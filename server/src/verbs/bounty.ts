// [S24] bounty (动词表 §4.14): post with real escrow / cancel while open.
// post: one of the five verifiable conditions with live references, expiry in
// S5's range, escrow of the issuer's own coin and unequipped items (at least
// economy.bounty_min_coin coin or one item), under bounty_open_max open
// bounties. Coin leaves the issuer and items move to the task in the same
// transaction; reputation for the taker is rep_bounty of the issuer's tier at
// posting (xp / potential 0). The note is sanitised and stored on the task
// (S62, so look / task list keep showing it) and also delivered in memory
// (speech event + speech store) for the place that hears it posted.
// cancel: issuer only, open only; escrow back in full.

import { countRows, getRow, mustGetRow } from "../facts/store.ts";
import type { Change, CharRow, Condition, ID, ItemInstanceRow, TaskInstanceRow } from "../facts/types.ts";
import { NO_DETAILS, reject } from "../protocol/errors.ts";
import { condition, itemId, taskId } from "../protocol/shapes.ts";
import { arr, nullable, obj, opt, seq, str, uint, union, type Out } from "../protocol/validate.ts";
import { requireRule } from "../rules/world_rules.ts";
import { sanitizeText } from "../speech/sanitize.ts";
import { emitItem, emitTaskChanged, loadInstance, moveItem, must, publicChanges, releaseTask, setCoin } from "../tasks/common.ts";
import { taskNumbers, tierNumbers, type TaskNumbers } from "../tasks/numbers.ts";
import { defineVerb, type VerbContext } from "./types.ts";

const args = union("op", {
  post: {
    condition,
    reward: obj({ coin: uint, items: arr(itemId, { unique: true }) }),
    expires_tick: seq,
    note: opt(nullable(str()), null),
  },
  cancel: { id: taskId },
});
export type BountyArgs = Out<typeof args>;
export interface BountyResult {
  task: TaskInstanceRow;
  changes: Change[];
  other_speech: string | null;
}

const F = "args.condition";

async function needPlace(ctx: VerbContext, id: ID, field: string): Promise<void> {
  if ((await getRow(ctx.q, "place", id)) === null) reject("NOT_FOUND", NO_DETAILS, field);
}

async function needDef(ctx: VerbContext, id: ID, field: string): Promise<void> {
  const d = await getRow(ctx.q, "item", id);
  if (d === null) reject("NOT_FOUND", NO_DETAILS, field);
  if (d.record !== "definition") reject("INVALID_ARGUMENT", { expected: "ID of an item definition" }, field);
}

async function needChar(ctx: VerbContext, me: CharRow, id: ID, field: string): Promise<CharRow> {
  if (id === me.id) return reject("INVALID_ARGUMENT", { expected: "ID of a char other than the issuer" }, field);
  const c = await getRow(ctx.q, "char", id);
  if (c === null || c.state === "buried") return reject("NOT_FOUND", NO_DETAILS, field);
  return c;
}

function needCount(n: TaskNumbers, c: Condition & { count: number }): void {
  if (c.count > n.count_max[c.tpl]) reject("INVALID_ARGUMENT", { expected: `count of at most ${n.count_max[c.tpl]} (tasks.count_max)` }, `${F}.count`);
}

/** Condition references must resolve now (动词表 §4.14 「引用可见有效」). */
async function checkCondition(ctx: VerbContext, me: CharRow, c: Condition, n: TaskNumbers): Promise<void> {
  switch (c.tpl) {
    case "deliver":
      needCount(n, c);
      await needDef(ctx, c.item_def, `${F}.item_def`);
      await needPlace(ctx, c.to_place, `${F}.to_place`);
      if (c.to_char !== null) {
        if ((await getRow(ctx.q, "char", c.to_char)) === null) reject("NOT_FOUND", NO_DETAILS, `${F}.to_char`);
      }
      return;
    case "gather":
      needCount(n, c);
      await needDef(ctx, c.item_def, `${F}.item_def`);
      await needPlace(ctx, c.to_place, `${F}.to_place`);
      return;
    case "find":
      await needChar(ctx, me, c.target, `${F}.target`);
      return;
    case "slay":
      needCount(n, c);
      if (c.target !== null) {
        const t = await needChar(ctx, me, c.target, `${F}.target`);
        if (t.tier !== c.tier) reject("INVALID_ARGUMENT", { expected: "tier of the target char" }, `${F}.tier`);
      }
      return;
    case "reach":
      if (c.mode === "place") await needPlace(ctx, c.place, `${F}.place`);
      return;
  }
}

/** An escrowable item: own, available, unequipped, not inside a socket. */
async function needOwnItem(ctx: VerbContext, me: CharRow, id: ID, field: string): Promise<ItemInstanceRow> {
  const it = await getRow(ctx.q, "item", id);
  if (it === null) return reject("NOT_FOUND", NO_DETAILS, field);
  if (it.record !== "instance") return reject("INVALID_ARGUMENT", { expected: "ID of an item instance" }, field);
  if (it.holder.kind === "item") {
    const box = await getRow(ctx.q, "item", it.holder.id);
    const mine = box !== null && box.record === "instance" && box.holder.kind === "char" && box.holder.id === me.id;
    return mine ? reject("ITEM_STATE", { reason: "socket" }, field) : reject("NOT_ALLOWED", { reason: "ownership" }, field);
  }
  if (it.holder.kind !== "char" || it.holder.id !== me.id) return reject("NOT_ALLOWED", { reason: "ownership" }, field);
  if (it.state !== "available") return reject("ITEM_STATE", { reason: "consumed" }, field);
  if (it.equipped) return reject("ITEM_STATE", { reason: "equipped" }, field);
  return it;
}

async function post(ctx: VerbContext, me: CharRow, a: Extract<BountyArgs, { op: "post" }>): Promise<BountyResult> {
  const { q, w, tick } = ctx;
  const n = taskNumbers(ctx.balance);
  await checkCondition(ctx, me, a.condition, n);
  const ahead = BigInt(a.expires_tick) - BigInt(tick);
  if (ahead < BigInt(n.bounty_expire.min) || ahead > BigInt(n.bounty_expire.max)) {
    reject("INVALID_ARGUMENT", { expected: `Tick ${n.bounty_expire.min}..${n.bounty_expire.max} ticks after the current tick` }, "args.expires_tick");
  }
  const { coin, items } = a.reward;
  if (coin < n.bounty_min_coin && items.length === 0) {
    reject("INVALID_ARGUMENT", { expected: `at least ${n.bounty_min_coin} coin or one item in escrow` }, "args.reward");
  }
  if (coin > me.coin) reject("INSUFFICIENT_RESOURCE", { resource: "coin", required: coin, available: me.coin }, "args.reward.coin");
  const own: ItemInstanceRow[] = [];
  for (const [i, id] of items.entries()) own.push(await needOwnItem(ctx, me, id, `args.reward.items[${i}]`));
  const max = requireRule(ctx.rules, "bounty_open_max");
  const open = await countRows(
    q,
    "task",
    "record = 'instance' AND state IN ('open', 'accepted') AND issuer ->> 'kind' = 'char' AND issuer ->> 'id' = $1",
    [me.id],
  );
  if (open >= max) reject("TASK_LIMIT", { kind: "bounty", limit: max });
  let note: { text: string; ttl: number } | null = null;
  if (a.note !== null) {
    const textMax = requireRule(ctx.rules, "text_max_chars");
    if ([...a.note].length > textMax) reject("INVALID_ARGUMENT", { expected: `string of at most ${textMax} code points` }, "args.note");
    note = { text: sanitizeText(a.note), ttl: requireRule(ctx.rules, "speech_ttl_ticks") };
  }

  const id = await w.newId("task");
  const row: TaskInstanceRow = {
    id,
    created_tick: tick,
    updated_tick: tick,
    record: "instance",
    template_id: null,
    kind: "bounty",
    tpl: a.condition.tpl,
    issuer: { kind: "char", id: me.id },
    offer_place: me.loc,
    eligible_char: null,
    issuer_tier: me.tier,
    taker: null,
    condition: a.condition,
    reward: { coin, xp: 0, potential: 0, rep: tierNumbers(n, me.tier).rep_bounty, items: [...items] },
    escrow: { coin, items: [...items] },
    state: "open",
    accepted_seq: null,
    progress: { count: 0, evidence: [] },
    expires_tick: a.expires_tick,
    note: note === null ? null : note.text,
  };
  const changes: Change[] = [must(await w.insert("task", row))];
  let cur = me;
  if (coin > 0) {
    const c = await setCoin(w, me, me.coin - coin);
    cur = c.row;
    changes.push(c.change);
  }
  const moved: ItemInstanceRow[] = [];
  for (const it of own) {
    const m = await moveItem(w, it, { kind: "task", id });
    moved.push(m.row);
    changes.push(m.change);
  }
  const deed = await w.deed({
    actor: me.id,
    verb: "bounty",
    kind: "bounty_post",
    targets: [id],
    place_id: me.loc,
    result: { outcome: "success", changes: publicChanges(changes), roll: null, proposal: null },
    visibility: "place",
    participants: [me.id],
  });
  await emitTaskChanged(w, row, deed.id);
  for (const it of moved) await emitItem(w, it, "escrow", [me.id], deed.id);
  ctx.actor = cur;
  if (note === null) return { task: row, changes, other_speech: null };
  const speech = await w.emit({
    scope: "place",
    place_id: me.loc,
    type: "speech",
    deed_id: deed.id,
    data: { speaker: me.id, channel: "place", target: null },
  });
  // Last step of the handler: memory only, keyed by the event of this transaction.
  await ctx.services.speech.persist(ctx.q, speech.id, note.text, (BigInt(tick) + BigInt(note.ttl)).toString(), tick);
  return { task: row, changes, other_speech: note.text };
}

async function cancel(ctx: VerbContext, me: CharRow, id: ID): Promise<BountyResult> {
  const { q, w } = ctx;
  const t = await loadInstance(q, id, me.id);
  if (t.issuer.kind !== "char" || t.issuer.id !== me.id) return reject("NOT_ALLOWED", { reason: "ownership" }, "args.id");
  if (t.state !== "open") return reject("TASK_STATE", { state: t.state }, "args.id");
  const rel = await releaseTask(q, w, t, "cancelled");
  const deed = await w.deed({
    actor: me.id,
    verb: "bounty",
    kind: "task_release",
    targets: [t.id],
    place_id: t.offer_place,
    result: { outcome: "success", changes: publicChanges(rel.changes), roll: null, proposal: null },
    visibility: "place",
    participants: [me.id],
  });
  await emitTaskChanged(w, rel.task, deed.id);
  for (const it of rel.items) await emitItem(w, it.row, "refund", [me.id], deed.id);
  ctx.actor = await mustGetRow(q, "char", me.id);
  return { task: rel.task, changes: rel.changes, other_speech: null };
}

export const def = defineVerb<BountyArgs, BountyResult>({
  verb: "bounty",
  summary: "用自己的钱或物托管发布悬赏，或撤销未被接取的悬赏。",
  errors: ["NOT_FOUND", "NOT_ALLOWED", "INSUFFICIENT_RESOURCE", "TASK_LIMIT", "TASK_STATE"],
  purpose: (a) => a.op === "post" ? "托管报酬并发布可核实的悬赏。" : "撤销自己尚未被接取的悬赏并收回托管物。",
  args,
  lock: "world",
  auth: () => true,
  costKey: (a) => (a.op === "post" ? "bounty.post" : "bounty.cancel"),
  async handler(ctx, a) {
    const me = ctx.actor;
    if (me === null) throw new Error("bounty without actor");
    return a.op === "post" ? post(ctx, me, a) : cancel(ctx, me, a.id);
  },
});
