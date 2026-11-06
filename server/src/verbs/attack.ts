// One neutral, reproducible S5 combat settlement. Request data never supplies rolls.

import { getRow } from "../facts/store.ts";
import type { Change, CharRow, ID, Roll } from "../facts/types.ts";
import { deriveStats, gridNumbers, mulDiv, type NeutralFacts } from "../growth/balance.ts";
import { firstKill, markWanted } from "../growth/combat_effects.ts";
import { backpack, combatant, neutralFacts } from "../growth/facts.ts";
import { resolutionSeed, resolveCombat, u32 } from "../growth/settlement.ts";
import { NO_DETAILS, reject } from "../protocol/errors.ts";
import { charId } from "../protocol/shapes.ts";
import { obj, type Out } from "../protocol/validate.ts";
import { defineVerb } from "./types.ts";

const args = obj({ target: charId });
export type AttackArgs = Out<typeof args>;
export interface AttackResult {
  outcome: "win" | "lose" | "draw";
  winner: ID | null;
  changes: Change[];
  deed_id: ID;
  roll: Roll;
}

export const def = defineVerb<AttackArgs, AttackResult>({
  verb: "attack",
  summary: "依当前地点战斗规则攻击同地目标。",
  errors: ["NOT_FOUND", "NOT_HERE", "NOT_ALLOWED", "INSUFFICIENT_RESOURCE"],
  args,
  lock: "world",
  auth: () => true,
  costKey: () => "attack",
  async handler(ctx, a) {
    const me = ctx.actor;
    if (me === null) throw new Error("attack without actor");
    if (a.target === me.id) return reject("NOT_ALLOWED", { reason: "combat" });
    const target = await getRow(ctx.q, "char", a.target, { lock: true });
    if (target === null) return reject("NOT_FOUND", NO_DETAILS);
    if (target.loc !== me.loc) return reject("NOT_HERE", NO_DETAILS);
    if (target.life !== "alive") return reject("LIFE_BLOCKED", { revive_tick: target.revive_tick ?? "0" });
    // draft and active are equal targets (动词表 §4.10: 不额外禁攻击草码); newcomers are
    // protected by safe start places. Dormant / buried chars are not actionable.
    if (target.state !== "active" && target.state !== "draft") return reject("NOT_ALLOWED", { reason: "combat" });
    const place = await getRow(ctx.q, "place", me.loc);
    if (place === null) throw new Error("combat place missing");
    if (place.combat === "safe" || (place.combat === "pve" && target.kind !== "npc")) return reject("NOT_ALLOWED", { reason: "combat" });
    if (me.vigor === 0) return reject("INSUFFICIENT_RESOURCE", { resource: "vigor", required: 1, available: 0 });
    const actorFacts = await neutralFacts(ctx.q, me);
    const targetFacts = await neutralFacts(ctx.q, target);
    const actorInput = combatant(ctx.balance, me, actorFacts);
    const targetInput = combatant(ctx.balance, target, targetFacts);
    const seed = await resolutionSeed(ctx.q, ctx.world.rules_revision, ctx.world.realm, ctx.tick, me.id, target.id);
    const resolved = resolveCombat(ctx.balance, seed, actorInput, targetInput, place.combat);
    const changes: Change[] = [];
    const push = (c: Change | null): void => { if (c !== null) changes.push(c); };
    const dead: CharRow[] = [];
    const deathChanges = new Map<ID, Change[]>();
    const dropped: { id: ID; def_id: ID }[] = [];
    const settle = async (char: CharRow, vigor: number, facts: NeutralFacts, wear: number): Promise<void> => {
      const before = changes.length;
      const dies = place.combat !== "duel" && vigor === 0;
      let next = { ...char, vigor };
      if (dies) {
        const n = ctx.balance.numbers;
        const wait = char.kind !== "npc" ? n.death.revive_wait_ticks : char.archetype === "tutorial_opponent" ? n.npc.tutorial_respawn_ticks : char.archetype === "monster" ? n.npc.monster_respawn_ticks : n.npc.npc_respawn_ticks;
        const xpLoss = Math.min(char.xp, mulDiv(gridNumbers(ctx.balance, char.tier, char.stage).xp_need, n.death.xp_loss_bp, 10000));
        next = { ...next, life: "dead", revive_tick: (BigInt(ctx.tick) + BigInt(wait)).toString(), xp: char.xp - xpLoss, last_yield_tick: ctx.tick };
        push(await ctx.w.update("char", char.id, { vigor, life: next.life, revive_tick: next.revive_tick, xp: next.xp, last_yield_tick: ctx.tick }));
        dead.push(next);
        if (place.combat === "pk" && char.kind !== "npc" && u32(seed, "dropchance") % 10000 < n.death.pk_drop_chance_bp) {
          const bag = await backpack(ctx.q, char.id);
          const item = bag.length === 0 ? undefined : bag[u32(seed, "drop") % bag.length];
          if (item !== undefined) {
            push(await ctx.w.update("item", item.id, { holder: { kind: "place", id: place.id } }));
            dropped.push({ id: item.id, def_id: item.def_id });
          }
        }
      } else push(await ctx.w.update("char", char.id, { vigor }));
      for (const e of facts.equipment) {
        const loss = Math.max(1, mulDiv(e.definition.dura_max, wear, 10000));
        const dura = Math.max(0, e.instance.dura - loss);
        if (dura !== e.instance.dura) push(await ctx.w.update("item", e.instance.id, { dura }));
        e.instance = { ...e.instance, dura };
      }
      const maxAfterWear = deriveStats(ctx.balance, next, facts).vigor_max;
      if (!dies && next.vigor > maxAfterWear) {
        next.vigor = maxAfterWear;
        push(await ctx.w.update("char", char.id, { vigor: next.vigor }));
      }
      if (dies) deathChanges.set(char.id, changes.slice(before));
      if (char.id === me.id) ctx.actor = next;
    };
    await settle(me, resolved.actor_vigor, actorFacts, resolved.actor_wear_bp);
    await settle(target, resolved.target_vigor, targetFacts, resolved.target_wear_bp);
    const deed = await ctx.w.deed({
      actor: me.id, verb: "attack", kind: resolved.outcome === "draw" ? "combat_draw" : resolved.outcome === "lose" ? "combat_loss" : place.combat === "duel" ? "duel_win" : "combat_win",
      targets: [target.id], place_id: place.id,
      result: { outcome: resolved.outcome === "lose" ? "failure" : "success", changes: [...changes], roll: resolved.roll, proposal: null },
      visibility: "self", participants: [me.id, target.id],
    });
    const data = { attacker: me.id, target: target.id, winner: resolved.winner, mode: place.combat, outcome: resolved.outcome, dead: dead.map((c) => c.id), deed_id: deed.id };
    await ctx.w.emit({ scope: "self", recipients: [me.id, target.id], type: "combat_resolved", deed_id: deed.id, data });
    await ctx.w.emit({ scope: "place", place_id: place.id, type: "combat_resolved", deed_id: deed.id, data });
    // Each owner gets only their balances/equipped changes; the place gets no
    // precise vigor/xp or inventory, except an object actually dropped there.
    for (const who of [me.id, target.id]) {
      const ownItems = new Set((who === me.id ? actorFacts : targetFacts).equipment.map((e) => e.instance.id));
      const own = changes.filter((c) => c.table === "char" ? c.id === who : ownItems.has(c.id));
      if (own.length > 0) await ctx.w.emit({ scope: "self", recipients: [who], type: "fact_changed", deed_id: deed.id, data: { changes: own } });
    }
    for (const item of dropped) {
      const itemData = { item_id: item.id, def_id: item.def_id, reason: "drop" as const, holder: { kind: "place" as const, id: place.id }, state: "available" as const };
      await ctx.w.emit({ scope: "self", recipients: [me.id, target.id], type: "item_changed", deed_id: deed.id, data: itemData });
      await ctx.w.emit({ scope: "place", place_id: place.id, type: "item_changed", deed_id: deed.id, data: itemData });
    }
    for (const char of dead) {
      const death = await ctx.w.deed({
        actor: char.id, verb: "attack", kind: "death", targets: [char.id], place_id: place.id,
        result: { outcome: "success", changes: deathChanges.get(char.id) ?? [], roll: null, proposal: null }, visibility: "self", participants: [char.id],
      });
      const life = { char_id: char.id, from: "alive" as const, to: "dead" as const, place_id: place.id, revive_tick: char.revive_tick };
      await ctx.w.emit({ scope: "self", recipients: [char.id], type: "life_changed", deed_id: death.id, data: life });
      await ctx.w.emit({ scope: "place", place_id: place.id, type: "life_changed", deed_id: death.id, data: life });
      if (resolved.winner !== null) {
        const input = char.id === me.id ? actorInput : targetInput;
        // slay task progress is the task stream's: submit verifies combat deeds itself.
        if (char.kind === "npc") changes.push(...await firstKill(ctx, resolved.winner, input));
        else if (place.combat === "pk") {
          const killer = resolved.winner === me.id ? me : target;
          changes.push(...await markWanted(ctx, killer, place, "kill_player"));
        }
      }
    }
    if (target.kind === "npc" && target.archetype === "guard") changes.push(...await markWanted(ctx, me, place, "attack_guard"));
    return { outcome: resolved.outcome, winner: resolved.winner, changes, deed_id: deed.id, roll: resolved.roll };
  },
});
