// Training selects a learned target; only the S5 clock periods grant growth.

import type { Change, SkillKey, Tick } from "../facts/types.ts";
import { learnedSkill, skillDefinition } from "../growth/facts.ts";
import { NO_DETAILS, reject } from "../protocol/errors.ts";
import { skillKey } from "../protocol/shapes.ts";
import { union, type Out } from "../protocol/validate.ts";
import { defineVerb } from "./types.ts";

const args = union("mode", { start: { skill: skillKey }, stop: {} });
export type TrainArgs = Out<typeof args>;
export interface TrainResult {
  train_skill: SkillKey | null;
  effective_tick: Tick;
  changes: Change[];
}

export const def = defineVerb<TrainArgs, TrainResult>({
  verb: "train",
  summary: "选择已学技能持续修炼，或停止修炼；收益按世界刻结算。",
  errors: ["NOT_FOUND", "CONDITION_UNMET", "SKILL_CAP"],
  purpose: (a) => a.mode === "start" ? "开始持续修炼指定的已学技能。" : "停止当前修炼。",
  args,
  lock: "world",
  auth: () => true,
  costKey: () => "train",
  async handler(ctx, a) {
    const me = ctx.actor;
    if (me === null) throw new Error("train without actor");
    let skill: SkillKey | null = null;
    if (a.mode === "start") {
      const definition = await skillDefinition(ctx.q, a.skill);
      if (definition === null) return reject("NOT_FOUND", NO_DETAILS);
      const learned = await learnedSkill(ctx.q, me.id, definition.id);
      if (learned === null || definition.tier > me.tier) return reject("CONDITION_UNMET", { reason: "training" });
      if (learned.level >= learned.cap) return reject("SKILL_CAP", { level: learned.level, cap: learned.cap });
      skill = a.skill;
    } else if (me.train_skill === null) return reject("CONDITION_UNMET", { reason: "training" });
    // A repeated start does not discard a partial period. Switching/stopping does,
    // so toggling never earns a period for a target that was not being trained.
    const patch = { train_skill: skill, last_yield_tick: skill === me.train_skill ? me.last_yield_tick : ctx.tick };
    const change = await ctx.w.update("char", me.id, patch);
    const changes: Change[] = change === null ? [] : [change];
    ctx.actor = { ...me, ...patch };
    const deed = await ctx.w.deed({
      actor: me.id, verb: "train", kind: "train", targets: [me.id], place_id: me.loc,
      result: { outcome: "success", changes, roll: null, proposal: null }, visibility: "self", participants: [me.id],
    });
    await ctx.w.emit({ scope: "self", recipients: [me.id], type: "fact_changed", deed_id: deed.id, data: { changes } });
    return { train_skill: skill, effective_tick: (BigInt(ctx.tick) + 1n).toString(), changes };
  },
});
