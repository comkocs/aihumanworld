// S25 archetype heartbeat. Stationary services never invent speech or attacks;
// patrol, revival, regeneration, master skills and coin floats are S5 rules.

import type { ClockCtx, ClockPhase } from "../clock/phases.ts";
import { getRow, selectRows, type Patch } from "../facts/store.ts";
import type { Change, CharRow, SkillLearnedRow } from "../facts/types.ts";
import { cellNumber, checkedUInt, numberAt, periodAt, requireRevision, valueAt } from "../orgs/numbers.ts";
import { stats } from "./facts.ts";

async function revive(ctx: ClockCtx, npc: CharRow): Promise<CharRow> {
  if (npc.revive_tick === null || BigInt(npc.revive_tick) > BigInt(ctx.to_tick)) return npc;
  const patch: Patch<"char"> = {
    life: "alive", revive_tick: null, loc: npc.respawn_place,
    vigor: (await stats(ctx.q, ctx.balance, npc)).vigor_max,
    ap_tick: ctx.to_tick, ap_spent: 0, last_yield_tick: ctx.to_tick,
  };
  const change = await ctx.w.update("char", npc.id, patch);
  const deed = await ctx.w.deed({
    actor: null, verb: "clock", kind: "revive", targets: [npc.id], place_id: npc.respawn_place,
    result: { outcome: "success", changes: change === null ? [] : [change], roll: null, proposal: null }, visibility: "self", participants: [npc.id],
  });
  const data = { char_id: npc.id, from: "dead" as const, to: "alive" as const, place_id: npc.respawn_place, revive_tick: null };
  await ctx.w.emit({ scope: "self", recipients: [npc.id], type: "life_changed", deed_id: deed.id, data });
  await ctx.w.emit({ scope: "place", place_id: npc.respawn_place, type: "life_changed", deed_id: deed.id, data });
  if (npc.loc !== npc.respawn_place) {
    const moved = { char_id: npc.id, from: npc.loc, to: npc.respawn_place };
    await ctx.w.emit({ scope: "self", recipients: [npc.id], type: "moved", deed_id: deed.id, data: moved });
    for (const place_id of [npc.loc, npc.respawn_place]) await ctx.w.emit({ scope: "place", place_id, type: "moved", deed_id: deed.id, data: moved });
  }
  return { ...npc, ...patch };
}

async function patrol(ctx: ClockCtx, npc: CharRow, previous: string): Promise<void> {
  if (npc.archetype !== "patroller" || npc.patrol_route.length === 0) return;
  const elapsed = BigInt(ctx.to_tick) - BigInt(previous);
  const interval = periodAt(ctx.balance, "npc.patrol_step_ticks");
  if (elapsed < interval) return;
  const next = (npc.patrol_index + 1) % npc.patrol_route.length;
  const to = npc.patrol_route[next];
  if (to === undefined) throw new Error("S25 invalid patrol index");
  const place = await getRow(ctx.q, "place", npc.loc);
  const exit = place?.exits.find((e) => e.to === to && !e.locked);
  if (exit === undefined || await getRow(ctx.q, "place", to) === null) return;
  const change = await ctx.w.update("char", npc.id, { loc: to, patrol_index: next });
  const deed = await ctx.w.deed({
    actor: null, verb: "clock", kind: "travel", targets: [npc.id, to], place_id: to,
    result: { outcome: "success", changes: change === null ? [] : [change], roll: null, proposal: null }, visibility: "place", participants: [npc.id],
  });
  const data = { char_id: npc.id, from: npc.loc, to };
  await ctx.w.emit({ scope: "self", recipients: [npc.id], type: "moved", deed_id: deed.id, data });
  for (const place_id of new Set([npc.loc, to])) await ctx.w.emit({ scope: "place", place_id, type: "moved", deed_id: deed.id, data });
  await ctx.q.query("UPDATE s25_npc_clock SET patrol_tick = $2 WHERE char_id = $1", [npc.id, ctx.to_tick]);
}

async function teach(ctx: ClockCtx, npc: CharRow): Promise<void> {
  if (npc.archetype !== "master") return;
  if (valueAt(ctx.balance, "npc.master_skill_level_rule") !== "skill_cap_hard") throw new Error("S25 unsupported master skill rule");
  const level = cellNumber(ctx.balance, "tiers", { tier: npc.tier }, "skill_cap_hard");
  const defs = await selectRows(ctx.q, "skill", "record = 'definition' AND key IN ('strike', 'guard', 'move', 'inner')", [], 'ORDER BY key COLLATE "C"');
  const changes: Change[] = [];
  const notes: { key: string; row: SkillLearnedRow }[] = [];
  for (const def of defs) {
    if (def.record !== "definition") continue;
    const old = (await selectRows(ctx.q, "skill", "record = 'learned' AND char_id = $1 AND def_id = $2", [npc.id, def.id]))[0];
    if (old?.record === "learned" && old.level === level && old.cap === level) continue;
    const row: SkillLearnedRow = old?.record === "learned" ? { ...old, level, cap: level, updated_tick: ctx.to_tick } : {
      id: await ctx.w.newId("skill"), created_tick: ctx.to_tick, updated_tick: ctx.to_tick,
      record: "learned", char_id: npc.id, def_id: def.id, level, cap: level,
    };
    const change = old === undefined ? await ctx.w.insert("skill", row) : await ctx.w.update("skill", old.id, { level, cap: level });
    if (change !== null) changes.push(change);
    notes.push({ key: def.key, row });
  }
  if (changes.length === 0) return;
  const deed = await ctx.w.deed({
    actor: null, verb: "clock", kind: "learn", targets: [npc.id, ...notes.map((n) => n.row.id)], place_id: npc.loc,
    result: { outcome: "success", changes, roll: null, proposal: null }, visibility: "self", participants: [npc.id],
  });
  for (const note of notes) await ctx.w.emit({ scope: "self", recipients: [npc.id], type: "skill_changed", deed_id: deed.id, data: { char_id: npc.id, skill: note.key, level, cap: level } });
}

export const npcPhase: ClockPhase = {
  name: "npc",
  owner: "S25",
  async run(ctx) {
    const rows = await selectRows(ctx.q, "char", "kind = 'npc' AND id LIKE $1", [`${ctx.world.realm}:char:%`], 'ORDER BY id COLLATE "C" FOR UPDATE');
    if (rows.length === 0) return;
    requireRevision(ctx.balance, ctx.world.rules_revision, ctx.rules.balance_key);
    for (let npc of rows) {
      await ctx.q.query("INSERT INTO s25_npc_clock (char_id, patrol_tick, coin_tick) VALUES ($1, $2, $2) ON CONFLICT DO NOTHING", [npc.id, npc.created_tick]);
      const row = (await ctx.q.query<{ patrol_tick: string; coin_tick: string }>("SELECT patrol_tick, coin_tick FROM s25_npc_clock WHERE char_id = $1", [npc.id])).rows[0];
      if (row === undefined) throw new Error("S25 missing NPC clock row");
      if (npc.life === "dead") {
        npc = await revive(ctx, npc);
        // The death fact's revive_tick is authoritative (S10 wrote the S5 wait).
        if (npc.life === "dead") continue;
        await ctx.q.query("UPDATE s25_npc_clock SET patrol_tick = $2 WHERE char_id = $1", [npc.id, ctx.to_tick]);
      } else {
        const elapsed = BigInt(ctx.to_tick) - BigInt(npc.ap_tick);
        if (elapsed > 0n) {
          const max = (await stats(ctx.q, ctx.balance, npc)).vigor_max;
          const raw = elapsed * BigInt(max) * BigInt(numberAt(ctx.balance, "clock.vigor_regen_bp_per_tick")) / 10000n;
          const value = BigInt(npc.vigor) + (raw > 0n ? raw : 1n);
          await ctx.w.update("char", npc.id, { vigor: value > BigInt(max) ? max : checkedUInt(value), ap_tick: ctx.to_tick, ap_spent: 0 });
        }
        await patrol(ctx, npc, row.patrol_tick);
      }
      await teach(ctx, npc);
      const period = periodAt(ctx.balance, "npc.coin_reset_ticks");
      if (BigInt(ctx.to_tick) / period > BigInt(row.coin_tick) / period) {
        const coin = cellNumber(ctx.balance, "tier_prices", { tier: npc.tier }, "npc_coin_float");
        const change = await ctx.w.update("char", npc.id, { coin });
        await ctx.w.emit({ scope: "self", recipients: [npc.id], type: "fact_changed", deed_id: null, data: { changes: change === null ? [] : [change] } });
        await ctx.q.query("UPDATE s25_npc_clock SET coin_tick = $2 WHERE char_id = $1", [npc.id, ctx.to_tick]);
      }
    }
  },
};
