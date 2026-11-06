// S31: public shop quotes and settlement share the existing S5 price calculation.

import type { Queryable } from "../db/db.ts";
import { ITEM_CATEGORY } from "../facts/enums.ts";
import type { ID } from "../facts/types.ts";
import type { Balance } from "../growth/balance.ts";
import { definition } from "../npc/facts.ts";
import { cellNumber, floorRatio, numberAt } from "../orgs/numbers.ts";

export async function itemPrice(q: Queryable, balance: Balance, id: ID): Promise<number> {
  const def = await definition(q, id);
  const category = ITEM_CATEGORY[def.kind];
  const keys = { tier: def.tier, grade: def.grade };
  if (category === "weapon" || category === "armor" || category === "accessory") return cellNumber(balance, "equipment.table", keys, "price");
  if (def.kind === "core") return cellNumber(balance, "cores.table", keys, "price");
  const field = def.kind === "potion" ? def.effect.kind === "breakthrough" ? "bt_price" : "restore_price" :
    def.kind === "scroll" ? "scroll_price" : def.kind === "key" ? "key_price" : def.kind === "map" ? "map_price" : "material_price";
  return cellNumber(balance, "consumables.table", keys, field);
}

export function tradePrice(balance: Balance, basePrice: number, op: "buy" | "sell"): number {
  return floorRatio(basePrice, numberAt(balance, op === "buy" ? "economy.buy_markup_bp" : "economy.sell_bp"));
}
