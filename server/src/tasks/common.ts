// [S24] Shared helpers of the task system and the world-interaction verbs:
// row merge after a patch, public filtering of deed changes, coin / item /
// reputation movement, escrow release and task event fan-out. Every write goes
// through the transaction's Writer; callers hold the world row lock.

import type { Queryable } from "../db/db.ts";
import { getRow, selectRows } from "../facts/store.ts";
import {
  PUBLIC_CHAR_FIELDS,
  type Change,
  type CharRow,
  type EventDataMap,
  type Holder,
  type ID,
  type ItemInstanceRow,
  type ReputationRow,
  type Reward,
  type TaskInstanceRow,
  type Tick,
} from "../facts/types.ts";
import type { Writer } from "../facts/writer.ts";
import { NO_DETAILS, reject } from "../protocol/errors.ts";
import { mulDivFloor, type BonusRule, type TierTaskNumbers } from "./numbers.ts";

/** Row after `patch` was written at `tick` (Writer stamps updated_tick). */
export function merged<T extends { updated_tick: Tick }>(row: T, patch: Partial<T>, tick: Tick): T {
  return { ...row, ...patch, updated_tick: tick };
}

export function must(c: Change | null): Change {
  if (c === null) throw new Error("public table update returned no change");
  return c;
}

export const unique = (ids: readonly (ID | null | undefined)[]): ID[] => [...new Set(ids.filter((x): x is ID => typeof x === "string"))];

export function addSafe(a: number, b: number): number {
  const s = a + b;
  if (!Number.isSafeInteger(s) || s < 0) throw new Error("integer overflow in fact arithmetic");
  return s;
}

const PUBLIC_CHAR = new Set<string>(PUBLIC_CHAR_FIELDS);

/**
 * Changes fit for a deed seen by others (place / world, or several
 * participants): char rows keep only the public field white list
 * (事实格式 §12), so balances, xp, potential and known places never leak.
 */
export function publicChanges(changes: readonly Change[]): Change[] {
  const out: Change[] = [];
  for (const c of changes) {
    if (c.table !== "char") {
      out.push(c);
      continue;
    }
    const after: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(c.after)) if (PUBLIC_CHAR.has(k)) after[k] = v;
    if (Object.keys(after).length > 0) out.push({ ...c, after });
  }
  return out;
}

export const isExpired = (t: TaskInstanceRow, tick: Tick): boolean => BigInt(tick) >= BigInt(t.expires_tick);

/** A task instance the caller may address (personal offers of others are invisible). */
export async function loadInstance(q: Queryable, id: ID, me: ID, field = "args.id"): Promise<TaskInstanceRow> {
  const row = await getRow(q, "task", id);
  if (row === null) return reject("NOT_FOUND", NO_DETAILS, field);
  if (row.record !== "instance") return reject("INVALID_ARGUMENT", { expected: "ID of a task instance" }, field);
  if (row.eligible_char !== null && row.eligible_char !== me) return reject("NOT_FOUND", NO_DETAILS, field);
  return row;
}

/** Instances a char holds directly, available, unequipped (transferable), in ID order. */
export async function heldTransferable(q: Queryable, charId: ID, defId: ID): Promise<ItemInstanceRow[]> {
  const rows = await selectRows(
    q,
    "item",
    "record = 'instance' AND holder ->> 'kind' = 'char' AND holder ->> 'id' = $1 AND def_id = $2 AND state = 'available' AND equipped = false",
    [charId, defId],
    'ORDER BY id COLLATE "C"',
  );
  return rows as ItemInstanceRow[];
}

export async function moveItem(w: Writer, item: ItemInstanceRow, holder: Holder): Promise<{ row: ItemInstanceRow; change: Change }> {
  const patch = { holder, equipped: false };
  const change = must(await w.update("item", item.id, patch));
  return { row: merged(item, patch, w.tick), change };
}

export async function consumeItem(w: Writer, item: ItemInstanceRow): Promise<{ row: ItemInstanceRow; change: Change }> {
  const patch = { state: "consumed" as const, equipped: false };
  const change = must(await w.update("item", item.id, patch));
  return { row: merged(item, patch, w.tick), change };
}

export async function setCoin(w: Writer, c: CharRow, coin: number): Promise<{ row: CharRow; change: Change }> {
  const change = must(await w.update("char", c.id, { coin }));
  return { row: merged(c, { coin }, w.tick), change };
}

export async function emitItem(
  w: Writer,
  item: ItemInstanceRow,
  reason: EventDataMap["item_changed"]["reason"],
  recipients: readonly ID[],
  deedId: ID | null,
  placeId: ID | null = null,
): Promise<void> {
  const data = { item_id: item.id, def_id: item.def_id, reason, holder: item.holder, state: item.state };
  const to = unique(recipients);
  if (to.length > 0) await w.emit({ scope: "self", recipients: to, type: "item_changed", deed_id: deedId, data });
  if (placeId !== null) await w.emit({ scope: "place", place_id: placeId, type: "item_changed", deed_id: deedId, data });
}

/** Issuer char, taker and personal holder of a task (self audience). */
export function taskAudience(t: TaskInstanceRow): ID[] {
  return unique([t.issuer.kind === "char" ? t.issuer.id : null, t.taker, t.eligible_char]);
}

/** task_changed to its self audience; public tasks also to their offer place board. */
export async function emitTaskChanged(w: Writer, t: TaskInstanceRow, deedId: ID | null, extra: readonly ID[] = []): Promise<void> {
  const data = { task_id: t.id, state: t.state, taker: t.taker, progress: t.progress.count };
  const to = unique([...taskAudience(t), ...extra]);
  if (to.length > 0) await w.emit({ scope: "self", recipients: to, type: "task_changed", deed_id: deedId, data });
  if (t.eligible_char === null) await w.emit({ scope: "place", place_id: t.offer_place, type: "task_changed", deed_id: deedId, data });
}

/** Adds to the char's world reputation (row created if missing). */
export async function addWorldRep(q: Queryable, w: Writer, charId: ID, delta: number): Promise<{ row: ReputationRow; change: Change } | null> {
  if (delta === 0) return null;
  const rows = (await selectRows(q, "reputation", "char_id = $1 AND scope = 'world'", [charId], "FOR UPDATE")) as ReputationRow[];
  const cur = rows[0];
  if (cur === undefined) {
    const row: ReputationRow = {
      id: await w.newId("reputation"),
      created_tick: w.tick,
      updated_tick: w.tick,
      char_id: charId,
      scope: "world",
      org_id: null,
      value: delta,
    };
    return { row, change: must(await w.insert("reputation", row)) };
  }
  const value = cur.value + delta;
  if (!Number.isSafeInteger(value)) throw new Error("reputation overflow");
  return { row: merged(cur, { value }, w.tick), change: must(await w.update("reputation", cur.id, { value })) };
}

/** Credits xp / potential (and world reputation) of a reward to a char. */
export async function creditGrowth(
  q: Queryable,
  w: Writer,
  c: CharRow,
  r: { coin: number; xp: number; potential: number; rep: number },
  extra: Partial<CharRow> = {},
): Promise<{ row: CharRow; changes: Change[]; rep: ReputationRow | null }> {
  const patch: Partial<CharRow> = { ...extra };
  if (r.coin > 0) patch.coin = addSafe(c.coin, r.coin);
  if (r.xp > 0) patch.xp = addSafe(c.xp, r.xp);
  if (r.potential > 0) patch.potential = addSafe(c.potential, r.potential);
  const changes: Change[] = [];
  let row = c;
  if (Object.keys(patch).length > 0) {
    changes.push(must(await w.update("char", c.id, patch)));
    row = merged(c, patch, w.tick);
  }
  const rep = await addWorldRep(q, w, c.id, r.rep);
  if (rep !== null) changes.push(rep.change);
  return { row, changes, rep: rep?.row ?? null };
}

/** World-first deed bonus (S5 tasks.deed_bonus): tier full task xp / potential × bp, rep_bounty × mult. */
export function bonusReward(rule: BonusRule, t: TierTaskNumbers): Reward {
  return {
    coin: 0,
    xp: mulDivFloor(t.task_xp, rule.xp_bp, 10000),
    potential: mulDivFloor(t.task_potential, rule.potential_bp, 10000),
    rep: t.rep_bounty * rule.rep_mult,
    items: [],
  };
}

/** Taker lets go of an unexpired task: back to open, taker / evidence cleared; escrow stays. */
export async function reopenTask(w: Writer, t: TaskInstanceRow): Promise<{ task: TaskInstanceRow; change: Change }> {
  const patch = { state: "open" as const, taker: null, accepted_seq: null, progress: { count: 0, evidence: [] as ID[] } };
  const change = must(await w.update("task", t.id, patch));
  return { task: merged(t, patch, w.tick), change };
}

export interface Released {
  task: TaskInstanceRow;
  changes: Change[];
  /** Refunded issuer (char) and the changes of their own balance. */
  issuer: { id: ID; changes: Change[] } | null;
  items: { row: ItemInstanceRow; reason: "refund" | "consume" }[];
}

/**
 * Ends a task (cancelled / expired) and settles the escrow not paid out:
 * char issuer → coin and items back to the issuer; org issuer → coin to the
 * treasury, items consumed (an org cannot hold items); system → reclaimed
 * (coin no longer exists, items consumed). Escrow is emptied (事实格式 §9).
 */
export async function releaseTask(
  q: Queryable,
  w: Writer,
  t: TaskInstanceRow,
  state: "cancelled" | "expired",
): Promise<Released> {
  const changes: Change[] = [];
  const items: Released["items"] = [];
  let issuer: Released["issuer"] = null;
  const escrow = t.escrow;
  if (t.issuer.kind === "char") {
    const who = await getRow(q, "char", t.issuer.id, { lock: true });
    if (who === null) throw new Error(`fact integrity: issuer ${t.issuer.id} missing`);
    const own: Change[] = [];
    if (escrow.coin > 0) {
      const c = await setCoin(w, who, addSafe(who.coin, escrow.coin));
      own.push(c.change);
    }
    for (const id of escrow.items) {
      const it = await getRow(q, "item", id);
      if (it === null || it.record !== "instance") throw new Error(`fact integrity: escrow item ${id} missing`);
      const m = await moveItem(w, it, { kind: "char", id: who.id });
      changes.push(m.change);
      items.push({ row: m.row, reason: "refund" });
    }
    changes.push(...own);
    issuer = { id: who.id, changes: own };
  } else {
    if (t.issuer.kind === "org" && escrow.coin > 0) {
      const org = await getRow(q, "org", t.issuer.id, { lock: true });
      if (org === null) throw new Error(`fact integrity: issuer ${t.issuer.id} missing`);
      changes.push(must(await w.update("org", org.id, { treasury: addSafe(org.treasury, escrow.coin) })));
    }
    for (const id of escrow.items) {
      const it = await getRow(q, "item", id);
      if (it === null || it.record !== "instance") throw new Error(`fact integrity: escrow item ${id} missing`);
      const m = await consumeItem(w, it);
      changes.push(m.change);
      items.push({ row: m.row, reason: "consume" });
    }
  }
  const patch = { state, escrow: { coin: 0, items: [] as ID[] } };
  changes.unshift(must(await w.update("task", t.id, patch)));
  return { task: merged(t, patch, w.tick), changes, issuer, items };
}
