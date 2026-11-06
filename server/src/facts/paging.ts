// Shared list paging of non-event lists (动词表 §2), weakly consistent. Order is
// creation order as the IDs' numeric natural order (0 号窗 11-06; ID format
// unchanged): length first, then bytes — within one table allocated locals share
// `<realm>:<type>:<letter>`, so r1:deed:d2 < r1:deed:d10. Seed / import locals
// (named, with an underscore) sort by the same key. The first request pins
// `through` to world.deed_head; a later page whose through differs from the
// current head reports snapshot_changed.

import type { Queryable } from "../db/db.ts";
import { reject } from "../protocol/errors.ts";
import { requireRule } from "../rules/world_rules.ts";
import { selectRows } from "./store.ts";
import type { FactTable, ID, RowMap, Seq, UInt, WorldRules } from "./types.ts";

export interface Page {
  after: ID | null;
  through: Seq | null;
}

export interface PageOut<T> {
  rows: T[];
  page: { after: ID | null; through: Seq };
  has_more: boolean;
  snapshot_changed: boolean;
}

export function resolveLimit(limit: UInt | null, rules: WorldRules, field = "args.limit"): UInt {
  const max = requireRule(rules, "page_size");
  if (limit === null) return max;
  if (limit > max) return reject("INVALID_ARGUMENT", { expected: "positive integer not above page_size" }, field);
  return limit;
}

export function pinThrough(page: Page, deedHead: Seq, field = "args.page.through"): { through: Seq; changed: boolean } {
  if (page.through === null) return { through: deedHead, changed: false };
  if (BigInt(page.through) > BigInt(deedHead)) {
    return reject("INVALID_ARGUMENT", { expected: "Seq not above deed_head" }, field);
  }
  return { through: page.through, changed: page.through !== deedHead };
}

/**
 * One page of `table` rows matching `where` (params $1…). `seqColumn`, when set,
 * also bounds rows by `seqColumn <= through` (deeds).
 */
export async function pageRows<T extends FactTable>(
  q: Queryable,
  table: T,
  where: string,
  params: readonly unknown[],
  page: Page,
  limit: UInt,
  deedHead: Seq,
  seqColumn: string | null = null,
): Promise<PageOut<RowMap[T]>> {
  const pin = pinThrough(page, deedHead);
  const conds = [where === "" ? "TRUE" : `(${where})`];
  const ps = [...params];
  if (page.after !== null) {
    ps.push(page.after);
    const p = `$${ps.length}::text`;
    conds.push(`(length(id), id COLLATE "C") > (length(${p}), ${p} COLLATE "C")`);
  }
  if (seqColumn !== null) {
    ps.push(pin.through);
    conds.push(`${seqColumn} <= $${ps.length}`);
  }
  ps.push(limit + 1);
  const rows = await selectRows(q, table, conds.join(" AND "), ps, `ORDER BY length(id), id COLLATE "C" LIMIT $${ps.length}`);
  const has_more = rows.length > limit;
  const out = has_more ? rows.slice(0, limit) : rows;
  const last = out[out.length - 1] as { id: ID } | undefined;
  return {
    rows: out,
    page: { after: last?.id ?? page.after, through: pin.through },
    has_more,
    snapshot_changed: pin.changed,
  };
}
