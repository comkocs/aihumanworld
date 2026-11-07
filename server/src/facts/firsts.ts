// S62 region-first deeds (产品文档 §十八: 谁第一个过木人巷、谁第一个开门派、谁第一个跨区).
// Each is a world-visible deed keyed like the existing first_found / first_clear:
// uniqueness is the first_key column, so a second arrival finds it taken and
// writes nothing. No reward — these are chronicle entries, not bonuses.
//
//   first_gate      first non-npc of an origin region to defeat the tutorial
//                   opponent standing at that region's tutorial place
//   first_build     first non-npc build in the realm (there is no verb that
//                   founds an org, so the first player-built place stands in)
//   first_crossing  first non-npc of an origin region to arrive at another
//                   origin region's start place (the neutral market is not "他区")

import type { CharRow, ID, PlaceRow } from "./types.ts";
import type { Writer } from "./writer.ts";

/** A place marked `tutorial` in an origin region is that region's first gate. */
export function isTutorialPlace(place: PlaceRow): boolean {
  return place.region !== "neutral" && place.features.includes("tutorial");
}

/** An origin region's start place (`features` has `start`); the neutral market has neither. */
export function isOriginStart(place: PlaceRow): boolean {
  return place.region !== "neutral" && place.features.includes("start");
}

async function writeFirst(
  w: Writer,
  actor: ID,
  kind: "first_gate" | "first_build" | "first_crossing",
  key: string,
  verb: "attack" | "build" | "go",
  targets: ID[],
  placeId: ID,
): Promise<void> {
  if (await w.firstTaken(key)) return;
  const deed = await w.deed({
    actor,
    verb,
    kind,
    targets,
    place_id: placeId,
    result: { outcome: "success", changes: [], roll: null, proposal: null },
    visibility: "world",
    participants: [actor],
    first_key: key,
  });
  await w.emit({
    scope: "world",
    type: "discovered",
    deed_id: deed.id,
    data: { char_id: actor, target: targets[0] ?? placeId, first: true },
  });
}

/** The killer just dropped a tutorial opponent at its own tutorial place. */
export async function noteFirstGate(w: Writer, killer: CharRow, foe: CharRow, place: PlaceRow): Promise<void> {
  if (killer.kind === "npc" || foe.archetype !== "tutorial_opponent") return;
  if (!isTutorialPlace(place) || foe.loc !== place.id) return;
  await writeFirst(w, killer.id, "first_gate", `first_gate:${place.region}`, "attack", [foe.id, place.id], place.id);
}

/** The builder's first-ever player build in the realm (a place stands for the unbuilt "found an org"). */
export async function noteFirstBuild(w: Writer, builder: CharRow, builtId: ID, placeId: ID): Promise<void> {
  if (builder.kind === "npc") return;
  await writeFirst(w, builder.id, "first_build", "first_build:realm", "build", [builtId], placeId);
}

/** The mover just arrived at another origin region's start place. */
export async function noteFirstCrossing(w: Writer, mover: CharRow, dest: PlaceRow): Promise<void> {
  if (mover.kind === "npc" || mover.origin_region === dest.region) return;
  if (!isOriginStart(dest)) return;
  await writeFirst(w, mover.id, "first_crossing", `first_crossing:${mover.origin_region}`, "go", [dest.id], dest.id);
}
