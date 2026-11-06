// Atomic membership transitions and org reputation. The caller owns the transaction.

import type { Queryable } from "../db/db.ts";
import { getRow, selectRows } from "../facts/store.ts";
import type { BondRow, Change, CharRow, ID, OrgRow, ReputationRow } from "../facts/types.ts";
import type { Writer } from "../facts/writer.ts";
import { NO_DETAILS, reject } from "../protocol/errors.ts";
import type { VerbContext } from "../verbs/types.ts";
import { cellNumber, checkedUInt, numberAt } from "./numbers.ts";

export async function membership(q: Queryable, char: ID): Promise<BondRow> {
  const rows = await selectRows(q, "bond", "kind = 'member' AND state = 'active' AND a = $1", [char]);
  if (rows.length !== 1 || rows[0] === undefined) throw new Error("S25 expected one active membership");
  return rows[0];
}

export async function orgReputation(q: Queryable, w: Writer, char: ID, org: ID, delta: number): Promise<{ row: ReputationRow; change: Change }> {
  const old = (await selectRows(q, "reputation", "char_id = $1 AND scope = 'org' AND org_id = $2", [char, org]))[0];
  const value = BigInt(old?.value ?? 0) + BigInt(delta);
  if (value < -BigInt(Number.MAX_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("S25 reputation outside Int range");
  const row: ReputationRow = old === undefined ? {
    id: await w.newId("reputation"), created_tick: w.tick, updated_tick: w.tick,
    char_id: char, scope: "org", org_id: org, value: Number(value),
  } : { ...old, value: Number(value), updated_tick: w.tick };
  const change = old === undefined ? await w.insert("reputation", row) : await w.update("reputation", row.id, { value: row.value });
  if (change === null) throw new Error("S25 reputation missing Change");
  return { row, change };
}

async function orgOf(q: Queryable, id: ID): Promise<OrgRow> {
  const org = await getRow(q, "org", id);
  if (org === null) return reject("NOT_FOUND", NO_DETAILS);
  return org;
}

async function newMember(w: Writer, who: ID, org: OrgRow, weight: number): Promise<{ row: BondRow; change: Change }> {
  const rank = (org.ranks.find((r) => r.key === "org_rank.member") ?? [...org.ranks].sort((a, b) => a.rank - b.rank)[0])?.rank;
  if (rank === undefined) throw new Error("S25 organization without default rank");
  const row: BondRow = {
    id: await w.newId("bond"), created_tick: w.tick, updated_tick: w.tick,
    kind: "member", a: who, b: org.id, state: "active", weight, rank,
    since_tick: w.tick, ended_tick: null,
  };
  const change = await w.insert("bond", row);
  if (change === null) throw new Error("S25 membership missing Change");
  return { row, change };
}

export async function emitBond(w: Writer, bond: BondRow, deed: ID): Promise<void> {
  const recipients = bond.kind === "member" ? [bond.a] : [bond.a, bond.b];
  await w.emit({ scope: "self", recipients, type: "bond_changed", deed_id: deed, data: { bond } });
}

interface MembershipResult { changes: Change[]; deed_id: ID }

export async function changeOrg(ctx: VerbContext, destination: ID | null): Promise<MembershipResult> {
  const me = ctx.actor;
  if (me === null) throw new Error("S25 organization without actor");
  const member = await membership(ctx.q, me.id);
  const old = await orgOf(ctx.q, member.b);
  const registry = ctx.world.registry_orgs[me.origin_region];
  if (destination === member.b) return reject("NOT_ALLOWED", { reason: "rank" });
  if (destination === null && old.registry) return reject("NOT_ALLOWED", { reason: "registry" });
  const next = await orgOf(ctx.q, destination ?? registry);
  if (destination !== null && next.hall !== me.loc) return reject("NOT_HERE", NO_DETAILS);
  if (next.registry && next.id !== registry) return reject("NOT_ALLOWED", { reason: "registry" });
  const leave = old.registry ? 0 : cellNumber(ctx.balance, "tier_prices", { tier: me.tier }, "org_leave_coin");
  const join = next.registry ? 0 : cellNumber(ctx.balance, "tier_prices", { tier: me.tier }, "org_join_fee");
  const total = checkedUInt(BigInt(leave) + BigInt(join));
  if (me.coin < total) return reject("INSUFFICIENT_RESOURCE", { resource: "coin", required: total, available: me.coin });
  const changes: Change[] = [];
  const leaving: Change[] = [];
  const push = (list: Change[], c: Change | null): void => { if (c !== null) { list.push(c); changes.push(c); } };
  const ended = { ...member, state: "ended" as const, ended_tick: ctx.tick, updated_tick: ctx.tick };
  push(leaving, await ctx.w.update("bond", member.id, { state: "ended", ended_tick: ctx.tick }));
  if (leave > 0) push(leaving, await ctx.w.update("char", me.id, { coin: me.coin - leave }));
  const rep = old.registry ? null : await orgReputation(ctx.q, ctx.w, me.id, old.id, -numberAt(ctx.balance, "orgs.leave_rep_loss"));
  if (rep !== null) { leaving.push(rep.change); changes.push(rep.change); }
  const left = await ctx.w.deed({
    actor: me.id, verb: "use", kind: "org_leave", targets: [old.id, member.id], place_id: me.loc,
    result: { outcome: "success", changes: leaving, roll: null, proposal: null }, visibility: "self", participants: [me.id],
  });
  await emitBond(ctx.w, ended, left.id);
  if (rep !== null) await ctx.w.emit({ scope: "self", recipients: [me.id], type: "reputation_changed", deed_id: left.id, data: { reputation: rep.row } });
  const joining: Change[] = [];
  if (join > 0) {
    push(joining, await ctx.w.update("char", me.id, { coin: me.coin - total }));
    push(joining, await ctx.w.update("org", next.id, { treasury: checkedUInt(BigInt(next.treasury) + BigInt(join)) }));
  }
  const added = await newMember(ctx.w, me.id, next, numberAt(ctx.balance, "economy.bond_weight_initial"));
  joining.push(added.change); changes.push(added.change);
  const joined = await ctx.w.deed({
    actor: me.id, verb: "use", kind: "org_join", targets: [next.id, added.row.id], place_id: me.loc,
    result: { outcome: "success", changes: joining, roll: null, proposal: null }, visibility: "self", participants: [me.id],
  });
  await emitBond(ctx.w, added.row, joined.id);
  await ctx.w.emit({ scope: "self", recipients: [me.id], type: "fact_changed", deed_id: joined.id, data: { changes } });
  ctx.actor = { ...me, coin: me.coin - total };
  return { changes, deed_id: joined.id };
}

export async function manageOrg(ctx: VerbContext, action: "promote" | "expel", target: ID): Promise<MembershipResult> {
  const me = ctx.actor;
  if (me === null) throw new Error("S25 organization without actor");
  const who: CharRow | null = await getRow(ctx.q, "char", target);
  if (who === null) return reject("NOT_FOUND", NO_DETAILS);
  const mine = await membership(ctx.q, me.id);
  const theirs = await membership(ctx.q, target);
  if (mine.b !== theirs.b) return reject("NOT_ALLOWED", { reason: "rank" });
  const org = await orgOf(ctx.q, mine.b);
  const rank = org.ranks.find((r) => r.rank === mine.rank);
  if (!(action === "promote" ? rank?.can_promote : rank?.can_expel)) return reject("NOT_ALLOWED", { reason: "rank" });
  if (action === "promote" && target === me.id) return reject("NOT_ALLOWED", { reason: "rank" });
  if (action === "expel" && org.registry) return reject("NOT_ALLOWED", { reason: "registry" });
  const changes: Change[] = [];
  let bond: BondRow;
  if (action === "promote") {
    const next = [...org.ranks].sort((a, b) => a.rank - b.rank).find((r) => r.rank > (theirs.rank ?? -1));
    if (next === undefined) return reject("CONDITION_UNMET", { reason: "rank" });
    const change = await ctx.w.update("bond", theirs.id, { rank: next.rank });
    if (change !== null) changes.push(change);
    bond = { ...theirs, rank: next.rank, updated_tick: ctx.tick };
  } else {
    const change = await ctx.w.update("bond", theirs.id, { state: "ended", ended_tick: ctx.tick });
    if (change !== null) changes.push(change);
    bond = { ...theirs, state: "ended", ended_tick: ctx.tick, updated_tick: ctx.tick };
  }
  const deed = await ctx.w.deed({
    actor: me.id, verb: "use", kind: action === "promote" ? "org_promote" : "org_expel", targets: [org.id, target, bond.id], place_id: me.loc,
    result: { outcome: "success", changes: [...changes], roll: null, proposal: null }, visibility: "self", participants: [target],
  });
  await emitBond(ctx.w, bond, deed.id);
  if (action === "expel") {
    const registry = await orgOf(ctx.q, ctx.world.registry_orgs[who.origin_region]);
    const added = await newMember(ctx.w, target, registry, numberAt(ctx.balance, "economy.bond_weight_initial"));
    changes.push(added.change);
    const joined = await ctx.w.deed({
      actor: target, verb: "use", kind: "org_join", targets: [registry.id, added.row.id], place_id: who.loc,
      result: { outcome: "success", changes: [added.change], roll: null, proposal: null }, visibility: "self", participants: [me.id, target],
    });
    await emitBond(ctx.w, added.row, joined.id);
  }
  return { changes, deed_id: deed.id };
}
