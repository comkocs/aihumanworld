// events — three-layer incremental pull (动词表 §4.3, 事实格式 §11.1).
// Implemented by S9. Layers keep independent read positions held by the client;
// the server stores no read state and no session. One consistent high-water
// mark `through = world.event_head` bounds the page and all three counts.

import type { DbRow, Queryable } from "../db/db.ts";
import type { EventScope } from "../facts/enums.ts";
import { resolveLimit } from "../facts/paging.ts";
import { decodeRow } from "../facts/tables.ts";
import type { EventRow, ID, Seq } from "../facts/types.ts";
import { NO_DETAILS, reject } from "../protocol/errors.ts";
import { limit, placeId } from "../protocol/shapes.ts";
import { bad, described, isCanonicalSeq, obj, oneOf, opt, schemaOf, seq, type Out, type V } from "../protocol/validate.ts";
import type { SpeechProjection } from "../speech/store.ts";
import { defineVerb } from "./types.ts";

/** Wrong JSON type → INVALID_ARGUMENT; non-canonical number string → INVALID_CURSOR. */
const cursor: V<Seq> = described((x, p) => {
  if (typeof x !== "string") return bad(p, "decimal integer string");
  return isCanonicalSeq(x) ? x : reject("INVALID_CURSOR", NO_DETAILS, p);
}, schemaOf(seq));

const args = obj({
  scope: opt(oneOf(["self", "place", "world"] as const, "event scope"), "self"),
  cursors: opt(
    obj({
      self: opt(cursor, "0"),
      place: opt(obj({ place_id: placeId, after: cursor }), undefined),
      world: opt(cursor, "0"),
    }),
    undefined,
  ),
  limit,
});
export type EventsArgs = Out<typeof args>;

export interface Cursors {
  self: Seq;
  place: { place_id: ID; after: Seq };
  world: Seq;
}

export type ProjectedEvent = EventRow & SpeechProjection;

export interface EventsResult {
  scope: EventScope;
  events: ProjectedEvent[];
  through: Seq;
  next_cursor: Seq;
  cursors: Cursors;
  counts: { self: number; place: number; world: number };
  remaining: number;
  has_more: boolean;
  place_reset: boolean;
}

/** SQL for one layer: FROM/WHERE over events `e`; its params follow $1 = after, $2 = through. */
function layer(scope: EventScope, me: ID, place: ID): { from: string; where: string; params: unknown[] } {
  switch (scope) {
    case "self":
      return {
        from: "event_inbox i JOIN events e ON e.cursor = i.cursor",
        where: "i.char_id = $3",
        params: [me],
      };
    case "place":
      return { from: "events e", where: "e.scope = 'place' AND e.place_id = $3", params: [place] };
    case "world":
      return { from: "events e", where: "e.scope = 'world'", params: [] };
  }
}

async function countLayer(q: Queryable, scope: EventScope, me: ID, place: ID, after: Seq, through: Seq): Promise<number> {
  const l = layer(scope, me, place);
  const r = await q.query<{ n: unknown }>(
    `SELECT count(*) AS n FROM ${l.from} WHERE e.cursor > $1 AND e.cursor <= $2 AND ${l.where}`,
    [after, through, ...l.params],
  );
  return Number(r.rows[0]?.n ?? 0);
}

async function pageLayer(
  q: Queryable,
  scope: EventScope,
  me: ID,
  place: ID,
  after: Seq,
  through: Seq,
  lim: number,
): Promise<EventRow[]> {
  const l = layer(scope, me, place);
  const r = await q.query<DbRow>(
    `SELECT e.* FROM ${l.from} WHERE e.cursor > $1 AND e.cursor <= $2 AND ${l.where} ORDER BY e.cursor LIMIT $${3 + l.params.length}`,
    [after, through, ...l.params, lim],
  );
  return r.rows.map((row) => decodeRow("event", row));
}

export const def = defineVerb<EventsArgs, EventsResult>({
  verb: "events",
  summary: "按独立游标增量读取自身、地点或世界事件。",
  errors: ["INVALID_CURSOR", "CURSOR_CONTEXT", "CURSOR_EXPIRED"],
  args,
  lock: "read",
  auth: () => true,
  costKey: () => "events",
  gate: () => "none",
  async handler(ctx, a) {
    const me = ctx.actor;
    if (me === null) throw new Error("events without actor");
    const through = ctx.world.event_head;
    const head = BigInt(through);
    const req = a.cursors;
    const selfAfter = req?.self ?? "0";
    const worldAfter = req?.world ?? "0";
    const reqPlace = req?.place;
    if (BigInt(selfAfter) > head) reject("INVALID_CURSOR", NO_DETAILS, "args.cursors.self");
    if (BigInt(worldAfter) > head) reject("INVALID_CURSOR", NO_DETAILS, "args.cursors.world");
    if (reqPlace !== undefined && BigInt(reqPlace.after) > head) {
      reject("INVALID_CURSOR", NO_DETAILS, "args.cursors.place.after");
    }

    const placeReset = reqPlace !== undefined && reqPlace.place_id !== me.loc;
    if (placeReset && a.scope === "place") {
      reject("CURSOR_CONTEXT", { place_id: me.loc, resume_cursor: "0" }, "args.cursors.place.place_id");
    }
    const placeCur = reqPlace === undefined || placeReset ? { place_id: me.loc, after: "0" } : reqPlace;
    const cursors: Cursors = { self: selfAfter, place: placeCur, world: worldAfter };
    const afterOf = (s: EventScope): Seq => (s === "self" ? selfAfter : s === "world" ? worldAfter : placeCur.after);

    const counts = {
      self: await countLayer(ctx.q, "self", me.id, me.loc, selfAfter, through),
      place: await countLayer(ctx.q, "place", me.id, me.loc, placeCur.after, through),
      world: await countLayer(ctx.q, "world", me.id, me.loc, worldAfter, through),
    };
    const lim = resolveLimit(a.limit, ctx.rules);
    const rows = await pageLayer(ctx.q, a.scope, me.id, me.loc, afterOf(a.scope), through, lim);
    const total = counts[a.scope];
    const has_more = total > rows.length;
    const last = rows[rows.length - 1];
    const next_cursor = has_more && last !== undefined ? last.cursor : through;
    const updated: Cursors =
      a.scope === "self"
        ? { ...cursors, self: next_cursor }
        : a.scope === "world"
          ? { ...cursors, world: next_cursor }
          : { ...cursors, place: { place_id: placeCur.place_id, after: next_cursor } };

    return {
      scope: a.scope,
      events: rows.map((e) => ({ ...e, ...ctx.services.speech.project(e, ctx.tick) })),
      through,
      next_cursor,
      cursors: updated,
      counts,
      remaining: total - rows.length,
      has_more,
      place_reset: placeReset,
    };
  },
});
