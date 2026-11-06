// [S32] Player handles (设计者原话 2026-11-06 18): one uppercase letter plus
// a counter — at least 5 digits zero-padded, at most 7 — A00001 … A9999999,
// then B00001 …, up to Z9999999. Player and official chars get one; it is public,
// globally unique and never reused. Numbering comes from the aihw_handle_seq
// sequence (migration 1000). Existing players are backfilled in creation
// order (created_tick, then numeric ID local) at startup — idempotent, and
// the sequence is advanced past the backfilled range so a later create never
// collides.

import type { Queryable } from "../db/db.ts";

const PER_LETTER = 9_999_999;
const LETTERS = 26;

export function handleOf(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > LETTERS * PER_LETTER) {
    throw new Error(`handle number out of range: ${n}`);
  }
  const letter = String.fromCharCode(65 + Math.floor((n - 1) / PER_LETTER));
  const idx = ((n - 1) % PER_LETTER) + 1;
  return letter + String(idx).padStart(5, "0");
}

/** Next never-reused handle (called inside the enter create transaction). */
export async function allocateHandle(q: Queryable): Promise<string> {
  const r = await q.query<{ n: unknown }>("SELECT nextval('aihw_handle_seq') AS n");
  const n = r.rows[0]?.n;
  if (n === undefined) throw new Error("sequence aihw_handle_seq returned nothing");
  return handleOf(Number(n));
}

/** Assigns handles to player / official chars that lack one, oldest first; returns the count. */
export async function backfillHandles(q: Queryable): Promise<number> {
  const r = await q.query<{ rn: unknown }>(`
    WITH ordered AS (
      SELECT id, row_number() OVER (
        ORDER BY created_tick,
          COALESCE(NULLIF(regexp_replace(split_part(id, ':', 3), '[^0-9]', '', 'g'), '')::bigint, 9223372036854775807),
          id
      ) AS rn
      FROM chars
      WHERE kind IN ('player', 'official') AND handle IS NULL
    )
    UPDATE chars c
    SET handle = chr(65 + ((o.rn - 1) / 9999999)::int)
              || lpad((((o.rn - 1) % 9999999) + 1)::text, 5, '0')
    FROM ordered o
    WHERE c.id = o.id
    RETURNING o.rn`);
  const rns = r.rows.map((x) => Number(x.rn));
  if (rns.length === 0) return 0;
  const top = Math.max(...rns);
  // Keep the sequence past the backfilled range even if it was already ahead.
  await q.query(
    "SELECT setval('aihw_handle_seq', GREATEST($1::bigint, COALESCE((SELECT last_value FROM aihw_handle_seq), 0)))",
    [String(top)],
  );
  return rns.length;
}
