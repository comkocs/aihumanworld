// S5 tick settlement: wanted expiry, revival, neutral regeneration and training
// of participant chars (player / official). NPCs are settled by npc/clock.ts.

import type { ClockCtx, ClockPhase } from "../clock/phases.ts";
import { mustGetRow, selectRows } from "../facts/store.ts";
import type { Change, CharRow } from "../facts/types.ts";
import { addUInt, deriveStats, mulDiv, safeUInt, tierNumbers } from "./balance.ts";
import { learnedSkill, neutralFacts, skillDefinition } from "./facts.ts";

export const wantedPhase: ClockPhase = {
  name: "wanted_expiry",
  owner: "S10",
  async run(ctx) {
    const rows = await selectRows(ctx.q, "wanted", "state = 'active' AND until_tick <= $1", [ctx.to_tick], 'ORDER BY id COLLATE "C" FOR UPDATE');
    for (const row of rows) {
      const change = await ctx.w.update("wanted", row.id, { state: "expired" });
      const changes = change === null ? [] : [change];
      const wanted = { ...row, state: "expired" as const, updated_tick: ctx.to_tick };
      const deed = await ctx.w.deed({
        actor: null, verb: "clock", kind: "wanted_end", targets: [row.id], place_id: null,
        result: { outcome: "success", changes, roll: null, proposal: null }, visibility: "world", participants: [row.char_id],
      });
      await ctx.w.emit({ scope: "self", recipients: [row.char_id], type: "wanted_changed", deed_id: deed.id, data: { wanted } });
      await ctx.w.emit({ scope: "world", type: "wanted_changed", deed_id: deed.id, data: { wanted } });
    }
  },
};

async function revive(ctx: ClockCtx, char: CharRow): Promise<void> {
  const facts = await neutralFacts(ctx.q, char);
  const max = deriveStats(ctx.balance, char, facts).vigor_max;
  const patch = {
    life: "alive" as const, revive_tick: null, loc: char.respawn_place,
    vigor: char.kind === "npc" ? max : Math.max(1, mulDiv(max, ctx.balance.numbers.death.revive_vigor_bp, 10000)),
    last_yield_tick: ctx.to_tick, ap_tick: ctx.to_tick, ap_spent: 0,
  };
  const change = await ctx.w.update("char", char.id, patch);
  const changes = change === null ? [] : [change];
  const deed = await ctx.w.deed({
    actor: null, verb: "clock", kind: "revive", targets: [char.id], place_id: char.respawn_place,
    result: { outcome: "success", changes, roll: null, proposal: null }, visibility: "self", participants: [char.id],
  });
  const data = { char_id: char.id, from: "dead" as const, to: "alive" as const, place_id: char.respawn_place, revive_tick: null };
  await ctx.w.emit({ scope: "self", recipients: [char.id], type: "life_changed", deed_id: deed.id, data });
  await ctx.w.emit({ scope: "place", place_id: char.respawn_place, type: "life_changed", deed_id: deed.id, data });
  if (char.loc !== char.respawn_place) {
    const moved = { char_id: char.id, from: char.loc, to: char.respawn_place };
    await ctx.w.emit({ scope: "self", recipients: [char.id], type: "moved", deed_id: deed.id, data: moved });
    for (const place_id of [char.loc, char.respawn_place]) await ctx.w.emit({ scope: "place", place_id, type: "moved", deed_id: deed.id, data: moved });
  }
  await ctx.w.emit({ scope: "self", recipients: [char.id], type: "fact_changed", deed_id: deed.id, data: { changes } });
}

export interface GrowthClockCtx extends ClockCtx {
  train_through_tick?: ClockCtx["to_tick"];
}

function trainThrough(ctx: GrowthClockCtx, char: CharRow): bigint {
  let through = BigInt(ctx.train_through_tick ?? ctx.to_tick);
  if (ctx.train_through_tick !== undefined && char.kind === "player") {
    // Settle before the existing identity phase makes this char ineligible.
    const limits = char.state === "draft"
      ? [[char.created_tick, ctx.rules.draft_expire_ticks]] as const
      : [[char.last_seen_tick, ctx.rules.dormant_after_ticks], [char.last_seen_tick, ctx.rules.bury_after_ticks]] as const;
    for (const [stamp, wait] of limits) {
      if (wait === null) continue;
      const end = BigInt(stamp) + BigInt(wait) - 1n;
      if (end < through) through = end;
    }
  }
  return through;
}

async function trainYield(ctx: GrowthClockCtx, char: CharRow): Promise<void> {
  if (char.train_skill === null) return;
  // Intermediate catch-up commits never consume part of an offline allowance.
  if (BigInt(ctx.to_tick) < trainThrough(ctx, char)) return;
  const n = ctx.balance.numbers;
  const elapsed = BigInt(ctx.to_tick) - BigInt(char.last_yield_tick);
  const due = elapsed / BigInt(n.clock.train_period_ticks);
  if (due <= 0n) return;
  const max = BigInt(n.clock.train_catchup_max_periods);
  const periods = Number(due > max ? max : due);
  const def = await skillDefinition(ctx.q, char.train_skill);
  const learned = def === null ? null : await learnedSkill(ctx.q, char.id, def.id);
  if (learned === null) {
    await ctx.w.update("char", char.id, { train_skill: null, last_yield_tick: ctx.to_tick });
    return;
  }
  const tier = tierNumbers(ctx.balance, char.tier);
  let potential = char.potential;
  let level = learned.level;
  const cap = Math.min(learned.cap, tier.skill_cap_hard);
  for (let period = 0; period < periods; period += 1) {
    potential = addUInt(potential, tier.train_potential);
    for (let up = 0; up < n.skills.train_levelup_per_yield && level < cap; up += 1) {
      const cost = safeUInt(BigInt(tier.task_potential) * BigInt(level + 1) * BigInt(n.skills.level_cost_mult));
      if (potential < cost) break;
      potential -= cost;
      level += 1;
    }
  }
  const xpGain = mulDiv(tier.train_xp, periods, 1);
  const potentialGain = mulDiv(tier.train_potential, periods, 1);
  // Persist both the capped grant and its endpoint in the same transaction.
  const patch = { xp: addUInt(char.xp, xpGain), potential, last_yield_tick: ctx.to_tick };
  const changes: Change[] = [];
  const change = await ctx.w.update("char", char.id, patch);
  if (change !== null) changes.push(change);
  if (level !== learned.level) {
    const skillChange = await ctx.w.update("skill", learned.id, { level });
    if (skillChange !== null) changes.push(skillChange);
  }
  const deed = await ctx.w.deed({
    actor: null, verb: "clock", kind: "train", targets: [char.id, learned.id], place_id: char.loc,
    result: { outcome: "success", changes, roll: null, proposal: null }, visibility: "self", participants: [char.id],
  });
  // UInt event fields describe generated yield; the exact post-spend potential
  // is recorded in Change (it can be lower than before the period).
  await ctx.w.emit({ scope: "self", recipients: [char.id], type: "tick_yield", deed_id: deed.id, data: { char_id: char.id, xp: xpGain, potential: potentialGain, skill: char.train_skill, level: level === learned.level ? null : level } });
  if (level !== learned.level) await ctx.w.emit({ scope: "self", recipients: [char.id], type: "skill_changed", deed_id: deed.id, data: { char_id: char.id, skill: char.train_skill, level, cap: learned.cap } });
  await ctx.w.emit({ scope: "self", recipients: [char.id], type: "fact_changed", deed_id: deed.id, data: { changes } });
}

async function scheduleGrowth(ctx: GrowthClockCtx, char: CharRow): Promise<void> {
  let due: bigint | null = null;
  if (char.kind !== "npc" && (char.state === "draft" || char.state === "active")) {
    if (char.life === "dead") due = char.revive_tick === null ? null : BigInt(char.revive_tick);
    else {
      const tick = BigInt(ctx.to_tick);
      const max = deriveStats(ctx.balance, char, await neutralFacts(ctx.q, char)).vigor_max;
      if (char.vigor !== max) due = tick + 1n;
      if (char.train_skill !== null) {
        let trainDue = BigInt(char.last_yield_tick) + BigInt(ctx.balance.numbers.clock.train_period_ticks);
        const through = trainThrough(ctx, char);
        if (trainDue <= through && tick < through) trainDue = through;
        if (due === null || trainDue < due) due = trainDue;
      }
    }
  }
  await ctx.q.query("UPDATE chars SET growth_due_tick = $2 WHERE id = $1", [char.id, due?.toString() ?? null]);
}

export const yieldPhase: ClockPhase = {
  name: "growth_yield",
  owner: "S10",
  async run(ctx: GrowthClockCtx) {
    // Participants only: NPC revival / regeneration belong to npc/clock.ts (S25) alone.
    const rows = await selectRows(ctx.q, "char",
      "split_part(id, ':', 1) = $1 AND growth_due_tick IS NOT NULL AND growth_due_tick <= $2::bigint",
      [ctx.world.realm, ctx.to_tick], 'ORDER BY id COLLATE "C"');
    for (let char of rows) {
      if (char.life === "dead") {
        if (char.revive_tick !== null && BigInt(char.revive_tick) <= BigInt(ctx.to_tick)) await revive(ctx, char);
      } else {
        // Reset budget here, using its previous stamp for S5 regeneration. The
        // frozen runner otherwise overwrites ap_tick before a paid handler runs.
        const delta = BigInt(ctx.to_tick) - BigInt(char.ap_tick);
        if (delta > 0n) {
          const stats = deriveStats(ctx.balance, char, await neutralFacts(ctx.q, char));
          const raw = delta * BigInt(stats.vigor_max) * BigInt(ctx.balance.numbers.clock.vigor_regen_bp_per_tick) / 10000n;
          const gain = raw > 0n ? raw : 1n;
          const next = BigInt(char.vigor) + gain;
          const vigor = next >= BigInt(stats.vigor_max) ? stats.vigor_max : safeUInt(next);
          if (vigor !== char.vigor) {
            await ctx.w.update("char", char.id, { vigor, ap_tick: ctx.to_tick, ap_spent: 0 });
            char = { ...char, vigor, ap_tick: ctx.to_tick, ap_spent: 0 };
          }
        }
        await trainYield(ctx, char);
      }
      await scheduleGrowth(ctx, await mustGetRow(ctx.q, "char", char.id));
    }
  },
};
