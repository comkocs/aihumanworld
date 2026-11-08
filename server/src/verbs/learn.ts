// Higher-tier teaching uses the same skill formula for every presentation.

import { getRow, selectRows } from "../facts/store.ts";
import type { Change, Cost, SkillLearnedRow } from "../facts/types.ts";
import { addUInt, tierNumbers } from "../growth/balance.ts";
import { learnedSkill, skillDefinition } from "../growth/facts.ts";
import { settleLearnTrade, type TradeReward } from "../growth/trade_bonus.ts";
import { NO_DETAILS, reject } from "../protocol/errors.ts";
import { charId, skillKey } from "../protocol/shapes.ts";
import { obj, oneOf, type Out } from "../protocol/validate.ts";
import { publicChanges } from "../tasks/common.ts";
import { defineVerb } from "./types.ts";

const args = obj({ master: charId, skill: skillKey, payment: oneOf(["bond", "coin"] as const, "payment") });
export type LearnArgs = Out<typeof args>;
export interface LearnResult {
  skill: SkillLearnedRow;
  paid: Cost;
  changes: Change[];
  trade_reward?: TradeReward;
}

export const def = defineVerb<LearnArgs, LearnResult>({
  verb: "learn",
  summary: "向同地更高阶师父学技能，按关系或钱支付学费。上限不够时向阶更高、该技能更高的师父学艺，每次上限 +5（不超本阶硬上限）。向玩家或官方师父学成一次，师徒各得较低阶 0.2 件任务修为与潜能，回包 trade_reward 可见；NPC 教学不算成交奖。",
  errors: ["NOT_FOUND", "NOT_HERE", "TEACHER_REQUIRED", "INSUFFICIENT_RESOURCE", "SKILL_CAP"],
  args,
  lock: "world",
  auth: () => true,
  costKey: () => "learn",
  async handler(ctx, a) {
    const me = ctx.actor;
    if (me === null) throw new Error("learn without actor");
    const master = await getRow(ctx.q, "char", a.master, { lock: true });
    if (master === null) return reject("NOT_FOUND", NO_DETAILS);
    if (master.loc !== me.loc) return reject("NOT_HERE", NO_DETAILS);
    if (master.life !== "alive" || (master.state !== "active" && master.state !== "draft") || master.tier <= me.tier) return reject("TEACHER_REQUIRED", { reason: "tier" });
    const definition = await skillDefinition(ctx.q, a.skill);
    if (definition === null) return reject("NOT_FOUND", NO_DETAILS);
    if (definition.tier > me.tier) return reject("TEACHER_REQUIRED", { reason: "level" });
    if (definition.org_id !== null) {
      const member = await selectRows(ctx.q, "bond", "kind = 'member' AND state = 'active' AND a = $1 AND b = $2", [me.id, definition.org_id]);
      if (member.length === 0) return reject("NOT_ALLOWED", { reason: "rank" });
      const org = await getRow(ctx.q, "org", definition.org_id);
      if (org === null || !org.skill_defs.includes(definition.id)) return reject("NOT_ALLOWED", { reason: "rank" });
    }
    const teacher = await learnedSkill(ctx.q, master.id, definition.id);
    const old = await learnedSkill(ctx.q, me.id, definition.id);
    const n = ctx.balance.numbers.skills;
    const level = old?.level ?? n.level_initial;
    if (teacher === null || teacher.level <= level) return reject("TEACHER_REQUIRED", { reason: "level" });
    const cap = Math.min(addUInt(old?.cap ?? n.cap_initial, n.learn_cap_gain), teacher.level, tierNumbers(ctx.balance, me.tier).skill_cap_hard);
    const nextLevel = Math.min(addUInt(level, n.learn_level_gain), cap);
    if (cap < (old?.cap ?? 0) || nextLevel <= level) return reject("TEACHER_REQUIRED", { reason: "level" });
    const mentor = await selectRows(ctx.q, "bond", "kind = 'mentor' AND state = 'active' AND a = $1 AND b = $2", [master.id, me.id]);
    let coin: number;
    if (a.payment === "bond") {
      if (mentor.length === 0) return reject("TEACHER_REQUIRED", { reason: "bond" });
      coin = n.learn_bond_coin;
    } else {
      // NPC master is the registered teaching service. Other teachers require
      // an already-confirmed mentor relationship, never inferred chat consent.
      if (!(master.kind === "npc" && master.archetype === "master") && mentor.length === 0) return reject("TEACHER_REQUIRED", { reason: "payment" });
      const price = ctx.balance.numbers.tier_prices.find((r) => r.tier === me.tier);
      if (price === undefined) throw new Error("learn price missing");
      coin = price.learn_coin;
    }
    if (me.coin < coin) return reject("INSUFFICIENT_RESOURCE", { resource: "coin", required: coin, available: me.coin });
    const changes: Change[] = [];
    const push = (change: Change | null): void => { if (change !== null) changes.push(change); };
    if (coin > 0) {
      push(await ctx.w.update("char", me.id, { coin: me.coin - coin }));
      push(await ctx.w.update("char", master.id, { coin: addUInt(master.coin, coin) }));
      ctx.actor = { ...me, coin: me.coin - coin };
    }
    const skill: SkillLearnedRow = old === null ? {
      id: await ctx.w.newId("skill"), created_tick: ctx.tick, updated_tick: ctx.tick,
      record: "learned", char_id: me.id, def_id: definition.id, level: nextLevel, cap,
    } : { ...old, level: nextLevel, cap, updated_tick: ctx.tick };
    if (old === null) push(await ctx.w.insert("skill", skill));
    else push(await ctx.w.update("skill", old.id, { level: nextLevel, cap }));
    const deed = await ctx.w.deed({
      actor: me.id, verb: "learn", kind: "learn", targets: [master.id, skill.id], place_id: me.loc,
      result: { outcome: "success", changes: publicChanges(changes), roll: null, proposal: null }, visibility: "self", participants: [me.id, master.id],
    });
    await ctx.w.emit({ scope: "self", recipients: [me.id], type: "skill_changed", deed_id: deed.id, data: { char_id: me.id, skill: definition.key, level: nextLevel, cap } });
    for (const who of [me.id, master.id]) {
      const visible = changes.filter((c) => c.table === "char" && c.id === who);
      if (visible.length > 0) await ctx.w.emit({ scope: "self", recipients: [who], type: "fact_changed", deed_id: deed.id, data: { changes: visible } });
    }
    const bonus = await settleLearnTrade(ctx, me.id, master.id, deed);
    changes.push(...bonus.changes);
    return { skill, paid: { coin, potential: 0, items: [] }, changes: changes.filter((c) => c.table !== "char" || c.id === me.id), ...(bonus.trade_reward === undefined ? {} : { trade_reward: bonus.trade_reward }) };
  },
});
