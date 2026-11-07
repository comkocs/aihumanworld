// S80: killing a monster pays cultivation. No daily count — the clock (action points, vigor,
// the 30-tick respawn) is the only limit, so this stays out of the duel / pk five.

import { getRow } from "../facts/store.ts";
import type { Change, CharRow, ID, Reward } from "../facts/types.ts";
import { creditGrowth } from "../tasks/common.ts";
import type { VerbContext } from "../verbs/types.ts";
import { mulDiv, tierNumbers } from "./balance.ts";

export interface MonsterKillReward {
  /** The killer's own fact changes (xp / potential), for the attack result. */
  changes: Change[];
  /** What this kill paid; absent when the kill pays nothing. */
  reward?: Reward;
}

/**
 * A participant (never an NPC) who kills a monster of its own tier or higher is paid
 * `monster_kill_xp_bp` of that monster's tier's full task value, in xp and in potential.
 * A monster below the killer's tier pays nothing, so farming weaker ones is not worth it.
 * Every kill pays; nothing here is counted against the daily duel / pk five.
 */
export async function monsterKillReward(ctx: VerbContext, killer: CharRow, monster: CharRow, deedId: ID): Promise<MonsterKillReward> {
  const bp = ctx.balance.numbers.combat.monster_kill_xp_bp;
  if (bp === undefined || bp === 0 || killer.kind === "npc" || monster.kind !== "npc" || monster.archetype !== "monster") return { changes: [] };
  if (monster.tier < killer.tier) return { changes: [] };
  const t = tierNumbers(ctx.balance, monster.tier);
  const reward: Reward = { coin: 0, xp: mulDiv(t.task_xp, bp, 10000), potential: mulDiv(t.task_potential, bp, 10000), rep: 0, items: [] };
  if (reward.xp === 0 && reward.potential === 0) return { changes: [] };
  const current = killer.id === ctx.actor?.id ? ctx.actor : await getRow(ctx.q, "char", killer.id);
  if (current === null) return { changes: [] };
  const paid = await creditGrowth(ctx.q, ctx.w, current, reward);
  if (killer.id === ctx.actor?.id) ctx.actor = paid.row;
  await ctx.w.emit({
    scope: "self", recipients: [killer.id], type: "reward_granted", deed_id: deedId,
    data: { char_id: killer.id, source: deedId, reward },
  });
  return { changes: killer.id === ctx.actor?.id ? paid.changes : [], reward };
}
