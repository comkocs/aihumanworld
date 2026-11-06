// [S27] Resource supply clock phase (数值表 npc.resource_respawn_ticks /
// npc.merchant_restock_ticks): every due row of s27_supply is topped back up to
// its cap — only what is missing, never beyond cap — as available instances
// held by the place (take-able) or the merchant NPC (buy-able). A holder that
// ends the tick at cap leaves the due index (due_tick = NULL), so idle full
// rows cost nothing; take / buy wake the row again (S19-style due index, the
// same shape s25_npc_clock / npc_due_tick use). Import sets due_tick to the
// world tick, so the first tick after boot fills every spot once.

import type { Queryable } from "../db/db.ts";
import { getRow } from "../facts/store.ts";
import type { Balance } from "../growth/balance.ts";
import { numberAt, requireRevision } from "../orgs/numbers.ts";
import type { ID, ItemDefinitionRow, Tick } from "../facts/types.ts";
import type { Writer } from "../facts/writer.ts";
import type { ClockCtx, ClockPhase } from "../clock/phases.ts";

/** Restock period of a holder kind (S5 numbers). */
export function supplyPeriod(balance: Balance, holderKind: "place" | "char"): bigint {
  return BigInt(numberAt(balance, holderKind === "place" ? "npc.resource_respawn_ticks" : "npc.merchant_restock_ticks"));
}

/**
 * Wakes a supply row after its stock shrank (take from a place, buy from a
 * merchant): schedules the next restock one period out, but only if the row is
 * currently idle (a pending earlier due date is kept).
 */
export async function wakeSupply(
  q: Queryable,
  balance: Balance,
  holder: { kind: "place" | "char"; id: ID },
  defId: ID,
  tick: Tick,
): Promise<void> {
  const due = (BigInt(tick) + supplyPeriod(balance, holder.kind)).toString();
  await q.query(
    "UPDATE s27_supply SET due_tick = $4 WHERE holder_kind = $1 AND holder_id = $2 AND def_id = $3 AND due_tick IS NULL",
    [holder.kind, holder.id, defId, due],
  );
}

/** Available, unequipped instances of defId currently held by the holder. */
async function heldCount(q: Queryable, holder: { kind: string; id: ID }, defId: ID): Promise<number> {
  const r = await q.query<{ n: unknown }>(
    "SELECT count(*) AS n FROM items WHERE record = 'instance' AND def_id = $1 AND state = 'available' AND equipped = false AND holder ->> 'kind' = $2 AND holder ->> 'id' = $3",
    [defId, holder.kind, holder.id],
  );
  return Number(r.rows[0]?.n ?? 0);
}

export const resourcePhase: ClockPhase = {
  name: "resource",
  owner: "S27",
  async run(ctx: ClockCtx) {
    requireRevision(ctx.balance, ctx.world.rules_revision, ctx.rules.balance_key);
    const due = await ctx.q.query<{ holder_kind: "place" | "char"; holder_id: ID; def_id: ID; cap: number }>(
      "SELECT holder_kind, holder_id, def_id, cap FROM s27_supply WHERE due_tick IS NOT NULL AND due_tick <= $1::bigint ORDER BY holder_kind, holder_id, def_id",
      [ctx.to_tick],
    );
    for (const row of due.rows) {
      const holder = { kind: row.holder_kind, id: row.holder_id };
      // A dead merchant restocks nothing this round; retry after its period.
      if (holder.kind === "char") {
        const npc = await getRow(ctx.q, "char", holder.id);
        if (npc === null || npc.kind !== "npc" || npc.archetype !== "merchant" || npc.life !== "alive") {
          await ctx.q.query(
            "UPDATE s27_supply SET due_tick = $4 WHERE holder_kind = $1 AND holder_id = $2 AND def_id = $3",
            [holder.kind, holder.id, row.def_id, (BigInt(ctx.to_tick) + supplyPeriod(ctx.balance, "char")).toString()],
          );
          continue;
        }
      }
      const missing = row.cap - (await heldCount(ctx.q, holder, row.def_id));
      if (missing > 0) {
        const def = await getRow(ctx.q, "item", row.def_id);
        if (def === null || def.record !== "definition") throw new Error(`S27 supply row references missing item definition ${row.def_id}`);
        for (let i = 0; i < missing; i += 1) await mint(ctx.w, def, holder);
      }
      // Restocked to cap (or already at / above it, e.g. after a sell): idle.
      await ctx.q.query("UPDATE s27_supply SET due_tick = NULL WHERE holder_kind = $1 AND holder_id = $2 AND def_id = $3", [
        holder.kind,
        holder.id,
        row.def_id,
      ]);
    }
  },
};

/** One available instance of def, dura full, sockets empty, held by holder. */
async function mint(w: Writer, def: ItemDefinitionRow, holder: { kind: "place" | "char"; id: ID }): Promise<void> {
  await w.insert("item", {
    id: await w.newId("item"),
    created_tick: w.tick,
    updated_tick: w.tick,
    record: "instance",
    def_id: def.id,
    holder,
    state: "available",
    equipped: false,
    dura: def.dura_max,
    sockets: Array.from({ length: def.slots }, () => null),
  });
}
