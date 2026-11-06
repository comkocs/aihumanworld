// [S24] Hooks other verbs call into the task system.

import type { CharRow, Change, PlaceRow } from "../facts/types.ts";
import type { VerbContext } from "../verbs/types.ts";
import { presenceEvidence } from "./evidence.ts";
import { supplyFor } from "./supply.ts";

/** enter create: initial system task supply of a new char (事实格式 §9 「system 每角色保持可接实例供给」). */
export async function supplyInitialTasks(ctx: VerbContext, char: CharRow): Promise<Change[]> {
  return supplyFor(ctx, char, char.loc);
}

/** look / go: find & reach evidence for accepted tasks at the current place (deduplicated). */
export async function recordPresenceEvidence(
  ctx: VerbContext,
  char: CharRow,
  place: PlaceRow,
  verb: "look" | "go" = "look",
): Promise<Change[]> {
  return presenceEvidence(ctx, char, place, verb);
}
