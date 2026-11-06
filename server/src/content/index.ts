// S16a: boot-time world content import (产品文档 §17 G — facts only, no prose).
// Reads every content/world/*.json after the seed, one transaction per file:
// each entry goes through the S12 build validator (shape / in-tier numbers /
// unique content key) and the reference checks, then in through the Writer.
// Idempotent per content key (and per char id / link direction): what is
// already in the library is skipped, never overwritten. One bad entry rolls
// the whole file back and the error names the file, section and local key.
// NPC / org / skill facts are import-only (事实格式 §1): char entries are
// shape-checked here and their neutral numbers (vigor, coin pool, master
// skills) are derived from the same S5 bundle the clock uses, so the data
// files carry no hand-written numbers for them. Orgs (事实格式 §8.1) get their
// goal numbers from S5 too; org skill definitions (§7.1, key
// `org:<org_id>:<local>`, translated as 标签词表 §8.1
// `skill.org·skill.<base>·content.<realm>.<org_local>.<skill_local>`) carry
// only base and tier: levels and caps follow the same four-base S5 rules.

import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkContentKey, checkItem, checkPlace, checkTask, CONTENT_LOCAL_MAX, type CheckEnv } from "../build/check.ts";
import { buildLimits } from "../build/limits.ts";
import { checkItemRefs, checkTaskRefs } from "../build/refs.ts";
import type { Db, Queryable } from "../db/db.ts";
import { BODIES, SKILL_BASES, TASK_TPLS } from "../facts/enums.ts";
import { seedId, worldId } from "../facts/ids.ts";
import { getRow, selectRows } from "../facts/store.ts";
import type {
  CharRow,
  Exit,
  ID,
  ItemDefinitionRow,
  OrgRow,
  PlaceRow,
  Rank,
  SkillDefinitionRow,
  SkillLearnedRow,
  TaskTemplateRow,
  Tick,
  WorldRow,
} from "../facts/types.ts";
import { Writer } from "../facts/writer.ts";
import { learnedSkill } from "../growth/facts.ts";
import type { RulesBundle } from "../growth/rules_source.ts";
import { errText, log } from "../log.ts";
import { stats } from "../npc/facts.ts";
import { cellNumber, valueAt } from "../orgs/numbers.ts";
import { ActionError } from "../protocol/errors.ts";
import {
  archetype as archetypeV,
  charId,
  combat as combatV,
  condition as conditionV,
  danger as dangerV,
  direction,
  element as elementV,
  features as featuresV,
  itemEffect,
  itemId,
  itemKind,
  modifiers as modifiersV,
  orgId,
  placeId,
  placeKind,
  region as regionV,
  rewardSpec,
  skin as skinV,
} from "../protocol/shapes.ts";
import { arr, bool, grade, lit, nullable, obj, oneOf, opt, refine, stage, str, tier, uint, type Out, type V } from "../protocol/validate.ts";
import { requireRule } from "../rules/world_rules.ts";

/** server/src/content → repo root's content/world (same level scheme as build/limits.ts). */
export const DEFAULT_CONTENT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../content/world");

export interface ContentImportResult {
  files: string[];
  inserted: Record<ContentCounter, number>;
  skipped: Record<ContentCounter, number>;
}

/** `skill` counts skill rows of both records (master learned rows, org skill definitions). */
export type ContentCounter = "place" | "item" | "task" | "char" | "skill" | "exit" | "org";

const zeroCounts = (): Record<ContentCounter, number> => ({ place: 0, item: 0, task: 0, char: 0, skill: 0, exit: 0, org: 0 });

/** Org skills per org (产品文档 §17 F: 每组织专属 2~3 门). */
export const ORG_SKILLS_MIN = 2;
export const ORG_SKILLS_MAX = 3;

// ---------- file shape (content keys and ids are realm-relative, see README) ----------

const REF_RE = /^(place|item|char|org|task):([a-z][a-z0-9_]*)$/;

/** Expands realm-relative references (`place:market_neutral`) to full ids. */
function realmize(value: unknown, realm: string): unknown {
  if (typeof value === "string") {
    const m = REF_RE.exec(value);
    return m === null ? value : `${realm}:${m[1]}:${m[2]}`;
  }
  if (Array.isArray(value)) return value.map((v) => realmize(v, realm));
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = realmize(v, realm);
    return out;
  }
  return value;
}

const localName: V<string> = refine(str({ min: 1, max: CONTENT_LOCAL_MAX }), (s) => /^[a-z][a-z0-9_]*$/.test(s), "lowercase local name");

const exitV: V<Exit> = obj({
  dir: direction,
  to: placeId,
  locked: opt(bool, false),
  key_def: opt(nullable(itemId), null),
  guard: opt(nullable(charId), null),
});

const placeEntry = obj({
  local: localName,
  region: regionV,
  kind: placeKind,
  features: featuresV,
  tier,
  danger: dangerV,
  combat: combatV,
  owner_org: nullable(orgId),
  exits: arr(exitV),
});

const itemEntry = obj({
  local: localName,
  kind: itemKind,
  tier,
  grade,
  element: elementV,
  slots: uint,
  cap: uint,
  dura_max: uint,
  modifiers: modifiersV,
  effect: itemEffect,
});

const taskEntry = obj({
  local: localName,
  tpl: oneOf(TASK_TPLS, "task template"),
  tier,
  stage,
  condition: conditionV,
  reward_spec: rewardSpec,
  duration_ticks: uint,
});

const charEntry = obj({
  local: localName,
  skin: skinV,
  origin_region: skinV,
  body: oneOf(BODIES, "body"),
  archetype: archetypeV,
  tier,
  stage,
  loc: placeId,
  respawn_place: placeId,
  patrol_route: opt(arr(placeId), []),
});

const linkEntry = obj({ place: placeId, dir: direction, to: placeId });

const rankEntry: V<Rank> = obj({
  rank: uint,
  key: refine(str({ min: 1, max: 80 }), (k) => /^org_rank\.[a-z0-9_]{1,64}$/.test(k), "org_rank.<local> key"),
  can_promote: bool,
  can_expel: bool,
});

const orgEntry = obj({
  local: localName,
  region: regionV,
  hall: placeId,
  ranks: arr(rankEntry, { min: 1 }),
  goal_kind: opt(oneOf(["system_tasks", "deliver_items"] as const, "org goal kind"), "system_tasks"),
});

const orgSkillEntry = obj({
  org: orgId,
  local: localName,
  base: oneOf(SKILL_BASES, "skill base"),
  tier,
});

const contentFile = obj({
  schema: lit("aihw.content.v1"),
  places: opt(arr(placeEntry), []),
  place_links: opt(arr(linkEntry), []),
  items: opt(arr(itemEntry), []),
  chars: opt(arr(charEntry), []),
  tasks: opt(arr(taskEntry), []),
  orgs: opt(arr(orgEntry), []),
  org_skills: opt(arr(orgSkillEntry), []),
});

type ItemEntry = Out<typeof itemEntry>;
type TaskEntry = Out<typeof taskEntry>;
type CharEntry = Out<typeof charEntry>;
type OrgEntry = Out<typeof orgEntry>;
type OrgSkillEntry = Out<typeof orgSkillEntry>;

// ---------- helpers ----------

function describe(err: unknown): string {
  if (err instanceof ActionError) {
    return `${err.code}${err.field === null ? "" : ` (${err.field})`} ${JSON.stringify(err.details)}`;
  }
  return err instanceof Error ? err.message : String(err);
}

function fail(file: string, section: string, index: number, local: string, err: unknown): never {
  throw new Error(`content ${file}: ${section}[${index}] ${local}: ${describe(err)}`);
}

const KEY_TAKEN: Readonly<Record<"place" | "item" | "task", string>> = {
  place: "SELECT 1 FROM places WHERE content_key = $1",
  item: "SELECT 1 FROM items WHERE record = 'definition' AND content_key = $1",
  task: "SELECT 1 FROM tasks WHERE record = 'template' AND content_key = $1",
};

async function keyTaken(q: Queryable, table: "place" | "item" | "task", key: string): Promise<boolean> {
  const r = await q.query(KEY_TAKEN[table], [key]);
  return r.rows.length > 0;
}

// ---------- import ----------

interface FileCtx {
  realm: string;
  tick: Tick;
  world: WorldRow;
  env: CheckEnv;
  w: Writer;
  balance: RulesBundle["balance"];
  /** Fresh places whose owner_org is imported later in the same file: set after the orgs. */
  pendingOwners: { place: ID; org: ID; local: string; index: number }[];
  /** Orgs created or given skills by this file (checked for 2~3 org skills at the end). */
  touchedOrgs: Set<ID>;
}

async function importPlaces(ctx: FileCtx, file: string, entries: Out<typeof placeEntry>[], result: ContentImportResult): Promise<PlaceRow[]> {
  const fresh: PlaceRow[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i]!;
    const key = `content.${ctx.realm}.place.${e.local}`;
    try {
      if (seen.has(key)) throw new Error(`duplicate local ${e.local} in this file`);
      seen.add(key);
      if (await keyTaken(ctx.w.q, "place", key)) {
        result.skipped.place += 1;
        continue;
      }
      checkContentKey(ctx.realm, "place", key);
      checkPlace({ content_key: key, region: e.region, kind: e.kind, features: e.features, tier: e.tier, danger: e.danger, combat: e.combat, owner_org: e.owner_org }, ctx.env);
      // An owner org created later in this file (its hall may be this place): set after the orgs.
      let owner = e.owner_org;
      if (owner !== null && (await getRow(ctx.w.q, "org", owner)) === null) {
        ctx.pendingOwners.push({ place: seedId(ctx.realm, "place", e.local), org: owner, local: e.local, index: i });
        owner = null;
      }
      const row: PlaceRow = {
        id: seedId(ctx.realm, "place", e.local),
        created_tick: ctx.tick,
        updated_tick: ctx.tick,
        content_key: key,
        region: e.region,
        kind: e.kind,
        features: e.features,
        tier: e.tier,
        danger: e.danger,
        combat: e.combat,
        exits: e.exits,
        owner_org: owner,
        by: null,
      };
      await ctx.w.insert("place", row);
      fresh.push(row);
      result.inserted.place += 1;
    } catch (err) {
      fail(file, "places", i, e.local, err);
    }
  }
  return fresh;
}

async function importLinks(ctx: FileCtx, file: string, entries: Out<typeof linkEntry>[], result: ContentImportResult): Promise<void> {
  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i]!;
    const name = `${e.place} ${e.dir}`;
    try {
      const from = await getRow(ctx.w.q, "place", e.place);
      if (from === null) throw new Error(`place ${e.place} not in library`);
      if (from.exits.some((x) => x.dir === e.dir)) {
        // Already linked (protocol §4: exits are only ever appended, never overwritten).
        result.skipped.exit += 1;
        continue;
      }
      if ((await getRow(ctx.w.q, "place", e.to)) === null) throw new Error(`place ${e.to} not in library`);
      const exit: Exit = { dir: e.dir, to: e.to, locked: false, key_def: null, guard: null };
      await ctx.w.update("place", from.id, { exits: [...from.exits, exit] });
      result.inserted.exit += 1;
    } catch (err) {
      fail(file, "place_links", i, name, err);
    }
  }
}

async function importItems(ctx: FileCtx, file: string, entries: ItemEntry[], result: ContentImportResult): Promise<void> {
  const seen = new Set<string>();
  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i]!;
    const key = `content.${ctx.realm}.item.${e.local}`;
    try {
      if (seen.has(key)) throw new Error(`duplicate local ${e.local} in this file`);
      seen.add(key);
      if (await keyTaken(ctx.w.q, "item", key)) {
        result.skipped.item += 1;
        continue;
      }
      checkContentKey(ctx.realm, "item", key);
      const data = {
        content_key: key, kind: e.kind, tier: e.tier, grade: e.grade, element: e.element,
        slots: e.slots, cap: e.cap, dura_max: e.dura_max, modifiers: e.modifiers, effect: e.effect,
      };
      checkItem(data, ctx.env);
      await checkItemRefs(ctx.w.q, data);
      const row: ItemDefinitionRow = {
        id: seedId(ctx.realm, "item", e.local),
        created_tick: ctx.tick,
        updated_tick: ctx.tick,
        record: "definition",
        by: null,
        ...data,
      };
      await ctx.w.insert("item", row);
      result.inserted.item += 1;
    } catch (err) {
      fail(file, "items", i, e.local, err);
    }
  }
}

/** S5 numbers the data files must not carry: vigor, coin pool, master skills. */
async function importChars(ctx: FileCtx, file: string, entries: CharEntry[], result: ContentImportResult): Promise<void> {
  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i]!;
    try {
      const id = seedId(ctx.realm, "char", e.local);
      if ((await getRow(ctx.w.q, "char", id)) !== null) {
        result.skipped.char += 1;
        continue;
      }
      if ((await getRow(ctx.w.q, "place", e.loc)) === null) throw new Error(`place ${e.loc} not in library`);
      const seenAt = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString().replace(".000Z", "Z");
      const coin = cellNumber(ctx.balance, "tier_prices", { tier: e.tier }, "npc_coin_float");
      const row: CharRow = {
        id,
        created_tick: ctx.tick,
        updated_tick: ctx.tick,
        kind: "npc",
        door: null,
        model: null,
        skin: e.skin,
        class: null,
        origin_region: e.origin_region,
        body: e.body,
        archetype: e.archetype,
        tier: e.tier,
        stage: e.stage,
        xp: 0,
        potential: 0,
        vigor: 0,
        coin,
        cycles: 0,
        legacy: 0,
        loc: e.loc,
        respawn_place: e.respawn_place,
        life: "alive",
        revive_tick: null,
        state: "active",
        state_since: ctx.tick,
        last_seen_tick: ctx.tick,
        last_yield_tick: ctx.tick,
        ap_tick: ctx.tick,
        seen_at: seenAt,
        ap_spent: 0,
        train_skill: null,
        day_index: 0,
        system_tasks_today: 0,
        known_places: [e.loc],
        patrol_route: e.patrol_route,
        patrol_index: 0,
      };
      // NPC vigor starts full: the same S5 derivation (grid × archetype factor) the clock uses.
      row.vigor = (await stats(ctx.w.q, ctx.balance, row)).vigor_max;
      await ctx.w.insert("char", row);
      result.inserted.char += 1;
      if (e.archetype === "master") await seedMasterSkills(ctx, id, e.tier, result);
    } catch (err) {
      fail(file, "chars", i, e.local, err);
    }
  }
}

/** npc.master_skill_level_rule = skill_cap_hard (S5): all four base skills at the tier's hard cap. */
async function seedMasterSkills(ctx: FileCtx, charId: ID, tierNum: number, result: ContentImportResult): Promise<void> {
  if (valueAt(ctx.balance, "npc.master_skill_level_rule") !== "skill_cap_hard") {
    throw new Error("unsupported npc.master_skill_level_rule");
  }
  const level = cellNumber(ctx.balance, "tiers", { tier: tierNum }, "skill_cap_hard");
  const defs = (await selectRows(ctx.w.q, "skill", "record = 'definition' AND org_id IS NULL AND key IN ('strike', 'guard', 'move', 'inner')", [], 'ORDER BY key COLLATE "C"')) as SkillDefinitionRow[];
  if (defs.length !== 4) throw new Error("fact integrity: base skill definitions missing");
  for (const def of defs) {
    if ((await learnedSkill(ctx.w.q, charId, def.id)) !== null) {
      result.skipped.skill += 1;
      continue;
    }
    const row: SkillLearnedRow = {
      id: seedId(ctx.realm, "skill", `${def.key}_${charId.split(":")[2]}`),
      created_tick: ctx.tick,
      updated_tick: ctx.tick,
      record: "learned",
      char_id: charId,
      def_id: def.id,
      level,
      cap: level,
    };
    await ctx.w.insert("skill", row);
    result.inserted.skill += 1;
  }
}

async function importTasks(ctx: FileCtx, file: string, entries: TaskEntry[], result: ContentImportResult): Promise<void> {
  const seen = new Set<string>();
  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i]!;
    const key = `content.${ctx.realm}.task.${e.local}`;
    try {
      if (seen.has(key)) throw new Error(`duplicate local ${e.local} in this file`);
      seen.add(key);
      if (await keyTaken(ctx.w.q, "task", key)) {
        result.skipped.task += 1;
        continue;
      }
      checkContentKey(ctx.realm, "task", key);
      const data = {
        content_key: key, tpl: e.tpl, tier: e.tier, stage: e.stage,
        condition: e.condition, reward_spec: e.reward_spec, duration_ticks: e.duration_ticks,
      };
      checkTask(data, ctx.env);
      await checkTaskRefs(ctx.w.q, data, ctx.env.limits);
      const row: TaskTemplateRow = {
        id: seedId(ctx.realm, "task", e.local),
        created_tick: ctx.tick,
        updated_tick: ctx.tick,
        record: "template",
        by: null,
        ...data,
      };
      await ctx.w.insert("task", row);
      result.inserted.task += 1;
    } catch (err) {
      fail(file, "tasks", i, e.local, err);
    }
  }
}

/**
 * Org rows (事实格式 §8.1), idempotent per content_key: an org already in the
 * library — including the seed's registry orgs — is never rebuilt or changed
 * here (org_skills may still add skill definitions to it). New orgs are not
 * registry orgs; treasury starts at 0 and the goal initial value comes from S5
 * (the org clock re-snapshots member_ids / target, S25).
 */
async function importOrgs(ctx: FileCtx, file: string, entries: OrgEntry[], result: ContentImportResult): Promise<void> {
  const seen = new Set<string>();
  const goalNumbers = ctx.balance.org_goal;
  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i]!;
    const key = `content.${ctx.realm}.org.${e.local}`;
    try {
      if (seen.has(key)) throw new Error(`duplicate local ${e.local} in this file`);
      seen.add(key);
      if ((await ctx.w.q.query("SELECT 1 FROM orgs WHERE content_key = $1", [key])).rows.length > 0) {
        result.skipped.org += 1;
        continue;
      }
      const hall = await getRow(ctx.w.q, "place", e.hall);
      if (hall === null) throw new Error(`hall ${e.hall} not in library`);
      if (hall.region !== e.region) throw new Error(`hall ${e.hall} is in region ${hall.region}, org is ${e.region}`);
      const ranks = new Set(e.ranks.map((r) => r.rank));
      const keys = new Set(e.ranks.map((r) => r.key));
      if (ranks.size !== e.ranks.length || keys.size !== e.ranks.length) throw new Error("ranks must have unique rank numbers and keys");
      if (!keys.has("org_rank.member")) throw new Error("ranks must include the default rank org_rank.member");
      const row: OrgRow = {
        id: seedId(ctx.realm, "org", e.local),
        created_tick: ctx.tick,
        updated_tick: ctx.tick,
        content_key: key,
        region: e.region,
        hall: hall.id,
        registry: false,
        ranks: e.ranks,
        skill_defs: [],
        treasury: 0,
        goal: {
          week: ctx.world.week_index,
          kind: e.goal_kind,
          target: goalNumbers.target,
          progress: 0,
          member_ids: [],
          reward_rep: goalNumbers.reward_rep,
          settled: false,
        },
      };
      await ctx.w.insert("org", row);
      ctx.touchedOrgs.add(row.id);
      result.inserted.org += 1;
    } catch (err) {
      fail(file, "orgs", i, e.local, err);
    }
  }
  for (const p of ctx.pendingOwners) {
    try {
      if ((await getRow(ctx.w.q, "org", p.org)) === null) throw new Error(`owner_org ${p.org} not in library`);
      await ctx.w.update("place", p.place, { owner_org: p.org });
    } catch (err) {
      fail(file, "places", p.index, p.local, err);
    }
  }
}

/**
 * Org skill definitions (事实格式 §7.1 definition branch), idempotent per key
 * `org:<org_id>:<local>`; each new definition is appended to its org's
 * skill_defs in the same transaction (skill_defs only ever grows).
 */
async function importOrgSkills(ctx: FileCtx, file: string, entries: OrgSkillEntry[], result: ContentImportResult): Promise<void> {
  const seen = new Set<string>();
  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i]!;
    const name = `${e.org} ${e.local}`;
    try {
      const org = await getRow(ctx.w.q, "org", e.org);
      if (org === null) throw new Error(`org ${e.org} not in library`);
      const key = `org:${org.id}:${e.local}`;
      if (seen.has(key)) throw new Error(`duplicate org skill ${e.local} in this file`);
      seen.add(key);
      ctx.touchedOrgs.add(org.id);
      const existing = (await selectRows(ctx.w.q, "skill", "record = 'definition' AND key = $1", [key]))[0];
      if (existing !== undefined) {
        if (existing.record !== "definition" || existing.org_id !== org.id) throw new Error(`skill key ${key} belongs elsewhere`);
        result.skipped.skill += 1;
        continue;
      }
      const orgLocal = org.id.split(":")[2] as string;
      const row: SkillDefinitionRow = {
        id: seedId(ctx.realm, "skill", `org_${orgLocal}_${e.local}`),
        created_tick: ctx.tick,
        updated_tick: ctx.tick,
        record: "definition",
        key,
        base: e.base,
        org_id: org.id,
        tier: e.tier,
      };
      await ctx.w.insert("skill", row);
      await ctx.w.update("org", org.id, { skill_defs: [...org.skill_defs, row.id] });
      result.inserted.skill += 1;
    } catch (err) {
      fail(file, "org_skills", i, name, err);
    }
  }
}

/** Every org this file created or gave skills ends with 2~3 org skill definitions. */
async function verifyOrgSkills(ctx: FileCtx, file: string): Promise<void> {
  for (const id of ctx.touchedOrgs) {
    const org = await getRow(ctx.w.q, "org", id);
    const n = org?.skill_defs.length ?? 0;
    if (n < ORG_SKILLS_MIN || n > ORG_SKILLS_MAX) {
      fail(file, "org_skills", -1, id, new Error(`org has ${n} org skills, needs ${ORG_SKILLS_MIN}..${ORG_SKILLS_MAX}`));
    }
  }
}

/** Whole-graph reference check for the freshly imported places (exits may point at places imported later in the same file). */
async function verifyPlaces(ctx: FileCtx, file: string, fresh: PlaceRow[]): Promise<void> {
  for (const p of fresh) {
    for (const exit of p.exits) {
      const where = `${p.content_key} exit ${exit.dir}`;
      if ((await getRow(ctx.w.q, "place", exit.to)) === null) fail(file, "places", -1, where, new Error(`place ${exit.to} not in library`));
      if (exit.locked) {
        if (exit.key_def === null) fail(file, "places", -1, where, new Error("locked exit without key_def"));
        const key = await getRow(ctx.w.q, "item", exit.key_def);
        if (key?.record !== "definition" || key.kind !== "key") fail(file, "places", -1, where, new Error("key_def is not a key definition"));
      }
      if (exit.guard !== null && (await getRow(ctx.w.q, "char", exit.guard)) === null) {
        fail(file, "places", -1, where, new Error(`guard ${exit.guard} not in library`));
      }
    }
  }
}

async function importFile(db: Db, realm: string, bundle: RulesBundle, file: string, path: string, result: ContentImportResult): Promise<void> {
  let parsed: Out<typeof contentFile>;
  try {
    parsed = contentFile(realmize(JSON.parse(await readFile(path, "utf8")), realm), "$");
  } catch (err) {
    throw new Error(`content ${file}: ${describe(err)}`);
  }
  await db.tx(async (q) => {
    await q.query("SELECT pg_advisory_xact_lock(7234003)");
    const world = await getRow(q, "world", worldId(realm));
    if (world === null) throw new Error(`content ${file}: world not booted`);
    const limits = buildLimits();
    if (limits.revision !== world.rules_revision) {
      throw new Error(`content ${file}: numbers revision ${limits.revision} != world ${world.rules_revision}`);
    }
    const ctx: FileCtx = {
      realm,
      tick: world.tick,
      world,
      env: { limits, builderTier: 9, socketMax: requireRule(world.rules, "socket_max") },
      w: new Writer(q, realm, world.tick, world.rules_revision, false),
      balance: bundle.balance,
      pendingOwners: [],
      touchedOrgs: new Set(),
    };
    const fresh = await importPlaces(ctx, file, parsed.places, result);
    await importLinks(ctx, file, parsed.place_links, result);
    await importOrgs(ctx, file, parsed.orgs, result);
    await importOrgSkills(ctx, file, parsed.org_skills, result);
    await importItems(ctx, file, parsed.items, result);
    await importChars(ctx, file, parsed.chars, result);
    await importTasks(ctx, file, parsed.tasks, result);
    await verifyPlaces(ctx, file, fresh);
    await verifyOrgSkills(ctx, file);
  });
}

/**
 * Imports every content/world/*.json (sorted by name) after the seed. One
 * transaction per file; a failure names the entry and aborts startup.
 */
export async function importWorldContent(
  db: Db,
  realm: string,
  bundle: RulesBundle,
  dir: string = DEFAULT_CONTENT_DIR,
): Promise<ContentImportResult> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  const result: ContentImportResult = { files, inserted: zeroCounts(), skipped: zeroCounts() };
  for (const file of files) {
    try {
      await importFile(db, realm, bundle, file, `${dir}/${file}`, result);
    } catch (err) {
      log.error("content import failed", { file, err: errText(err) });
      throw err;
    }
  }
  const { inserted, skipped } = result;
  log.info("content imported", {
    files: result.files.length,
    places: inserted.place, items: inserted.item, tasks: inserted.task, chars: inserted.char, skills: inserted.skill, exits: inserted.exit, orgs: inserted.org,
    skipped: Object.values(skipped).reduce((a, b) => a + b, 0),
  });
  return result;
}
