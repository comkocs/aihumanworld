// Logical-table descriptors and the row codec (DB row ↔ fact row).
// Column names equal protocol field names; physical table names are plural.
// Discriminated tables (item / skill / task) list the exact field set of each
// branch, so a decoded row never carries fields of the other branch.

import type { FactTable, RowMap } from "./types.ts";

export type ColKind = "text" | "num" | "seq" | "bool" | "time" | "json";

export interface TableDesc {
  readonly physical: string;
  readonly cols: Readonly<Record<string, ColKind>>;
  /** Field order per branch (discriminated tables) or a single "*" branch. */
  readonly branches: Readonly<Record<string, readonly string[]>>;
  readonly discriminator: string | null;
  /** deed / event rows are never updated. */
  readonly appendOnly: boolean;
  /** Tables with updated_tick. */
  readonly touched: boolean;
}

const common = { id: "text", created_tick: "seq", updated_tick: "seq" } as const;
const COMMON = ["id", "created_tick", "updated_tick"] as const;

function plain(physical: string, cols: Record<string, ColKind>, touched = true): TableDesc {
  return {
    physical,
    cols,
    branches: { "*": Object.keys(cols) },
    discriminator: null,
    appendOnly: !touched,
    touched,
  };
}

function split(
  physical: string,
  discriminator: string,
  cols: Record<string, ColKind>,
  branches: Record<string, readonly string[]>,
): TableDesc {
  const full: Record<string, readonly string[]> = {};
  for (const [b, fields] of Object.entries(branches)) full[b] = [...COMMON, discriminator, ...fields];
  return { physical, cols, branches: full, discriminator, appendOnly: false, touched: true };
}

export const TABLES: Readonly<Record<FactTable, TableDesc>> = {
  world: plain("worlds", {
    ...common,
    realm: "text",
    tick: "seq",
    event_head: "seq",
    deed_head: "seq",
    tick_started_at: "time",
    rules_revision: "text",
    rules: "json",
    spawn_places: "json",
    registry_orgs: "json",
    day_index: "num",
    week_index: "num",
  }),
  identity: plain("identities", { ...common, char_id: "text", code_hash: "text", expires_tick: "seq" }),
  place: plain("places", {
    ...common,
    content_key: "text",
    region: "text",
    kind: "text",
    features: "json",
    tier: "num",
    danger: "text",
    combat: "text",
    exits: "json",
    owner_org: "text",
    by: "text",
    note: "text",
  }),
  item: split(
    "items",
    "record",
    {
      ...common,
      record: "text",
      content_key: "text",
      kind: "text",
      tier: "num",
      grade: "num",
      element: "text",
      slots: "num",
      cap: "num",
      dura_max: "num",
      modifiers: "json",
      effect: "json",
      by: "text",
      note: "text",
      def_id: "text",
      holder: "json",
      state: "text",
      equipped: "bool",
      dura: "num",
      sockets: "json",
    },
    {
      definition: [
        "content_key",
        "kind",
        "tier",
        "grade",
        "element",
        "slots",
        "cap",
        "dura_max",
        "modifiers",
        "effect",
        "by",
        "note",
      ],
      instance: ["def_id", "holder", "state", "equipped", "dura", "sockets", "note"],
    },
  ),
  char: plain("chars", {
    ...common,
    kind: "text",
    door: "text",
    handle: "text",
    email_hash: "text",
    model: "text",
    skin: "text",
    class: "text",
    origin_region: "text",
    body: "text",
    archetype: "text",
    tier: "num",
    stage: "num",
    xp: "num",
    potential: "num",
    vigor: "num",
    coin: "num",
    cycles: "num",
    legacy: "num",
    loc: "text",
    respawn_place: "text",
    life: "text",
    revive_tick: "seq",
    state: "text",
    state_since: "seq",
    last_seen_tick: "seq",
    last_yield_tick: "seq",
    ap_tick: "seq",
    seen_at: "time",
    ap_spent: "num",
    train_skill: "text",
    day_index: "num",
    system_tasks_today: "num",
    known_places: "json",
    patrol_route: "json",
    patrol_index: "num",
  }),
  skill: split(
    "skills",
    "record",
    {
      ...common,
      record: "text",
      key: "text",
      base: "text",
      org_id: "text",
      tier: "num",
      char_id: "text",
      def_id: "text",
      level: "num",
      cap: "num",
    },
    { definition: ["key", "base", "org_id", "tier"], learned: ["char_id", "def_id", "level", "cap"] },
  ),
  bond: plain("bonds", {
    ...common,
    kind: "text",
    a: "text",
    b: "text",
    state: "text",
    weight: "num",
    rank: "num",
    since_tick: "seq",
    ended_tick: "seq",
  }),
  org: plain("orgs", {
    ...common,
    content_key: "text",
    region: "text",
    hall: "text",
    registry: "bool",
    ranks: "json",
    skill_defs: "json",
    treasury: "num",
    goal: "json",
  }),
  reputation: plain("reputations", {
    ...common,
    char_id: "text",
    scope: "text",
    org_id: "text",
    value: "num",
  }),
  wanted: plain("wanted", {
    ...common,
    char_id: "text",
    region: "text",
    reason: "text",
    until_tick: "seq",
    state: "text",
    bounty_task: "text",
  }),
  task: split(
    "tasks",
    "record",
    {
      ...common,
      record: "text",
      content_key: "text",
      tpl: "text",
      tier: "num",
      stage: "num",
      condition: "json",
      reward_spec: "json",
      duration_ticks: "num",
      by: "text",
      template_id: "text",
      kind: "text",
      issuer: "json",
      offer_place: "text",
      eligible_char: "text",
      issuer_tier: "num",
      taker: "text",
      reward: "json",
      escrow: "json",
      state: "text",
      accepted_seq: "seq",
      progress: "json",
      expires_tick: "seq",
      note: "text",
    },
    {
      template: ["content_key", "tpl", "tier", "stage", "condition", "reward_spec", "duration_ticks", "by", "note"],
      instance: [
        "template_id",
        "kind",
        "tpl",
        "issuer",
        "offer_place",
        "eligible_char",
        "issuer_tier",
        "taker",
        "condition",
        "reward",
        "escrow",
        "state",
        "accepted_seq",
        "progress",
        "expires_tick",
        "note",
      ],
    },
  ),
  deed: plain(
    "deeds",
    {
      id: "text",
      seq: "seq",
      tick: "seq",
      actor: "text",
      verb: "text",
      kind: "text",
      targets: "json",
      place_id: "text",
      result: "json",
      visibility: "text",
      participants: "json",
      rules_revision: "text",
    },
    false,
  ),
  event: plain(
    "events",
    {
      id: "text",
      cursor: "seq",
      tick: "seq",
      scope: "text",
      recipients: "json",
      place_id: "text",
      type: "text",
      deed_id: "text",
      data: "json",
    },
    false,
  ),
};

function formatTime(v: unknown): string {
  const d = v instanceof Date ? v : new Date(String(v));
  return d.toISOString().replace(".000Z", "Z");
}

function decodeValue(kind: ColKind, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  switch (kind) {
    case "text":
      return String(v);
    case "num":
      return typeof v === "number" ? v : Number(v);
    case "seq":
      return typeof v === "string" ? v : String(v);
    case "bool":
      return v === true || v === "t" || v === "true";
    case "time":
      return formatTime(v);
    case "json":
      return typeof v === "string" ? (JSON.parse(v) as unknown) : v;
  }
}

/** Branch field list for a row (discriminator value) or the single branch. */
export function fieldsOf(desc: TableDesc, discValue: unknown): readonly string[] {
  if (desc.discriminator === null) return desc.branches["*"] as readonly string[];
  const f = desc.branches[String(discValue)];
  if (f === undefined) throw new Error(`unknown ${desc.physical}.${desc.discriminator}: ${String(discValue)}`);
  return f;
}

export function decodeRow<T extends FactTable>(table: T, row: Record<string, unknown>): RowMap[T] {
  const desc = TABLES[table];
  const fields = fieldsOf(desc, desc.discriminator === null ? null : row[desc.discriminator]);
  const out: Record<string, unknown> = {};
  for (const f of fields) out[f] = decodeValue(desc.cols[f] as ColKind, row[f]);
  // Existing content and seed inserts omit this nullable, player-only column.
  if (table === "org" && row.player_name != null) out.player_name = String(row.player_name);
  return out as unknown as RowMap[T];
}

/** SQL parameter for a field value plus the placeholder cast. */
export function encodeValue(kind: ColKind, v: unknown): { value: unknown; cast: string } {
  if (kind === "json") return { value: v === null || v === undefined ? null : JSON.stringify(v), cast: "::jsonb" };
  if (v === null || v === undefined) return { value: null, cast: "" };
  if (kind === "seq") return { value: String(v), cast: "" };
  if (kind === "time") return { value: String(v), cast: "::timestamptz" };
  return { value: v, cast: "" };
}
