// whoami — the caller's own state (动词表 §4.4). Implemented by S9.
// Changes nothing but the access stamp (done by the runner). derived comes from
// the neutral balance (S10); missing numbers answer RULES_UNSET.

import { pageRows, resolveLimit } from "../facts/paging.ts";
import { countRows } from "../facts/store.ts";
import type { CharRow, FactTable, ID, Seq, Stats } from "../facts/types.ts";
import { deriveStats } from "../growth/balance.ts";
import { neutralFacts } from "../growth/facts.ts";
import { PAGE_DEFAULT, limit, page } from "../protocol/shapes.ts";
import { obj, oneOf, opt, type Out } from "../protocol/validate.ts";
import { nextBreakthrough, type NextBreakthrough } from "./breakthrough.ts";
import { defineVerb } from "./types.ts";

const SECTIONS = ["char", "items", "skills", "bonds", "tasks", "reputation", "wanted"] as const;
type Section = (typeof SECTIONS)[number];
type ListSection = Exclude<Section, "char">;

const args = obj({
  section: opt(oneOf(SECTIONS, "whoami section"), "char"),
  page: opt(page, PAGE_DEFAULT),
  limit,
});
export type WhoamiArgs = Out<typeof args>;

export interface WhoamiResult {
  char: CharRow;
  /** Present only for section=char: whether a breakthrough would clear stage/tier/xp/training right now. */
  next_breakthrough?: NextBreakthrough;
  derived: Stats;
  section: Section;
  rows: unknown[];
  page: { after: ID | null; through: Seq };
  has_more: boolean;
  snapshot_changed: boolean;
  counts: Record<ListSection, number>;
}

const QUERIES: Readonly<Record<ListSection, { table: FactTable; where: string }>> = {
  items: { table: "item", where: "record = 'instance' AND holder ->> 'kind' = 'char' AND holder ->> 'id' = $1" },
  skills: { table: "skill", where: "record = 'learned' AND char_id = $1" },
  bonds: { table: "bond", where: "state = 'active' AND (a = $1 OR b = $1)" },
  tasks: {
    table: "task",
    where:
      "record = 'instance' AND state IN ('open', 'accepted') AND (taker = $1 OR (issuer ->> 'kind' = 'char' AND issuer ->> 'id' = $1))",
  },
  reputation: { table: "reputation", where: "char_id = $1" },
  wanted: { table: "wanted", where: "char_id = $1" },
};

export const def = defineVerb<WhoamiArgs, WhoamiResult>({
  verb: "whoami",
  summary: "查看自己的角色、背包、技能、关系、任务、声望或悬赏。",
  errors: ["INVALID_CURSOR"],
  args,
  lock: "read",
  auth: () => true,
  costKey: () => "whoami",
  gate: () => "none",
  async handler(ctx, a) {
    const me = ctx.actor;
    if (me === null) throw new Error("whoami without actor");
    // Skills and equipped items (with cores) count, exactly as in combat inputs.
    const facts = await neutralFacts(ctx.q, me);
    const derived = deriveStats(ctx.balance, me, facts);
    const counts = {} as Record<ListSection, number>;
    for (const s of Object.keys(QUERIES) as ListSection[]) {
      counts[s] = await countRows(ctx.q, QUERIES[s].table, QUERIES[s].where, [me.id]);
    }
    if (a.section === "char") {
      return {
        char: me,
        next_breakthrough: nextBreakthrough(ctx.balance, me, facts),
        derived,
        section: "char",
        rows: [],
        page: { after: null, through: ctx.world.deed_head },
        has_more: false,
        snapshot_changed: false,
        counts,
      };
    }
    const q = QUERIES[a.section];
    const lim = resolveLimit(a.limit, ctx.rules);
    const p = await pageRows(ctx.q, q.table, q.where, [me.id], a.page, lim, ctx.world.deed_head);
    return {
      char: me,
      derived,
      section: a.section,
      rows: p.rows,
      page: p.page,
      has_more: p.has_more,
      snapshot_changed: p.snapshot_changed,
      counts,
    };
  },
});
