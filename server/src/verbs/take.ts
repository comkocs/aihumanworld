// [S24] take (动词表 §4.7): pick up one item instance lying at the current
// place (resources are instances the rules already spawned; the client never
// states a quantity). holder → the char, unequipped; deed take (place-visible);
// item_changed to self and the place; gather evidence via the task system.

import { getRow } from "../facts/store.ts";
import type { Change, ItemInstanceRow } from "../facts/types.ts";
import { NO_DETAILS, reject } from "../protocol/errors.ts";
import { itemId } from "../protocol/shapes.ts";
import { obj, type Out } from "../protocol/validate.ts";
import { wakeSupply } from "../resources/clock.ts";
import { emitItem, moveItem } from "../tasks/common.ts";
import { gatherEvidence } from "../tasks/evidence.ts";
import { defineVerb } from "./types.ts";

const args = obj({ item: itemId });
export type TakeArgs = Out<typeof args>;
export interface TakeResult {
  item: ItemInstanceRow;
  changes: Change[];
}

export const def = defineVerb<TakeArgs, TakeResult>({
  verb: "take",
  args,
  lock: "world",
  auth: () => true,
  costKey: () => "take",
  async handler(ctx, a) {
    const me = ctx.actor;
    if (me === null) throw new Error("take without actor");
    const it = await getRow(ctx.q, "item", a.item);
    if (it === null) return reject("NOT_FOUND", NO_DETAILS, "args.item");
    if (it.record !== "instance") return reject("INVALID_ARGUMENT", { expected: "ID of an item instance" }, "args.item");
    if (it.holder.kind !== "place" || it.holder.id !== me.loc) return reject("NOT_HERE", NO_DETAILS, "args.item");
    if (it.state !== "available") return reject("ITEM_STATE", { reason: "consumed" }, "args.item");

    const m = await moveItem(ctx.w, it, { kind: "char", id: me.id });
    // [S27] The spot is one item poorer: wake its supply row if it was idle.
    await wakeSupply(ctx.q, ctx.balance, { kind: "place", id: me.loc }, it.def_id, ctx.tick);
    const deed = await ctx.w.deed({
      actor: me.id,
      verb: "take",
      kind: "take",
      targets: [it.id],
      place_id: me.loc,
      result: { outcome: "success", changes: [m.change], roll: null, proposal: null },
      visibility: "place",
      participants: [me.id],
    });
    await emitItem(ctx.w, m.row, "take", [me.id], deed.id, me.loc);
    const evidence = await gatherEvidence(ctx, me, m.row, deed.id);
    return { item: m.row, changes: [m.change, ...evidence] };
  },
});
