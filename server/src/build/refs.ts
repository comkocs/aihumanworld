// S12: build checks that need the database, run inside the build transaction
// (which already holds the world row lock, so check-then-insert cannot race):
// content key not taken, referenced facts exist, and for places the anchor /
// ownership / free-exit rules of 动词表 §4.15.

import type { Queryable } from "../db/db.ts";
import { getRow, physical } from "../facts/store.ts";
import type { CharRow, FactTable, ID, PlaceRow } from "../facts/types.ts";
import { NO_DETAILS, reject } from "../protocol/errors.ts";
import { invalid, type ItemData, type PlaceData, type TaskData } from "./check.ts";
import type { BuildLimits } from "./limits.ts";

const KEY_TAKEN: Readonly<Record<"place" | "item" | "task", string>> = {
  place: "SELECT 1 FROM places WHERE content_key = $1",
  item: "SELECT 1 FROM items WHERE record = 'definition' AND content_key = $1",
  task: "SELECT 1 FROM tasks WHERE record = 'template' AND content_key = $1",
};

/** DUPLICATE_KEY when the same realm / table already has this content_key. */
export async function ensureKeyFree(q: Queryable, table: "place" | "item" | "task", key: string): Promise<void> {
  const r = await q.query(KEY_TAKEN[table], [key]);
  if (r.rows.length > 0) reject("DUPLICATE_KEY", { table }, "args.data.content_key");
}

async function isMember(q: Queryable, charId: ID, orgId: ID): Promise<boolean> {
  const r = await q.query("SELECT 1 FROM bonds WHERE kind = 'member' AND state = 'active' AND a = $1 AND b = $2", [charId, orgId]);
  return r.rows.length > 0;
}

/** Number of the given ids present in the table (ids are already shape-checked). */
async function countPresent(q: Queryable, table: FactTable, ids: readonly ID[], extra = ""): Promise<number> {
  if (ids.length === 0) return 0;
  const r = await q.query<{ n: unknown }>(
    `SELECT count(*) AS n FROM ${physical(table)} WHERE id IN (SELECT jsonb_array_elements_text($1::jsonb))${extra}`,
    [JSON.stringify([...new Set(ids)])],
  );
  return Number(r.rows[0]?.n ?? 0);
}

async function requireAll(q: Queryable, table: FactTable, ids: readonly ID[], field: string, extra = ""): Promise<void> {
  if ((await countPresent(q, table, ids, extra)) !== new Set(ids).size) invalid("reference", field);
}

/** A template may only name content that is there for everyone: NPC / official chars, not players. */
async function requireContentChar(q: Queryable, id: ID, field: string): Promise<CharRow> {
  const c = await getRow(q, "char", id);
  if (c === null || c.kind === "player") return invalid("reference", field);
  return c;
}

/** Place build: the anchor is the builder's own place, it offers building, the exit is free. */
export async function checkAnchor(
  q: Queryable,
  me: CharRow,
  attach: { from: ID; dir: string },
  data: PlaceData,
): Promise<PlaceRow> {
  // NOT_HERE never reveals whether a far-away place exists.
  if (attach.from !== me.loc) return reject("NOT_HERE", NO_DETAILS, "args.attach.from");
  const from = await getRow(q, "place", attach.from);
  if (from === null) throw new Error(`fact integrity: place ${attach.from} missing`);
  if (!from.features.includes("build_anchor")) return reject("NOT_ALLOWED", { reason: "service" });
  if (from.owner_org !== null && !(await isMember(q, me.id, from.owner_org))) {
    return reject("NOT_ALLOWED", { reason: "ownership" });
  }
  if (data.owner_org !== null) {
    if ((await getRow(q, "org", data.owner_org)) === null) return invalid("reference", "args.data.owner_org");
    if (!(await isMember(q, me.id, data.owner_org))) return reject("NOT_ALLOWED", { reason: "ownership" });
  }
  if (from.exits.some((e) => e.dir === attach.dir)) return invalid("reference", "args.attach.dir");
  return from;
}

export async function checkItemRefs(q: Queryable, d: ItemData): Promise<void> {
  const e = d.effect;
  if (e.kind === "learn") {
    const r = await q.query("SELECT 1 FROM skills WHERE record = 'definition' AND key = $1", [e.skill]);
    if (r.rows.length === 0) invalid("reference", "args.data.effect.skill");
  }
  if (e.kind === "map") await requireAll(q, "place", e.places, "args.data.effect.places");
}

export async function checkTaskRefs(q: Queryable, d: TaskData, limits: BuildLimits): Promise<void> {
  const c = d.condition;
  const at = "args.data.condition";
  switch (c.tpl) {
    case "deliver":
      await requireAll(q, "item", [c.item_def], `${at}.item_def`, " AND record = 'definition'");
      await requireAll(q, "place", [c.to_place], `${at}.to_place`);
      if (c.to_char !== null) await requireContentChar(q, c.to_char, `${at}.to_char`);
      break;
    case "find":
      await requireContentChar(q, c.target, `${at}.target`);
      break;
    case "slay":
      if (c.target !== null) {
        const t = await requireContentChar(q, c.target, `${at}.target`);
        // 事实格式 §9.1: the tier must match the target.
        if (t.tier !== c.tier) invalid("tier", `${at}.tier`);
      }
      break;
    case "gather":
      await requireAll(q, "item", [c.item_def], `${at}.item_def`, " AND record = 'definition'");
      await requireAll(q, "place", [c.to_place], `${at}.to_place`);
      break;
    case "reach":
      if (c.mode === "place") await requireAll(q, "place", [c.place], `${at}.place`);
      break;
  }

  // Reward items: existing definitions, no higher than the template's tier, at most the S5 grade.
  const defs = d.reward_spec.item_defs;
  await requireAll(q, "item", defs, "args.data.reward_spec.item_defs", " AND record = 'definition'");
  if (defs.length > 0) {
    const r = await q.query<{ tier: unknown; grade: unknown }>(
      "SELECT tier, grade FROM items WHERE record = 'definition' AND id IN (SELECT jsonb_array_elements_text($1::jsonb))",
      [JSON.stringify([...new Set(defs)])],
    );
    for (const row of r.rows) {
      if (Number(row.tier) > d.tier || Number(row.grade) > limits.itemGradeMax) {
        invalid("tier", "args.data.reward_spec.item_defs");
      }
    }
  }
}
