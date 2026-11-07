// Public-page projections (产品文档 第八节 2, 附录 A5, 事实格式 §10 / §12).
// Read-only Markdown of facts. Identity codes and their hashes never appear:
// the queries below do not touch the identity table, and char rows are reduced
// to the public field whitelist before rendering.
// Deeds are filtered by visibility (S9 开口⑤): chronicle = world only,
// place page = place + world, biography = deeds the char authored or is named in.
// Lists are not true creation order. Deeds sort by numeric seq. Other public
// lists sort by trailing digits (0 when an ID has none), then by ID bytes, so a
// named ID is not ordered by when it was created.

import type { Queryable } from "../db/db.ts";
import { ITEM_CATEGORY, SKINS, type ItemKind, type Region, type Skin } from "../facts/enums.ts";
import { publicChar } from "../facts/project.ts";
import { selectRows } from "../facts/store.ts";
import type {
  BondRow,
  DeedRow,
  ItemDefinitionRow,
  ItemInstanceRow,
  PlaceRow,
  PublicChar,
  ReputationRow,
  TaskInstanceRow,
  WantedRow,
} from "../facts/types.ts";
import { lookPlace } from "../verbs/look.ts";
import { lexiconFor, neutralLexicon, type Lexicon, type Named, type SkinBook } from "./skins.ts";

export const RECENT_LIMIT = 20;

const ID_RE = /^[a-z][a-z0-9_]*:(place|char|item|task|org|bond|reputation|wanted):[a-z][a-z0-9_]*$/;

export type PageKind = "chronicle" | "region" | "place" | "char";

export interface PageDoc {
  kind: PageKind;
  /** Stable across requests while the facts are unchanged (ETag input). */
  stamp: string;
  markdown: string;
}

export interface PageQuery {
  kind: PageKind;
  /** Region key, place id or char id, depending on kind. */
  ref: string | null;
  lexicon: Lexicon;
  /** When no skin was requested, a biography uses the character's origin skin. */
  birthBook?: SkinBook;
}

const REGION_KEYS = ["xiuxian", "wuxia", "fantasy", "scifi", "neutral"] as const;

function isRegion(v: string): v is Region {
  return (REGION_KEYS as readonly string[]).includes(v);
}

/** Sort key, not creation time: trailing digits (0 if none), then the ID bytes. */
export function creationOrder(id: string): [number, string] {
  const m = /(\d+)$/.exec(id);
  return [m?.[1] !== undefined ? Number(m[1]) : 0, id];
}

function byCreation<T extends { id: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const [an, aid] = creationOrder(a.id);
    const [bn, bid] = creationOrder(b.id);
    return an - bn || (aid < bid ? -1 : aid > bid ? 1 : 0);
  });
}

/** Deeds carry a realm-wide numeric seq; that is their creation order. */
function bySeq(rows: DeedRow[]): DeedRow[] {
  return [...rows].sort((a, b) => Number(a.seq) - Number(b.seq) || (a.id < b.id ? -1 : 1));
}

function label(n: Named): string {
  return n.missing ? n.key.replace(/^.*\./, "").replace(/[_.·]+/g, " ") : n.name;
}

function facet(lex: Lexicon, key: string): string {
  return `${label(lex.name(key))} \`${key}\``;
}

function lineOf(parts: string[]): string {
  return parts.filter((p) => p !== "").join(" · ");
}

function placeLine(lex: Lexicon, p: PlaceRow): string {
  const shown = lookPlace(p);
  const features = [...p.features].sort().map((f) => facet(lex, `feature.${f}`));
  return lineOf([
    `\`${p.id}\``,
    facet(lex, `place.${p.kind}`),
    facet(lex, `region.${p.region}`),
    facet(lex, `tier${p.tier}`),
    facet(lex, `danger.${shown.danger}`),
    facet(lex, `combat.${shown.combat}`),
    shown.npc_attackable === false ? "NPC 不可攻击 / NPCs cannot be attacked `npc_attackable=false`" : "",
    features.length > 0 ? features.join(", ") : "",
    p.note === null || p.note === "" ? "" : `note ${p.note}`,
  ]);
}

function charLine(lex: Lexicon, c: PublicChar): string {
  const parts = [
    `\`${c.id}\``,
    c.handle === null ? "" : `handle ${c.handle}`,
    facet(lex, `person.${c.kind}`),
    facet(lex, `body.${c.body}`),
    c.archetype === null ? "" : facet(lex, `npc.${c.archetype}`),
    facet(lex, `tier${c.tier}`),
    facet(lex, `stage${c.stage}`),
    `life ${c.life}`,
    `state ${c.state}`,
    c.door === null ? "" : `door ${c.door}`,
    c.model === null ? "" : `model ${c.model}`,
    c.class === null ? "" : facet(lex, `class.${c.class}`),
  ];
  return lineOf(parts);
}

function itemLine(lex: Lexicon, inst: ItemInstanceRow, def: ItemDefinitionRow | undefined): string {
  if (def === undefined) return `\`${inst.id}\` def \`${inst.def_id}\` (definition missing)`;
  const short = lex.name(`item.${def.kind}·tier${def.tier}`);
  const grade = lex.name(`grade${def.grade}`);
  const element = def.element === "none" ? null : lex.name(`element.${def.element}`);
  const parts = [short, grade, element].filter((n): n is Named => n !== null);
  const name = parts.some((n) => n.missing)
    ? parts.map((n) => label(n)).join("、")
    : parts.map((n) => n.name).join("、");
  return lineOf([
    `\`${inst.id}\``,
    name,
    `×1`,
    facet(lex, `category.${ITEM_CATEGORY[def.kind as ItemKind]}`),
    inst.equipped ? "equipped" : "on ground",
    `dura ${inst.dura}`,
    def?.note ? `note ${def.note}` : "",
  ]);
}

function taskLine(lex: Lexicon, t: TaskInstanceRow): string {
  const cond = JSON.stringify(t.condition);
  return lineOf([
    `\`${t.id}\``,
    facet(lex, `task.${t.tpl}`),
    facet(lex, `task_kind.${t.kind}`),
    `state ${t.state}`,
    `reward coin ${t.reward.coin}`,
    cond,
    t.note === null || t.note === "" ? "" : `note ${t.note}`,
  ]);
}

function deedLine(lex: Lexicon, d: DeedRow, orgNames: ReadonlyMap<string, string> = new Map()): string {
  const targets = d.targets.map((t) => `\`${t}\`${orgNames.has(t) ? ` (${orgNames.get(t)})` : ""}`).join(", ");
  const kind = d.kind === "org_create" ? "开派 Organization founded `deed.org_create`"
    : d.kind === "first_org" ? "首开组织 First organization `deed.first_org`" : facet(lex, `deed.${d.kind}`);
  return lineOf([
    `tick ${d.tick}`,
    kind,
    `verb ${d.verb}`,
    `outcome ${d.result.outcome}`,
    d.actor === null ? "actor system" : `actor \`${d.actor}\``,
    targets === "" ? "" : `targets ${targets}`,
    `\`${d.id}\``,
  ]);
}

async function playerOrgNames(q: Queryable, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id) => id.split(":")[1] === "org"))];
  const names = new Map<string, string>();
  if (unique.length === 0) return names;
  const marks = unique.map((_, i) => `$${i + 1}`).join(", ");
  for (const org of await selectRows(q, "org", `id IN (${marks})`, unique)) {
    if (org.player_name !== undefined) names.set(org.id, org.player_name);
  }
  return names;
}

function header(title: string, lex: Lexicon, note: string): string[] {
  const skin = lex.skin === null ? "neutral" : `${lex.skin}/${lex.locale}`;
  return [`# ${title}`, "", `skin: ${skin}`, "", note, ""];
}

async function chronicle(q: Queryable, lex: Lexicon): Promise<PageDoc> {
  const deeds = bySeq(
    await selectRows(q, "deed", "visibility = 'world'", [RECENT_LIMIT], "ORDER BY seq DESC LIMIT $1"),
  );
  const head = await q.query<{ deed_head: string; tick: string }>("SELECT deed_head, tick FROM worlds");
  const w = head.rows[0];
  const lines = header(
    "编年史 Chronicle",
    lex,
    "全世界近期公开事迹(visibility = world),最近在前。不含身份码。",
  );
  lines.push("## 近期事迹 Recent deeds", "");
  if (deeds.length === 0) lines.push("(none)", "");
  const orgNames = await playerOrgNames(q, deeds.flatMap((d) => d.targets));
  for (const d of deeds) lines.push(`- ${deedLine(lex, d, orgNames)}`);
  lines.push("");
  const stamp = `chronicle:${w?.tick ?? "0"}:${w?.deed_head ?? "0"}:${deeds.map((d) => d.seq).join(",")}`;
  return { kind: "chronicle", stamp, markdown: lines.join("\n") };
}

async function regionPage(q: Queryable, lex: Lexicon, ref: string): Promise<PageDoc | null> {
  if (!isRegion(ref)) return null;
  const places = byCreation(await selectRows(q, "place", "region = $1", [ref]));
  const lines = header(
    `区 Region ${facet(lex, `region.${ref}`)}`,
    lex,
    "本区地点,按 ID 末尾数字(没有则为 0)再按 ID 字节序排列;数字分配 ID 即数字序,命名 ID 不按创建先后。",
  );
  lines.push("## 地点 Places", "");
  if (places.length === 0) lines.push("(none)", "");
  for (const p of places) lines.push(`- ${placeLine(lex, p)}`);
  lines.push("");
  const stamp = `region:${ref}:${places.map((p) => `${p.id}@${p.updated_tick}`).join(",")}`;
  return { kind: "region", stamp, markdown: lines.join("\n") };
}

async function placePage(q: Queryable, lex: Lexicon, ref: string): Promise<PageDoc | null> {
  const place = (await selectRows(q, "place", "id = $1", [ref]))[0];
  if (place === undefined) return null;
  const people = byCreation(
    await selectRows(q, "char", "loc = $1 AND state <> 'buried'", [place.id]),
  ).map((c) => publicChar(c));
  const items = byCreation(
    (await selectRows(q, "item", "record = 'instance' AND holder ->> 'kind' = 'place' AND holder ->> 'id' = $1 AND state = 'available'", [
      place.id,
    ])).filter((r): r is ItemInstanceRow => r.record === "instance"),
  );
  const defIds = [...new Set(items.map((i) => i.def_id))];
  const defs = new Map<string, ItemDefinitionRow>();
  if (defIds.length > 0) {
    const marks = defIds.map((_, i) => `$${i + 1}`).join(", ");
    for (const d of await selectRows(q, "item", `record = 'definition' AND id IN (${marks})`, defIds)) {
      if (d.record === "definition") defs.set(d.id, d);
    }
  }
  const tasks = byCreation(
    (await selectRows(
      q,
      "task",
      "record = 'instance' AND offer_place = $1 AND state = 'open' AND eligible_char IS NULL",
      [place.id],
    )).filter((r): r is TaskInstanceRow => r.record === "instance"),
  );
  const deeds = bySeq(
    await selectRows(
      q,
      "deed",
      "place_id = $1 AND visibility IN ('place', 'world')",
      [place.id, RECENT_LIMIT],
      "ORDER BY seq DESC LIMIT $2",
    ),
  );
  const orgNames = await playerOrgNames(q, deeds.flatMap((d) => d.targets));
  const lines = header(`地点 Place ${place.id}`, lex, "在场者 / 物 / 出口 / 可接任务 / 近期事迹。事实,不含身份码。");
  lines.push(placeLine(lex, place), "");
  lines.push("## 出口 Exits", "");
  if (place.exits.length === 0) lines.push("(none)", "");
  for (const e of place.exits) {
    lines.push(`- ${e.dir} → \`${e.to}\`${e.locked ? " (locked)" : ""}`);
  }
  lines.push("", "## 在场 Present", "");
  if (people.length === 0) lines.push("(none)", "");
  const byKind = new Map<string, number>();
  for (const c of people) byKind.set(c.kind, (byKind.get(c.kind) ?? 0) + 1);
  const tally = [...byKind.entries()].map(([k, n]) => `${k} ${n}`).join(" / ");
  if (tally !== "") lines.push(`×${people.length}(${tally})`, "");
  for (const c of people) lines.push(`- ${charLine(lex, c)}`);
  lines.push("", "## 物 Items", "");
  if (items.length === 0) lines.push("(none)", "");
  for (const it of items) lines.push(`- ${itemLine(lex, it, defs.get(it.def_id))}`);
  lines.push("", "## 可接任务 Open tasks", "");
  if (tasks.length === 0) lines.push("(none)", "");
  for (const t of tasks) lines.push(`- ${taskLine(lex, t)}`);
  lines.push("", "## 近期事迹 Recent deeds", "");
  if (deeds.length === 0) lines.push("(none)", "");
  for (const d of deeds) lines.push(`- ${deedLine(lex, d, orgNames)}`);
  lines.push("");
  const stamp = [
    "place",
    place.id,
    place.updated_tick,
    people.map((c) => c.id).join(","),
    items.map((i) => `${i.id}@${i.updated_tick}`).join(","),
    tasks.map((t) => t.id).join(","),
    deeds.map((d) => d.seq).join(","),
  ].join(":");
  return { kind: "place", stamp, markdown: lines.join("\n") };
}

async function biography(q: Queryable, lex: Lexicon, ref: string, birthBook?: SkinBook): Promise<PageDoc | null> {
  const row = (await selectRows(q, "char", "id = $1", [ref]))[0];
  if (row === undefined) return null;
  if (birthBook !== undefined) {
    const origin = row.origin_region;
    lex = typeof origin === "string" && (SKINS as readonly string[]).includes(origin)
      ? defaultSkin(birthBook, origin as Skin).lexicon
      : neutralLexicon();
  }
  const who = publicChar(row);
  const deeds = bySeq(
    await selectRows(
      q,
      "deed",
      "(actor = $1 OR targets @> $2::jsonb OR participants @> $2::jsonb) AND visibility IN ('place', 'world')",
      [who.id, JSON.stringify([who.id]), RECENT_LIMIT],
      "ORDER BY seq DESC LIMIT $3",
    ),
  );
  const bonds = byCreation(
    await selectRows(q, "bond", "state = 'active' AND (a = $1 OR b = $1)", [who.id]),
  );
  const orgNames = await playerOrgNames(q, [...bonds.filter((b) => b.kind === "member").map((b) => b.b), ...deeds.flatMap((d) => d.targets)]);
  const reps = byCreation(await selectRows(q, "reputation", "char_id = $1 AND scope = 'world'", [who.id]));
  const wanted = byCreation(await selectRows(q, "wanted", "char_id = $1 AND state = 'active'", [who.id]));
  const lines = header(`传记 Biography ${who.id}`, lex, "公开字段与公开事迹。余额、体力、身份凭据不在此页。");
  lines.push(`- ${charLine(lex, who)}`, "");
  lines.push("## 关系 Bonds", "");
  if (bonds.length === 0) lines.push("(none)", "");
  for (const b of bonds) lines.push(`- ${bondLine(lex, b, orgNames)}`);
  lines.push("", "## 名声 Reputation", "");
  if (reps.length === 0) lines.push("(none)", "");
  for (const r of reps) lines.push(`- ${repLine(lex, r)}`);
  lines.push("", "## 通缉 Wanted", "");
  if (wanted.length === 0) lines.push("(none)", "");
  for (const w of wanted) lines.push(`- ${wantedLine(lex, w)}`);
  lines.push("", "## 事迹 Deeds", "");
  if (deeds.length === 0) lines.push("(none)", "");
  for (const d of deeds) lines.push(`- ${deedLine(lex, d, orgNames)}`);
  lines.push("");
  const stamp = [
    "char",
    who.id,
    row.updated_tick,
    deeds.map((d) => d.seq).join(","),
    bonds.map((b) => `${b.id}@${b.updated_tick}`).join(","),
    reps.map((r) => `${r.id}:${r.value}`).join(","),
    wanted.map((w) => w.id).join(","),
  ].join(":");
  return { kind: "char", stamp, markdown: lines.join("\n") };
}

function bondLine(lex: Lexicon, b: BondRow, orgNames: ReadonlyMap<string, string>): string {
  return lineOf([`\`${b.id}\``, facet(lex, `bond.${b.kind}`), `\`${b.a}\` → \`${b.b}\``, orgNames.get(b.b) ?? "", `since ${b.since_tick}`]);
}

function repLine(lex: Lexicon, r: ReputationRow): string {
  return lineOf([`\`${r.id}\``, r.scope, r.org_id === null ? "" : `\`${r.org_id}\``, `${facet(lex, "stat.reputation")} ${r.value}`]);
}

function wantedLine(lex: Lexicon, w: WantedRow): string {
  return lineOf([
    `\`${w.id}\``,
    facet(lex, `region.${w.region}`),
    facet(lex, `wanted.${w.reason}`),
    `until tick ${w.until_tick}`,
  ]);
}

export async function renderPage(q: Queryable, query: PageQuery): Promise<PageDoc | null> {
  switch (query.kind) {
    case "chronicle":
      return chronicle(q, query.lexicon);
    case "region":
      return query.ref === null ? null : regionPage(q, query.lexicon, query.ref);
    case "place":
      return query.ref === null ? null : placePage(q, query.lexicon, query.ref);
    case "char":
      return query.ref === null ? null : biography(q, query.lexicon, query.ref, query.birthBook);
  }
}

export interface ResolvedSkin {
  lexicon: Lexicon;
  /** Canonical query string ("" or "?skin=…&locale=…") so links keep the choice. */
  query: string;
}

/** Chinese skins default to Chinese; fantasy and science fiction default to English. */
function defaultLocale(skin: Skin): string {
  return skin === "xiuxian" || skin === "wuxia" ? "zh-CN" : "en";
}

function defaultSkin(book: SkinBook, skin: Skin): ResolvedSkin {
  const locale = defaultLocale(skin);
  const lexicon = lexiconFor(book, skin, locale);
  return lexicon.skin === null
    ? { lexicon: neutralLexicon(), query: "" }
    : { lexicon, query: `?skin=${encodeURIComponent(skin)}&locale=${encodeURIComponent(locale)}` };
}

/** `?skin=<皮>&locale=<语言>`; a missing locale uses the skin's default. */
export function resolveSkin(book: SkinBook, search: URLSearchParams): ResolvedSkin {
  const skin = search.get("skin");
  if (skin === null || !(SKINS as readonly string[]).includes(skin)) {
    return { lexicon: neutralLexicon(), query: "" };
  }
  const locale = search.get("locale");
  if (locale === null) return defaultSkin(book, skin as Skin);
  const lex = lexiconFor(book, skin as Skin, locale);
  if (lex.skin === null) return { lexicon: neutralLexicon(), query: "" };
  return { lexicon: lex, query: `?skin=${encodeURIComponent(skin)}&locale=${encodeURIComponent(locale)}` };
}

export function indexDoc(book: SkinBook, skinQuery: string): PageDoc {
  const lines = [
    "# AI 人间 · 公开页",
    "",
    "只读事实,不含身份码。选皮在网址上加 `?skin=<皮>&locale=<语言>`。",
    "",
    `- [编年史](/chronicle${skinQuery})`,
  ];
  for (const region of REGION_KEYS) lines.push(`- [区 ${region}](/region/${region}${skinQuery})`);
  lines.push("", "## 皮 Skins", "");
  for (const skin of SKINS) {
    const locales = book.localesOf(skin);
    lines.push(`- ${skin}: ${locales.length === 0 ? "(no table)" : locales.join(", ")}`);
  }
  lines.push("");
  const stamp = `index:${[...book.tables.keys()].sort().join(",")}`;
  return { kind: "chronicle", stamp, markdown: lines.join("\n") };
}

export function isFactId(ref: string, type: string): boolean {
  return ID_RE.test(ref) && ref.split(":")[1] === type;
}
