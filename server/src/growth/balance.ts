// Neutral S5 numbers and derived attributes. Presentation fields are never inputs.

import type { NpcArchetype, SkillBase } from "../facts/enums.ts";
import type { CharRow, ItemDefinitionRow, ItemInstanceRow, SkillDefinitionRow, SkillLearnedRow, Stats, UInt } from "../facts/types.ts";

type Numeric = Record<string, number>;
export interface TierNumbers extends Numeric {
  tier: number; cap_max: number; skill_cap_hard: number; task_potential: number;
  train_xp: number; train_potential: number; task_xp: number; rep_bounty: number; task_coin: number;
}
export interface GridNumbers extends Numeric {
  tier: number; stage: number; xp_need: number; power: number; guard: number;
  speed: number; vigor_max: number; inner_req: number;
}
export interface Numbers {
  meta: { schema: string; revision_key: string; integer_only: boolean };
  clock: { day_ticks: number; week_ticks: number; train_period_ticks: number; train_catchup_max_periods: number; vigor_regen_bp_per_tick: number };
  tiers: TierNumbers[];
  grid: GridNumbers[];
  tier_prices: { tier: number; learn_coin: number }[];
  stats: { skill_bp_per_level: number };
  skills: {
    cap_initial: number; level_initial: number; level_cost_mult: number; train_levelup_per_yield: number;
    learn_cap_gain: number; learn_level_gain: number; learn_bond_coin: number; eff_level_rule: string;
  };
  breakthrough: {
    stage_success_bp: number; tier_base_bp: number; decay_bp_per_tier: number;
    floor_bp: number; cap_bp: number; fail_xp_loss_bp: number; item_tier_rule: string;
  };
  cycle: { legacy_gain: number; legacy_cap: number; legacy_bp_per_point: number; skill_keep_bp: number; potential_keep_bp: number; xp_after: number };
  combat: {
    roll_spread_bp: number; draw_margin_bp: number; loss_base_bp: number; loss_gap_pct: number;
    loss_cap_bp: number; winner_recoil_bp: number; draw_loss_bp: number; vigor_factor_floor_bp: number;
    duel_vigor_floor: number; tutorial_dies_on_loss: boolean; tutorial_rating_bp: number;
    wear_loser_bp: number; wear_winner_bp: number; wear_draw_bp: number;
    npc_rating_bp: Record<NpcArchetype, number>; rule_key: string; rule_key_tier: string; rule_key_cycle: string;
    /** S48: a new char cannot be attacked by other participants for this many ticks after creation (absent = 0). */
    newbie_protect_ticks?: number;
  };
  death: { xp_loss_bp: number; revive_wait_ticks: number; revive_vigor_bp: number; pk_drop_chance_bp: number; pk_drop_count: number; pk_drop_equipped: boolean };
  wanted: {
    attack_guard_ticks: number; kill_player_ticks: number; bounty_coin_pct_of_task_coin?: number;
    /** S48: red-name duration by tier relation of the initiator who killed in a pk place (absent = kill_player_ticks). */
    kill_lower_ticks?: number; kill_peer_ticks?: number; kill_higher_ticks?: number;
  };
  npc: { monster_respawn_ticks: number; npc_respawn_ticks: number; tutorial_respawn_ticks: number };
  consumables: { table: { tier: number; grade: number; bt_bonus_bp: number }[] };
  economy: { start_coin: number; start_potential: number };
  orgs: { goal_min_target: number; goal_reward_rep: number };
  tasks: {
    deed_bonus: {
      first_kill: { xp_bp: number; potential_bp: number; rep_mult: number };
      /** S46 论道. Absent in numbers older than balance.v1.1 (S46): no discourse reward then. first_* = 初识 (a pair's first). */
      discourse?: {
        xp_bp: number; potential_bp: number; rep_mult: number; daily_max: number; window_ticks: number;
        first_xp_bp: number; first_potential_bp: number;
      };
      /**
       * S46 切磋 / PK. Absent = no such reward. *_bp apply to xp and potential alike, of the full task value of the
       * LOWER tier of the two chars; daily_max counts duel and pk rewards together per char per game day.
       */
      combat_social?: {
        duel_win_bp: number; duel_lose_bp: number; duel_draw_bp: number; pk_win_bp: number; daily_max: number;
        /** S48: killing a red-name pays the red-name tier's task value x pk_win_bp x hunt_mult, hunt_daily_max a day. */
        hunt_mult: number; hunt_daily_max: number;
      };
    };
  };
}

export interface Balance {
  start: { coin: UInt; skill_cap: UInt };
  org_goal: { kind: "system_tasks" | "deliver_items"; target: UInt; reward_rep: UInt };
  numbers: Numbers;
}
export interface LearnedSkill { definition: SkillDefinitionRow; learned: SkillLearnedRow }
export interface Equipment {
  definition: ItemDefinitionRow;
  instance: ItemInstanceRow;
  cores: { definition: ItemDefinitionRow; instance: ItemInstanceRow }[];
}
export interface NeutralFacts { skills: LearnedSkill[]; equipment: Equipment[] }

export function safeUInt(n: bigint): UInt {
  if (n < 0n || n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("settlement outside UInt range");
  return Number(n);
}
export function addUInt(a: number, b: number): UInt { return safeUInt(BigInt(a) + BigInt(b)); }
export function mulDiv(a: number, b: number, divisor: number): UInt {
  if (divisor <= 0) throw new Error("settlement divisor must be positive");
  return safeUInt(BigInt(a) * BigInt(b) / BigInt(divisor));
}

function record(v: unknown, path: string): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error(`${path} must be an object`);
  return v as Record<string, unknown>;
}
function uint(v: unknown, path: string): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) throw new Error(`${path} must be UInt`);
  return v;
}
function numbersAt(root: Record<string, unknown>, path: string, keys: string): void {
  let value: unknown = root;
  for (const part of path.split(".")) value = record(value, path)[part];
  const obj = record(value, path);
  for (const key of keys.split(" ")) uint(obj[key], `${path}.${key}`);
}
function rowsAt(root: Record<string, unknown>, path: string, keys: string, count: number): Record<string, unknown>[] {
  let value: unknown = root;
  for (const part of path.split(".")) value = record(value, path)[part];
  if (!Array.isArray(value) || value.length !== count) throw new Error(`${path} must have ${count} rows`);
  return value.map((row: unknown) => {
    const r = record(row, path);
    for (const key of keys.split(" ")) uint(r[key], `${path}.${key}`);
    return r;
  });
}

/** Fail boot on incomplete/unsupported numbers, rather than silently invent defaults. */
export function parseBalance(input: unknown): Balance {
  const root = record(input, "numbers");
  const meta = record(root.meta, "meta");
  if (meta.schema !== "aihw.numbers.v1" || meta.integer_only !== true ||
      typeof meta.revision_key !== "string" || !/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/.test(meta.revision_key)) {
    throw new Error("unsupported S5 number schema/revision");
  }
  const visit = (v: unknown): void => {
    if (typeof v === "number") uint(v, "numbers");
    else if (Array.isArray(v)) v.forEach(visit);
    else if (typeof v === "object" && v !== null) Object.values(v).forEach(visit);
  };
  visit(root);
  numbersAt(root, "clock", "day_ticks week_ticks train_period_ticks train_catchup_max_periods vigor_regen_bp_per_tick");
  numbersAt(root, "stats", "skill_bp_per_level");
  numbersAt(root, "skills", "cap_initial level_initial level_cost_mult train_levelup_per_yield learn_cap_gain learn_level_gain learn_bond_coin");
  numbersAt(root, "breakthrough", "stage_success_bp tier_base_bp decay_bp_per_tier floor_bp cap_bp fail_xp_loss_bp");
  numbersAt(root, "cycle", "legacy_gain legacy_cap legacy_bp_per_point skill_keep_bp potential_keep_bp xp_after");
  numbersAt(root, "combat", "roll_spread_bp draw_margin_bp loss_base_bp loss_gap_pct loss_cap_bp winner_recoil_bp draw_loss_bp vigor_factor_floor_bp duel_vigor_floor tutorial_rating_bp wear_loser_bp wear_winner_bp wear_draw_bp");
  numbersAt(root, "combat.npc_rating_bp", "master merchant repairer guard quest_giver patroller monster tutorial_opponent");
  numbersAt(root, "death", "xp_loss_bp revive_wait_ticks revive_vigor_bp pk_drop_chance_bp pk_drop_count");
  numbersAt(root, "wanted", "attack_guard_ticks kill_player_ticks");
  numbersAt(root, "npc", "monster_respawn_ticks npc_respawn_ticks tutorial_respawn_ticks");
  numbersAt(root, "economy", "start_coin start_potential");
  numbersAt(root, "orgs", "goal_min_target goal_reward_rep");
  numbersAt(root, "tasks.deed_bonus.first_kill", "xp_bp potential_bp rep_mult");
  const deedBonus = record(record(root.tasks, "tasks").deed_bonus, "tasks.deed_bonus");
  if (deedBonus.discourse !== undefined) {
    numbersAt(root, "tasks.deed_bonus.discourse", "xp_bp potential_bp rep_mult daily_max window_ticks first_xp_bp first_potential_bp");
    const d = record(deedBonus.discourse, "tasks.deed_bonus.discourse");
    for (const key of ["xp_bp", "potential_bp", "first_xp_bp", "first_potential_bp"]) {
      if ((d[key] as number) > 100000) throw new Error(`tasks.deed_bonus.discourse.${key} exceeds ten tasks`);
    }
    if (d.window_ticks === 0) throw new Error("tasks.deed_bonus.discourse.window_ticks must be positive");
  }
  if (deedBonus.combat_social !== undefined) {
    numbersAt(root, "tasks.deed_bonus.combat_social", "duel_win_bp duel_lose_bp duel_draw_bp pk_win_bp daily_max hunt_mult hunt_daily_max");
    const c = record(deedBonus.combat_social, "tasks.deed_bonus.combat_social");
    for (const key of ["duel_win_bp", "duel_lose_bp", "duel_draw_bp", "pk_win_bp"]) {
      if ((c[key] as number) > 100000) throw new Error(`tasks.deed_bonus.combat_social.${key} exceeds ten tasks`);
    }
  }
  const tiers = rowsAt(root, "tiers", "tier cap_max skill_cap_hard task_potential train_xp train_potential task_xp rep_bounty task_coin", 9);
  const grid = rowsAt(root, "grid", "tier stage xp_need power guard speed vigor_max inner_req", 36);
  const prices = rowsAt(root, "tier_prices", "tier learn_coin", 9);
  const potions = rowsAt(root, "consumables.table", "tier grade bt_bonus_bp", 27);
  for (let tier = 1; tier <= 9; tier += 1) {
    if (tiers.filter((r) => r.tier === tier).length !== 1 || prices.filter((r) => r.tier === tier).length !== 1) throw new Error("incomplete tier numbers");
    for (let stage = 1; stage <= 4; stage += 1) {
      const row = grid.filter((r) => r.tier === tier && r.stage === stage);
      if (row.length !== 1 || row[0]?.vigor_max === 0 || row[0]?.xp_need === 0) throw new Error("incomplete grid numbers");
    }
    for (let grade = 1; grade <= 3; grade += 1) {
      if (potions.filter((r) => r.tier === tier && r.grade === grade).length !== 1) throw new Error("incomplete potion numbers");
    }
  }
  const n = root as unknown as Numbers;
  for (const section of ["clock", "breakthrough", "combat", "death", "cycle"]) {
    for (const [key, value] of Object.entries(record(root[section], section))) {
      if (key.endsWith("_bp") && typeof value === "number" && uint(value, `${section}.${key}`) > 10000) throw new Error(`${section}.${key} exceeds basis-point range`);
    }
  }
  if (n.skills.level_initial > n.skills.cap_initial) throw new Error("initial skill exceeds cap");
  for (const rule of [n.combat.rule_key, n.combat.rule_key_tier, n.combat.rule_key_cycle]) {
    if (typeof rule !== "string" || !/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/.test(rule)) throw new Error("invalid roll rule key");
  }
  if (n.clock.day_ticks === 0 || n.clock.week_ticks === 0 || n.clock.train_period_ticks === 0 || n.clock.train_catchup_max_periods === 0 ||
      n.skills.eff_level_rule !== "max_by_base" || n.skills.level_initial !== 0 || n.economy.start_potential !== 0 ||
      n.breakthrough.item_tier_rule !== "equal" || n.breakthrough.stage_success_bp !== 10000 ||
      n.breakthrough.floor_bp > n.breakthrough.cap_bp || n.breakthrough.cap_bp > 10000 ||
      n.combat.roll_spread_bp >= 10000 || n.combat.vigor_factor_floor_bp > 10000 ||
      typeof n.combat.tutorial_dies_on_loss !== "boolean" || n.death.pk_drop_count !== 1 || n.death.pk_drop_equipped !== false) {
    throw new Error("unsupported S5 settlement rule");
  }
  return {
    numbers: n,
    start: { coin: n.economy.start_coin, skill_cap: n.skills.cap_initial },
    org_goal: { kind: "system_tasks", target: n.orgs.goal_min_target, reward_rep: n.orgs.goal_reward_rep },
  };
}

export function tierNumbers(balance: Balance, tier: number): TierNumbers {
  const row = balance.numbers.tiers.find((r) => r.tier === tier);
  if (row === undefined) throw new Error("missing tier numbers");
  return row;
}
export function gridNumbers(balance: Balance, tier: number, stage: number): GridNumbers {
  const row = balance.numbers.grid.find((r) => r.tier === tier && r.stage === stage);
  if (row === undefined) throw new Error("missing grid numbers");
  return row;
}
export function effectiveLevels(facts: NeutralFacts): Record<SkillBase, number> {
  const levels: Record<SkillBase, number> = { strike: 0, guard: 0, move: 0, inner: 0 };
  for (const { definition, learned } of facts.skills) levels[definition.base] = Math.max(levels[definition.base], learned.level);
  return levels;
}
export function equipmentCapacity(e: Equipment): number {
  return e.cores.reduce((sum, c) => addUInt(sum, c.definition.cap), e.definition.cap);
}

/** S9's two-argument call remains valid for a fresh char; existing chars need their neutral facts. */
export function deriveStats(balance: Balance, char: Pick<CharRow, "kind" | "archetype" | "tier" | "stage" | "legacy">, facts: NeutralFacts = { skills: [], equipment: [] }): Stats {
  const n = balance.numbers;
  const tutorial = char.kind === "npc" && char.archetype === "tutorial_opponent";
  const base = gridNumbers(balance, tutorial ? 1 : char.tier, tutorial ? 1 : char.stage);
  const cap_max = tierNumbers(balance, char.tier).cap_max;
  if (char.kind === "npc") {
    if (char.archetype === null) throw new Error("NPC without archetype");
    const factor = tutorial ? n.combat.tutorial_rating_bp : n.combat.npc_rating_bp[char.archetype];
    return {
      power: mulDiv(base.power, factor, 10000), guard: mulDiv(base.guard, factor, 10000),
      speed: mulDiv(base.speed, factor, 10000), vigor_max: mulDiv(base.vigor_max, factor, 10000), cap_max,
    };
  }
  const levels = effectiveLevels(facts);
  const legacy = BigInt(Math.min(char.legacy, n.cycle.legacy_cap)) * BigInt(n.cycle.legacy_bp_per_point);
  const stat = (value: number, level: number, name: "power" | "guard" | "speed" | "vigor"): number => {
    let result = BigInt(value) * (10000n + BigInt(n.stats.skill_bp_per_level) * BigInt(level) + legacy) / 10000n;
    for (const e of facts.equipment) {
      if (e.instance.dura === 0) continue;
      result += BigInt(e.definition.modifiers[name]);
      for (const c of e.cores) {
        if (c.definition.effect.kind !== "socket") throw new Error("non-core socket fact");
        result += BigInt(c.definition.effect.modifiers[name]);
      }
    }
    return safeUInt(result < 0n ? 0n : result);
  };
  return {
    power: stat(base.power, levels.strike, "power"), guard: stat(base.guard, levels.guard, "guard"),
    speed: stat(base.speed, levels.move, "speed"), vigor_max: stat(base.vigor_max, levels.inner, "vigor"), cap_max,
  };
}
export function startValues(balance: Balance): { coin: UInt; skill_cap: UInt } { return { ...balance.start }; }
