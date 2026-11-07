// look — current place and its public facts (动词表 §4.2). Implemented by S9.
// Sections other than "place" are ID-ordered pages; deeds only those the caller
// may see (place / world, or self where the caller participated).

import type { Queryable } from "../db/db.ts";
import { pageRows, resolveLimit } from "../facts/paging.ts";
import { publicChar } from "../facts/project.ts";
import { countRows, mustGetRow, selectRows } from "../facts/store.ts";
import type { Change, CharRow, FactTable, ID, PlaceRow, PublicChar, Seq } from "../facts/types.ts";
import { PAGE_DEFAULT, limit, page } from "../protocol/shapes.ts";
import { obj, oneOf, opt, type Out } from "../protocol/validate.ts";
import { merged } from "../tasks/common.ts";
import { recordPresenceEvidence } from "../tasks/hooks.ts";
import { defineVerb, type VerbContext } from "./types.ts";

const SECTIONS = ["place", "people", "items", "tasks", "deeds"] as const;
type Section = (typeof SECTIONS)[number];

const args = obj({
  section: opt(oneOf(SECTIONS, "look section"), "place"),
  page: opt(page, PAGE_DEFAULT),
  limit,
});
export type LookArgs = Out<typeof args>;

export type LookExit = PlaceRow["exits"][number] & Partial<Pick<PlaceRow, "tier" | "danger" | "region">>;
export type LookPlace = Omit<PlaceRow, "exits"> & { exits: LookExit[]; npc_attackable?: false };

/** Display participant combat rules without changing the stored NPC restriction. */
export function lookPlace(place: PlaceRow): LookPlace {
  return {
    ...place,
    combat: place.combat === "duel" ? "duel" : "pk",
    danger: place.danger === "safe" ? "low" : place.danger,
    ...(place.combat === "safe" ? { npc_attackable: false as const } : {}),
  };
}

export async function lookExits(q: Queryable, place: PlaceRow): Promise<LookExit[]> {
  const ids = [...new Set(place.exits.map((exit) => exit.to))];
  if (ids.length === 0) return [];
  const marks = ids.map((_, i) => `$${i + 1}`).join(", ");
  const destinations = new Map((await selectRows(q, "place", `id IN (${marks})`, ids)).map((p) => [p.id, p]));
  return place.exits.map((exit) => {
    const target = destinations.get(exit.to);
    if (target === undefined) return { ...exit };
    const shown = lookPlace(target);
    return { ...exit, tier: shown.tier, danger: shown.danger, region: shown.region };
  });
}

export interface LookResult {
  place: LookPlace;
  section: Section;
  rows: unknown[];
  page: { after: ID | null; through: Seq };
  has_more: boolean;
  snapshot_changed: boolean;
  counts: { people: number; items: number; tasks: number; deeds: number };
}

interface SectionQuery {
  table: FactTable;
  where: string;
  params: unknown[];
  seqColumn: string | null;
}

function sectionQuery(s: Exclude<Section, "place">, placeId: ID, me: ID): SectionQuery {
  switch (s) {
    case "people":
      return { table: "char", where: "loc = $1 AND state <> 'buried'", params: [placeId], seqColumn: null };
    case "items":
      return {
        table: "item",
        where: "record = 'instance' AND holder ->> 'kind' = 'place' AND holder ->> 'id' = $1 AND state = 'available'",
        params: [placeId],
        seqColumn: null,
      };
    case "tasks":
      return {
        table: "task",
        where: "record = 'instance' AND offer_place = $1 AND state = 'open' AND (eligible_char IS NULL OR eligible_char = $2)",
        params: [placeId, me],
        seqColumn: null,
      };
    case "deeds":
      return {
        table: "deed",
        where: "place_id = $1 AND (visibility IN ('place', 'world') OR (visibility = 'self' AND participants @> $2::jsonb))",
        params: [placeId, JSON.stringify([me])],
        seqColumn: "seq",
      };
  }
}

/** First sight updates known_places; arrival alone awards first discovery. */
async function discover(ctx: VerbContext, place: PlaceRow): Promise<void> {
  const me = ctx.actor;
  if (me === null || me.known_places.includes(place.id)) return;
  const known = [...me.known_places, place.id];
  const change = (await ctx.w.update("char", me.id, { known_places: known })) as Change;
  const cur = merged(me, { known_places: known }, ctx.tick);
  const changes = [change];
  const d = await ctx.w.deed({
    actor: me.id,
    verb: "look",
    kind: "discover",
    targets: [place.id],
    place_id: place.id,
    result: { outcome: "success", changes, roll: null, proposal: null },
    visibility: "self",
    participants: [me.id],
  });
  await ctx.w.emit({
    scope: "self",
    recipients: [me.id],
    type: "discovered",
    deed_id: d.id,
    data: { char_id: me.id, target: place.id, first: false },
  });
  ctx.actor = cur;
}

export const def = defineVerb<LookArgs, LookResult>({
  verb: "look",
  summary: "查看当前地点、在场人物、地面物、任务或事迹。",
  errors: ["INVALID_CURSOR"],
  args,
  lock: "world",
  auth: () => true,
  costKey: () => "look",
  gate: () => "in_world",
  async handler(ctx, a) {
    const me = ctx.actor;
    if (me === null) throw new Error("look without actor");
    const place = await mustGetRow(ctx.q, "place", me.loc);
    const shownPlace = { ...lookPlace(place), exits: await lookExits(ctx.q, place) };
    await discover(ctx, place);
    await recordPresenceEvidence(ctx, ctx.actor ?? me, place);
    // deed_head after any deed this look wrote.
    const deedHead = (await mustGetRow(ctx.q, "world", ctx.world.id)).deed_head;

    const counts = { people: 0, items: 0, tasks: 0, deeds: 0 };
    for (const s of ["people", "items", "tasks", "deeds"] as const) {
      const sq = sectionQuery(s, place.id, me.id);
      counts[s] = await countRows(ctx.q, sq.table, sq.where, sq.params);
    }

    if (a.section === "place") {
      return {
        place: shownPlace,
        section: "place",
        rows: [],
        page: { after: null, through: deedHead },
        has_more: false,
        snapshot_changed: false,
        counts,
      };
    }
    const sq = sectionQuery(a.section, place.id, me.id);
    const lim = resolveLimit(a.limit, ctx.rules);
    const p = await pageRows(ctx.q, sq.table, sq.where, sq.params, a.page, lim, deedHead, sq.seqColumn);
    const rows: unknown[] = a.section === "people" ? (p.rows as CharRow[]).map((c): PublicChar => publicChar(c)) : p.rows;
    return { place: shownPlace, section: a.section, rows, page: p.page, has_more: p.has_more, snapshot_changed: p.snapshot_changed, counts };
  },
});
