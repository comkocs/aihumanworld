// S87: bounded facts from the interval before this successful action, never generated prose.
// The action cursor is remembered only after COMMIT; last_seen_tick is the restart fallback.

import type { DbRow, Queryable } from "../db/db.ts";
import { countRows, getRow, selectRows } from "../facts/store.ts";
import { decodeRow } from "../facts/tables.ts";
import type { EventDataMap, EventRow, ID, OrgGoal, Seq, Tick } from "../facts/types.ts";
import type { SpeechProjection } from "../speech/store.ts";
import type { VerbContext } from "./types.ts";

export const BRIEFING_SPEECH_MAX = 12;
export const BRIEFING_MAX_BYTES = 8192;
const FACT_MAX = 4;
const FACT_BYTES = 512;
const SPEECH_BYTES = 4096;
const MEMO_MAX = 50_000;

interface Section<T> {
  total: number;
  items: T[];
}
interface Sentence extends SpeechProjection {
  from: ID;
  from_handle: string | null;
  tick: Tick;
  text_truncated?: true;
}
type Fact<T> = { tick: Tick; cursor: Seq } & T;
type Goal = Omit<OrgGoal, "member_ids" | "reward_rep">;
interface WorldResult {
  outcome: string;
  changed_facts: number;
  spawned?: number;
  defeated?: number;
}
export interface Briefing {
  from_tick: Tick;
  to_tick: Tick;
  speech?: Section<Sentence>;
  relations?: Section<Fact<{ bond: Pick<EventDataMap["bond_changed"]["bond"], "id" | "kind" | "a" | "b" | "state" | "since_tick" | "ended_tick"> }>>;
  organization?: Section<{ org_id: ID; goal: Goal }>;
  world_events?: Section<Fact<EventDataMap["world_event"] & { result?: WorldResult }>>;
  bounties?: Section<Fact<EventDataMap["task_changed"]>>;
  life?: Section<Fact<EventDataMap["life_changed"]>>;
  attacks?: Section<Fact<Pick<EventDataMap["combat_resolved"], "attacker" | "winner" | "mode" | "outcome" | "dead" | "deed_id">>>;
}

interface Boundary { tick: Tick; head: Seq }
const delivered = new WeakMap<object, Map<ID, Boundary>>();
const starts = new WeakMap<VerbContext, Tick>();
const prepared = new WeakMap<VerbContext, Briefing>();

function memo(ctx: VerbContext): Map<ID, Boundary> {
  let m = delivered.get(ctx.services);
  if (m === undefined) {
    m = new Map();
    delivered.set(ctx.services, m);
  }
  if (m.size > MEMO_MAX) m.clear();
  return m;
}

/** Called before touchSeen, including the handle + email authentication path. */
export function rememberBriefingStart(ctx: VerbContext, tick: Tick | null): void {
  if (tick !== null) starts.set(ctx, tick);
}
export function briefingStart(ctx: VerbContext): Tick | null {
  return starts.get(ctx) ?? null;
}
export function commitBriefing(ctx: VerbContext, head: Seq): void {
  if (ctx.actor === null) return;
  const m = memo(ctx);
  const last = m.get(ctx.actor.id);
  if (last === undefined || BigInt(head) >= BigInt(last.head)) m.set(ctx.actor.id, { tick: ctx.tick, head });
}

function bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}
function section<T>(total: number, items: T[], budget = FACT_BYTES): Section<T> | undefined {
  if (total === 0) return undefined;
  const out = { total, items: [] as T[] };
  for (const item of items) {
    out.items.push(item);
    if (bytes(out) > budget) out.items.pop();
  }
  return out;
}
function clip(text: string, budget: number): string {
  let used = 0;
  let out = "";
  for (const char of text) {
    used += bytes(char) - 2;
    if (used > budget) break;
    out += char;
  }
  return out;
}

/** One category's own SQL filter and count: busy unrelated inbox traffic cannot hide a category. */
async function events(
  q: Queryable, me: ID, start: Tick, head: Seq, after: Seq | null,
  filter: string, limit = FACT_MAX, world = false,
): Promise<{ total: number; items: EventRow[] }> {
  const source = world ? "events e" : "event_inbox i JOIN events e ON e.cursor = i.cursor";
  const audience = world ? "e.scope = 'world'" : "i.char_id = $1";
  const where = `${audience} AND e.tick >= $2 AND e.cursor <= $3 AND ($4::bigint IS NULL OR e.cursor > $4) AND (${filter})`;
  const params = [me, start, head, after];
  // Keep $1 typed on the world path as well, for PostgreSQL's parameter inference.
  const typed = world ? `${where} AND $1::text IS NOT NULL` : where;
  const n = await q.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${source} WHERE ${typed}`, params);
  const rows = await q.query<DbRow>(`SELECT e.* FROM ${source} WHERE ${typed} ORDER BY e.cursor DESC LIMIT ${limit}`, params);
  return { total: Number(n.rows[0]?.n ?? 0), items: rows.rows.map((r) => decodeRow("event", r)) };
}

async function worldResult(ctx: VerbContext, event: Extract<EventRow, { type: "world_event" }>): Promise<WorldResult | undefined> {
  if (event.data.phase !== "close") return undefined;
  const deed = event.deed_id === null ? null : await getRow(ctx.q, "deed", event.deed_id);
  const result: WorldResult = { outcome: deed?.result.outcome ?? "closed", changed_facts: deed?.result.changes.length ?? 0 };
  if (event.data.kind === "beast_tide") {
    const rows = await ctx.q.query<{ spawned: unknown }>("SELECT spawned FROM s72_world_events WHERE open_tick = $1", [event.data.open_tick]);
    const raw = rows.rows[0]?.spawned;
    const spawned: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (Array.isArray(spawned) && spawned.every((id) => typeof id === "string")) {
      const killed = await ctx.q.query<{ n: string }>(
        `SELECT count(DISTINCT data->>'char_id')::text AS n FROM events
         WHERE type = 'life_changed' AND data->>'to' = 'dead' AND data->>'char_id' = ANY($1::text[])
           AND tick >= $2 AND tick <= $3 AND cursor <= $4`,
        [spawned, event.data.open_tick, event.data.until_tick, event.cursor],
      );
      result.spawned = spawned.length;
      result.defeated = Number(killed.rows[0]?.n ?? 0);
    }
  }
  return result;
}

/** Resume opts in even for a short interval; an already consumed, unchanged interval is not repeated. */
export async function briefingFor(ctx: VerbContext, resume = false): Promise<Briefing | undefined> {
  const cached = prepared.get(ctx);
  if (cached !== undefined) return cached;
  const start = briefingStart(ctx);
  const me = ctx.actor?.id;
  if (start === null || me === undefined) return undefined;
  const known = memo(ctx).get(me);
  const from = known !== undefined && BigInt(known.tick) > BigInt(start) ? known.tick : start;
  const head = ctx.world.event_head;
  if (!resume && BigInt(ctx.tick) - BigInt(from) <= 10n) return undefined;
  if (known !== undefined && BigInt(head) <= BigInt(known.head) && BigInt(ctx.tick) <= BigInt(known.tick)) return undefined;
  const after = known?.head ?? null;
  const out: Briefing = { from_tick: from, to_tick: ctx.tick };

  const said = await events(ctx.q, me, from, head, after,
    "e.type = 'speech' AND e.data->>'speaker' <> $1 AND e.data->>'target' = $1 AND e.data->>'channel' = 'direct'", BRIEFING_SPEECH_MAX);
  if (said.total > 0) {
    const items: Sentence[] = [];
    for (const e of said.items.reverse()) {
      if (e.type !== "speech") continue;
      const sender = await getRow(ctx.q, "char", e.data.speaker);
      items.push({ from: e.data.speaker, from_handle: sender?.handle ?? null, tick: e.tick, ...ctx.services.speech.project(e, ctx.tick) });
    }
    const value = { total: said.total, items };
    if (bytes(value) > SPEECH_BYTES) {
      const empty = items.map((s) => ({ ...s, other_speech: s.other_speech === null ? null : "", text_truncated: true }));
      const perText = Math.max(0, Math.floor((SPEECH_BYTES - bytes({ total: said.total, items: empty })) / items.length));
      for (const s of items) {
        if (s.other_speech === null || bytes(s.other_speech) - 2 <= perText) continue;
        s.other_speech = clip(s.other_speech, perText);
        s.text_truncated = true;
      }
    }
    out.speech = value;
  }

  const bonds = await events(ctx.q, me, from, head, after,
    "e.type = 'bond_changed' AND e.data->'bond'->>'kind' IN ('mentor','ally','enemy') AND (e.data->'bond'->>'a' = $1 OR e.data->'bond'->>'b' = $1)");
  out.relations = section(bonds.total, bonds.items.flatMap((e) => {
    if (e.type !== "bond_changed") return [];
    const { id, kind, a, b, state, since_tick, ended_tick } = e.data.bond;
    return [{ tick: e.tick, cursor: e.cursor, bond: { id, kind, a, b, state, since_tick, ended_tick } }];
  }));

  const orgFilter = "EXISTS (SELECT 1 FROM bonds b WHERE b.kind = 'member' AND b.a = $1 AND b.b = orgs.id AND b.state = 'active') AND (goal->>'target')::bigint > 0";
  const orgTotal = await countRows(ctx.q, "org", orgFilter, [me]);
  const orgs = await selectRows(ctx.q, "org", orgFilter, [me], `ORDER BY id LIMIT ${FACT_MAX}`);
  out.organization = section(orgTotal, orgs.map((org) => {
    const { week, kind, target, progress, settled } = org.goal;
    return { org_id: org.id, goal: { week, kind, target, progress, settled } };
  }));

  const world = await events(ctx.q, me, from, head, after, "e.type = 'world_event'", FACT_MAX, true);
  const windows: NonNullable<Briefing["world_events"]>["items"] = [];
  for (const e of world.items) {
    if (e.type !== "world_event") continue;
    const result = await worldResult(ctx, e);
    windows.push({ tick: e.tick, cursor: e.cursor, ...e.data, ...(result === undefined ? {} : { result }) });
  }
  out.world_events = section(world.total, windows, 768);

  const tasks = await events(ctx.q, me, from, head, after,
    `e.type = 'task_changed' AND EXISTS (SELECT 1 FROM tasks t WHERE t.id = e.data->>'task_id'
     AND t.record = 'instance' AND t.kind = 'bounty'
     AND (t.issuer->>'id' = $1 OR t.taker = $1 OR t.eligible_char = $1 OR e.data->>'taker' = $1))`);
  out.bounties = section(tasks.total, tasks.items.flatMap((e) => e.type === "task_changed" ? [{ tick: e.tick, cursor: e.cursor, ...e.data }] : []));

  const lives = await events(ctx.q, me, from, head, after, "e.type = 'life_changed' AND e.data->>'char_id' = $1");
  out.life = section(lives.total, lives.items.flatMap((e) => e.type === "life_changed" ? [{ tick: e.tick, cursor: e.cursor, ...e.data }] : []));

  const attacks = await events(ctx.q, me, from, head, after, "e.type = 'combat_resolved' AND e.data->>'target' = $1 AND e.data->>'attacker' <> $1");
  out.attacks = section(attacks.total, attacks.items.flatMap((e) => {
    if (e.type !== "combat_resolved") return [];
    const { attacker, winner, mode, outcome, dead, deed_id } = e.data;
    return [{ tick: e.tick, cursor: e.cursor, attacker, winner, mode, outcome, dead, deed_id }];
  }));
  prepared.set(ctx, out);
  return out;
}
