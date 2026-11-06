// Public projections (事实格式 §12). identity rows never leave the server.

import { PUBLIC_CHAR_FIELDS, type CharRow, type OrgRow, type PublicChar, type WorldRow } from "./types.ts";

export function publicChar(c: CharRow): PublicChar {
  const out: Record<string, unknown> = {};
  for (const f of PUBLIC_CHAR_FIELDS) out[f] = c[f];
  return out as unknown as PublicChar;
}

/** Org as seen by place / world audiences: goal without the member snapshot. */
export function publicOrg(o: OrgRow): OrgRow {
  return { ...o, goal: { ...o.goal, member_ids: [] } };
}

/** World values a client needs (tick, budget, revision, paging / text limits). */
export interface WorldClientView {
  id: string;
  tick: string;
  tick_started_at: string;
  rules_revision: string;
  tick_seconds: number | null;
  ap_per_tick: number | null;
  ap_costs: WorldRow["rules"]["ap_costs"];
  page_size: number | null;
  text_max_chars: number | null;
  day_index: number;
  week_index: number;
}

export function worldClientView(w: WorldRow): WorldClientView {
  return {
    id: w.id,
    tick: w.tick,
    tick_started_at: w.tick_started_at,
    rules_revision: w.rules_revision,
    tick_seconds: w.rules.tick_seconds,
    ap_per_tick: w.rules.ap_per_tick,
    ap_costs: w.rules.ap_costs,
    page_size: w.rules.page_size,
    text_max_chars: w.rules.text_max_chars,
    day_index: w.day_index,
    week_index: w.week_index,
  };
}
