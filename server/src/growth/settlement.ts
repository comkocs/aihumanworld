// Deterministic S5 primitives: integer arithmetic and SHA-256 labelled samples.

import { createHash } from "node:crypto";
import type { Queryable } from "../db/db.ts";
import type { Combatant, Roll, Tick } from "../facts/types.ts";
import { mulDiv, safeUInt, type Balance } from "./balance.ts";

export function u32(seed: string, label: string): number {
  return createHash("sha256").update(`${seed}#${label}`, "utf8").digest().readUInt32BE(0);
}

/** Caller holds the world lock; no deed may be written between this and its resolution deed. */
export async function resolutionSeed(q: Queryable, revision: string, realm: string, tick: Tick, actor: string, target: string | null): Promise<string> {
  const result = await q.query<{ deed_head: string }>("SELECT deed_head FROM worlds WHERE realm = $1", [realm]);
  if (result.rows[0] === undefined) throw new Error("world missing for settlement seed");
  const seq = BigInt(result.rows[0].deed_head) + 1n;
  return `${revision}:${realm}:${tick}:${seq}:${actor}:${target ?? "-"}`;
}

export interface CombatResolution {
  outcome: "win" | "lose" | "draw";
  winner: string | null;
  actor_vigor: number;
  target_vigor: number;
  actor_wear_bp: number;
  target_wear_bp: number;
  roll: Roll;
  /**
   * S82 / S103: how many rounds this one resolution played. Monster hunts and participant PK play
   * the whole bout; duels and other fights still play one round.
   */
  rounds: number;
}

/** S82 / S103: monster hunts and participant PK settle a whole bout within these round caps. */
export const MONSTER_BOUT_ROUND_CAP = 8;
export const PK_BOUT_ROUND_CAP = 8;

/**
 * One labelled round of the neutral combat rule. `seed` already names the round, so a bout of several
 * rounds draws a fresh jitter each round and stays replayable from the one deed seed.
 */
function resolveRound(balance: Balance, seed: string, actor: Combatant, target: Combatant, mode: "pve" | "duel" | "pk"): CombatResolution {
  const n = balance.numbers.combat;
  const score = (c: Combatant, label: string): bigint => {
    const max = BigInt(c.stats.vigor_max);
    if (max <= 0n) throw new Error("combat requires positive vigor maximum");
    const rating = BigInt(c.stats.power) + BigInt(c.stats.guard) + BigInt(c.stats.speed);
    const factor = BigInt(n.vigor_factor_floor_bp) * max + BigInt(10000 - n.vigor_factor_floor_bp) * BigInt(Math.min(c.vigor, c.stats.vigor_max));
    const effective = rating * factor / (10000n * max);
    const jitter = u32(seed, label) % (2 * n.roll_spread_bp + 1) - n.roll_spread_bp;
    return effective * BigInt(10000 + jitter);
  };
  const a = score(actor, "A");
  const d = score(target, "D");
  if (a <= 0n || d <= 0n) throw new Error("combat requires positive rating");
  const hi = a > d ? a : d;
  const lo = a > d ? d : a;
  const gap = safeUInt((hi - lo) * 10000n / hi);
  const outcome = gap < n.draw_margin_bp ? "draw" : a > d ? "win" : "lose";
  const loss = Math.min(n.loss_cap_bp, n.loss_base_bp + mulDiv(gap, n.loss_gap_pct, 100));
  const left = (c: Combatant, bp: number, loses: boolean): number => {
    let vigor = Math.max(0, c.vigor - mulDiv(c.stats.vigor_max, bp, 10000));
    if (loses && c.archetype === "tutorial_opponent" && n.tutorial_dies_on_loss) vigor = 0;
    return mode === "duel" ? Math.max(n.duel_vigor_floor, vigor) : vigor;
  };
  return {
    outcome, winner: outcome === "draw" ? null : outcome === "win" ? actor.char_id : target.char_id,
    actor_vigor: left(actor, outcome === "draw" ? n.draw_loss_bp : outcome === "win" ? n.winner_recoil_bp : loss, outcome === "lose"),
    target_vigor: left(target, outcome === "draw" ? n.draw_loss_bp : outcome === "lose" ? n.winner_recoil_bp : loss, outcome === "win"),
    actor_wear_bp: outcome === "draw" ? n.wear_draw_bp : outcome === "win" ? n.wear_winner_bp : n.wear_loser_bp,
    target_wear_bp: outcome === "draw" ? n.wear_draw_bp : outcome === "lose" ? n.wear_winner_bp : n.wear_loser_bp,
    roll: { seed, rule: n.rule_key, inputs: { actor, target, mode, assist_item: null }, value: safeUInt(a * 10000n / d) },
    rounds: 1,
  };
}

/**
 * S82 (设计者 11-08 01:08: 等级差不多就一次结算, 打不打由 AI 自己看怪的阶段判断, 不加准入门槛).
 * A participant fighting an `archetype: monster` NPC — the attack verb and a monster's ambush alike —
 * plays the whole bout inside the one resolution: the same per-round rule, round after round, each
 * round a fresh labelled draw off the one deed seed, carrying the vigor each round leaves behind,
 * until one side's vigor is 0 or `MONSTER_BOUT_ROUND_CAP` rounds have passed.
 * Win = the monster's vigor hit 0 (it dies; drop, first kill and reward stay on this one result).
 * Lose = the participant's vigor hit 0 (the existing vigor / death rules apply unchanged).
 * Draw = neither side reached 0 within the cap: both keep the vigor the last round left them, so both
 * are hurt and the monster lives. Reaching 0 on the same round counts as the participant's win.
 * Wear is taken from the round that ended the bout, not summed, so one bout wears gear once.
 * S103 also uses this loop for participant PK. A duel and other NPC fights stay one round.
 */
export function resolveMonsterBout(balance: Balance, seed: string, actor: Combatant, target: Combatant, mode: "pve" | "pk"): CombatResolution {
  return resolveBout(balance, seed, actor, target, mode, MONSTER_BOUT_ROUND_CAP);
}

/** S103: participant PK follows S82's round rule, stop conditions, tie-break and once-per-bout wear. */
export function resolvePkBout(balance: Balance, seed: string, actor: Combatant, target: Combatant): CombatResolution {
  return resolveBout(balance, seed, actor, target, "pk", PK_BOUT_ROUND_CAP);
}

function resolveBout(balance: Balance, seed: string, actor: Combatant, target: Combatant, mode: "pve" | "pk", roundCap: number): CombatResolution {
  let a: Combatant = actor;
  let d: Combatant = target;
  let last: CombatResolution | undefined;
  for (let round = 0; round < roundCap; round += 1) {
    last = resolveRound(balance, `${seed}#r${round}`, a, d, mode);
    if (last.actor_vigor === 0 || last.target_vigor === 0) {
      const targetDies = last.target_vigor === 0;
      const actorDies = last.actor_vigor === 0;
      const outcome = targetDies ? "win" : actorDies ? "lose" : last.outcome;
      return {
        ...last,
        outcome,
        winner: outcome === "draw" ? null : outcome === "win" ? actor.char_id : target.char_id,
        rounds: round + 1,
      };
    }
    a = { ...a, vigor: last.actor_vigor };
    d = { ...d, vigor: last.target_vigor };
  }
  if (last === undefined) throw new Error("combat bout played no round");
  return { ...last, outcome: "draw", winner: null, rounds: roundCap };
}

export function resolveCombat(balance: Balance, seed: string, actor: Combatant, target: Combatant, mode: "pve" | "duel" | "pk"): CombatResolution {
  const monsterBout = target.archetype === "monster" && actor.archetype !== "monster" && mode !== "duel";
  if (monsterBout) return resolveMonsterBout(balance, seed, actor, target, mode === "pk" ? "pk" : "pve");
  if (mode === "pk" && actor.archetype === null && target.archetype === null) return resolvePkBout(balance, seed, actor, target);
  return resolveRound(balance, seed, actor, target, mode);
}

export function resolveBreakthrough(balance: Balance, mode: "stage" | "tier" | "cycle", tier: number, bonus: number, seed: string): { success: boolean; value: number | null; probability: number } {
  const n = balance.numbers.breakthrough;
  if (mode === "stage") return { success: true, value: null, probability: n.stage_success_bp };
  const probability = Math.max(n.floor_bp, Math.min(n.cap_bp, n.tier_base_bp + bonus - n.decay_bp_per_tier * (tier - 1)));
  const value = u32(seed, "bt") % 10000;
  return { success: value < probability, value, probability };
}
