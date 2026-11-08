// [S92] Speech stays unrestricted and pays no cultivation, including 初识 and NPC talk.
// Direct speech to a nearby NPC still produces its ordinary topic-selected reply.
// Cultivation for a completed exchange is settled by trade_bonus.ts, not by speech frequency.

import type { DbRow, Queryable } from "../db/db.ts";
import { getRow } from "../facts/store.ts";
import { decodeRow } from "../facts/tables.ts";
import type { Change, EventRow, ID, Seq } from "../facts/types.ts";
import type { VerbContext } from "../verbs/types.ts";
import { npcLine } from "./npc_lines.ts";

const PAGE = 20;
const SCAN_CAP = 400;

export type EventSource = { inbox: ID } | { place: ID };

/**
 * Events of one source, newest first, below cursor `before` (exclusive), stopping at the first event
 * older than `minTick` or not newer than cursor `after` (cursor and tick grow together). Cost follows
 * what happened to the source inside the window, not the history.
 */
export async function eventsSince(
  q: Queryable,
  src: EventSource,
  minTick: bigint,
  before: Seq | null = null,
  after: bigint | null = null,
  cap: number = SCAN_CAP,
): Promise<EventRow[]> {
  const out: EventRow[] = [];
  let cursor = before;
  for (;;) {
    const params: unknown[] = ["inbox" in src ? src.inbox : src.place];
    const cut = cursor === null ? "" : ` AND ${"inbox" in src ? "i" : "e"}.cursor < $2`;
    if (cursor !== null) params.push(cursor);
    const sql =
      "inbox" in src
        ? `SELECT e.* FROM event_inbox i JOIN events e ON e.cursor = i.cursor WHERE i.char_id = $1${cut} ORDER BY i.cursor DESC LIMIT ${PAGE}`
        : `SELECT e.* FROM events e WHERE e.scope = 'place' AND e.place_id = $1${cut} ORDER BY e.cursor DESC LIMIT ${PAGE}`;
    const r = await q.query<DbRow>(sql, params);
    let last: EventRow | undefined;
    for (const row of r.rows) {
      const e = decodeRow("event", row);
      if (BigInt(e.tick) < minTick || (after !== null && BigInt(e.cursor) <= after)) return out;
      out.push(e);
      if (out.length >= cap) return out;
      last = e;
    }
    if (r.rows.length < PAGE || last === undefined) return out;
    cursor = last.cursor;
  }
}

/** What a direct talk with an NPC produced, for the `say` result. */
export interface NpcReply {
  from: ID;
  text: string;
  event_id: ID;
}

/** Called by say in its transaction; speech never changes growth facts. */
export async function settleDiscourse(ctx: VerbContext, speech: EventRow, spokenText: string): Promise<{ changes: Change[]; npcReply: NpcReply | null }> {
  const me = ctx.actor;
  const none = { changes: [] as Change[], npcReply: null };
  if (me === null || me.kind === "npc" || speech.type !== "speech" || speech.data.channel !== "direct" || speech.data.target === null) return none;
  const npc = await getRow(ctx.q, "char", speech.data.target);
  if (npc === null || npc.kind !== "npc" || npc.loc !== me.loc || (npc.state !== "draft" && npc.state !== "active") || npc.life !== "alive") return none;
  let lang: "zh" | "en";
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}]/u.test(spokenText)) {
    lang = "zh";
  } else if (/[\p{L}\p{N}]/u.test(spokenText)) {
    lang = "en";
  } else {
    const place = await getRow(ctx.q, "place", me.loc);
    lang = place !== null && (place.region === "fantasy" || place.region === "scifi") ? "en" : "zh";
  }
  const text = npcLine(npc.archetype, lang, me.id, npc.id, spokenText);
  const reply = await ctx.w.emit({
    scope: "self", recipients: [me.id, npc.id], type: "speech", deed_id: null,
    data: { speaker: npc.id, channel: "direct", target: me.id },
  });
  return { changes: [], npcReply: { from: npc.id, text, event_id: reply.id } };
}
