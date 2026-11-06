// S23: official residents are named only by the server boot import
// (事实格式 §6 「官方身份只由服务器初始导入」). content/officials.json lists
// public handles; a listed player that is not buried becomes kind=official.
// Missing file, empty list, or a handle that is not a live player: do nothing.
// Chars not on the list are never demoted.

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Queryable } from "../db/db.ts";
import { log } from "../log.ts";

/** Repo content/officials.json, resolved from server/src/identity. */
export const DEFAULT_OFFICIALS_FILE = resolve(dirname(fileURLToPath(import.meta.url)), "../../../content/officials.json");

const HANDLE_RE = /^[A-Z][0-9]{5,7}$/;

export interface OfficialsImportResult {
  /** How many player chars were flipped to official this run (0 when nothing changed). */
  changed: number;
}

/** Reads {"handles":[...]} . Missing file → null (caller does nothing). */
export async function readOfficialHandles(file: string): Promise<string[] | null> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as { handles?: unknown }).handles)) {
    throw new Error("officials: handles must be an array");
  }
  const handles = (parsed as { handles: unknown[] }).handles;
  const out: string[] = [];
  for (const h of handles) {
    if (typeof h !== "string" || !HANDLE_RE.test(h)) throw new Error("officials: handle is invalid");
    if (!out.includes(h)) out.push(h);
  }
  return out;
}

/**
 * Flips listed live players to official. Idempotent. Returns how many rows changed.
 * An empty list changes nothing. Buried chars and non-players are left alone.
 */
export async function importOfficials(q: Queryable, handles: readonly string[]): Promise<OfficialsImportResult> {
  if (handles.length === 0) return { changed: 0 };
  const r = await q.query<{ id: string }>(
    `UPDATE chars SET kind = 'official'
     WHERE kind = 'player' AND state <> 'buried' AND handle = ANY($1::text[])
     RETURNING id`,
    [handles],
  );
  return { changed: r.rows.length };
}

/** Boot hook: missing or empty file is a no-op; a real change is logged by count only. */
export async function importOfficialsFile(q: Queryable, file: string = DEFAULT_OFFICIALS_FILE): Promise<OfficialsImportResult> {
  const handles = await readOfficialHandles(file);
  if (handles === null || handles.length === 0) return { changed: 0 };
  const result = await importOfficials(q, handles);
  if (result.changed > 0) log.info("official residents marked", { count: result.changed });
  return result;
}
