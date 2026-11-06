// [S11 owns this file after S9] Bearer authentication and access stamping.
// The code is hashed and looked up; it is never logged, echoed or stored.
// Access-time lifecycle (动词表 §2): judged on the OLD last_seen_tick /
// created_tick / expires_tick before the runner stamps the new access. Only
// unrecoverable expiry refuses here — IDENTITY_EXPIRED once the hash is still
// there but the holder is past recovery (draft TTL or revive window); the
// credential row itself stays for the tick phase to clear, because a rejection
// rolls the transaction back (this path is read-only). State drift
// (active → dormant → buried) belongs to the tick phase; gates decide what a
// dormant / buried char may still call (whoami / events / enter resume).

import type { Queryable } from "../db/db.ts";
import { worldId } from "../facts/ids.ts";
import { getRow } from "../facts/store.ts";
import type { CharRow, Tick, WorldRules } from "../facts/types.ts";
import type { Writer } from "../facts/writer.ts";
import { NO_DETAILS, reject } from "../protocol/errors.ts";
import { hashCode, normalizeCode } from "./code.ts";

/** null = header absent; "" = present but not `Bearer <code>`. */
export function parseBearer(header: string | undefined): string | null {
  if (header === undefined) return null;
  const m = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(header);
  return m === null ? "" : (m[1] ?? "");
}

/** True when the holder is past recovery on the current tick (read-only check). */
function pastRecovery(c: CharRow, expiresTick: Tick | null, rules: WorldRules, tick: Tick): boolean {
  const now = Number(tick);
  if (expiresTick !== null && now >= Number(expiresTick)) return true;
  const draftTtl = rules.draft_expire_ticks;
  return c.state === "draft" && draftTtl !== null && now - Number(c.created_tick) >= draftTtl;
}

/** Resolves the bearer code to its char (row-locked when `lock`). */
export async function authenticate(q: Queryable, bearer: string | null, opts: { lock: boolean }): Promise<CharRow> {
  if (bearer === null) return reject("AUTH_REQUIRED", NO_DETAILS);
  if (bearer === "") return reject("AUTH_INVALID", NO_DETAILS);
  const hash = hashCode(normalizeCode(bearer));
  const r = await q.query<{ char_id: string; expires_tick: string | null }>(
    "SELECT char_id, expires_tick FROM identities WHERE code_hash = $1",
    [hash],
  );
  const ident = r.rows[0];
  if (ident === undefined) return reject("AUTH_INVALID", NO_DETAILS);
  const c = await getRow(q, "char", ident.char_id, { lock: opts.lock });
  if (c === null) return reject("AUTH_INVALID", NO_DETAILS);
  const world = await q.query<{ tick: string; rules: WorldRules }>("SELECT tick, rules FROM worlds WHERE id = $1", [
    worldId(c.id.split(":")[0] as string),
  ]);
  const w = world.rows[0];
  if (w !== undefined && pastRecovery(c, ident.expires_tick, w.rules, w.tick)) {
    return reject("IDENTITY_EXPIRED", { can_create: true });
  }
  return c;
}

/** Stamps a successful authenticated access (seen_at / last_seen_tick). */
export async function touchSeen(w: Writer, c: CharRow, tick: Tick, now: Date): Promise<CharRow> {
  const seen_at = now.toISOString();
  await w.update("char", c.id, { seen_at, last_seen_tick: tick });
  return { ...c, seen_at: seen_at.replace(".000Z", "Z"), last_seen_tick: tick };
}
