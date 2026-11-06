// S12: the S5 numbers the build validator needs (docs/数值/数值表_v1.md,
// machine copy content/rules/numbers.v1.json). Only the tables that bound public
// builds are read; everything is integers. A malformed file throws at load time
// (boot / first build), never a half-filled table.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TASK_TPLS, type TaskTpl } from "../facts/enums.ts";
import type { UInt } from "../facts/types.ts";

export interface EquipmentRow {
  budget: UInt;
  cap: UInt;
  dura_max: UInt;
  slots: UInt;
}
export interface CoreRow {
  budget: UInt;
  cap: UInt;
}
export interface ConsumableRow {
  restore_vigor: UInt;
  bt_bonus_bp: UInt;
  scroll_levels: UInt;
}
export interface TaskRewardRow {
  coin: UInt;
  xp: UInt;
  potential: UInt;
}

export interface BuildLimits {
  /** meta.revision_key; must equal world.rules_revision for the limits to apply. */
  revision: string;
  /** equipment.vigor_budget_ratio: this many vigor points cost one budget point. */
  vigorRatio: UInt;
  /** Keyed `${tier}:${grade}`. */
  equipment: ReadonlyMap<string, EquipmentRow>;
  cores: ReadonlyMap<string, CoreRow>;
  consumables: ReadonlyMap<string, ConsumableRow>;
  /** Keyed `${tier}:${tpl}`. */
  taskRewards: ReadonlyMap<string, TaskRewardRow>;
  /** tasks.rep_system: the most rep a public template may promise. */
  repMax: UInt;
  countMax: Readonly<Record<TaskTpl, UInt>>;
  itemDefsMax: UInt;
  itemGradeMax: UInt;
  durationMin: UInt;
  durationMax: UInt;
}

type Obj = Record<string, unknown>;

function obj(v: unknown, path: string): Obj {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error(`numbers: ${path} must be an object`);
  return v as Obj;
}

function uint(v: unknown, path: string): UInt {
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return v;
  throw new Error(`numbers: ${path} must be a non-negative integer`);
}

function rows(v: unknown, path: string): Obj[] {
  if (!Array.isArray(v)) throw new Error(`numbers: ${path} must be an array`);
  return v.map((r, i) => obj(r, `${path}[${i}]`));
}

/** Fills a map from table rows and checks the full grid is there (no silent gap = no silent unlimited). */
function grid<T>(
  v: unknown,
  path: string,
  second: readonly (number | string)[],
  pick: (r: Obj, p: string) => T,
  secondKey: string,
): ReadonlyMap<string, T> {
  const out = new Map<string, T>();
  rows(v, path).forEach((r, i) => {
    const p = `${path}[${i}]`;
    const k = `${uint(r.tier, `${p}.tier`)}:${String(r[secondKey])}`;
    if (out.has(k)) throw new Error(`numbers: ${path} has duplicate row ${k}`);
    out.set(k, pick(r, p));
  });
  for (let tier = 1; tier <= 9; tier += 1) {
    for (const s of second) if (!out.has(`${tier}:${s}`)) throw new Error(`numbers: ${path} lacks row ${tier}:${s}`);
  }
  return out;
}

export function parseBuildLimits(raw: unknown): BuildLimits {
  const root = obj(raw, "$");
  const meta = obj(root.meta, "meta");
  if (meta.schema !== "aihw.numbers.v1") throw new Error("numbers: meta.schema must be aihw.numbers.v1");
  if (typeof meta.revision_key !== "string" || meta.revision_key === "") throw new Error("numbers: meta.revision_key missing");

  const equipment = obj(root.equipment, "equipment");
  const cores = obj(root.cores, "cores");
  const consumables = obj(root.consumables, "consumables");
  const tasks = obj(root.tasks, "tasks");
  const clock = obj(root.clock, "clock");
  const countMax = obj(tasks.count_max, "tasks.count_max");
  const vigorRatio = uint(equipment.vigor_budget_ratio, "equipment.vigor_budget_ratio");
  if (vigorRatio === 0) throw new Error("numbers: equipment.vigor_budget_ratio must be positive");

  const grades = [1, 2, 3];
  return {
    revision: meta.revision_key,
    vigorRatio,
    equipment: grid(equipment.table, "equipment.table", grades, (r, p) => ({
      budget: uint(r.budget, `${p}.budget`),
      cap: uint(r.cap, `${p}.cap`),
      dura_max: uint(r.dura_max, `${p}.dura_max`),
      slots: uint(r.slots, `${p}.slots`),
    }), "grade"),
    cores: grid(cores.table, "cores.table", grades, (r, p) => ({
      budget: uint(r.budget, `${p}.budget`),
      cap: uint(r.cap, `${p}.cap`),
    }), "grade"),
    consumables: grid(consumables.table, "consumables.table", grades, (r, p) => ({
      restore_vigor: uint(r.restore_vigor, `${p}.restore_vigor`),
      bt_bonus_bp: uint(r.bt_bonus_bp, `${p}.bt_bonus_bp`),
      scroll_levels: uint(r.scroll_levels, `${p}.scroll_levels`),
    }), "grade"),
    taskRewards: grid(root.task_rewards, "task_rewards", TASK_TPLS, (r, p) => ({
      coin: uint(r.coin, `${p}.coin`),
      xp: uint(r.xp, `${p}.xp`),
      potential: uint(r.potential, `${p}.potential`),
    }), "tpl"),
    repMax: uint(tasks.rep_system, "tasks.rep_system"),
    countMax: Object.fromEntries(TASK_TPLS.map((t) => [t, uint(countMax[t], `tasks.count_max.${t}`)])) as Record<TaskTpl, UInt>,
    itemDefsMax: uint(tasks.build_template_item_defs_max, "tasks.build_template_item_defs_max"),
    itemGradeMax: uint(tasks.build_template_item_grade_max, "tasks.build_template_item_grade_max"),
    durationMin: uint(clock.task_duration_min_ticks, "clock.task_duration_min_ticks"),
    durationMax: uint(clock.task_duration_max_ticks, "clock.task_duration_max_ticks"),
  };
}

/** Default source: the repo's S5 machine table (server/src/build → repo root is three levels up). */
export const DEFAULT_NUMBERS_FILE = resolve(dirname(fileURLToPath(import.meta.url)), "../../../content/rules/numbers.v1.json");

export function loadBuildLimits(file: string = DEFAULT_NUMBERS_FILE): BuildLimits {
  return parseBuildLimits(JSON.parse(readFileSync(file, "utf8")));
}

let current: BuildLimits | null = null;
let source: string = DEFAULT_NUMBERS_FILE;

/** Points the validator at another numbers file (or injects parsed limits); null forgets the cache. */
export function useBuildLimits(from: string | BuildLimits | null): void {
  if (from === null || typeof from === "string") {
    source = from ?? DEFAULT_NUMBERS_FILE;
    current = null;
  } else {
    current = from;
  }
}

/** The limits in force (loaded once, lazily, from the configured source). */
export function buildLimits(): BuildLimits {
  current ??= loadBuildLimits(source);
  return current;
}
