// S78: stance between two organizations. Unlisted pairs, and any pair a
// player-founded org is in, read as neutral. One row per unordered pair.

import type { Queryable } from "../db/db.ts";
import { selectRows } from "../facts/store.ts";
import type { ID } from "../facts/types.ts";

export type OrgStance = "ally" | "enemy" | "neutral";

/** Byte order, so the stored pair is unique whichever side asks. */
export function pairOrder(x: ID, y: ID): [ID, ID] {
  return x < y ? [x, y] : [y, x];
}

export async function orgStance(q: Queryable, x: ID, y: ID): Promise<OrgStance> {
  if (x === y) return "neutral";
  const [a, b] = pairOrder(x, y);
  const r = await q.query<{ stance: string }>("SELECT stance FROM s78_org_relations WHERE a = $1 AND b = $2", [a, b]);
  const stance = r.rows[0]?.stance;
  return stance === "ally" || stance === "enemy" ? stance : "neutral";
}

export interface OrgStanceList {
  allies: ID[];
  enemies: ID[];
}

/** Every org this one is allied or at odds with, each list in id order. */
export async function orgStances(q: Queryable, org: ID): Promise<OrgStanceList> {
  const r = await q.query<{ a: ID; b: ID; stance: string }>(
    "SELECT a, b, stance FROM s78_org_relations WHERE a = $1 OR b = $1 ORDER BY a, b",
    [org],
  );
  const allies: ID[] = [];
  const enemies: ID[] = [];
  for (const row of r.rows) {
    const other = row.a === org ? row.b : row.a;
    if (row.stance === "ally") allies.push(other);
    else if (row.stance === "enemy") enemies.push(other);
  }
  return { allies, enemies };
}

/** The org a char belongs to, or null when it has no active membership. */
export async function memberOrg(q: Queryable, charId: ID): Promise<ID | null> {
  const rows = await selectRows(q, "bond", "kind = 'member' AND state = 'active' AND a = $1", [charId]);
  return rows[0]?.b ?? null;
}
