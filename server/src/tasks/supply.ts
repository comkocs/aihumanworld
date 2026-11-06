// [S24] System task supply (产品文档 5.2「保证任何时刻任何角色都有事可接」,
// 事实格式 §9「system 每角色保持可接实例供给」). Each player / official keeps
// tasks.supply_per_char personal open offers (eligible_char = the char). Open
// personal offers follow their char: they are offered where the char asks
// (enter, task list, accept), so nobody is left without work after moving.
// New offers are cloned from templates by a deterministic rule: own tier first,
// then lower tiers; nearest stage; then a stable hash of (char, template, day).
// Rewards are min(template reward_spec, S5 table of the template's tier × tpl),
// reputation capped by tasks.rep_system; reward items are minted as instances
// held by the task (escrow). Nothing is written as prose.

import { createHash } from "node:crypto";
import type { Queryable } from "../db/db.ts";
import { getRow, selectRows } from "../facts/store.ts";
import type {
  Change,
  CharRow,
  ID,
  ItemInstanceRow,
  TaskInstanceRow,
  TaskTemplateRow,
  Tick,
  WorldRow,
} from "../facts/types.ts";
import type { Writer } from "../facts/writer.ts";
import { must } from "./common.ts";
import { rewardKey, taskNumbers, type TaskNumbers } from "./numbers.ts";

export interface SupplyCtx {
  q: Queryable;
  w: Writer;
  tick: Tick;
  world: WorldRow;
  balance: unknown;
}

const hashOrder = (charId: ID, templateId: ID, day: number): string =>
  createHash("sha256").update(`${charId}|${templateId}|${day}`).digest("hex");

const before = (aT: number, aS: number, bT: number, bS: number): boolean => aT < bT || (aT === bT && aS < bS);

/** Template references still resolve and the task is not already satisfied here. */
async function usable(q: Queryable, char: CharRow, t: TaskTemplateRow, placeId: ID): Promise<boolean> {
  const c = t.condition;
  const placeOk = async (id: ID): Promise<boolean> => (await getRow(q, "place", id)) !== null;
  const defOk = async (id: ID): Promise<boolean> => (await getRow(q, "item", id))?.record === "definition";
  const charOk = async (id: ID): Promise<boolean> => {
    if (id === char.id) return false;
    const other = await getRow(q, "char", id);
    return other !== null && other.state !== "buried";
  };
  switch (c.tpl) {
    case "deliver":
      return (await defOk(c.item_def)) && (await placeOk(c.to_place)) && (c.to_char === null || (await charOk(c.to_char)));
    case "gather":
      return (await defOk(c.item_def)) && (await placeOk(c.to_place));
    case "find":
      return charOk(c.target);
    case "slay":
      return c.target === null || (await charOk(c.target));
    case "reach":
      if (c.mode === "place") return c.place !== placeId && (await placeOk(c.place));
      return before(char.tier, char.stage, c.tier, c.stage);
  }
}

async function instantiate(ctx: SupplyCtx, n: TaskNumbers, char: CharRow, t: TaskTemplateRow, placeId: ID): Promise<Change[]> {
  const { q, w, tick } = ctx;
  const base = n.rewards.get(rewardKey(t.tier, t.tpl));
  if (base === undefined) throw new Error(`no S5 reward row for ${t.tier}/${t.tpl}`);
  const id = await w.newId("task");
  const changes: Change[] = [];
  const items: ID[] = [];
  const itemRows: ItemInstanceRow[] = [];
  for (const defId of t.reward_spec.item_defs) {
    const d = await getRow(q, "item", defId);
    if (d === null || d.record !== "definition") continue;
    const inst: ItemInstanceRow = {
      id: await w.newId("item"),
      created_tick: tick,
      updated_tick: tick,
      record: "instance",
      def_id: d.id,
      holder: { kind: "task", id },
      state: "available",
      equipped: false,
      dura: d.dura_max,
      sockets: Array.from({ length: d.slots }, () => null),
    };
    itemRows.push(inst);
    items.push(inst.id);
  }
  const spec = t.reward_spec;
  const reward = {
    coin: Math.min(spec.coin, base.coin),
    xp: Math.min(spec.xp, base.xp),
    potential: Math.min(spec.potential, base.potential),
    rep: Math.min(spec.rep, n.rep_system),
    items,
  };
  const raw = t.duration_ticks === 0 ? n.duration.default : t.duration_ticks;
  const duration = Math.min(n.duration.max, Math.max(n.duration.min, raw));
  const row: TaskInstanceRow = {
    id,
    created_tick: tick,
    updated_tick: tick,
    record: "instance",
    template_id: t.id,
    kind: "system",
    tpl: t.tpl,
    issuer: { kind: "system", id: ctx.world.id },
    offer_place: placeId,
    eligible_char: char.id,
    issuer_tier: null,
    taker: null,
    condition: structuredClone(t.condition),
    reward,
    escrow: { coin: reward.coin, items: [...items] },
    state: "open",
    accepted_seq: null,
    progress: { count: 0, evidence: [] },
    expires_tick: (BigInt(tick) + BigInt(duration)).toString(),
  };
  changes.push(must(await w.insert("task", row)));
  for (const inst of itemRows) changes.push(must(await w.insert("item", inst)));
  return changes;
}

/** Personal open system offers of a char (not yet past expiry). */
export async function openOffers(q: Queryable, charId: ID, tick: Tick): Promise<TaskInstanceRow[]> {
  const rows = await selectRows(
    q,
    "task",
    "record = 'instance' AND kind = 'system' AND state = 'open' AND eligible_char = $1 AND expires_tick > $2",
    [charId, tick],
    'ORDER BY id COLLATE "C"',
  );
  return rows as TaskInstanceRow[];
}

/**
 * Keeps the char's supply at `placeId`: moves its open personal offers here and
 * tops them up to tasks.supply_per_char from templates. Returns the changes.
 */
export async function supplyFor(ctx: SupplyCtx, char: CharRow, placeId: ID): Promise<Change[]> {
  if (char.kind === "npc") return [];
  const n = taskNumbers(ctx.balance);
  const { q, w } = ctx;
  const changes: Change[] = [];
  const mine = await openOffers(q, char.id, ctx.tick);
  for (const t of mine) {
    if (t.offer_place !== placeId) changes.push(must(await w.update("task", t.id, { offer_place: placeId })));
  }
  let need = n.supply_per_char - mine.length;
  if (need <= 0) return changes;

  const inUse = await selectRows(
    q,
    "task",
    "record = 'instance' AND state IN ('open', 'accepted') AND template_id IS NOT NULL AND (eligible_char = $1 OR taker = $1)",
    [char.id],
  );
  const busy = new Set(inUse.map((r) => (r.record === "instance" ? r.template_id : null)));
  for (let tier = char.tier; tier >= 1 && need > 0; tier -= 1) {
    const tpls = (await selectRows(q, "task", "record = 'template' AND tier = $1", [tier])) as TaskTemplateRow[];
    const ranked = tpls
      .filter((t) => !busy.has(t.id))
      .map((t) => ({ t, rank: Math.abs(t.stage - char.stage), h: hashOrder(char.id, t.id, ctx.world.day_index) }))
      .sort((a, b) => a.rank - b.rank || (a.h < b.h ? -1 : a.h > b.h ? 1 : 0));
    for (const { t } of ranked) {
      if (need <= 0) break;
      if (!(await usable(q, char, t, placeId))) continue;
      changes.push(...(await instantiate(ctx, n, char, t, placeId)));
      busy.add(t.id);
      need -= 1;
    }
  }
  return changes;
}
