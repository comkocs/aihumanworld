// S12: pure build checks (no database). Three questions only, as 事实格式 §12 puts
// it: is the data well-formed, are its numbers inside the tier (S5 tables), and
// is the content key shaped for its table. Names, prose and taste are not judged.
// Uniqueness and references need the database and live in refs.ts.
//
// Reason mapping of BUILD_INVALID (动词表 §3): shape = a field combination the
// fact format forbids; tier = a number above the S5 bound or above the builder's
// own tier; reference / name are raised by refs.ts (name is unused: a taken
// content key is DUPLICATE_KEY, a malformed one INVALID_KEY).

import { ITEM_CATEGORY, type ItemKind } from "../facts/enums.ts";
import type { ItemDefinitionRow, Modifiers, PlaceRow, TaskTemplateRow, Tier, UInt } from "../facts/types.ts";
import { reject } from "../protocol/errors.ts";
import type { BuildLimits } from "./limits.ts";

export type PlaceData = Pick<
  PlaceRow,
  "content_key" | "region" | "kind" | "features" | "tier" | "danger" | "combat" | "owner_org"
>;
export type ItemData = Pick<
  ItemDefinitionRow,
  "content_key" | "kind" | "tier" | "grade" | "element" | "slots" | "cap" | "dura_max" | "modifiers" | "effect"
>;
export type TaskData = Pick<
  TaskTemplateRow,
  "content_key" | "tpl" | "tier" | "stage" | "condition" | "reward_spec" | "duration_ticks"
>;

export interface CheckEnv {
  limits: BuildLimits;
  /** The builder's current tier: no definition may sit above it. */
  builderTier: Tier;
  /** world.rules.socket_max (loaded). */
  socketMax: UInt;
}

type Reason = "shape" | "reference" | "tier" | "name";

export function invalid(reason: Reason, field: string): never {
  return reject("BUILD_INVALID", { reason, field }, field);
}

/** Longest local part of a content key; a data-size bound, not a naming rule. */
export const CONTENT_LOCAL_MAX = 64;

/** Shape of a content key before any table / realm is known (used by the request validator). */
export const CONTENT_KEY_RE = new RegExp(`^content\\.[a-z][a-z0-9_]*\\.(?:place|item|task)\\.[a-z0-9_]{1,${CONTENT_LOCAL_MAX}}$`);

/** content.<realm>.<type>.<local> must name this realm and this table (标签词表 §8.3). */
export function checkContentKey(realm: string, table: "place" | "item" | "task", key: string): void {
  if (!key.startsWith(`content.${realm}.${table}.`)) {
    reject("INVALID_KEY", { expected: "content key of this realm and table" }, "args.data.content_key");
  }
}

export function checkPlace(d: PlaceData, env: CheckEnv): void {
  if (d.tier > env.builderTier) invalid("tier", "args.data.tier");
}

const MOD_KEYS = ["vigor", "power", "guard", "speed"] as const;

/** Budget points of a modifier set: power / guard / speed cost 1, vigor costs 1/ratio. */
function overBudget(m: Modifiers, budget: UInt, ratio: UInt): boolean {
  return ratio * (m.power + m.guard + m.speed) + m.vigor > ratio * budget;
}

function nonNegative(m: Modifiers, path: string): void {
  for (const k of MOD_KEYS) if (m[k] < 0) invalid("tier", `${path}.${k}`);
}

const EFFECTS_OF: Readonly<Partial<Record<ItemKind, readonly string[]>>> = {
  potion: ["restore", "breakthrough"],
  scroll: ["learn"],
  key: ["unlock"],
  core: ["socket"],
  map: ["map"],
};

export function checkItem(d: ItemData, env: CheckEnv): void {
  const L = env.limits;
  if (d.tier > env.builderTier) invalid("tier", "args.data.tier");
  if (!(EFFECTS_OF[d.kind] ?? ["none"]).includes(d.effect.kind)) invalid("shape", "args.data.effect");
  const cat = ITEM_CATEGORY[d.kind];
  const cell = `${d.tier}:${d.grade}`;

  if (cat === "weapon" || cat === "armor" || cat === "accessory") {
    const row = L.equipment.get(cell);
    if (row === undefined) throw new Error(`numbers: equipment row ${cell} missing`);
    nonNegative(d.modifiers, "args.data.modifiers");
    if (d.slots > Math.min(row.slots, env.socketMax)) invalid("tier", "args.data.slots");
    if (d.cap < row.cap) invalid("tier", "args.data.cap");
    // dura_max 0 would make repair (price × gap ÷ dura_max) divide by zero.
    if (d.dura_max < 1) invalid("shape", "args.data.dura_max");
    if (d.dura_max > row.dura_max) invalid("tier", "args.data.dura_max");
    if (overBudget(d.modifiers, row.budget, L.vigorRatio)) invalid("tier", "args.data.modifiers");
    return;
  }

  // Everything else carries no equipment numbers of its own.
  if (MOD_KEYS.some((k) => d.modifiers[k] !== 0)) invalid("shape", "args.data.modifiers");
  if (d.slots !== 0) invalid("shape", "args.data.slots");
  if (d.dura_max !== 0) invalid("shape", "args.data.dura_max");

  const e = d.effect;
  if (e.kind === "socket") {
    // core: the bonus sits in effect.modifiers; its cap is the one allowed non-zero cap.
    const row = L.cores.get(cell);
    if (row === undefined) throw new Error(`numbers: core row ${cell} missing`);
    nonNegative(e.modifiers, "args.data.effect.modifiers");
    if (d.cap < row.cap) invalid("tier", "args.data.cap");
    if (overBudget(e.modifiers, row.budget, L.vigorRatio)) invalid("tier", "args.data.effect.modifiers");
    return;
  }
  if (d.cap !== 0) invalid("shape", "args.data.cap");
  const row = L.consumables.get(cell);
  if (row === undefined) throw new Error(`numbers: consumable row ${cell} missing`);
  if (e.kind === "restore" && e.vigor > row.restore_vigor) invalid("tier", "args.data.effect.vigor");
  if (e.kind === "breakthrough" && e.bonus > row.bt_bonus_bp) invalid("tier", "args.data.effect.bonus");
  if (e.kind === "learn" && e.levels > row.scroll_levels) invalid("tier", "args.data.effect.levels");
}

export function checkTask(d: TaskData, env: CheckEnv): void {
  const L = env.limits;
  if (d.tier > env.builderTier) invalid("tier", "args.data.tier");
  if (d.condition.tpl !== d.tpl) invalid("shape", "args.data.condition.tpl");

  const base = L.taskRewards.get(`${d.tier}:${d.tpl}`);
  if (base === undefined) throw new Error(`numbers: task reward row ${d.tier}:${d.tpl} missing`);
  const r = d.reward_spec;
  if (r.coin > base.coin) invalid("tier", "args.data.reward_spec.coin");
  if (r.xp > base.xp) invalid("tier", "args.data.reward_spec.xp");
  if (r.potential > base.potential) invalid("tier", "args.data.reward_spec.potential");
  if (r.rep > L.repMax) invalid("tier", "args.data.reward_spec.rep");
  if (r.item_defs.length > L.itemDefsMax) invalid("tier", "args.data.reward_spec.item_defs");
  if (d.duration_ticks < L.durationMin || d.duration_ticks > L.durationMax) invalid("tier", "args.data.duration_ticks");

  const c = d.condition;
  if ((c.tpl === "deliver" || c.tpl === "slay" || c.tpl === "gather") && c.count > L.countMax[c.tpl]) {
    invalid("tier", "args.data.condition.count");
  }
}
