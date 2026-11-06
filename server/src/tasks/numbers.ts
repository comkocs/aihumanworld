// [S24] Task-system numbers from S5 (content/rules/numbers.v1.json, balance.v1):
// system reward base per tier × template, daily decay, supply size, durations,
// bounty expiry range and minimum escrow, deed bonuses. Read from the numbers
// object the world booted with (Balance.numbers once S10 lands) so tasks and
// growth use one revision; falls back to the S5 file itself. Malformed or
// missing numbers answer RULES_UNSET, never a made-up default.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SERVER_ROOT } from "../config.ts";
import { TASK_TPLS, type TaskTpl } from "../facts/enums.ts";
import type { Tier, UInt } from "../facts/types.ts";
import { reject } from "../protocol/errors.ts";

export const NUMBERS_FILE = resolve(SERVER_ROOT, "../content/rules/numbers.v1.json");

export interface BonusRule {
  xp_bp: UInt;
  potential_bp: UInt;
  rep_mult: UInt;
}

export interface TierTaskNumbers {
  task_coin: UInt;
  task_xp: UInt;
  task_potential: UInt;
  rep_bounty: UInt;
}

export interface TaskNumbers {
  revision: string;
  decay_step_bp: UInt;
  item_min_pct_bp: UInt;
  supply_per_char: UInt;
  rep_system: UInt;
  count_max: Readonly<Record<TaskTpl, UInt>>;
  /** task_rewards rows: full (undecayed) system reward base of a tier × template. */
  rewards: ReadonlyMap<string, { coin: UInt; xp: UInt; potential: UInt }>;
  tiers: ReadonlyMap<Tier, TierTaskNumbers>;
  bonus: { first_found: BonusRule; first_clear: BonusRule };
  duration: { default: UInt; min: UInt; max: UInt };
  bounty_expire: { min: UInt; max: UInt };
  bounty_min_coin: UInt;
}

class NumbersError extends Error {}

function rec(v: unknown, what: string): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new NumbersError(`${what} must be an object`);
  return v as Record<string, unknown>;
}

function u(v: unknown, what: string): UInt {
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return v;
  throw new NumbersError(`${what} must be UInt`);
}

function bonusRule(v: unknown, what: string): BonusRule {
  const b = rec(v, what);
  return { xp_bp: u(b.xp_bp, `${what}.xp_bp`), potential_bp: u(b.potential_bp, `${what}.potential_bp`), rep_mult: u(b.rep_mult, `${what}.rep_mult`) };
}

export const rewardKey = (tier: Tier, tpl: TaskTpl): string => `${tier}:${tpl}`;

function parse(root: Record<string, unknown>): TaskNumbers {
  const meta = rec(root.meta, "meta");
  if (meta.schema !== "aihw.numbers.v1" || meta.integer_only !== true || typeof meta.revision_key !== "string") {
    throw new NumbersError("unsupported numbers schema");
  }
  const tasks = rec(root.tasks, "tasks");
  const clock = rec(root.clock, "clock");
  const economy = rec(root.economy, "economy");
  const tplBp = rec(tasks.tpl_bp, "tasks.tpl_bp");
  const countMax = rec(tasks.count_max, "tasks.count_max");
  const count_max = {} as Record<TaskTpl, UInt>;
  for (const t of TASK_TPLS) {
    u(tplBp[t], `tasks.tpl_bp.${t}`);
    count_max[t] = u(countMax[t], `tasks.count_max.${t}`);
    if (count_max[t] === 0) throw new NumbersError(`tasks.count_max.${t} must be positive`);
  }
  if (!Array.isArray(root.tiers) || !Array.isArray(root.task_rewards)) throw new NumbersError("tiers / task_rewards must be arrays");
  const tiers = new Map<Tier, TierTaskNumbers>();
  for (const raw of root.tiers as unknown[]) {
    const r = rec(raw, "tiers[]");
    const tier = u(r.tier, "tiers[].tier");
    tiers.set(tier, {
      task_coin: u(r.task_coin, "tiers[].task_coin"),
      task_xp: u(r.task_xp, "tiers[].task_xp"),
      task_potential: u(r.task_potential, "tiers[].task_potential"),
      rep_bounty: u(r.rep_bounty, "tiers[].rep_bounty"),
    });
  }
  const rewards = new Map<string, { coin: UInt; xp: UInt; potential: UInt }>();
  for (const raw of root.task_rewards as unknown[]) {
    const r = rec(raw, "task_rewards[]");
    const tpl = r.tpl;
    if (typeof tpl !== "string" || !(TASK_TPLS as readonly string[]).includes(tpl)) throw new NumbersError("task_rewards[].tpl");
    rewards.set(rewardKey(u(r.tier, "task_rewards[].tier"), tpl as TaskTpl), {
      coin: u(r.coin, "task_rewards[].coin"),
      xp: u(r.xp, "task_rewards[].xp"),
      potential: u(r.potential, "task_rewards[].potential"),
    });
  }
  for (let t = 1; t <= 9; t += 1) {
    if (!tiers.has(t)) throw new NumbersError(`tiers row ${t} missing`);
    for (const tpl of TASK_TPLS) if (!rewards.has(rewardKey(t, tpl))) throw new NumbersError(`task_rewards ${t}/${tpl} missing`);
  }
  const bonus = rec(tasks.deed_bonus, "tasks.deed_bonus");
  const duration = {
    default: u(clock.task_duration_default_ticks, "clock.task_duration_default_ticks"),
    min: u(clock.task_duration_min_ticks, "clock.task_duration_min_ticks"),
    max: u(clock.task_duration_max_ticks, "clock.task_duration_max_ticks"),
  };
  const bounty_expire = {
    min: u(clock.bounty_expire_min_ticks, "clock.bounty_expire_min_ticks"),
    max: u(clock.bounty_expire_max_ticks, "clock.bounty_expire_max_ticks"),
  };
  if (duration.min === 0 || duration.min > duration.max || duration.default < duration.min || duration.default > duration.max) {
    throw new NumbersError("task duration range");
  }
  if (bounty_expire.min === 0 || bounty_expire.min > bounty_expire.max) throw new NumbersError("bounty expiry range");
  return {
    revision: meta.revision_key,
    decay_step_bp: u(tasks.decay_step_bp, "tasks.decay_step_bp"),
    item_min_pct_bp: u(tasks.item_min_pct_bp, "tasks.item_min_pct_bp"),
    supply_per_char: u(tasks.supply_per_char, "tasks.supply_per_char"),
    rep_system: u(tasks.rep_system, "tasks.rep_system"),
    count_max,
    rewards,
    tiers,
    bonus: {
      first_found: bonusRule(bonus.first_found, "tasks.deed_bonus.first_found"),
      first_clear: bonusRule(bonus.first_clear, "tasks.deed_bonus.first_clear"),
    },
    duration,
    bounty_expire,
    bounty_min_coin: u(economy.bounty_min_coin, "economy.bounty_min_coin"),
  };
}

const fromBalance = new WeakMap<object, TaskNumbers | NumbersError>();
let fromFile: TaskNumbers | NumbersError | null = null;

function attempt(read: () => Record<string, unknown>): TaskNumbers | NumbersError {
  try {
    return parse(read());
  } catch (err) {
    return err instanceof NumbersError ? err : new NumbersError(String(err));
  }
}

/** Task numbers of the running world (RULES_UNSET when absent or malformed). */
export function taskNumbers(balance: unknown): TaskNumbers {
  const held = typeof balance === "object" && balance !== null ? (balance as { numbers?: unknown }).numbers : undefined;
  let got: TaskNumbers | NumbersError;
  if (typeof held === "object" && held !== null) {
    const cached = fromBalance.get(held);
    got = cached ?? attempt(() => rec(held, "numbers"));
    if (cached === undefined) fromBalance.set(held, got);
  } else {
    fromFile ??= attempt(() => rec(JSON.parse(readFileSync(NUMBERS_FILE, "utf8")) as unknown, "numbers"));
    got = fromFile;
  }
  if (got instanceof NumbersError) return reject("RULES_UNSET", { rule_key: "balance.tasks" });
  return got;
}

export function tierNumbers(n: TaskNumbers, tier: Tier): TierTaskNumbers {
  const row = n.tiers.get(tier);
  if (row === undefined) return reject("RULES_UNSET", { rule_key: "balance.tiers" });
  return row;
}

/** floor(a × b ÷ d) on safe integers. */
export function mulDivFloor(a: UInt, b: UInt, d: UInt): UInt {
  return Number((BigInt(a) * BigInt(b)) / BigInt(d));
}
