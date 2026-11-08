// Sanitised speech text (事实格式 §13): events contain metadata only; text is
// persisted separately until speech_ttl_ticks and restored to memory at boot.
// Synchronous projections share a transaction gate; rollback restores the cache.
//
// Memory is bounded without any per-player limit: expired texts are swept every
// SWEEP_EVERY puts, and past `maxEntries` the oldest texts are dropped (they then
// project as expired). Speech text is never logged.

import { AmbiguousCommitError, type Db, type Queryable } from "../db/db.ts";
import type { EventRow, Tick } from "../facts/types.ts";

export interface SpeechProjection {
  other_speech: string | null;
  speech_status: "available" | "expired" | "not_applicable";
}

const SWEEP_EVERY = 256;
export const DEFAULT_MAX_ENTRIES = 200_000;

interface Entry {
  text: string;
  expires: bigint | null;
}

export class SpeechStore {
  /** Insertion order = age (a re-put moves the entry to the end). */
  private readonly texts = new Map<string, Entry>();
  private readonly maxEntries: number;
  private readonly pending = new WeakMap<Queryable, { value: Map<string, Entry> | null; puts: number }>();
  private queue: Promise<void> = Promise.resolve();
  private dirty = false;
  private puts = 0;
  private writes = 0;

  constructor(maxEntries: number = DEFAULT_MAX_ENTRIES) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new Error("SpeechStore: maxEntries must be a positive integer");
    this.maxEntries = maxEntries;
  }

  get size(): number {
    return this.texts.size;
  }

  /** Serialize action projections with speech writes; restore the cache on rollback. */
  async transaction<T>(db: Db, fn: (q: Queryable) => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    const before: { value: Map<string, Entry> | null; puts: number } = { value: null, puts: this.puts };
    try {
      if (this.dirty) await this.reconcile(db);
      return await db.tx(async (q) => {
        this.pending.set(q, before);
        try {
          return await fn(q);
        } finally {
          this.pending.delete(q);
        }
      });
    } catch (err) {
      if (before.value !== null) {
        this.texts.clear();
        for (const [id, entry] of before.value) this.texts.set(id, entry);
        this.puts = before.puts;
      }
      if (err instanceof AmbiguousCommitError) this.dirty = true;
      throw err;
    } finally {
      release();
    }
  }

  private async reconcile(db: Db): Promise<void> {
    const world = await db.query<{ tick: string }>("SELECT tick FROM worlds LIMIT 1");
    if (world.rows[0] === undefined) throw new Error("SpeechStore: world missing");
    await this.restore(db, String(world.rows[0].tick));
    this.dirty = false;
  }

  /** Write alongside the event; the transaction gate protects uncommitted cache entries. */
  async persist(q: Queryable, eventId: string, text: string, expiresTick: Tick, nowTick: Tick): Promise<void> {
    const snapshot = this.pending.get(q);
    if (snapshot === undefined) throw new Error("SpeechStore: transaction not registered");
    await q.query("INSERT INTO speech_texts (event_id, text, expires_tick) VALUES ($1, $2, $3)", [eventId, text, expiresTick]);
    this.writes += 1;
    if (this.writes % SWEEP_EVERY === 0) {
      await q.query("DELETE FROM speech_texts WHERE expires_tick <= $1::bigint", [nowTick]);
    }
    if (snapshot.value === null) {
      snapshot.value = new Map(this.texts);
      snapshot.puts = this.puts;
    }
    this.put(eventId, text, expiresTick, nowTick);
  }

  /** Restore at most the newest maxEntries unexpired texts and delete expired rows. */
  async restore(q: Queryable, tick: Tick): Promise<void> {
    await q.query("DELETE FROM speech_texts WHERE expires_tick <= $1::bigint", [tick]);
    const result = await q.query<{ event_id: string; text: string; expires_tick: string }>(
      "SELECT s.event_id, s.text, s.expires_tick FROM speech_texts s JOIN events e ON e.id = s.event_id " +
      "WHERE s.expires_tick > $1::bigint ORDER BY e.cursor DESC LIMIT $2",
      [tick, this.maxEntries],
    );
    this.texts.clear();
    for (const row of result.rows.reverse()) this.put(row.event_id, row.text, String(row.expires_tick));
  }

  /** expiresTick null = no expiry; nowTick lets the store sweep expired texts now and then. */
  put(eventId: string, text: string, expiresTick: Tick | null, nowTick?: Tick): void {
    this.texts.delete(eventId);
    this.texts.set(eventId, { text, expires: expiresTick === null ? null : BigInt(expiresTick) });
    this.puts += 1;
    if (nowTick !== undefined && this.puts % SWEEP_EVERY === 0) this.sweep(nowTick);
    while (this.texts.size > this.maxEntries) {
      const oldest = this.texts.keys().next();
      if (oldest.done === true) break;
      this.texts.delete(oldest.value);
    }
  }

  project(e: EventRow, tick: Tick): SpeechProjection {
    if (e.type !== "speech") return { other_speech: null, speech_status: "not_applicable" };
    const hit = this.texts.get(e.id);
    if (hit === undefined || (hit.expires !== null && BigInt(tick) >= hit.expires)) {
      return { other_speech: null, speech_status: "expired" };
    }
    return { other_speech: hit.text, speech_status: "available" };
  }

  sweep(tick: Tick): void {
    const t = BigInt(tick);
    for (const [k, v] of this.texts) if (v.expires !== null && t >= v.expires) this.texts.delete(k);
  }
}
