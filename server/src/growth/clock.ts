// S5 tick settlement: wanted expiry, revival, neutral regeneration and training
// of participant chars (player / official). NPCs are settled by npc/clock.ts.

import type { ClockCtx, ClockPhase } from "../clock/phases.ts";
import { selectRows } from "../facts/store.ts";
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
  train_periods?: Map<string, number>;
  train_through_tick?: ClockCtx["to_tick"];
}

async function trainYield(ctx: GrowthClockCtx, char: CharRow): Promise<void> {
  if (char.train_skill === null) return;
  const n = ctx.balance.numbers;
  const elapsed = BigInt(ctx.to_tick) - BigInt(char.last_yield_tick);
  const due = elapsed / BigInt(n.clock.train_period_ticks);
  if (due <= 0n) return;
  const used = ctx.train_periods?.get(char.id) ?? 0;
  const remaining = BigInt(n.clock.train_catchup_max_periods - used);
  const periods = Number(due > remaining ? remaining : due);
  if (periods === 0) {
    await ctx.w.update("char", char.id, { last_yield_tick: ctx.train_through_tick ?? ctx.to_tick });
    return;
  }
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
  const exhausted = used + periods >= n.clock.train_catchup_max_periods;
  // Once capped, discard the rest of this offline interval, including later batches.
  const patch = { xp: addUInt(char.xp, xpGain), potential, last_yield_tick: exhausted ? ctx.train_through_tick ?? ctx.to_tick : ctx.to_tick };
  ctx.train_periods?.set(char.id, used + periods);
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

export const yieldPhase: ClockPhase = {
  name: "growth_yield",
  owner: "S10",
  async run(ctx: GrowthClockCtx) {
    // Participants only: NPC revival / regeneration belong to npc/clock.ts (S25) alone.
    const n = ctx.balance.numbers;
    const vigorMax = `(
      (SELECT trunc(g.vigor_max * (10000 +
        COALESCE((SELECT MAX(s.level) FROM skills s JOIN skills d ON d.id = s.def_id
          WHERE s.record = 'learned' AND s.char_id = chars.id AND d.base = 'inner'), 0) * $5::numeric +
        LEAST(chars.legacy, $6::numeric) * $7::numeric) / 10000)
        FROM jsonb_to_recordset($4::jsonb) AS g(tier integer, stage integer, vigor_max numeric)
        WHERE g.tier = chars.tier AND g.stage = chars.stage) +
      COALESCE((SELECT SUM((d.modifiers ->> 'vigor')::numeric +
        COALESCE((SELECT SUM((cd.effect -> 'modifiers' ->> 'vigor')::numeric)
          FROM jsonb_array_elements_text(i.sockets) AS socket(id)
          JOIN items ci ON ci.id = socket.id JOIN items cd ON cd.id = ci.def_id
          WHERE ci.state = 'available' AND ci.holder ->> 'kind' = 'item' AND ci.holder ->> 'id' = i.id), 0))
        FROM items i JOIN items d ON d.id = i.def_id
        WHERE i.record = 'instance' AND i.state = 'available' AND i.equipped = true AND i.dura > 0
          AND i.holder ->> 'kind' = 'char' AND i.holder ->> 'id' = chars.id), 0)
    )`;
    const rows = await selectRows(ctx.q, "char", `kind <> 'npc' AND state IN ('draft', 'active') AND id LIKE $1 AND (
      (life = 'dead' AND revive_tick <= $2::bigint) OR
      (life = 'alive' AND ((train_skill IS NOT NULL AND last_yield_tick + $3::bigint <= $2::bigint) OR
        (ap_tick < $2::bigint AND vigor <> ${vigorMax}))))`,
      [`${ctx.world.realm}:char:%`, ctx.to_tick, n.clock.train_period_ticks, JSON.stringify(n.grid), n.stats.skill_bp_per_level, n.cycle.legacy_cap, n.cycle.legacy_bp_per_point], 'ORDER BY id COLLATE "C"');
    for (const char of rows) {
      if (char.life === "dead") {
        if (char.revive_tick !== null && BigInt(char.revive_tick) <= BigInt(ctx.to_tick)) await revive(ctx, char);
        continue;
      }
      // Reset budget here, using its previous stamp for S5 regeneration. The
      // frozen runner otherwise overwrites ap_tick before a paid handler runs.
      const delta = BigInt(ctx.to_tick) - BigInt(char.ap_tick);
      if (delta > 0n) {
        const stats = deriveStats(ctx.balance, char, await neutralFacts(ctx.q, char));
        const raw = delta * BigInt(stats.vigor_max) * BigInt(ctx.balance.numbers.clock.vigor_regen_bp_per_tick) / 10000n;
        const gain = raw > 0n ? raw : 1n;
        const next = BigInt(char.vigor) + gain;
        const vigor = next >= BigInt(stats.vigor_max) ? stats.vigor_max : safeUInt(next);
        if (vigor !== char.vigor) await ctx.w.update("char", char.id, { vigor, ap_tick: ctx.to_tick, ap_spent: 0 });
      }
      await trainYield(ctx, char);
    }
  },
};
