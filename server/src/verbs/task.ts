// [S24] task (动词表 §4.13): list / accept / submit / abandon.
// list available tops up the caller's personal system offers here first
// (tasks/supply.ts). submit verifies the five template conditions on server
// facts, settles the escrow atomically (system reward decays by the char's
// system tasks completed today, S5 tasks.decay_step_bp; player bounties pay
// the promised escrow in full), writes the actual reward back and pays once.
// draft → active on the first system task is S11's (judged from these facts);
// org weekly goal progress is S25's (from the same facts). The first world
// completion of a template writes first_clear with the S5 bonus.

import { pageRows, resolveLimit } from "../facts/paging.ts";
import { countRows, getRow, mustGetRow, selectRows } from "../facts/store.ts";
import type { Change, CharRow, DeedRow, Holder, ID, ItemInstanceRow, Reward, Seq, TaskInstanceRow } from "../facts/types.ts";
import { settleBountyTrade } from "../growth/trade_bonus.ts";
import { NO_DETAILS, reject } from "../protocol/errors.ts";
import { PAGE_DEFAULT, limit, page, taskId } from "../protocol/shapes.ts";
import { oneOf, opt, union, type Out } from "../protocol/validate.ts";
import { requireRule } from "../rules/world_rules.ts";
import {
  bonusReward,
  consumeItem,
  creditGrowth,
  emitItem,
  emitTaskChanged,
  heldTransferable,
  isExpired,
  loadInstance,
  merged,
  moveItem,
  must,
  publicChanges,
  releaseTask,
  reopenTask,
  unique,
} from "../tasks/common.ts";
import { slayEvidence } from "../tasks/evidence.ts";
import { mulDivFloor, taskNumbers, tierNumbers } from "../tasks/numbers.ts";
import { supplyFor } from "../tasks/supply.ts";
import { defineVerb, type VerbContext } from "./types.ts";

const args = union("op", {
  list: {
    filter: opt(oneOf(["available", "accepted"] as const, "task filter"), "available"),
    page: opt(page, PAGE_DEFAULT),
    limit,
  },
  accept: { id: taskId },
  submit: { id: taskId },
  abandon: { id: taskId },
});
export type TaskArgs = Out<typeof args>;
export type TaskResult =
  | {
      rows: TaskInstanceRow[];
      page: { after: ID | null; through: Seq };
      has_more: boolean;
      snapshot_changed: boolean;
      hint?: TaskHint;
    }
  | { task: TaskInstanceRow; reward: Reward | null; changes: Change[]; hint?: TaskHint };
type Edit = Extract<TaskResult, { task: TaskInstanceRow }>;
type TaskHint = { zh: string; en: string };

const alternatives = {
  zh: "可以找人论道、给物或交易，接玩家悬赏，打本阶怪，去切磋场切磋，或参与组织周目标；这些不受系统差事递减限制。",
  en: "You can discuss with others, give items or trade, take player bounties, fight monsters of your tier, spar in a duel area, or join an organization's weekly goal; these are not subject to system-task decay.",
};
const fullHint: TaskHint = {
  zh: `今日系统差事常规收益已满，不再给常规收益，明天（下一个游戏日）重置。${alternatives.zh}`,
  en: `Today's regular system-task rewards are exhausted and give no further rewards; they reset tomorrow (the next game day). ${alternatives.en}`,
};
const nextFullHint: TaskHint = {
  zh: `今日系统差事下一件起不再给常规收益，明天（下一个游戏日）重置。${alternatives.zh}`,
  en: `Regular system-task rewards will stop starting with the next task today; they reset tomorrow (the next game day). ${alternatives.en}`,
};
const zeroHint: TaskHint = {
  zh: `本次系统差事常规收益为零，每日递减明天（下一个游戏日）重置。${alternatives.zh}`,
  en: `This system task gave no regular reward; daily decay resets tomorrow (the next game day). ${alternatives.en}`,
};
const zeroNextFullHint: TaskHint = {
  zh: `本次系统差事常规收益为零，下一件起不再给常规收益，明天（下一个游戏日）重置。${alternatives.zh}`,
  en: `This system task gave no regular reward, and regular rewards will stop starting with the next task today; they reset tomorrow (the next game day). ${alternatives.en}`,
};

const systemFactor = (done: number, step: number): number => Math.max(0, 10000 - step * done);
const systemDoneToday = (ctx: VerbContext, me: CharRow): number =>
  me.day_index === ctx.world.day_index ? me.system_tasks_today : 0;

function actor(ctx: VerbContext): CharRow {
  if (ctx.actor === null) throw new Error("task without actor");
  return ctx.actor;
}

const issuerChar = (t: TaskInstanceRow): ID | null => (t.issuer.kind === "char" ? t.issuer.id : null);

async function list(ctx: VerbContext, a: Extract<TaskArgs, { op: "list" }>): Promise<TaskResult> {
  const me = actor(ctx);
  let where: string;
  let params: unknown[];
  if (a.filter === "available") {
    await supplyFor(ctx, me, me.loc);
    where =
      "record = 'instance' AND state = 'open' AND offer_place = $1 AND (eligible_char IS NULL OR eligible_char = $2) AND expires_tick > $3";
    params = [me.loc, me.id, ctx.tick];
  } else {
    where = "record = 'instance' AND state = 'accepted' AND taker = $1";
    params = [me.id];
  }
  const lim = resolveLimit(a.limit, ctx.rules);
  const p = await pageRows(ctx.q, "task", where, params, a.page, lim, ctx.world.deed_head);
  const full = systemFactor(systemDoneToday(ctx, me), taskNumbers(ctx.balance).decay_step_bp) === 0;
  return { rows: p.rows as TaskInstanceRow[], page: p.page, has_more: p.has_more, snapshot_changed: p.snapshot_changed, ...(full ? { hint: fullHint } : {}) };
}

async function accept(ctx: VerbContext, id: ID): Promise<Edit> {
  const me = actor(ctx);
  const { q, w } = ctx;
  const t = await loadInstance(q, id, me.id);
  if (t.state !== "open") return reject("TASK_STATE", { state: t.state }, "args.id");
  if (isExpired(t, ctx.tick)) return reject("TASK_STATE", { state: "expired" }, "args.id");
  if (issuerChar(t) === me.id) return reject("NOT_ALLOWED", { reason: "ownership" }, "args.id");
  // Personal system offers follow their char (tasks/supply.ts); others are taken at offer_place.
  const personal = t.kind === "system" && t.eligible_char === me.id;
  if (!personal && t.offer_place !== me.loc) return reject("NOT_HERE", NO_DETAILS, "args.id");
  const max = requireRule(ctx.rules, "active_task_max");
  const active = await countRows(q, "task", "record = 'instance' AND state = 'accepted' AND taker = $1", [me.id]);
  if (active >= max) return reject("TASK_LIMIT", { kind: "accepted", limit: max });

  const head = (await mustGetRow(q, "world", ctx.world.id)).deed_head;
  const patch: Partial<TaskInstanceRow> = {
    taker: me.id,
    state: "accepted",
    accepted_seq: head,
    progress: { count: 0, evidence: [] },
  };
  if (personal && t.offer_place !== me.loc) patch.offer_place = me.loc;
  const change = must(await w.update("task", t.id, patch));
  const task = merged(t, patch, ctx.tick);
  const isPublic = t.eligible_char === null;
  const deed = await w.deed({
    actor: me.id,
    verb: "task",
    kind: "task_accept",
    targets: [t.id],
    place_id: me.loc,
    result: { outcome: "success", changes: [change], roll: null, proposal: null },
    visibility: isPublic ? "place" : "self",
    participants: unique([me.id, issuerChar(t)]),
  });
  await emitTaskChanged(w, task, deed.id);
  return { task, reward: null, changes: [change] };
}

const before = (aT: number, aS: number, bT: number, bS: number): boolean => aT < bT || (aT === bT && aS < bS);

interface ItemNote {
  row: ItemInstanceRow;
  reason: "give" | "drop" | "consume" | "reward";
  to: ID[];
  place: ID | null;
}

/** Checks the condition on facts and performs its hand-over; returns the final progress. */
async function fulfil(
  ctx: VerbContext,
  me: CharRow,
  t: TaskInstanceRow,
  changes: Change[],
  notes: ItemNote[],
): Promise<TaskInstanceRow["progress"]> {
  const { q, w } = ctx;
  const c = t.condition;
  const unmet = (): never => reject("CONDITION_UNMET", { reason: "task" }, "args.id");
  switch (c.tpl) {
    case "deliver": {
      const held = await heldTransferable(q, me.id, c.item_def);
      if (held.length < c.count) return reject("INSUFFICIENT_RESOURCE", { resource: "item", required: c.count, available: held.length });
      let holder: Holder = { kind: "place", id: c.to_place };
      const to = [me.id];
      if (c.to_char !== null) {
        const rc = await getRow(q, "char", c.to_char);
        if (rc === null || rc.loc !== c.to_place || rc.state === "buried") return unmet();
        holder = { kind: "char", id: rc.id };
        to.push(rc.id);
      }
      for (const it of held.slice(0, c.count)) {
        const m = await moveItem(w, it, holder);
        changes.push(m.change);
        notes.push({ row: m.row, reason: c.to_char === null ? "drop" : "give", to, place: c.to_char === null ? c.to_place : null });
      }
      return { count: c.count, evidence: t.progress.evidence };
    }
    case "gather": {
      if (t.progress.count < c.count) return unmet();
      const held = await heldTransferable(q, me.id, c.item_def);
      if (held.length < c.count) return reject("INSUFFICIENT_RESOURCE", { resource: "item", required: c.count, available: held.length });
      const proof = (await selectRows(q, "deed", "id IN (SELECT jsonb_array_elements_text($1::jsonb))", [
        JSON.stringify(t.progress.evidence),
      ])) as DeedRow[];
      const taken = new Set(proof.flatMap((d) => d.targets));
      const pick = [...held.filter((i) => taken.has(i.id)), ...held.filter((i) => !taken.has(i.id))].slice(0, c.count);
      for (const it of pick) {
        const m = await consumeItem(w, it);
        changes.push(m.change);
        notes.push({ row: m.row, reason: "consume", to: [me.id], place: null });
      }
      return t.progress;
    }
    case "find":
      if (t.progress.count < 1) return unmet();
      return t.progress;
    case "reach":
      if (c.mode === "place") {
        if (t.progress.count < 1) return unmet();
        return t.progress;
      }
      if (before(me.tier, me.stage, c.tier, c.stage)) {
        return reject("CONDITION_UNMET", { reason: me.tier < c.tier ? "tier" : "stage" }, "args.id");
      }
      return { count: 1, evidence: t.progress.evidence };
    case "slay": {
      const ev = await slayEvidence(q, me, t);
      if (ev.length < c.count) return unmet();
      return { count: ev.length, evidence: ev };
    }
  }
}

async function submit(ctx: VerbContext, id: ID): Promise<Edit> {
  const me = actor(ctx);
  const { q, w, tick } = ctx;
  const t = await loadInstance(q, id, me.id);
  if (t.state !== "accepted") return reject("TASK_STATE", { state: t.state }, "args.id");
  if (t.taker !== me.id) return reject("NOT_ALLOWED", { reason: "ownership" }, "args.id");
  if (isExpired(t, tick)) return reject("TASK_STATE", { state: "expired" }, "args.id");
  const c = t.condition;
  const at = c.tpl === "deliver" || c.tpl === "gather" ? c.to_place : t.offer_place;
  if (me.loc !== at) return reject("CONDITION_UNMET", { reason: "location", place_id: at }, "args.id");
  const n = taskNumbers(ctx.balance);

  const changes: Change[] = [];
  const notes: ItemNote[] = [];
  const progress = await fulfil(ctx, me, t, changes, notes);

  // Actual reward. System-funded: decays to zero by tasks done today; else the promised escrow.
  const escrow = t.escrow;
  const systemFunded = t.issuer.kind === "system";
  let reward: Reward;
  let payItems = true;
  let counters: Partial<CharRow> = {};
  let hint: TaskHint | undefined;
  if (systemFunded) {
    const done = systemDoneToday(ctx, me);
    const factor = systemFactor(done, n.decay_step_bp);
    const f = (v: number): number => mulDivFloor(v, factor, 10000);
    payItems = factor > 0 && factor >= n.item_min_pct_bp;
    reward = {
      coin: Math.min(f(t.reward.coin), escrow.coin),
      xp: f(t.reward.xp),
      potential: f(t.reward.potential),
      rep: f(t.reward.rep),
      items: payItems ? [...escrow.items] : [],
    };
    counters = { day_index: ctx.world.day_index, system_tasks_today: done + 1 };
    if (t.kind === "system") {
      const zero = reward.coin === 0 && reward.xp === 0 && reward.potential === 0 && reward.rep === 0 && reward.items.length === 0;
      if (factor === 0) hint = fullHint;
      else if (systemFactor(done + 1, n.decay_step_bp) === 0) hint = zero ? zeroNextFullHint : nextFullHint;
      else if (zero) hint = zeroHint;
    }
  } else {
    reward = { coin: escrow.coin, xp: t.reward.xp, potential: t.reward.potential, rep: t.reward.rep, items: [...escrow.items] };
  }
  for (const itemId of escrow.items) {
    const it = await getRow(q, "item", itemId);
    if (it === null || it.record !== "instance") throw new Error(`fact integrity: escrow item ${itemId} missing`);
    if (payItems) {
      const m = await moveItem(w, it, { kind: "char", id: me.id });
      changes.push(m.change);
      notes.push({ row: m.row, reason: "reward", to: [me.id], place: null });
    } else {
      changes.push((await consumeItem(w, it)).change);
    }
  }
  const paid = await creditGrowth(q, w, me, reward, counters);
  changes.push(...paid.changes);
  let cur = paid.row;

  const taskPatch = { state: "completed" as const, reward, escrow: { coin: 0, items: [] as ID[] }, progress };
  changes.unshift(must(await w.update("task", t.id, taskPatch)));
  const task = merged(t, taskPatch, tick);

  // World first completion of a template.
  let clear: { key: string; reward: Reward; rep: typeof paid.rep; template: ID } | null = null;
  if (t.kind === "system" && t.template_id !== null) {
    const key = `first_clear:${t.template_id}`;
    if (!(await w.firstTaken(key))) {
      const tpl = await getRow(q, "task", t.template_id);
      const tier = tpl !== null && tpl.record === "template" ? tpl.tier : me.tier;
      const b = bonusReward(n.bonus.first_clear, tierNumbers(n, tier));
      const g = await creditGrowth(q, w, cur, b);
      cur = g.row;
      changes.push(...g.changes);
      clear = { key, reward: b, rep: g.rep, template: t.template_id };
    }
  }

  const isPublic = t.eligible_char === null;
  const deed = await w.deed({
    actor: me.id,
    verb: "task",
    kind: t.kind === "bounty" ? "bounty_done" : "task_done",
    targets: unique([t.id, t.template_id]),
    place_id: me.loc,
    result: { outcome: "success", changes: isPublic ? publicChanges(changes) : changes, roll: null, proposal: null },
    visibility: isPublic ? "place" : "self",
    participants: unique([me.id, issuerChar(t)]),
  });
  await emitTaskChanged(w, task, deed.id);
  await w.emit({ scope: "self", recipients: [me.id], type: "reward_granted", deed_id: deed.id, data: { char_id: me.id, source: t.id, reward } });
  if (paid.rep !== null) {
    await w.emit({ scope: "self", recipients: [me.id], type: "reputation_changed", deed_id: deed.id, data: { reputation: paid.rep } });
  }
  for (const note of notes) await emitItem(w, note.row, note.reason, note.to, deed.id, note.place);
  if (clear !== null) {
    const fd = await w.deed({
      actor: me.id,
      verb: "task",
      kind: "first_clear",
      targets: [clear.template],
      place_id: me.loc,
      result: { outcome: "success", changes: [], roll: null, proposal: null },
      visibility: "world",
      participants: [me.id],
      first_key: clear.key,
    });
    await w.emit({ scope: "self", recipients: [me.id], type: "reward_granted", deed_id: fd.id, data: { char_id: me.id, source: fd.id, reward: clear.reward } });
    if (clear.rep !== null) {
      await w.emit({ scope: "self", recipients: [me.id], type: "reputation_changed", deed_id: fd.id, data: { reputation: clear.rep } });
    }
  }
  ctx.actor = cur;
  if (t.kind === "bounty") changes.push(...await settleBountyTrade(ctx, t, deed));
  return { task, reward, changes, ...(hint === undefined ? {} : { hint }) };
}

async function abandon(ctx: VerbContext, id: ID): Promise<Edit> {
  const me = actor(ctx);
  const { q, w } = ctx;
  const t = await loadInstance(q, id, me.id);
  if (t.state !== "accepted") return reject("TASK_STATE", { state: t.state }, "args.id");
  if (t.taker !== me.id) return reject("NOT_ALLOWED", { reason: "ownership" }, "args.id");
  let task: TaskInstanceRow;
  let changes: Change[];
  let refund: Awaited<ReturnType<typeof releaseTask>> | null = null;
  if (isExpired(t, ctx.tick)) {
    refund = await releaseTask(q, w, t, "expired");
    task = refund.task;
    changes = refund.changes;
  } else {
    const r = await reopenTask(w, t);
    task = r.task;
    changes = [r.change];
  }
  const isPublic = t.eligible_char === null;
  const visible = publicChanges(changes);
  const deed = await w.deed({
    actor: me.id,
    verb: "task",
    kind: "task_release",
    targets: [t.id],
    place_id: me.loc,
    result: { outcome: "success", changes: visible, roll: null, proposal: null },
    visibility: isPublic ? "place" : "self",
    participants: unique([me.id, issuerChar(t)]),
  });
  await emitTaskChanged(w, task, deed.id, [me.id]);
  if (refund !== null && refund.issuer !== null && refund.issuer.changes.length > 0) {
    await w.emit({ scope: "self", recipients: [refund.issuer.id], type: "fact_changed", deed_id: deed.id, data: { changes: refund.issuer.changes } });
    for (const it of refund.items) if (it.reason === "refund") await emitItem(w, it.row, "refund", [refund.issuer.id], deed.id);
  }
  return { task, reward: null, changes: visible };
}

export const def = defineVerb<TaskArgs, TaskResult>({
  verb: "task",
  summary: "查看、接取、提交或放弃可核实的任务。",
  errors: ["NOT_FOUND", "NOT_HERE", "TASK_STATE", "TASK_LIMIT", "CONDITION_UNMET"],
  purpose: (a) => ({ list: "列出可接或已接任务。", accept: "接取指定任务。", submit: "核验目标并提交任务领取报酬。", abandon: "放弃已接任务。" })[a.op],
  args,
  lock: "world",
  auth: () => true,
  costKey: (a) => (a.op === "list" ? "task.list" : a.op === "accept" ? "task.accept" : a.op === "submit" ? "task.submit" : "task.abandon"),
  gate: (a) => (a.op === "list" ? "in_world" : "acting"),
  async handler(ctx, a) {
    switch (a.op) {
      case "list":
        return list(ctx, a);
      case "accept":
        return accept(ctx, a.id);
      case "submit":
        return submit(ctx, a.id);
      case "abandon":
        return abandon(ctx, a.id);
    }
  },
});
