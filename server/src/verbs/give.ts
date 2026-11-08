// [S24] give (动词表 §4.8): hand one item or some coin to a char at the same
// place. Atomic holder / balance change; an item carries its socketed cores
// along (they keep pointing at it). Not a task submit, not an org delivery.
// The deed is self-visible to the two parties only; the giver's result holds
// only the giver's own balance, the receiver learns theirs by fact_changed.

import { getRow } from "../facts/store.ts";
import type { Change, ID } from "../facts/types.ts";
import { settleGiveCoin, settleGiveItem, type TradeReward } from "../growth/trade_bonus.ts";
import { NO_DETAILS, reject } from "../protocol/errors.ts";
import { charId, itemId } from "../protocol/shapes.ts";
import { obj, posUint, union, type Out } from "../protocol/validate.ts";
import { addSafe, emitItem, moveItem, publicChanges, setCoin } from "../tasks/common.ts";
import { defineVerb } from "./types.ts";

const args = obj({
  target: charId,
  asset: union("kind", { item: { item: itemId }, coin: { amount: posUint } }),
});
export type GiveArgs = Out<typeof args>;
export interface GiveResult {
  target: ID;
  changes: Change[];
  trade_reward?: TradeReward;
}

export const def = defineVerb<GiveArgs, GiveResult>({
  verb: "give",
  summary: "把一件物品实例或一定数量的钱交给同地人物。与玩家或官方人物的足值成交双方各得较低阶 0.2 件任务修为与潜能，不足按价值折算；低于一成任务币值不给，每件物品首次玩家间转手才算，钱只奖给出方对所有玩家及官方累计净流出新高的增量，回包 trade_reward 可见。NPC 不算。",
  errors: ["NOT_FOUND", "NOT_HERE", "ITEM_STATE", "INSUFFICIENT_RESOURCE"],
  args,
  lock: "world",
  auth: () => true,
  costKey: () => "give",
  async handler(ctx, a) {
    const me = ctx.actor;
    if (me === null) throw new Error("give without actor");
    const { q, w } = ctx;
    if (a.target === me.id) return reject("INVALID_ARGUMENT", { expected: "ID of another char" }, "args.target");
    const to = await getRow(q, "char", a.target, { lock: true });
    if (to === null) return reject("NOT_FOUND", NO_DETAILS, "args.target");
    if (to.loc !== me.loc) return reject("NOT_HERE", NO_DETAILS, "args.target");
    if (to.state !== "draft" && to.state !== "active") return reject("STATE_BLOCKED", { state: to.state, required_action: "enter" }, "args.target");
    if (to.life !== "alive") return reject("LIFE_BLOCKED", { revive_tick: to.revive_tick ?? "0" }, "args.target");

    const deedOf = async (targets: ID[], changes: Change[]) =>
      w.deed({
        actor: me.id,
        verb: "give",
        kind: "give",
        targets,
        place_id: me.loc,
        result: { outcome: "success", changes: publicChanges(changes), roll: null, proposal: null },
        visibility: "self",
        participants: [me.id, to.id],
      });

    if (a.asset.kind === "coin") {
      const amount = a.asset.amount;
      if (amount > me.coin) return reject("INSUFFICIENT_RESOURCE", { resource: "coin", required: amount, available: me.coin }, "args.asset.amount");
      const mine = await setCoin(w, me, me.coin - amount);
      const theirs = await setCoin(w, to, addSafe(to.coin, amount));
      const deed = await deedOf([to.id], [mine.change, theirs.change]);
      ctx.actor = mine.row;
      const bonus = await settleGiveCoin(ctx, me.id, to.id, amount, deed);
      const receiver = await getRow(q, "char", to.id);
      const receiverGrowth: Change[] = receiver !== null && (receiver.xp !== to.xp || receiver.potential !== to.potential)
        ? [{ table: "char", id: to.id, after: { xp: receiver.xp, potential: receiver.potential } }] : [];
      await w.emit({ scope: "self", recipients: [me.id], type: "fact_changed", deed_id: deed.id, data: { changes: [mine.change, ...bonus.changes] } });
      await w.emit({ scope: "self", recipients: [to.id], type: "fact_changed", deed_id: deed.id, data: { changes: [theirs.change, ...receiverGrowth] } });
      return { target: to.id, changes: [mine.change, ...bonus.changes], ...(bonus.trade_reward === undefined ? {} : { trade_reward: bonus.trade_reward }) };
    }

    const field = "args.asset.item";
    const it = await getRow(q, "item", a.asset.item);
    if (it === null) return reject("NOT_FOUND", NO_DETAILS, field);
    if (it.record !== "instance") return reject("INVALID_ARGUMENT", { expected: "ID of an item instance" }, field);
    if (it.holder.kind === "item") {
      const box = await getRow(q, "item", it.holder.id);
      const mineBox = box !== null && box.record === "instance" && box.holder.kind === "char" && box.holder.id === me.id;
      return mineBox ? reject("ITEM_STATE", { reason: "socket" }, field) : reject("NOT_ALLOWED", { reason: "ownership" }, field);
    }
    if (it.holder.kind !== "char" || it.holder.id !== me.id) return reject("NOT_ALLOWED", { reason: "ownership" }, field);
    if (it.state !== "available") return reject("ITEM_STATE", { reason: "consumed" }, field);
    if (it.equipped) return reject("ITEM_STATE", { reason: "equipped" }, field);

    const m = await moveItem(w, it, { kind: "char", id: to.id });
    const deed = await deedOf([to.id, it.id], [m.change]);
    await emitItem(w, m.row, "give", [me.id, to.id], deed.id);
    const bonus = await settleGiveItem(ctx, me.id, to.id, it.id, deed);
    return { target: to.id, changes: [m.change, ...bonus.changes], ...(bonus.trade_reward === undefined ? {} : { trade_reward: bonus.trade_reward }) };
  },
});
