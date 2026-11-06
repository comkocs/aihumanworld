// [S25] use (动词表 §4.9):
// the closed set of 16 ops; no free-form intent. Prices / fees / periods are S5's.

import { itemPrice, tradePrice } from "../economy/prices.ts";
import { ITEM_CATEGORY, type DeedKind } from "../facts/enums.ts";
import { getRow, selectRows, type Patch } from "../facts/store.ts";
import type { BondRow, Change, CharRow, ID, ItemInstanceRow, Proposal, SkillLearnedRow, UInt } from "../facts/types.ts";
import { capacity, definition, equipped, stats } from "../npc/facts.ts";
import { changeOrg, emitBond, manageOrg, membership } from "../orgs/membership.ts";
import { boolAt, ceilRatio, cellNumber, checkedUInt, floorRatio, numberAt, requireRevision } from "../orgs/numbers.ts";
import { NO_DETAILS, reject } from "../protocol/errors.ts";
import { wakeSupply } from "../resources/clock.ts";
import { requireRule } from "../rules/world_rules.ts";
import { bondId, charId, deedId, direction, itemId, orgId } from "../protocol/shapes.ts";
import { bool, oneOf, uint, union, type Out } from "../protocol/validate.ts";
import { defineVerb, type VerbContext } from "./types.ts";

const args = union("op", {
  consume: { item: itemId },
  unlock: { item: itemId, dir: direction },
  equip: { item: itemId },
  unequip: { item: itemId },
  socket: { item: itemId, core: itemId, index: uint },
  unsocket: { item: itemId, index: uint },
  repair: { item: itemId, npc: charId },
  buy: { item: itemId, npc: charId },
  sell: { item: itemId, npc: charId },
  org_join: { org: orgId },
  org_leave: {},
  org_manage: { action: oneOf(["promote", "expel"] as const, "org_manage action"), target: charId },
  relation_offer: { kind: oneOf(["mentor", "ally"] as const, "relation kind"), target: charId },
  relation_accept: { offer: deedId },
  relation_end: { bond: bondId },
  enmity: { target: charId, active: bool },
});
export type UseArgs = Out<typeof args>;
export type UseOp = UseArgs["op"];
export interface UseResult {
  op: UseOp;
  changes: Change[];
  deed_id: ID;
  outcome: "success";
  /** buy / sell */
  price?: UInt;
  /** relation_offer */
  offer?: ID;
}

function actor(ctx: VerbContext): CharRow {
  if (ctx.actor === null) throw new Error("use without actor");
  return ctx.actor;
}

async function item(ctx: VerbContext, id: ID): Promise<ItemInstanceRow> {
  const row = await getRow(ctx.q, "item", id);
  if (row === null) return reject("NOT_FOUND", NO_DETAILS);
  if (row.record !== "instance") return reject("ITEM_STATE", { reason: "type" });
  if (row.state !== "available") return reject("ITEM_STATE", { reason: "consumed" });
  return row;
}

async function held(ctx: VerbContext, id: ID, unequipped = false): Promise<ItemInstanceRow> {
  const row = await item(ctx, id);
  if (row.holder.kind !== "char" || row.holder.id !== actor(ctx).id) return reject("NOT_ALLOWED", { reason: "ownership" });
  if (unequipped && row.equipped) return reject("ITEM_STATE", { reason: "equipped" });
  return row;
}

async function service(ctx: VerbContext, id: ID, archetype: "merchant" | "repairer"): Promise<CharRow> {
  const npc = await getRow(ctx.q, "char", id);
  if (npc === null) return reject("NOT_FOUND", NO_DETAILS);
  if (npc.loc !== actor(ctx).loc) return reject("NOT_HERE", NO_DETAILS);
  if (npc.kind !== "npc" || npc.archetype !== archetype || npc.life !== "alive" || npc.state !== "active") return reject("NOT_ALLOWED", { reason: "service" });
  return npc;
}

function sufficient(coin: number, required: number): void {
  if (coin < required) reject("INSUFFICIENT_RESOURCE", { resource: "coin", required, available: coin });
}

class Operation {
  readonly changes: Change[] = [];
  readonly ctx: VerbContext;
  constructor(ctx: VerbContext) { this.ctx = ctx; }
  async update<T extends "char" | "item" | "place" | "skill" | "bond">(table: T, id: ID, patch: Patch<T>): Promise<void> {
    const change = await this.ctx.w.update(table, id, patch);
    if (change !== null) this.changes.push(change);
    if (table === "char" && id === this.ctx.actor?.id) this.ctx.actor = { ...this.ctx.actor, ...patch } as CharRow;
  }
  async clampVigor(): Promise<void> {
    const me = actor(this.ctx);
    const max = (await stats(this.ctx.q, this.ctx.balance, me)).vigor_max;
    if (me.vigor > max) await this.update("char", me.id, { vigor: max });
  }
  async finish(op: UseOp, kind: DeedKind, targets: ID[], others: ID[] = [], proposal: Proposal | null = null): Promise<UseResult> {
    const me = actor(this.ctx);
    const deedChanges = others.some((id) => id !== me.id) ? this.changes.filter((c) => c.table !== "char") : this.changes;
    const deed = await this.ctx.w.deed({
      actor: me.id, verb: "use", kind, targets, place_id: me.loc,
      result: { outcome: "success", changes: deedChanges, roll: null, proposal }, visibility: "self", participants: others,
    });
    // Private char deltas are routed to their owner, never to the other party.
    for (const who of new Set([me.id, ...others])) {
      const changes = this.changes.filter((c) => c.table === "char" ? c.id === who : who === me.id);
      if (changes.length > 0) await this.ctx.w.emit({ scope: "self", recipients: [who], type: "fact_changed", deed_id: deed.id, data: { changes } });
    }
    for (const change of this.changes) {
      if (change.table !== "item") continue;
      const row = await getRow(this.ctx.q, "item", change.id);
      if (row?.record !== "instance") continue;
      const reason = op === "unlock" ? "consume" : op;
      if (reason !== "consume" && reason !== "equip" && reason !== "unequip" && reason !== "socket" && reason !== "unsocket" && reason !== "repair" && reason !== "buy" && reason !== "sell") continue;
      await this.ctx.w.emit({ scope: "self", recipients: [me.id, ...others], type: "item_changed", deed_id: deed.id,
        data: { item_id: row.id, def_id: row.def_id, reason, holder: row.holder, state: row.state } });
    }
    if (proposal !== null) await this.ctx.w.emit({ scope: "self", recipients: [proposal.a, proposal.b], type: "relation_proposed", deed_id: deed.id, data: { offer: deed.id, proposal } });
    return { op, changes: this.changes.filter((c) => c.table !== "char" || c.id === me.id), deed_id: deed.id, outcome: "success", ...(proposal === null ? {} : { offer: deed.id }) };
  }
}

async function consume(ctx: VerbContext, id: ID): Promise<UseResult> {
  const me = actor(ctx);
  const row = await held(ctx, id, true);
  const def = await definition(ctx.q, row.def_id);
  const effect = def.effect;
  const operation = new Operation(ctx);
  let learned: { row: SkillLearnedRow; key: string } | null = null;
  if (def.kind === "potion" && effect.kind === "restore") {
    const max = (await stats(ctx.q, ctx.balance, me)).vigor_max;
    await operation.update("char", me.id, { vigor: Number(BigInt(me.vigor) + BigInt(effect.vigor) > BigInt(max) ? BigInt(max) : BigInt(me.vigor) + BigInt(effect.vigor)) });
  } else if (def.kind === "scroll" && effect.kind === "learn") {
    if (def.tier !== me.tier) return reject("ITEM_STATE", { reason: "type" });
    const skill = (await selectRows(ctx.q, "skill", "record = 'definition' AND key = $1", [effect.skill]))[0];
    if (skill?.record !== "definition") return reject("NOT_FOUND", NO_DETAILS);
    if (skill.tier > me.tier) return reject("ITEM_STATE", { reason: "type" });
    if (skill.org_id !== null) {
      const member = await membership(ctx.q, me.id);
      const org = await getRow(ctx.q, "org", skill.org_id);
      if (member.b !== skill.org_id || !org?.skill_defs.includes(skill.id)) return reject("NOT_ALLOWED", { reason: "rank" });
    }
    const old = (await selectRows(ctx.q, "skill", "record = 'learned' AND char_id = $1 AND def_id = $2", [me.id, skill.id]))[0];
    const hard = cellNumber(ctx.balance, "tiers", { tier: me.tier }, "skill_cap_hard");
    const previous = old?.record === "learned" ? old : null;
    if ((previous?.level ?? 0) >= hard || effect.levels === 0) return reject("SKILL_CAP", { level: previous?.level ?? 0, cap: hard });
    const level = Number(BigInt(previous?.level ?? 0) + BigInt(effect.levels) > BigInt(hard) ? BigInt(hard) : BigInt(previous?.level ?? 0) + BigInt(effect.levels));
    const cap = Math.min(hard, Math.max(previous?.cap ?? 0, level));
    const next: SkillLearnedRow = previous === null ? {
      id: await ctx.w.newId("skill"), created_tick: ctx.tick, updated_tick: ctx.tick,
      record: "learned", char_id: me.id, def_id: skill.id, level, cap,
    } : { ...previous, level, cap, updated_tick: ctx.tick };
    if (previous === null) {
      const change = await ctx.w.insert("skill", next);
      if (change !== null) operation.changes.push(change);
    } else await operation.update("skill", next.id, { level, cap });
    learned = { row: next, key: skill.key };
  } else if (def.kind === "map" && effect.kind === "map") {
    for (const place of effect.places) if (await getRow(ctx.q, "place", place) === null) return reject("NOT_FOUND", NO_DETAILS);
    await operation.update("char", me.id, { known_places: [...new Set([...me.known_places, ...effect.places])] });
  } else return reject("ITEM_STATE", { reason: "type" });
  await operation.update("item", row.id, { state: "consumed" });
  const result = await operation.finish("consume", "use", [row.id]);
  if (learned !== null) await ctx.w.emit({ scope: "self", recipients: [me.id], type: "skill_changed", deed_id: result.deed_id,
    data: { char_id: me.id, skill: learned.key, level: learned.row.level, cap: learned.row.cap } });
  return result;
}

async function equipment(ctx: VerbContext, a: Extract<UseArgs, { op: "equip" | "unequip" | "socket" | "unsocket" }>): Promise<UseResult> {
  const me = actor(ctx);
  const row = await held(ctx, a.item);
  const def = await definition(ctx.q, row.def_id);
  const category = ITEM_CATEGORY[def.kind];
  if (category !== "weapon" && category !== "armor" && category !== "accessory") return reject("ITEM_STATE", { reason: "type" });
  const operation = new Operation(ctx);
  const gear = await equipped(ctx.q, me.id);
  const max = (await stats(ctx.q, ctx.balance, me)).cap_max;
  let used = 0n;
  for (const equippedItem of gear) used += BigInt(await capacity(ctx.q, equippedItem));
  const checkCapacity = (required: bigint): void => {
    if (required > BigInt(max)) reject("CAPACITY_EXCEEDED", { required: checkedUInt(required), available: max });
  };
  if (a.op === "equip") {
    if (row.equipped) return reject("ITEM_STATE", { reason: "equipped" });
    if (row.dura === 0) return reject("ITEM_STATE", { reason: "durability" });
    checkCapacity(used + BigInt(await capacity(ctx.q, row)));
    let positions = 0;
    for (const other of gear) if (ITEM_CATEGORY[(await definition(ctx.q, other.def_id)).kind] === category) positions += 1;
    if (positions >= numberAt(ctx.balance, `equipment.positions.${category}`)) return reject("ITEM_STATE", { reason: "equipped" });
    await operation.update("item", row.id, { equipped: true });
  } else if (a.op === "unequip") {
    if (!row.equipped) return reject("ITEM_STATE", { reason: "equipped" });
    await operation.update("item", row.id, { equipped: false });
  } else {
    if (a.index >= row.sockets.length || a.index >= def.slots || a.index >= requireRule(ctx.rules, "socket_max")) return reject("ITEM_STATE", { reason: "socket" });
    const sockets = [...row.sockets];
    if (a.op === "socket") {
      if (sockets[a.index] !== null) return reject("ITEM_STATE", { reason: "socket" });
      const core = await held(ctx, a.core, true);
      const coreDef = await definition(ctx.q, core.def_id);
      if (core.id === row.id || coreDef.kind !== "core" || coreDef.effect.kind !== "socket") return reject("ITEM_STATE", { reason: "type" });
      if (row.equipped) checkCapacity(used + BigInt(coreDef.cap));
      sockets[a.index] = core.id;
      await operation.update("item", core.id, { holder: { kind: "item", id: row.id } });
    } else {
      const id = sockets[a.index];
      if (id === null || id === undefined) return reject("ITEM_STATE", { reason: "socket" });
      const core = await item(ctx, id);
      if (core.holder.kind !== "item" || core.holder.id !== row.id) return reject("ITEM_STATE", { reason: "socket" });
      const fee = floorRatio(await itemPrice(ctx.q, ctx.balance, core.def_id), numberAt(ctx.balance, "cores.unsocket_fee_bp"));
      sufficient(me.coin, fee);
      await operation.update("char", me.id, { coin: me.coin - fee });
      await operation.update("item", core.id, { holder: { kind: "char", id: me.id } });
      sockets[a.index] = null;
    }
    await operation.update("item", row.id, { sockets });
  }
  await operation.clampVigor();
  return operation.finish(a.op, "equip", [row.id, ...(a.op === "socket" ? [a.core] : [])]);
}

async function trade(ctx: VerbContext, a: Extract<UseArgs, { op: "buy" | "sell" | "repair" }>): Promise<UseResult> {
  const me = actor(ctx);
  const npc = await service(ctx, a.npc, a.op === "repair" ? "repairer" : "merchant");
  const row = a.op === "buy" ? await item(ctx, a.item) : await held(ctx, a.item, a.op === "sell");
  if (row.holder.kind !== "char" || row.holder.id !== (a.op === "buy" ? npc.id : me.id)) return reject("NOT_ALLOWED", { reason: "ownership" });
  if (a.op === "buy" && row.equipped) return reject("ITEM_STATE", { reason: "equipped" });
  const def = await definition(ctx.q, row.def_id);
  const basePrice = await itemPrice(ctx.q, ctx.balance, def.id);
  const operation = new Operation(ctx);
  let amount: number;
  if (a.op === "repair") {
    const category = ITEM_CATEGORY[def.kind];
    if (category !== "weapon" && category !== "armor" && category !== "accessory") return reject("ITEM_STATE", { reason: "type" });
    if (def.dura_max === 0 || row.dura >= def.dura_max) return reject("ITEM_STATE", { reason: "durability" });
    amount = ceilRatio(BigInt(basePrice) * BigInt(numberAt(ctx.balance, "equipment.repair_full_bp")) * BigInt(def.dura_max - row.dura), 10000n * BigInt(def.dura_max));
    sufficient(me.coin, amount);
    await operation.update("char", me.id, { coin: me.coin - amount });
    await operation.update("char", npc.id, { coin: checkedUInt(BigInt(npc.coin) + BigInt(amount)) });
    await operation.update("item", row.id, { dura: def.dura_max });
  } else {
    amount = tradePrice(ctx.balance, basePrice, a.op);
    const buyer = a.op === "buy" ? me : npc;
    const seller = a.op === "buy" ? npc : me;
    sufficient(buyer.coin, amount);
    await operation.update("char", buyer.id, { coin: buyer.coin - amount });
    await operation.update("char", seller.id, { coin: checkedUInt(BigInt(seller.coin) + BigInt(amount)) });
    await operation.update("item", row.id, { holder: { kind: "char", id: buyer.id } });
    // [S27] The shop is one item poorer: wake its supply row if it was idle.
    if (a.op === "buy") await wakeSupply(ctx.q, ctx.balance, { kind: "char", id: npc.id }, row.def_id, ctx.tick);
  }
  const result = await operation.finish(a.op, a.op === "repair" ? "repair" : "trade", [row.id, npc.id], [npc.id]);
  return a.op === "repair" ? result : { ...result, price: amount };
}

async function activeBond(ctx: VerbContext, kind: BondRow["kind"], a: ID, b: ID): Promise<BondRow | null> {
  return (await selectRows(ctx.q, "bond", "kind = $1 AND a = $2 AND b = $3 AND state = 'active'", [kind, a, b]))[0] ?? null;
}

async function teacher(ctx: VerbContext, master: CharRow, pupil: CharRow): Promise<void> {
  if (master.life !== "alive" || (master.state !== "draft" && master.state !== "active") || master.tier <= pupil.tier) return reject("TEACHER_REQUIRED", { reason: "tier" });
  if (master.kind === "npc" && master.archetype === "master") return;
  const skills = await selectRows(ctx.q, "skill", "record = 'learned' AND char_id = $1 AND level > 0", [master.id]);
  if (skills.length === 0) return reject("TEACHER_REQUIRED", { reason: "level" });
}

async function relationship(ctx: VerbContext, a: Extract<UseArgs, { op: "relation_offer" | "relation_accept" | "relation_end" | "enmity" }>): Promise<UseResult> {
  const me = actor(ctx);
  const operation = new Operation(ctx);
  if (a.op === "relation_offer" || a.op === "enmity") {
    const target = await getRow(ctx.q, "char", a.target);
    if (target === null) return reject("NOT_FOUND", NO_DETAILS);
    if (target.id === me.id) return reject("NOT_ALLOWED", { reason: "ownership" });
    if (a.op === "enmity") {
      const old = await activeBond(ctx, "enemy", me.id, target.id);
      if ((old !== null) === a.active) return reject("CONDITION_UNMET", { reason: "relation" });
      let bond: BondRow;
      if (old !== null) {
        await operation.update("bond", old.id, { state: "ended", ended_tick: ctx.tick });
        bond = { ...old, state: "ended", ended_tick: ctx.tick, updated_tick: ctx.tick };
      } else {
        bond = await makeBond(ctx, operation.changes, "enemy", me.id, target.id);
      }
      const result = await operation.finish(a.op, "enmity", [target.id, bond.id], [target.id]);
      await emitBond(ctx.w, bond, result.deed_id);
      return result;
    }
    if (target.loc !== me.loc) return reject("NOT_HERE", NO_DETAILS);
    if (target.life !== "alive" || (target.state !== "draft" && target.state !== "active")) return reject("NOT_ALLOWED", { reason: "service" });
    if (a.kind === "mentor") await teacher(ctx, me, target);
    const endpoints = a.kind === "ally" ? [me.id, target.id].sort() : [me.id, target.id];
    if (await activeBond(ctx, a.kind, endpoints[0]!, endpoints[1]!) !== null) return reject("NOT_ALLOWED", { reason: "ownership" });
    const proposal: Proposal = { kind: a.kind, a: me.id, b: target.id, expires_tick: (BigInt(ctx.tick) + BigInt(numberAt(ctx.balance, "clock.proposal_ttl_ticks"))).toString() };
    return operation.finish(a.op, "relation_offer", [target.id], [target.id], proposal);
  }
  if (a.op === "relation_end") {
    const old = await getRow(ctx.q, "bond", a.bond);
    if (old === null) return reject("NOT_FOUND", NO_DETAILS);
    if ((old.kind !== "mentor" && old.kind !== "ally") || old.state !== "active" || (old.a !== me.id && old.b !== me.id)) return reject("NOT_ALLOWED", { reason: "ownership" });
    await operation.update("bond", old.id, { state: "ended", ended_tick: ctx.tick });
    const result = await operation.finish(a.op, "relation_end", [old.id], [old.a, old.b]);
    await emitBond(ctx.w, { ...old, state: "ended", ended_tick: ctx.tick, updated_tick: ctx.tick }, result.deed_id);
    return result;
  }
  const offer = await getRow(ctx.q, "deed", a.offer);
  if (offer === null || offer.kind !== "relation_offer" || offer.verb !== "use" || offer.result.proposal === null) return reject("NOT_FOUND", NO_DETAILS);
  const proposal = offer.result.proposal;
  if (proposal.b !== me.id) return reject("OFFER_STATE", { reason: "recipient" });
  const used = await selectRows(ctx.q, "deed", "kind = 'relation_accept' AND targets @> $1::jsonb", [JSON.stringify([offer.id])], "LIMIT 1");
  if (used.length > 0) return reject("OFFER_STATE", { reason: "used" });
  if (BigInt(ctx.tick) >= BigInt(proposal.expires_tick)) return reject("OFFER_STATE", { reason: "expired" });
  const proposer = await getRow(ctx.q, "char", proposal.a);
  if (proposer === null) return reject("NOT_FOUND", NO_DETAILS);
  if (proposal.kind === "mentor") await teacher(ctx, proposer, me);
  const endpoints = proposal.kind === "ally" ? [proposal.a, proposal.b].sort() : [proposal.a, proposal.b];
  if (await activeBond(ctx, proposal.kind, endpoints[0]!, endpoints[1]!) !== null) return reject("OFFER_STATE", { reason: "used" });
  const bond = await makeBond(ctx, operation.changes, proposal.kind, endpoints[0]!, endpoints[1]!);
  const result = await operation.finish(a.op, "relation_accept", [offer.id, bond.id], [proposer.id]);
  await emitBond(ctx.w, bond, result.deed_id);
  return result;
}

async function makeBond(ctx: VerbContext, changes: Change[], kind: "mentor" | "ally" | "enemy", a: ID, b: ID): Promise<BondRow> {
  const bond: BondRow = {
    id: await ctx.w.newId("bond"), created_tick: ctx.tick, updated_tick: ctx.tick, kind, a, b,
    state: "active", weight: numberAt(ctx.balance, "economy.bond_weight_initial"), rank: null, since_tick: ctx.tick, ended_tick: null,
  };
  const change = await ctx.w.insert("bond", bond);
  if (change !== null) changes.push(change);
  return bond;
}

export const def = defineVerb<UseArgs, UseResult>({
  verb: "use",
  summary: "使用物品、买卖修理，或管理组织与人物关系。",
  errors: ["NOT_FOUND", "NOT_HERE", "NOT_ALLOWED", "ITEM_STATE", "INSUFFICIENT_RESOURCE", "CAPACITY_EXCEEDED", "SKILL_CAP", "EXIT_BLOCKED", "OFFER_STATE"],
  purpose: (a) => ({
    consume: "消耗药品、卷轴或地图。", unlock: "用匹配钥匙打开当前地点指定方向的锁门。",
    equip: "装备背包里的物品。", unequip: "卸下已装备物品。", socket: "把核心镶入指定孔位。", unsocket: "付费取下指定孔位的核心。",
    repair: "向同地修理匠付费修复装备耐久。", buy: "按 GET /v1/shops/{npc} 的实例 item.id 向同地商人买入。", sell: "向同地商人出售自己的未装备物品。",
    org_join: "加入指定组织。", org_leave: "离开当前组织。", org_manage: "按职级权限晋升或移除组织成员。",
    relation_offer: "向同地人物发起师徒或盟友邀约。", relation_accept: "接受仍有效的关系邀约。", relation_end: "结束自己的师徒或盟友关系。", enmity: "建立或结束自己的敌对关系。",
  })[a.op],
  args,
  lock: "world",
  auth: () => true,
  costKey: () => "use",
  gate: () => "acting",
  async handler(ctx, a) {
    requireRevision(ctx.balance, ctx.world.rules_revision, ctx.rules.balance_key);
    switch (a.op) {
      case "consume": return consume(ctx, a.item);
      case "equip": case "unequip": case "socket": case "unsocket": return equipment(ctx, a);
      case "repair": case "buy": case "sell": return trade(ctx, a);
      case "org_join": {
        const result = await changeOrg(ctx, a.org);
        return { op: a.op, ...result, outcome: "success" };
      }
      case "org_leave": {
        const result = await changeOrg(ctx, null);
        return { op: a.op, ...result, outcome: "success" };
      }
      case "org_manage": {
        const result = await manageOrg(ctx, a.action, a.target);
        return { op: a.op, ...result, outcome: "success" };
      }
      case "relation_offer": case "relation_accept": case "relation_end": case "enmity": return relationship(ctx, a);
      case "unlock": {
        const me = actor(ctx);
        const key = await held(ctx, a.item, true);
        const def = await definition(ctx.q, key.def_id);
        if (def.kind !== "key" || def.effect.kind !== "unlock") return reject("ITEM_STATE", { reason: "type" });
        const place = await getRow(ctx.q, "place", me.loc);
        if (place === null) return reject("NOT_FOUND", NO_DETAILS);
        const exit = place.exits.find((e) => e.dir === a.dir);
        if (exit === undefined) return reject("NOT_FOUND", NO_DETAILS);
        if (!exit.locked || exit.key_def !== def.id) return reject("EXIT_BLOCKED", { reason: "locked" });
        const operation = new Operation(ctx);
        await operation.update("place", place.id, { exits: place.exits.map((e) => e.dir === a.dir ? { ...e, locked: false } : e) });
        if (boolAt(ctx.balance, "economy.key_consumed")) await operation.update("item", key.id, { state: "consumed" });
        const result = await operation.finish(a.op, "use", [key.id, place.id]);
        await ctx.w.emit({ scope: "place", place_id: place.id, type: "fact_changed", deed_id: result.deed_id, data: { changes: result.changes.filter((c) => c.table === "place") } });
        return result;
      }
    }
  },
});
