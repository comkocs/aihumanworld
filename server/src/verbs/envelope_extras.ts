// [S46] Optional fields of a success envelope that belong to no single verb's result:
//   new_speech  direct sentences others said to this char since its previous successful action
//   notice      "the entry guide changed" (content/notice.json), once per char per rev
// Nothing is kept per char in the database: both are bounded by the char's previous successful action
// tick (`last_seen_tick` before this request stamped it). A small per-process memo (what this process
// already showed) only sharpens that boundary inside one tick, where ticks alone cannot tell "before
// my previous action" from "after it"; a restart loses it and falls back to the tick boundary, which
// can repeat a line within one tick but never drops one. Computed by the runner inside the request
// transaction (a rollback takes the fields away); the memo is written only after the commit.

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Queryable } from "../db/db.ts";
import { getRow } from "../facts/store.ts";
import type { ID, Seq, Tick, WorldRules } from "../facts/types.ts";
import { eventsSince } from "../growth/discourse.ts";
import { log } from "../log.ts";
import { requireRule } from "../rules/world_rules.ts";
import type { SpeechProjection, SpeechStore } from "../speech/store.ts";

/** At most this many sentences ride in one envelope (the newest ones, oldest first). */
export const NEW_SPEECH_MAX = 5;
/** The memo is dropped (back to the tick boundary) past this many chars; it only ever sharpens. */
const MEMO_MAX = 50_000;

export interface NewSpeech {
  from: ID;
  from_handle: string | null;
  tick: Tick;
  other_speech: string | null;
  speech_status: SpeechProjection["speech_status"];
}

export interface Notice {
  rev: string;
  url: string;
  text: Record<string, string>;
}

/** What this process already showed, per char; keyed by the app's services object (one per app). */
interface Memo {
  /** event_head of the char's last successful action: later direct sentences are the new ones. */
  heard: Map<ID, bigint>;
  /** Last notice rev shown to the char. */
  noticed: Map<ID, string>;
}
const memos = new WeakMap<object, Memo>();

function memoOf(owner: object): Memo {
  let m = memos.get(owner);
  if (m === undefined) {
    m = { heard: new Map(), noticed: new Map() };
    memos.set(owner, m);
  }
  if (m.heard.size > MEMO_MAX) m.heard.clear();
  if (m.noticed.size > MEMO_MAX) m.noticed.clear();
  return m;
}

/**
 * Direct sentences addressed to `me` since its previous successful action, up to event cursor `head`
 * (the newest 5, oldest first). Boundary: the cursor of the previous action when this process saw it,
 * else the previous action's tick, inclusive (a sentence in that very tick may have come after the
 * action, so it is shown rather than lost); never older than the speech TTL. Text and status come from
 * the speech store, the same source and expiry as `events`.
 */
async function newSpeechFor(
  q: Queryable,
  speech: SpeechStore,
  rules: WorldRules,
  memo: Memo,
  me: ID,
  oldSeen: Tick,
  tick: Tick,
  head: Seq,
): Promise<NewSpeech[]> {
  const known = memo.heard.get(me);
  if (known !== undefined && known >= BigInt(head)) return []; // nothing new happened anywhere since this char's last action
  const ttl = BigInt(requireRule(rules, "speech_ttl_ticks"));
  const floor = BigInt(tick) - ttl;
  const since = BigInt(oldSeen) > floor ? BigInt(oldSeen) : floor;
  const events = await eventsSince(q, { inbox: me }, since, (BigInt(head) + 1n).toString(), known ?? null);
  const out: NewSpeech[] = [];
  for (const e of events) {
    if (e.type !== "speech" || e.data.speaker === me) continue;
    const from = await getRow(q, "char", e.data.speaker);
    const shown = speech.project(e, tick);
    out.push({ from: e.data.speaker, from_handle: from?.handle ?? null, tick: e.tick, other_speech: shown.other_speech, speech_status: shown.speech_status });
    if (out.length >= NEW_SPEECH_MAX) break;
  }
  return out.reverse();
}

/** Repo content/notice.json, resolved from server/src/verbs. AIHW_NOTICE_FILE overrides it (tests). */
export const DEFAULT_NOTICE_FILE = resolve(dirname(fileURLToPath(import.meta.url)), "../../../content/notice.json");

const REV_RE = /^[A-Za-z0-9._-]{1,64}$/;
let lastWarning = "";

function badFile(reason: string): null {
  if (reason !== lastWarning) log.warn("notice file ignored", { reason });
  lastWarning = reason;
  return null;
}

/** Reads {"rev","url","text":{locale:string}}. Missing, empty or malformed file = no notice (malformed is logged once). */
export async function readNotice(file?: string): Promise<Notice | null> {
  const env = process.env.AIHW_NOTICE_FILE;
  const path = file ?? (env !== undefined && env !== "" ? env : DEFAULT_NOTICE_FILE);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ENOENT" ? null : badFile("unreadable");
  }
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  if (raw.trim() === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return badFile("not json");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return badFile("not an object");
  const o = parsed as Record<string, unknown>;
  const text = o.text;
  if (typeof o.rev !== "string" || !REV_RE.test(o.rev)) return badFile("rev");
  if (typeof o.url !== "string" || o.url === "") return badFile("url");
  if (typeof text !== "object" || text === null || Array.isArray(text)) return badFile("text");
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(text)) {
    if (typeof v !== "string" || v === "") return badFile("text entry");
    out[k] = v;
  }
  if (Object.keys(out).length === 0) return badFile("text empty");
  lastWarning = "";
  return { rev: o.rev, url: o.url, text: out };
}

/**
 * The notice this char should see now, or null. A rev is published at the world tick of the first
 * request that sees it (row in notice_revs, so a restart forgets nothing); a char sees it when its
 * previous successful action is not later than that tick (so a char active in the publishing tick is
 * not missed) and this process has not shown it that rev yet. Its own request stamps last_seen_tick
 * past the publication on the next tick, so the same rev does not show twice; a new rev shows once
 * more to everyone.
 */
async function noticeFor(q: Queryable, memo: Memo, realm: string, me: ID, tick: Tick, oldSeen: Tick, file?: string): Promise<Notice | null> {
  const notice = await readNotice(file);
  if (notice === null) return null;
  const lookup = async (): Promise<string | undefined> =>
    (await q.query<{ published_tick: string }>("SELECT published_tick FROM notice_revs WHERE realm = $1 AND rev = $2", [realm, notice.rev])).rows[0]?.published_tick;
  let published = await lookup();
  if (published === undefined) {
    published = (
      await q.query<{ published_tick: string }>(
        "INSERT INTO notice_revs (realm, rev, published_tick) VALUES ($1, $2, $3) ON CONFLICT (realm, rev) DO NOTHING RETURNING published_tick",
        [realm, notice.rev, tick],
      )
    ).rows[0]?.published_tick;
    published ??= await lookup();
  }
  if (published === undefined || BigInt(oldSeen) > BigInt(published)) return null;
  return memo.noticed.get(me) === notice.rev ? null : notice;
}

export interface Extras {
  new_speech?: NewSpeech[];
  notice?: Notice;
  /** Run once the transaction has committed: remembers what was shown. */
  commit(): void;
}

/** Everything the runner adds to the success envelope of an authenticated char (see the header). */
export async function envelopeExtras(
  q: Queryable,
  owner: object,
  speech: SpeechStore,
  realm: string,
  rules: WorldRules,
  me: ID,
  oldSeen: Tick,
  tick: Tick,
  head: Seq,
): Promise<Extras> {
  const memo = memoOf(owner);
  const extras: Extras = {
    commit() {
      memo.heard.set(me, BigInt(head));
      if (extras.notice !== undefined) memo.noticed.set(me, extras.notice.rev);
    },
  };
  const heard = await newSpeechFor(q, speech, rules, memo, me, oldSeen, tick, head);
  if (heard.length > 0) extras.new_speech = heard;
  const notice = await noticeFor(q, memo, realm, me, tick, oldSeen);
  if (notice !== null) extras.notice = notice;
  return extras;
}
