// Generic fact-row access over the descriptors in tables.ts. Work streams write
// their own specific queries with selectRows/countRows instead of editing a
// shared per-table repository file.

import type { DbRow, Queryable } from "../db/db.ts";
import { PUBLIC_TABLES, type PublicTable } from "./enums.ts";
import { TABLES, decodeRow, encodeValue, fieldsOf, type ColKind } from "./tables.ts";
import type { Change, FactTable, ID, RowMap, Tick } from "./types.ts";

const PUBLIC = new Set<string>(PUBLIC_TABLES);
export const isPublicTable = (t: string): t is PublicTable => PUBLIC.has(t);

export function physical(table: FactTable): string {
  return TABLES[table].physical;
}

export async function getRow<T extends FactTable>(
  q: Queryable,
  table: T,
  id: ID,
  opts: { lock?: boolean } = {},
): Promise<RowMap[T] | null> {
  const sql = `SELECT * FROM ${physical(table)} WHERE id = $1${opts.lock === true ? " FOR UPDATE" : ""}`;
  const r = await q.query<DbRow>(sql, [id]);
  const row = r.rows[0];
  return row === undefined ? null : decodeRow(table, row);
}

export async function mustGetRow<T extends FactTable>(
  q: Queryable,
  table: T,
  id: ID,
  opts: { lock?: boolean } = {},
): Promise<RowMap[T]> {
  const row = await getRow(q, table, id, opts);
  if (row === null) throw new Error(`fact integrity: ${table} ${id} missing`);
  return row;
}

/**
 * `where` is a SQL fragment over the physical table (alias-free), `tail` may
 * add ORDER BY / LIMIT / FOR UPDATE. Parameters are positional ($1…).
 */
export async function selectRows<T extends FactTable>(
  q: Queryable,
  table: T,
  where: string,
  params: readonly unknown[] = [],
  tail = "",
): Promise<RowMap[T][]> {
  const sql = `SELECT * FROM ${physical(table)}${where === "" ? "" : ` WHERE ${where}`} ${tail}`;
  const r = await q.query<DbRow>(sql, params);
  return r.rows.map((row) => decodeRow(table, row));
}

export async function countRows(
  q: Queryable,
  table: FactTable,
  where: string,
  params: readonly unknown[] = [],
): Promise<number> {
  const sql = `SELECT count(*) AS n FROM ${physical(table)}${where === "" ? "" : ` WHERE ${where}`}`;
  const r = await q.query<{ n: unknown }>(sql, params);
  return Number(r.rows[0]?.n ?? 0);
}

/**
 * Inserts a complete row. The field set must equal the branch field list exactly
 * (no missing, no extra fields). `extra` carries physical helper columns.
 */
export async function insertRow<T extends FactTable>(
  q: Queryable,
  table: T,
  row: RowMap[T],
  extra: Record<string, unknown> = {},
): Promise<void> {
  const desc = TABLES[table];
  const r = row as unknown as Record<string, unknown>;
  const fields = fieldsOf(desc, desc.discriminator === null ? null : r[desc.discriminator]);
  const keys = Object.keys(r);
  if (keys.length !== fields.length || !fields.every((f) => Object.hasOwn(r, f))) {
    throw new Error(`insert ${table}: field set mismatch`);
  }
  const cols: string[] = [];
  const marks: string[] = [];
  const params: unknown[] = [];
  for (const f of fields) {
    const enc = encodeValue(desc.cols[f] as ColKind, r[f]);
    params.push(enc.value);
    cols.push(f);
    marks.push(`$${params.length}${enc.cast}`);
  }
  for (const [c, v] of Object.entries(extra)) {
    params.push(v);
    cols.push(c);
    marks.push(`$${params.length}`);
  }
  await q.query(`INSERT INTO ${desc.physical} (${cols.join(", ")}) VALUES (${marks.join(", ")})`, params);
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** Field patch; for discriminated tables any branch field may appear (the DB CHECK enforces the branch). */
export type Patch<T extends FactTable> = Partial<DistributiveOmit<RowMap[T], "id" | "created_tick" | "updated_tick" | "record">>;

/**
 * Updates fields of one row and stamps updated_tick. Returns the Change for
 * public tables (after = the patch only), null for world / identity.
 */
export async function updateRow<T extends FactTable>(
  q: Queryable,
  table: T,
  id: ID,
  patch: Patch<T>,
  tick: Tick,
): Promise<Change | null> {
  const desc = TABLES[table];
  if (desc.appendOnly) throw new Error(`${table} is append-only`);
  const p = patch as unknown as Record<string, unknown>;
  const sets: string[] = [];
  const params: unknown[] = [id];
  for (const [f, v] of Object.entries(p)) {
    const kind = desc.cols[f];
    if (kind === undefined || f === "id" || f === desc.discriminator) throw new Error(`update ${table}: bad field ${f}`);
    const enc = encodeValue(kind, v);
    params.push(enc.value);
    sets.push(`${f} = $${params.length}${enc.cast}`);
  }
  if (desc.touched) {
    params.push(tick);
    sets.push(`updated_tick = $${params.length}`);
  }
  if (sets.length === 0) return null;
  const r = await q.query(`UPDATE ${desc.physical} SET ${sets.join(", ")} WHERE id = $1`, params);
  if (r.affected !== 1) throw new Error(`fact integrity: update ${table} ${id} affected ${r.affected}`);
  return isPublicTable(table) ? { table, id, after: { ...p } } : null;
}

/** Change record for a newly created public row (after = complete row). */
export function createdChange(table: PublicTable, row: { id: ID }): Change {
  return { table, id: row.id, after: { ...(row as Record<string, unknown>) } };
}
