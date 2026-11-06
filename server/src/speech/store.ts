// [S12 owns this file after S9] In-memory delivery of sanitised speech text
// (事实格式 §13): the fact store keeps only the speech event (who, to whom,
// when, channel); the text lives here until speech_ttl_ticks or restart, then
// projects as expired. Never persisted, never logged.
//
// Memory is bounded without any per-player limit: expired texts are swept every
// SWEEP_EVERY puts, and past `maxEntries` the oldest texts are dropped (they then
// project as expired, which is the documented price of not keeping a mailbox).

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
  private puts = 0;

  constructor(maxEntries: number = DEFAULT_MAX_ENTRIES) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new Error("SpeechStore: maxEntries must be a positive integer");
    this.maxEntries = maxEntries;
  }

  get size(): number {
    return this.texts.size;
  }

  /** expiresTick null = kept until restart; nowTick (when given) lets the store sweep expired texts now and then. */
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
