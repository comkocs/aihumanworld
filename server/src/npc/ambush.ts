// S77: high-danger monsters act without a verb request. Cooldowns are recovered
// from the victim's existing inbox, so they survive restarts without a table.
import type { ClockCtx } from "../clock/phases.ts";
import { ITEM_CATEGORY } from "../facts/enums.ts";
import { getRow, selectRows } from "../facts/store.ts";
import type { Change, CharRow, ItemDefinitionRow } from "../facts/types.ts";
import { deriveStats, gridNumbers, mulDiv, type NeutralFacts } from "../growth/balance.ts";
import { firstKill } from "../growth/combat_effects.ts";
import { monsterKillReward } from "../growth/monster_reward.ts";
import { SpeechStore } from "../speech/store.ts";
import { combatant, neutralFacts } from "../growth/facts.ts";
import { resolutionSeed, resolveCombat, u32 } from "../growth/settlement.ts";
import { recordSlayEvidence } from "../tasks/evidence.ts";

export function npcLifeNumber(ctx: ClockCtx, key: string, fallback: number, min: number, max: number): number {
  const npc = ctx.balance.numbers.npc as unknown as Record<string, unknown>;
  const value = npc[key];
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`invalid npc.${key}`);
  }
  return value;
}

export async function ambush(ctx: ClockCtx, monster: CharRow): Promise<void> {
  if (monster.archetype !== "monster" || monster.life !== "alive" || monster.state !== "active" || monster.vigor === 0) return;
  const interval = npcLifeNumber(ctx, "ambush_interval_ticks", 5, 1, 1000000);
  const chance = npcLifeNumber(ctx, "ambush_chance_bp", 2000, 0, 10000);
  if (BigInt(ctx.to_tick) % BigInt(interval) !== 0n ||
      u32(`${ctx.world.realm}:${ctx.to_tick}:${monster.id}`, "s77_ambush") % 10000 >= chance) return;
  const place = await getRow(ctx.q, "place", monster.loc);
  if (place === null || place.danger !== "high" || place.combat === "safe" || place.combat === "duel" || place.tier !== monster.tier) return;
  const cooldown = npcLifeNumber(ctx, "ambush_cooldown_ticks", 60, 1, 1000000);
  const protect = ctx.balance.numbers.combat.newbie_protect_ticks ?? 0;
  const activeSince = (BigInt(ctx.to_tick) - BigInt(interval)).toString();
  const candidates = await selectRows(ctx.q, "char", "loc = $1 AND kind IN ('player', 'official') AND state IN ('draft', 'active') AND life = 'alive' AND vigor > 0 AND last_seen_tick >= $2::bigint", [place.id, activeSince], 'ORDER BY id COLLATE "C"');
  const start = candidates.length === 0 ? 0 : u32(`${ctx.to_tick}:${monster.id}`, "s77_target") % candidates.length;
  let target: CharRow | undefined;
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[(start + i) % candidates.length]!;
    // Do not ambush anyone during the original window, even if they opted out
    // of player-vs-player protection by attacking another participant.
    if (BigInt(ctx.to_tick) < BigInt(candidate.created_tick) + BigInt(protect)) continue;
    const recent = await ctx.q.query(
      "SELECT 1 FROM event_inbox i JOIN events e ON e.cursor = i.cursor JOIN deeds d ON d.id = e.deed_id " +
      "WHERE i.char_id = $1 AND e.type = 'combat_resolved' AND e.data->>'ambush' = 'true' " +
      "AND e.data->>'target' = $1 AND d.place_id = $2 AND e.tick > $3::bigint LIMIT 1",
      [candidate.id, place.id, (BigInt(ctx.to_tick) - BigInt(cooldown)).toString()],
    );
    if (recent.rows.length === 0) { target = candidate; break; }
  }
  if (target === undefined) return;
  const actorFacts = await neutralFacts(ctx.q, monster);
  const targetFacts = await neutralFacts(ctx.q, target);
  // S82: the ambush is the monster's bout, so the monster leads and the participant is the target. resolveCombat
  // only plays a whole bout when the *target* is the monster, so the two inputs are swapped for the resolution
  // and mapped back: a monster win here is the participant losing the bout.
  const actorInput = combatant(ctx.balance, target, targetFacts);
  const targetInput = combatant(ctx.balance, monster, actorFacts);
  const seed = await resolutionSeed(ctx.q, ctx.world.rules_revision, ctx.world.realm, ctx.to_tick, monster.id, target.id);
  const bout = resolveCombat(ctx.balance, seed, actorInput, targetInput, "pve");
  const result = {
    outcome: (bout.outcome === "win" ? "lose" : bout.outcome === "lose" ? "win" : "draw") as "win" | "lose" | "draw",
    winner: bout.winner,
    actor_vigor: bout.target_vigor, target_vigor: bout.actor_vigor,
    actor_wear_bp: bout.target_wear_bp, target_wear_bp: bout.actor_wear_bp,
    roll: bout.roll, rounds: bout.rounds,
  };
  const changes: Change[] = [];
  const own = new Map<string, Change[]>();
  const dead: CharRow[] = [];
  const settle = async (char: CharRow, vigor: number, facts: NeutralFacts, wear: number): Promise<void> => {
    const personal: Change[] = [];
    const push = (c: Change | null): void => { if (c !== null) { changes.push(c); personal.push(c); } };
    const dies = vigor === 0;
    let next = { ...char, vigor };
    if (dies) {
      const n = ctx.balance.numbers;
      const wait = char.kind === "npc" ? n.npc.monster_respawn_ticks : n.death.revive_wait_ticks;
      const xpLoss = Math.min(char.xp, mulDiv(gridNumbers(ctx.balance, char.tier, char.stage).xp_need, n.death.xp_loss_bp, 10000));
      next = { ...next, life: "dead", revive_tick: (BigInt(ctx.to_tick) + BigInt(wait)).toString(), xp: char.xp - xpLoss, last_yield_tick: ctx.to_tick };
      push(await ctx.w.update("char", char.id, { vigor, life: next.life, revive_tick: next.revive_tick, xp: next.xp, last_yield_tick: ctx.to_tick }));
      dead.push(next);
    } else push(await ctx.w.update("char", char.id, { vigor }));
    for (const e of facts.equipment) {
      const loss = Math.max(1, mulDiv(e.definition.dura_max, wear, 10000));
      const dura = Math.max(0, e.instance.dura - loss);
      if (dura !== e.instance.dura) push(await ctx.w.update("item", e.instance.id, { dura }));
      e.instance = { ...e.instance, dura };
    }
    const max = deriveStats(ctx.balance, next, facts).vigor_max;
    if (!dies && next.vigor > max) push(await ctx.w.update("char", char.id, { vigor: max }));
    own.set(char.id, personal);
  };
  await settle(monster, result.actor_vigor, actorFacts, result.actor_wear_bp);
  await settle(target, result.target_vigor, targetFacts, result.target_wear_bp);
  const dropped: { item_id: string; def_id: string }[] = [];
  const drop = ctx.balance.numbers.combat;
  if (dead.some((c) => c.id === monster.id) && drop.monster_drop_chance_bp !== undefined && drop.monster_drop_grade_weight !== undefined &&
      u32(seed, "mondrop") % 10000 < drop.monster_drop_chance_bp) {
    const draw = u32(seed, "mongrade") % 10000;
    let grade = 1;
    for (let acc = 0; grade <= drop.monster_drop_grade_weight.length; grade += 1) {
      acc += drop.monster_drop_grade_weight[grade - 1] ?? 0;
      if (draw < acc) break;
    }
    const defs = (await selectRows(ctx.q, "item", "record = 'definition' AND tier = $1 AND grade = $2", [monster.tier, grade]))
      .filter((d): d is ItemDefinitionRow => d.record === "definition" && ["weapon", "armor", "accessory"].includes(ITEM_CATEGORY[d.kind]));
    const kinds = [...new Set(defs.map((d) => d.kind))].sort();
    const chosenKind = kinds[u32(seed, "monkind") % kinds.length];
    const matching = defs.filter((d) => d.kind === chosenKind).sort((a, b) => a.id < b.id ? -1 : 1);
    const def = matching[u32(seed, "mondef") % matching.length];
    if (def !== undefined) {
      const id = await ctx.w.newId("item");
      const change = await ctx.w.insert("item", { id, created_tick: ctx.to_tick, updated_tick: ctx.to_tick, record: "instance", def_id: def.id,
        holder: { kind: "place", id: place.id }, state: "available", equipped: false, dura: def.dura_max,
        sockets: Array.from({ length: def.slots }, () => null), note: null });
      if (change !== null) changes.push(change);
      dropped.push({ item_id: id, def_id: def.id });
    }
  }
  const deed = await ctx.w.deed({
    actor: monster.id, verb: "clock", kind: result.outcome === "draw" ? "combat_draw" : result.outcome === "lose" ? "combat_loss" : "combat_win",
    targets: [target.id], place_id: place.id,
    result: { outcome: result.outcome === "lose" ? "failure" : "success", changes, roll: result.roll, proposal: null },
    visibility: "self", participants: [target.id],
  });
  // S80: counter-killing the ambusher pays the same as a kill the victim started, and the event below
  // carries it. The clock started this fight, so no action points were spent; it is not counted with the duel / pk five.
  const countered = dead.some((c) => c.id === monster.id) && result.winner === target.id;
  const verbCtx = { q: ctx.q, w: ctx.w, world: ctx.world, rules: ctx.rules, balance: ctx.balance, tick: ctx.to_tick,
    now: ctx.now, door: "api" as const, actor: null, services: { speech: new SpeechStore(), balance: () => ctx.balance } };
  const counterPay = countered ? await monsterKillReward(verbCtx, target, monster, deed.id) : { changes: [] };
  // S83: the monster's combat_loss also proves its victim's counter-kill for slay tasks.
  if (countered) await recordSlayEvidence({ q: ctx.q, w: ctx.w, tick: ctx.to_tick }, target, deed);
  const data = { attacker: monster.id, target: target.id, winner: result.winner, mode: "pve" as const, outcome: result.outcome, dead: dead.map((c) => c.id), deed_id: deed.id, ambush: true,
    ...(dropped.length > 0 ? { dropped } : {}),
    ...(counterPay.reward !== undefined ? { reward: { xp: counterPay.reward.xp, potential: counterPay.reward.potential } } : {}) };
  await ctx.w.emit({ scope: "self", recipients: [monster.id, target.id], type: "combat_resolved", deed_id: deed.id, data });
  await ctx.w.emit({ scope: "place", place_id: place.id, type: "combat_resolved", deed_id: deed.id, data });
  for (const who of [monster.id, target.id]) {
    const personal = own.get(who) ?? [];
    if (personal.length > 0) await ctx.w.emit({ scope: "self", recipients: [who], type: "fact_changed", deed_id: deed.id, data: { changes: personal } });
  }
  for (const item of dropped) {
    const itemData = { ...item, reason: "drop" as const, holder: { kind: "place" as const, id: place.id }, state: "available" as const };
    await ctx.w.emit({ scope: "self", recipients: [monster.id, target.id], type: "item_changed", deed_id: deed.id, data: itemData });
    await ctx.w.emit({ scope: "place", place_id: place.id, type: "item_changed", deed_id: deed.id, data: itemData });
  }
  for (const char of dead) {
    const death = await ctx.w.deed({ actor: char.id, verb: "clock", kind: "death", targets: [char.id], place_id: place.id,
      result: { outcome: "success", changes: own.get(char.id) ?? [], roll: null, proposal: null }, visibility: "self", participants: [char.id] });
    const life = { char_id: char.id, from: "alive" as const, to: "dead" as const, place_id: place.id, revive_tick: char.revive_tick };
    await ctx.w.emit({ scope: "self", recipients: [char.id], type: "life_changed", deed_id: death.id, data: life });
    await ctx.w.emit({ scope: "place", place_id: place.id, type: "life_changed", deed_id: death.id, data: life });
    if (char.id === monster.id && result.winner === target.id) await firstKill(verbCtx, target.id, actorInput);
  }
}
