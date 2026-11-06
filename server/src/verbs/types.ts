// Verb definition contract. One file per verb under src/verbs/; the owner of a
// verb fills `handler` in that file only. The runner (runner.ts) does envelope
// parsing, authentication, presence gates, AP spending, the transaction and the
// response envelope, so handlers contain game logic only.

import type { Queryable } from "../db/db.ts";
import type { ApCostKey, Door, Verb } from "../facts/enums.ts";
import type { CharRow, Tick, WorldRow, WorldRules } from "../facts/types.ts";
import type { Writer } from "../facts/writer.ts";
import type { Balance } from "../growth/balance.ts";
import type { V } from "../protocol/validate.ts";
import type { SpeechStore } from "../speech/store.ts";

export interface Services {
  speech: SpeechStore;
  balance(): Balance;
}

export interface VerbContext {
  q: Queryable;
  w: Writer;
  /** World row read at transaction start (locked when def.lock = "world"). */
  world: WorldRow;
  rules: WorldRules;
  balance: Balance;
  tick: Tick;
  now: Date;
  /** Entry shell of this request: api (HTTP JSON) or web (S13 form). */
  door: Door;
  /** Authenticated char (budget already spent); enter create sets it. */
  actor: CharRow | null;
  services: Services;
}

/**
 * Presence gate before the handler:
 *   none     any population state (events / whoami)
 *   in_world draft / active, dead allowed (look)
 *   acting   draft / active and alive (every paid action; default when cost > 0)
 */
export type Gate = "none" | "in_world" | "acting";

export interface VerbDef<A, R> {
  verb: Verb;
  args: V<A>;
  /** "world" locks the world row (required to write deeds / events). */
  lock: "world" | "read";
  /** Does this call need `Authorization: Bearer`? (false only for enter create) */
  auth(a: A): boolean;
  costKey(a: A): ApCostKey;
  gate?(a: A): Gate;
  /** Absent → NOT_IMPLEMENTED (after auth, before gates; no AP spent). */
  handler?(ctx: VerbContext, a: A): Promise<R>;
}

export function defineVerb<A, R>(d: VerbDef<A, R>): VerbDef<A, R> {
  return d;
}

export type AnyVerbDef = VerbDef<any, unknown>;
