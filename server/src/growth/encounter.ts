// S89: a small deterministic arrival reward, recorded only for the traveller.

import { countRows, selectRows } from "../facts/store.ts";
import type { Change, CharRow, ID, ItemDefinitionRow, ItemInstanceRow, PlaceRow, Reward } from "../facts/types.ts";
import { creditGrowth, emitItem, must } from "../tasks/common.ts";
import type { VerbContext } from "../verbs/types.ts";
import { mulDiv, tierNumbers } from "./balance.ts";
import { u32 } from "./settlement.ts";

export type EncounterFact =
  | { kind: "item"; item_id: ID; def_id: ID }
  | { kind: "xp"; xp: number }
  | { kind: "coin"; coin: number };

type EncounterNumbers = { chance_bp: number; repeat_divisor: number; xp_bp: number; coin_bp: number };

function encounterNumbers(ctx: VerbContext): EncounterNumbers | null {
  const value = (ctx.balance.numbers as unknown as { encounter?: unknown }).encounter;
  if (value === undefined) return null;
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("invalid encounter numbers");
  const n = value as Record<string, unknown>;
  for (const k of ["chance_bp", "repeat_divisor", "xp_bp", "coin_bp"]) {
    if (typeof n[k] !== "number" || !Number.isSafeInteger(n[k]) || (n[k] as number) < 0) throw new Error(`invalid encounter.${k}`);
  }
  if ((n.chance_bp as number) > 10000 || (n.xp_bp as number) > 10000 || (n.coin_bp as number) > 10000 || (n.repeat_divisor as number) < 1) {
    throw new Error("invalid encounter ratios");
  }
  return n as EncounterNumbers;
}

/** Called before the current travel deed is written, under the world lock. */
export async function encounterOnArrival(ctx: VerbContext, me: CharRow, dest: PlaceRow): Promise<{
  row: CharRow; changes: Change[]; fact: EncounterFact; reward: Reward; item: ItemInstanceRow | null;
} | null> {
  const n = encounterNumbers(ctx);
  if (n === null || me.kind === "npc") return null;
  const previous = await countRows(ctx.q, "deed", "actor = $1 AND verb = 'go' AND kind = 'travel' AND tick = $2 AND place_id = $3", [me.id, ctx.tick, dest.id]);
  // repeat_divisor is retained in the numbers but no longer applies to same-tick, same-place arrivals.
  if (previous > 0) return null;
  const seed = JSON.stringify([ctx.world.realm, me.id, ctx.tick, dest.id]);
  if (u32(seed, "encounter") % 10000 >= n.chance_bp) return null;

  const tier = Math.min(me.tier, dest.tier);
  const base = tierNumbers(ctx.balance, tier);
  const kind = u32(seed, "kind") % 3;
  let item: ItemInstanceRow | null = null;
  let fact: EncounterFact;
  const reward: Reward = { coin: 0, xp: 0, potential: 0, rep: 0, items: [] };
  if (kind === 0) {
    const defs = (await selectRows(ctx.q, "item", "record = 'definition' AND tier = $1 AND grade = 1 AND kind IN ('ore', 'herb') AND by IS NULL", [tier], 'ORDER BY id COLLATE "C"')) as ItemDefinitionRow[];
    const def = defs[u32(seed, "item") % defs.length];
    if (def !== undefined) {
      item = { id: await ctx.w.newId("item"), created_tick: ctx.tick, updated_tick: ctx.tick, record: "instance", def_id: def.id,
        holder: { kind: "char", id: me.id }, state: "available", equipped: false, dura: def.dura_max,
        sockets: Array.from({ length: def.slots }, () => null), note: null };
      const change = must(await ctx.w.insert("item", item));
      reward.items.push(item.id);
      fact = { kind: "item", item_id: item.id, def_id: def.id };
      return { row: me, changes: [change], fact, reward, item };
    }
  }
  if (kind === 1) {
    reward.xp = Math.max(1, mulDiv(base.task_xp, n.xp_bp, 10000));
    fact = { kind: "xp", xp: reward.xp };
  } else {
    reward.coin = Math.max(1, mulDiv(base.task_coin, n.coin_bp, 10000));
    fact = { kind: "coin", coin: reward.coin };
  }
  const credited = await creditGrowth(ctx.q, ctx.w, me, reward);
  return { row: credited.row, changes: credited.changes, fact, reward, item };
}

export async function emitEncounter(ctx: VerbContext, charId: ID, deedId: ID, result: NonNullable<Awaited<ReturnType<typeof encounterOnArrival>>>): Promise<void> {
  const data = { char_id: charId, source: deedId, reward: result.reward, encounter: result.fact };
  await ctx.w.emit({ scope: "self", recipients: [charId], type: "reward_granted", deed_id: deedId, data });
  if (result.item !== null) await emitItem(ctx.w, result.item, "reward", [charId], deedId);
  await ctx.w.emit({ scope: "self", recipients: [charId], type: "fact_changed", deed_id: deedId, data: { changes: result.changes } });
}
