// Stage, tier and cycle use one deterministic S5 primitive; failure is committed.

import { getRow } from "../facts/store.ts";
import type { Change, CharRow, ItemInstanceRow, Roll, Stage, Tier, UInt } from "../facts/types.ts";
import { addUInt, deriveStats, effectiveLevels, equipmentCapacity, gridNumbers, mulDiv, tierNumbers, type Balance, type NeutralFacts } from "../growth/balance.ts";
import { combatant, itemDefinition, neutralFacts } from "../growth/facts.ts";
import { resolutionSeed, resolveBreakthrough } from "../growth/settlement.ts";
import { NO_DETAILS, reject } from "../protocol/errors.ts";
import { itemId } from "../protocol/shapes.ts";
import { nullable, obj, oneOf, opt, type Out } from "../protocol/validate.ts";
import { defineVerb } from "./types.ts";

const args = obj({
  mode: oneOf(["stage", "tier", "cycle"] as const, "breakthrough mode"),
  item: opt(nullable(itemId), null),
});
export type BreakthroughArgs = Out<typeof args>;

/** Same gate breakthrough uses for stage / tier / xp / training. ready means a call now would not be refused on those. */
export interface NextBreakthrough {
  mode: BreakthroughArgs["mode"] | null;
  ready: boolean;
  xp_need: UInt;
  inner_req: UInt;
}

export function nextBreakthrough(balance: Balance, me: Pick<CharRow, "tier" | "stage" | "xp">, facts: NeutralFacts): NextBreakthrough {
  const mode: NextBreakthrough["mode"] = me.stage < 4 ? "stage" : me.tier < 9 ? "tier" : "cycle";
  const grid = gridNumbers(balance, me.tier, me.stage);
  const ready = me.xp >= grid.xp_need && effectiveLevels(facts).inner >= grid.inner_req;
  return { mode, ready, xp_need: grid.xp_need, inner_req: grid.inner_req };
}

export interface BreakthroughResult {
  mode: BreakthroughArgs["mode"];
  outcome: "success" | "failure";
  tier: Tier;
  stage: Stage;
  cycles: UInt;
  changes: Change[];
  roll: Roll | null;
}

export const def = defineVerb<BreakthroughArgs, BreakthroughResult>({
  verb: "breakthrough",
  summary: "条件满足后突破小段、大阶或轮回，可选用同阶突破药。",
  errors: ["CONDITION_UNMET", "NOT_FOUND", "ITEM_STATE"],
  purpose: (a) => ({ stage: "突破当前小段。", tier: "从第四段尝试突破到下一大阶。", cycle: "九阶四段完成轮回。" })[a.mode],
  args,
  lock: "world",
  auth: () => true,
  costKey: () => "breakthrough",
  async handler(ctx, a) {
    const me = ctx.actor;
    if (me === null) throw new Error("breakthrough without actor");
    if (a.mode === "stage" ? me.stage >= 4 : a.mode === "tier" ? me.stage !== 4 || me.tier >= 9 : me.tier !== 9 || me.stage !== 4) return reject("CONDITION_UNMET", { reason: a.mode === "cycle" ? "tier" : "stage" });
    const facts = await neutralFacts(ctx.q, me);
    const gate = nextBreakthrough(ctx.balance, me, facts);
    if (me.xp < gate.xp_need) return reject("CONDITION_UNMET", { reason: "xp", required: gate.xp_need, have: me.xp });
    if (!gate.ready) {
      const inner = facts.skills.find((s) => s.definition.base === "inner");
      return reject("CONDITION_UNMET", { reason: "training", skill: "inner", required: gate.inner_req, level: inner?.learned.level ?? 0, cap: inner?.learned.cap ?? 0 });
    }
    const grid = gridNumbers(ctx.balance, me.tier, me.stage);
    let item: ItemInstanceRow | null = null;
    let bonus = 0;
    if (a.item !== null) {
      const row = await getRow(ctx.q, "item", a.item);
      if (row?.record !== "instance" || row.holder.kind !== "char" || row.holder.id !== me.id) return reject("NOT_FOUND", NO_DETAILS);
      if (row.state !== "available") return reject("ITEM_STATE", { reason: "consumed" });
      if (row.equipped) return reject("ITEM_STATE", { reason: "equipped" });
      const definition = await itemDefinition(ctx.q, row.def_id);
      if (definition.kind !== "potion" || definition.effect.kind !== "breakthrough" || definition.tier !== me.tier) return reject("ITEM_STATE", { reason: "type" });
      const numbers = ctx.balance.numbers.consumables.table.find((r) => r.tier === definition.tier && r.grade === definition.grade);
      if (numbers === undefined || definition.effect.bonus > numbers.bt_bonus_bp) return reject("ITEM_STATE", { reason: "type" });
      bonus = definition.effect.bonus;
      item = row;
    }
    const seed = await resolutionSeed(ctx.q, ctx.world.rules_revision, ctx.world.realm, ctx.tick, me.id, null);
    const check = resolveBreakthrough(ctx.balance, a.mode, me.tier, bonus, seed);
    const roll: Roll | null = check.value === null ? null : {
      seed, rule: a.mode === "cycle" ? ctx.balance.numbers.combat.rule_key_cycle : ctx.balance.numbers.combat.rule_key_tier,
      inputs: { actor: combatant(ctx.balance, me, facts), target: null, mode: a.mode === "cycle" ? "cycle" : "tier", assist_item: item?.id ?? null }, value: check.value,
    };
    const changes: Change[] = [];
    const push = (c: Change | null): void => { if (c !== null) changes.push(c); };
    const unequipped: ItemInstanceRow[] = [];
    if (item !== null) push(await ctx.w.update("item", item.id, { state: "consumed" }));
    let next = { ...me };
    if (!check.success) {
      next.xp = Math.max(0, me.xp - mulDiv(grid.xp_need, ctx.balance.numbers.breakthrough.fail_xp_loss_bp, 10000));
    } else if (a.mode !== "cycle") {
      next.xp -= grid.xp_need;
      if (a.mode === "stage") next.stage += 1;
      else { next.tier += 1; next.stage = 1; }
    } else {
      const n = ctx.balance.numbers.cycle;
      next = {
        ...next, tier: 1, stage: 1, xp: n.xp_after, potential: mulDiv(me.potential, n.potential_keep_bp, 10000),
        cycles: addUInt(me.cycles, 1), legacy: Math.min(addUInt(me.legacy, n.legacy_gain), n.legacy_cap), last_yield_tick: ctx.tick,
      };
      const hard = tierNumbers(ctx.balance, 1).skill_cap_hard;
      for (const skill of facts.skills) {
        const cap = Math.min(mulDiv(skill.learned.cap, n.skill_keep_bp, 10000), hard);
        const level = Math.min(mulDiv(skill.learned.level, n.skill_keep_bp, 10000), cap);
        push(await ctx.w.update("skill", skill.learned.id, { level, cap }));
        skill.learned = { ...skill.learned, level, cap };
      }
      let capacity = facts.equipment.reduce((sum, e) => addUInt(sum, equipmentCapacity(e)), 0);
      const max = tierNumbers(ctx.balance, 1).cap_max;
      const descending = [...facts.equipment].sort((a, b) => a.instance.id < b.instance.id ? 1 : a.instance.id > b.instance.id ? -1 : 0);
      for (const e of descending) {
        if (capacity <= max) break;
        push(await ctx.w.update("item", e.instance.id, { equipped: false }));
        unequipped.push(e.instance);
        capacity -= equipmentCapacity(e);
      }
      const ids = new Set(unequipped.map((e) => e.id));
      facts.equipment = facts.equipment.filter((e) => !ids.has(e.instance.id));
      next.vigor = deriveStats(ctx.balance, next, facts).vigor_max;
    }
    const patch = { tier: next.tier, stage: next.stage, xp: next.xp, potential: next.potential, cycles: next.cycles, legacy: next.legacy, vigor: next.vigor, last_yield_tick: next.last_yield_tick };
    push(await ctx.w.update("char", me.id, patch));
    ctx.actor = next;
    const outcome: "success" | "failure" = check.success ? "success" : "failure";
    const deed = await ctx.w.deed({
      actor: me.id, verb: "breakthrough", kind: a.mode === "stage" ? "stage_up" : a.mode === "cycle" ? "ascend" : "breakthrough", targets: item === null ? [me.id] : [me.id, item.id], place_id: me.loc,
      result: { outcome, changes, roll, proposal: null }, visibility: "self", participants: [me.id],
    });
    const data = { char_id: me.id, mode: a.mode, outcome, tier: next.tier, stage: next.stage, cycles: next.cycles, deed_id: deed.id };
    await ctx.w.emit({ scope: "self", recipients: [me.id], type: "progressed", deed_id: deed.id, data });
    await ctx.w.emit({ scope: "self", recipients: [me.id], type: "fact_changed", deed_id: deed.id, data: { changes } });
    if (item !== null) await ctx.w.emit({ scope: "self", recipients: [me.id], type: "item_changed", deed_id: deed.id, data: { item_id: item.id, def_id: item.def_id, reason: "consume", holder: item.holder, state: "consumed" } });
    for (const e of unequipped) await ctx.w.emit({ scope: "self", recipients: [me.id], type: "item_changed", deed_id: deed.id, data: { item_id: e.id, def_id: e.def_id, reason: "unequip", holder: e.holder, state: "available" } });
    if (check.success && a.mode === "cycle") {
      for (const s of facts.skills) await ctx.w.emit({ scope: "self", recipients: [me.id], type: "skill_changed", deed_id: deed.id, data: { char_id: me.id, skill: s.definition.key, level: s.learned.level, cap: s.learned.cap } });
    }
    return { mode: a.mode, outcome, tier: next.tier, stage: next.stage, cycles: next.cycles, changes, roll };
  },
});
