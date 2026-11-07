// One neutral, reproducible S5 combat settlement. Request data never supplies rolls.

import { noteFirstGate } from "../facts/firsts.ts";
import { ITEM_CATEGORY } from "../facts/enums.ts";
import { getRow, selectRows } from "../facts/store.ts";
import type { Change, CharRow, ID, ItemDefinitionRow, Roll } from "../facts/types.ts";
import { deriveStats, gridNumbers, mulDiv, type NeutralFacts } from "../growth/balance.ts";
import { firstKill, markWanted, settlePkKill, socialCombatReward } from "../growth/combat_effects.ts";
import { backpack, combatant, neutralFacts } from "../growth/facts.ts";
import { resolutionSeed, resolveCombat, u32 } from "../growth/settlement.ts";
import { NO_DETAILS, reject } from "../protocol/errors.ts";
import { charId } from "../protocol/shapes.ts";
import { obj, type Out } from "../protocol/validate.ts";
import { defineVerb, type VerbContext } from "./types.ts";

const args = obj({ target: charId });
export type AttackArgs = Out<typeof args>;
export interface AttackResult {
  outcome: "win" | "lose" | "draw";
  winner: ID | null;
  changes: Change[];
  deed_id: ID;
  roll: Roll;
  /** S69: equipment a killed monster dropped on the place; absent when nothing dropped. */
  dropped?: { item_id: ID; def_id: ID }[];
}

const EQUIPMENT_CATEGORIES = new Set(["weapon", "armor", "accessory"]);

/**
 * S69: one equipment definition of the monster's own tier, drawn from the library (never a hard-coded
 * local list). Grade follows monster_drop_grade_weight; the kind is uniform over the kinds the library
 * actually stocks at that tier and grade. Same seed, same library → same drop.
 */
async function monsterDropDef(ctx: VerbContext, seed: string, tier: number): Promise<ItemDefinitionRow | null> {
  const c = ctx.balance.numbers.combat;
  const weights = c.monster_drop_grade_weight;
  if (c.monster_drop_chance_bp === undefined || weights === undefined) return null;
  if (u32(seed, "mondrop") % 10000 >= c.monster_drop_chance_bp) return null;
  const draw = u32(seed, "mongrade") % 10000;
  let grade = 1;
  for (let acc = 0; grade <= weights.length; grade += 1) {
    acc += weights[grade - 1] ?? 0;
    if (draw < acc) break;
  }
  const defs = (await selectRows(ctx.q, "item", "record = 'definition' AND tier = $1 AND grade = $2", [tier, grade]))
    .filter((d): d is ItemDefinitionRow => d.record === "definition" && EQUIPMENT_CATEGORIES.has(ITEM_CATEGORY[d.kind]));
  const kinds = [...new Set(defs.map((d) => d.kind))].sort();
  const ofKind = defs.filter((d) => d.kind === kinds[u32(seed, "monkind") % kinds.length]).sort((a, b) => (a.id < b.id ? -1 : 1));
  const picked = ofKind[u32(seed, "mondef") % ofKind.length];
  return picked ?? null;
}

export const def = defineVerb<AttackArgs, AttackResult>({
  verb: "attack",
  summary:
    "依当前地点战斗规则攻击同地目标。与另一位玩家在切磋场较量,每对每天首次胜得 0.84 件任务修为、负得 0.42 件、平局各得 0.56 件;在其他任何地点击杀对方得 0.79 件。按双方较低阶的满额任务算,切磋与 PK 奖励每天共至多 5 次。单玩时持续玩家聊天最快,探索次之,五场切磋胜再次,五次 PK 击杀约等于练级。除切磋场外由你发起并击杀玩家会被通缉(红名)并挂系统悬赏:高杀低两天且无奖,同阶四小时、低杀高两小时;击杀红名者不受罚,得红名者阶 2.37 件任务修为与悬赏币。新角色建角后 5 刻内不能被其他玩家攻击,之后处处可 PK。",
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
    // draft and active are equal targets (动词表 §4.10: 不额外禁攻击草码). Dormant / buried chars are not actionable.
    if (target.state !== "active" && target.state !== "draft") return reject("NOT_ALLOWED", { reason: "combat" });
    const place = await getRow(ctx.q, "place", me.loc);
    if (place === null) throw new Error("combat place missing");
    // S67 (设计者 15:2x, 弱规则): no safe zone. Past the newbie window a participant may be attacked anywhere;
    // duel stays a non-lethal spar, and every other place settles as pk (red name, bounty, death loss).
    // Attacking an NPC in a safe place stays forbidden, as before.
    const lethal = place.combat !== "duel" && me.kind !== "npc" && target.kind !== "npc";
    if (!lethal && (place.combat === "safe" || (place.combat === "pve" && target.kind !== "npc"))) return reject("NOT_ALLOWED", { reason: "combat" });
    const mode = lethal || place.combat === "safe" ? "pk" : place.combat;
    // S48 newbie protection: a new participant cannot be attacked by other participants for a few ticks (NPCs go on as usual).
    // S53: protection also ends the tick the newcomer itself first attacks another participant (player / official);
    // attacking an NPC does not count. No new table — the earliest such combat_resolved is the fact.
    const protect = ctx.balance.numbers.combat.newbie_protect_ticks ?? 0;
    if (protect > 0 && me.kind !== "npc" && target.kind !== "npc") {
      const windowEnd = BigInt(target.created_tick) + BigInt(protect);
      let until = windowEnd;
      // Only look while the window is open, and only in the target's own inbox (indexed by char_id).
      if (BigInt(ctx.tick) < windowEnd) {
        const broke = await ctx.q.query<{ tick: string | null }>(
          "SELECT min(e.tick)::text AS tick FROM event_inbox i JOIN events e ON e.cursor = i.cursor " +
            "JOIN chars c ON c.id = e.data->>'target' " +
            "WHERE i.char_id = $1 AND e.type = 'combat_resolved' AND e.data->>'attacker' = $1 " +
            "AND c.kind IN ('player', 'official') AND e.tick >= $2::bigint AND e.tick < $3::bigint",
          [target.id, target.created_tick, windowEnd.toString()],
        );
        const first = broke.rows[0]?.tick;
        if (first !== undefined && first !== null) until = BigInt(first);
      }
      if (BigInt(ctx.tick) < until) {
        return reject("NOT_ALLOWED", { reason: "newbie", until_tick: until.toString() });
      }
    }
    if (me.vigor === 0) return reject("INSUFFICIENT_RESOURCE", { resource: "vigor", required: 1, available: 0 });
    const actorFacts = await neutralFacts(ctx.q, me);
    const targetFacts = await neutralFacts(ctx.q, target);
    const actorInput = combatant(ctx.balance, me, actorFacts);
    const targetInput = combatant(ctx.balance, target, targetFacts);
    const seed = await resolutionSeed(ctx.q, ctx.world.rules_revision, ctx.world.realm, ctx.tick, me.id, target.id);
    const resolved = resolveCombat(ctx.balance, seed, actorInput, targetInput, mode);
    const changes: Change[] = [];
    const push = (c: Change | null): void => { if (c !== null) changes.push(c); };
    const dead: CharRow[] = [];
    const deathChanges = new Map<ID, Change[]>();
    const dropped: { id: ID; def_id: ID }[] = [];
    // S69 only: what the killed monster itself dropped. A player's PK loot stays out of the combat report.
    const monsterDrops: { id: ID; def_id: ID }[] = [];
    const settle = async (char: CharRow, vigor: number, facts: NeutralFacts, wear: number): Promise<void> => {
      const before = changes.length;
      const dies = mode !== "duel" && vigor === 0;
      let next = { ...char, vigor };
      if (dies) {
        const n = ctx.balance.numbers;
        const wait = char.kind !== "npc" ? n.death.revive_wait_ticks : char.archetype === "tutorial_opponent" ? n.npc.tutorial_respawn_ticks : char.archetype === "monster" ? n.npc.monster_respawn_ticks : n.npc.npc_respawn_ticks;
        const xpLoss = Math.min(char.xp, mulDiv(gridNumbers(ctx.balance, char.tier, char.stage).xp_need, n.death.xp_loss_bp, 10000));
        next = { ...next, life: "dead", revive_tick: (BigInt(ctx.tick) + BigInt(wait)).toString(), xp: char.xp - xpLoss, last_yield_tick: ctx.tick };
        push(await ctx.w.update("char", char.id, { vigor, life: next.life, revive_tick: next.revive_tick, xp: next.xp, last_yield_tick: ctx.tick }));
        dead.push(next);
        if (mode === "pk" && char.kind !== "npc" && u32(seed, "dropchance") % 10000 < n.death.pk_drop_chance_bp) {
          const bag = await backpack(ctx.q, char.id);
          const item = bag.length === 0 ? undefined : bag[u32(seed, "drop") % bag.length];
          if (item !== undefined) {
            push(await ctx.w.update("item", item.id, { holder: { kind: "place", id: place.id } }));
            dropped.push({ id: item.id, def_id: item.def_id });
          }
        }
        // A participant killing a monster outside a duel may drop equipment of the monster's own tier.
        // No equipment of its tier in the library drops nothing either.
        if (place.combat !== "duel" && me.kind !== "npc" && char.id === target.id && resolved.winner === me.id && char.kind === "npc" && char.archetype === "monster") {
          const def = await monsterDropDef(ctx, seed, char.tier);
          if (def !== null) {
            const id = await ctx.w.newId("item");
            push(await ctx.w.insert("item", {
              id, created_tick: ctx.tick, updated_tick: ctx.tick, record: "instance", def_id: def.id,
              holder: { kind: "place", id: place.id }, state: "available", equipped: false,
              dura: def.dura_max, sockets: Array.from({ length: def.slots }, () => null), note: null,
            }));
            dropped.push({ id, def_id: def.id });
            monsterDrops.push({ id, def_id: def.id });
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
      actor: me.id, verb: "attack", kind: resolved.outcome === "draw" ? "combat_draw" : resolved.outcome === "lose" ? "combat_loss" : mode === "duel" ? "duel_win" : "combat_win",
      targets: [target.id], place_id: place.id,
      result: { outcome: resolved.outcome === "lose" ? "failure" : "success", changes: [...changes], roll: resolved.roll, proposal: null },
      visibility: "self", participants: [me.id, target.id],
    });
    const data = {
      attacker: me.id, target: target.id, winner: resolved.winner, mode, outcome: resolved.outcome, dead: dead.map((c) => c.id), deed_id: deed.id,
      ...(monsterDrops.length > 0 ? { dropped: monsterDrops.map((d) => ({ item_id: d.id, def_id: d.def_id })) } : {}),
    };
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
    // S46 切磋 / PK reward and S48 red name / bounty for fighting another participant (also in this result's changes).
    const fight = { me: ctx.actor ?? me, target, place, outcome: resolved.outcome, winner: resolved.winner, dead: dead.map((c) => c.id), deed };
    const loser = resolved.winner === null ? null : resolved.winner === me.id ? target : me;
    if (mode === "pk" && loser !== null && fight.dead.includes(loser.id)) {
      const winner = resolved.winner === me.id ? (ctx.actor ?? me) : target;
      changes.push(...await settlePkKill(ctx, { initiator: me.id, winner, loser, place, fight }));
    } else {
      changes.push(...await socialCombatReward(ctx, fight));
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
        // S62: the first of this origin region to beat the opponent at its tutorial place.
        const killer = await getRow(ctx.q, "char", resolved.winner);
        if (killer !== null) await noteFirstGate(ctx.w, killer, char, place);
      }
    }
    if (target.kind === "npc" && target.archetype === "guard") changes.push(...await markWanted(ctx, me, place, "attack_guard"));
    return {
      outcome: resolved.outcome, winner: resolved.winner, changes, deed_id: deed.id, roll: resolved.roll,
      ...(monsterDrops.length > 0 ? { dropped: monsterDrops.map((d) => ({ item_id: d.id, def_id: d.def_id })) } : {}),
    };
  },
});
