// Public pages (S13): chronicle / region / place / biography as Markdown, plus
// one minimal HTML form per action. Everything that is not POST /v1/actions/<verb>
// lands here (http/server.ts). Pages are projections of facts and never contain
// identity codes or their hashes. A form submits through `dispatch` with door
// "web" — no second action path, no session, no cookie.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import type { Db } from "../db/db.ts";
import { SERVER_ROOT } from "../config.ts";
import { SKINS, VERBS, type Skin } from "../facts/enums.ts";
import { getRow, mustGetRow, selectRows } from "../facts/store.ts";
import { worldId } from "../facts/ids.ts";
import { itemPrice, tradePrice } from "../economy/prices.ts";
import type { Balance } from "../growth/balance.ts";
import { requireRevision } from "../orgs/numbers.ts";
import { ActionError, NO_DETAILS, reject } from "../protocol/errors.ts";
import { charId } from "../protocol/shapes.ts";
import { verbCatalog } from "../verbs/catalog.ts";
import { errEnvelope } from "../verbs/runner.ts";
import { publicChar } from "../facts/project.ts";
import type { LookResult } from "../verbs/look.ts";
import { parseBearer } from "../identity/auth.ts";
import type { DispatchInput, DispatchOutput } from "../verbs/runner.ts";
import { argsFromPost, formBySlug, formsOf, type WebForm } from "./forms.ts";
import { formDocument, formsIndexDocument, homeHtml, publicHtml, resultDocument, shellLang, wantsHtml, type ShellLang } from "./html.ts";
import { indexDoc, isFactId, renderPage, resolveSkin, type PageDoc, type PageKind, type ResolvedSkin } from "./pages.ts";
import { lexiconFor, loadSkins, neutralLexicon, type SkinBook } from "./skins.ts";

export interface PublicDeps {
  db: Db;
  realm: string;
  balance(): Balance;
  /** Run a verb exactly like the JSON API does (use door: "web"). */
  dispatch(input: DispatchInput): Promise<DispatchOutput>;
}

const BODY_MAX = 65536;
const SKINS_DIR = join(SERVER_ROOT, "..", "content", "skins");
const STATIC_DIR = join(SERVER_ROOT, "src", "public", "static");
const PLAY_PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI 人间</title>
<link rel="stylesheet" href="/play/static/play.css">
</head>
<body>
<div class="wrap">
<div id="gate"></div>
<div id="reveal" class="hidden"></div>
<main id="world" class="hidden">
<header id="world-head" class="top"></header>
<p id="status" class="small" role="status"></p>
<div id="world-view" class="grid"></div>
<section id="events-card" class="card">
<h3 id="events-title"></h3>
<div id="events" class="list"></div>
</section>
<details class="raw"><summary id="details-title"></summary><pre id="last-raw"></pre></details>
</main>
</div>
<div id="toast" class="toast hidden" role="status"></div>
<script src="/play/static/play.js"></script>
</body>
</html>
`;
const CSP = "default-src 'self'";

let skinsPromise: Promise<SkinBook> | null = null;
function skins(): Promise<SkinBook> {
  skinsPromise ??= loadSkins(SKINS_DIR);
  return skinsPromise;
}

function etagOf(doc: PageDoc): string {
  const hash = createHash("sha256").update(doc.stamp).update("\n").update(doc.markdown).digest("hex").slice(0, 32);
  return `"${hash}"`;
}

function fresh(req: IncomingMessage, etag: string): boolean {
  const inm = req.headers["if-none-match"];
  if (typeof inm !== "string") return false;
  return inm.split(",").some((part) => part.trim() === etag);
}

function send(res: ServerResponse, status: number, type: string, body: string, extra: Record<string, string> = {}): void {
  res.writeHead(status, {
    "Content-Type": `${type}; charset=utf-8`,
    "Content-Length": Buffer.byteLength(body),
    "X-Content-Type-Options": "nosniff",
    ...extra,
  });
  res.end(body);
}

/** Read-only page: validators may cache it; nothing here sets a cookie. */
function sendPage(req: IncomingMessage, res: ServerResponse, doc: PageDoc): void {
  const etag = etagOf(doc);
  if (fresh(req, etag)) {
    res.writeHead(304, {
      ETag: etag,
      "Cache-Control": "public, max-age=0, must-revalidate",
    });
    res.end();
    return;
  }
  send(res, 200, "text/markdown", doc.markdown, {
    ETag: etag,
    "Cache-Control": "public, max-age=0, must-revalidate",
  });
}

function sendHtml(res: ServerResponse, status: number, body: string, csp = false): void {
  send(res, status, "text/html", body, {
    "Cache-Control": "no-store",
    ...(csp ? { "Content-Security-Policy": CSP } : {}),
  });
}

function headerLine(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  return typeof v === "string" ? v : Array.isArray(v) ? v.join(", ") : undefined;
}

/** Browser view of a public page. Region pages use that region's skin; the rest default by language. */
function browserSkin(book: SkinBook, kind: PageKind | "index", ref: string | null, search: URLSearchParams, lang: ShellLang): ResolvedSkin {
  const asked = resolveSkin(book, search);
  if (asked.query !== "") return asked;
  const locale = lang === "zh" ? "zh-CN" : "en";
  const skin: Skin = kind === "region" && ref !== null && (SKINS as readonly string[]).includes(ref) ? (ref as Skin) : lang === "zh" ? "xiuxian" : "fantasy";
  const lex = lexiconFor(book, skin, locale);
  if (lex.skin === null) return { lexicon: neutralLexicon(), query: "" };
  return { lexicon: lex, query: `?skin=${skin}&locale=${encodeURIComponent(locale)}` };
}

function notFound(res: ServerResponse): void {
  send(res, 404, "text/plain", "not found\n", { "Cache-Control": "no-store" });
}

function esc(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function formHtml(spec: WebForm, skinQuery: string, lang: ShellLang): string {
  return formDocument(lang, { title: spec.title, verb: spec.verb, slug: spec.slug, fields: spec.fields }, skinQuery);
}

function indexHtml(skinQuery: string, lang: ShellLang): string {
  const items = VERBS.map((verb) => {
    const forms = formsOf(verb);
    if (forms.length === 0) return `<li><code>${verb}</code> — JSON <code>POST /v1/actions/${verb}</code></li>`;
    const links = forms.map((f) => `<a href="/act/${esc(f.slug)}${skinQuery}">${esc(f.title)}</a>`).join(" · ");
    return `<li><code>${verb}</code> — ${links}</li>`;
  }).join("\n");
  return formsIndexDocument(lang, items, skinQuery);
}

function resultHtml(spec: WebForm, out: DispatchOutput, skinQuery: string, lang: ShellLang): string {
  return resultDocument(lang, spec.title, out.status, JSON.stringify(out.body, null, 2), `/act/${spec.slug}${skinQuery}`, skinQuery);
}

async function readFormBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const b = chunk as Buffer;
    size += b.length;
    if (size > BODY_MAX) return "";
    chunks.push(b);
  }
  return Buffer.concat(chunks).toString("utf8");
}

interface RouteHit {
  kind: PageKind | "index";
  ref: string | null;
}

function routeOf(path: string): RouteHit | null {
  if (path === "/") return { kind: "index", ref: null };
  if (path === "/chronicle") return { kind: "chronicle", ref: null };
  const region = /^\/region\/([a-z]+)$/.exec(path);
  if (region?.[1] !== undefined) return { kind: "region", ref: region[1] };
  const place = /^\/place\/([a-z][a-z0-9_]*:[a-z]+:[a-z][a-z0-9_]*)$/.exec(path);
  if (place?.[1] !== undefined && isFactId(place[1], "place")) return { kind: "place", ref: place[1] };
  const bio = /^\/char\/([a-z][a-z0-9_]*:[a-z]+:[a-z][a-z0-9_]*)$/.exec(path);
  if (bio?.[1] !== undefined && isFactId(bio[1], "char")) return { kind: "char", ref: bio[1] };
  return null;
}

/** Form slugs may carry `_` (use-org_join, use-relation_end, ...). */
const FORM_PATH = /^\/act\/([a-z0-9_-]+)$/;

const STATIC_FILES = new Map<string, string>([
  ["play.js", "text/javascript"],
  ["play.css", "text/css"],
]);

async function sendStatic(res: ServerResponse, name: string): Promise<void> {
  const type = STATIC_FILES.get(name);
  if (type === undefined) return notFound(res);
  let body: string;
  try {
    body = await readFile(join(STATIC_DIR, name), "utf8");
  } catch {
    return notFound(res);
  }
  send(res, 200, type, body, { "Cache-Control": "no-store", "Content-Security-Policy": CSP });
}

async function sendLexicon(res: ServerResponse, skin: string, locale: string): Promise<void> {
  if (!(SKINS as readonly string[]).includes(skin) || !/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})?$/.test(locale)) return notFound(res);
  const file = join(SKINS_DIR, skin, `${locale}.json`);
  if (!file.startsWith(SKINS_DIR)) return notFound(res);
  let body: string;
  try {
    body = await readFile(file, "utf8");
  } catch {
    return notFound(res);
  }
  send(res, 200, "application/json", body, { "Cache-Control": "no-store", "Content-Security-Policy": CSP });
}

/**
 * Public definition catalog: item / skill definitions of this realm plus place
 * content keys. One body for `GET /v1/defs` (no auth, no arguments) and its web
 * alias `GET /play/definitions`.
 */
async function sendDefinitions(deps: PublicDeps, res: ServerResponse): Promise<void> {
  const where = "record = 'definition' AND split_part(id, ':', 1) = $1";
  const items = await selectRows(deps.db, "item", where, [deps.realm]);
  const skills = await selectRows(deps.db, "skill", where, [deps.realm]);
  const places = await selectRows(deps.db, "place", "split_part(id, ':', 1) = $1", [deps.realm]);
  send(res, 200, "application/json", JSON.stringify({ items, skills, places: places.map(({ id, content_key }) => ({ id, content_key })) }), {
    "Cache-Control": "no-store",
    "Content-Security-Policy": CSP,
  });
}

async function sendShop(deps: PublicDeps, res: ServerResponse, id: string): Promise<void> {
  try {
    charId(id, "npc");
    if (id.split(":")[0] !== deps.realm) reject("NOT_FOUND", NO_DETAILS);
    const body = await deps.db.tx(async (q) => {
      const npc = await getRow(q, "char", id);
      if (npc === null) return reject("NOT_FOUND", NO_DETAILS);
      if (npc.kind !== "npc" || npc.archetype !== "merchant" || npc.life !== "alive" || npc.state !== "active") {
        return reject("NOT_ALLOWED", { reason: "service" });
      }
      const world = await mustGetRow(q, "world", worldId(deps.realm));
      const balance = deps.balance();
      requireRevision(balance, world.rules_revision, world.rules.balance_key);
      const stock = await selectRows(q, "item", "record = 'instance' AND holder ->> 'kind' = 'char' AND holder ->> 'id' = $1 AND state = 'available' AND equipped = false", [id], 'ORDER BY id COLLATE "C"');
      const items = [];
      const prices = new Map<string, number>();
      for (const item of stock) {
        if (item.record !== "instance") continue;
        let price = prices.get(item.def_id);
        if (price === undefined) {
          price = tradePrice(balance, await itemPrice(q, balance, item.def_id), "buy");
          prices.set(item.def_id, price);
        }
        items.push({ item, price });
      }
      return { npc: publicChar(npc), items };
    });
    send(res, 200, "application/json", JSON.stringify(body), { "Cache-Control": "no-store", "Content-Security-Policy": CSP });
  } catch (err) {
    if (!(err instanceof ActionError)) throw err;
    const out = errEnvelope(err, { tick: null, ap: null });
    send(res, out.status, "application/json", JSON.stringify(out.body), { "Cache-Control": "no-store", "Content-Security-Policy": CSP });
  }
}

/** S32: a char counts as online after a successful action within the last 10 ticks. */
const ONLINE_WINDOW_TICKS = 10;

function isOnline(c: { state: string; last_seen_tick: string }, tick: string): boolean {
  return c.state !== "buried" && BigInt(tick) - BigInt(c.last_seen_tick) <= BigInt(ONLINE_WINDOW_TICKS);
}

/** Public read-only lookup by handle (设计者原话 2026-11-06 18). */
async function sendWho(deps: PublicDeps, res: ServerResponse, handle: string): Promise<void> {
  const world = await mustGetRow(deps.db, "world", worldId(deps.realm));
  const c = (await selectRows(deps.db, "char", "handle = $1 AND kind = 'player'", [handle]))[0];
  if (c === undefined) {
    send(res, 404, "application/json", JSON.stringify({ ok: false, error: { code: "NOT_FOUND" } }), {
      "Cache-Control": "no-store",
      "Content-Security-Policy": CSP,
    });
    return;
  }
  const online = isOnline(c, world.tick);
  send(res, 200, "application/json", JSON.stringify({
    handle: c.handle,
    char_id: c.id,
    online,
    place_id: online ? c.loc : null,
    char: publicChar(c),
  }), { "Cache-Control": "no-store", "Content-Security-Policy": CSP });
}

/** Public read-only online list (设计者原话 2026-11-06 18): random 20 players per request. */
async function sendOnline(deps: PublicDeps, res: ServerResponse): Promise<void> {
  const world = await mustGetRow(deps.db, "world", worldId(deps.realm));
  const since = BigInt(world.tick) - BigInt(ONLINE_WINDOW_TICKS);
  const r = await deps.db.query<{
    id: string;
    handle: string | null;
    tier: number;
    stage: number;
    skin: string;
    region: string;
  }>(
    `SELECT c.id, c.handle, c.tier, c.stage, c.skin, p.region
     FROM chars c JOIN places p ON p.id = c.loc
     WHERE c.kind = 'player' AND c.state <> 'buried' AND c.last_seen_tick >= $1::bigint
     ORDER BY random() LIMIT 20`,
    [since.toString()],
  );
  const online = r.rows.map((row) => ({
    handle: row.handle,
    char_id: row.id,
    tier: row.tier,
    stage: row.stage,
    skin: row.skin,
    region: row.region,
  }));
  send(res, 200, "application/json", JSON.stringify({ count: online.length, online }), {
    "Cache-Control": "no-store",
    "Content-Security-Policy": CSP,
  });
}

/** Browser view of a handle (S32): same dark shell, server-rendered, no script. */
async function sendIdPage(deps: PublicDeps, res: ServerResponse, handle: string): Promise<void> {
  const world = await mustGetRow(deps.db, "world", worldId(deps.realm));
  const c = (await selectRows(deps.db, "char", "handle = $1 AND kind = 'player'", [handle]))[0];
  const page = (title: string, body: string): string => `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="/play/static/play.css">
</head>
<body>
<div class="wrap">
<section class="card stack">
<h2 class="place-title">${esc(title)}</h2>
${body}
</section>
</div>
</body>
</html>
`;
  if (c === undefined) {
    sendHtml(res, 404, page(`短号 ${handle}`, `<p class="muted">没有这个短号。</p>`), true);
    return;
  }
  const online = isOnline(c, world.tick);
  const rows = [
    `短号 <code>${esc(c.handle ?? "")}</code>`,
    `角色 <a href="/char/${esc(c.id)}"><code>${esc(c.id)}</code></a>`,
    online ? "在线" : "离线",
    online ? `在 <code>${esc(c.loc)}</code>` : "",
    `皮 ${esc(c.skin)} · ${esc(c.kind)}`,
    c.model === null ? "" : `自称 ${esc(c.model)}`,
  ].filter((x) => x !== "");
  sendHtml(res, 200, page(`短号 ${c.handle ?? handle}`, `<p class="small">${rows.join("<br>")}</p>`), true);
}

async function handleGet(deps: PublicDeps, req: IncomingMessage, res: ServerResponse, path: string, search: URLSearchParams): Promise<void> {
  if (path === "/v1/verbs" || path === "/v1/actions") {
    const world = await mustGetRow(deps.db, "world", worldId(deps.realm));
    send(res, 200, "application/json", JSON.stringify(verbCatalog(world.rules, world.rules_revision)), { "Cache-Control": "no-store", "Content-Security-Policy": CSP });
    return;
  }
  const who = /^\/v1\/who\/([A-Z][0-9]{5,7})$/.exec(path);
  if (who?.[1] !== undefined) {
    await sendWho(deps, res, who[1]);
    return;
  }
  if (path === "/v1/online") {
    await sendOnline(deps, res);
    return;
  }
  const idPage = /^\/id\/([A-Z][0-9]{5,7})$/.exec(path);
  if (idPage?.[1] !== undefined) {
    await sendIdPage(deps, res, idPage[1]);
    return;
  }
  const shop = /^\/v1\/shops\/([^/]+)$/.exec(path);
  if (shop?.[1] !== undefined) {
    await sendShop(deps, res, decodeURIComponent(shop[1]));
    return;
  }
  if (path === "/play") {
    sendHtml(res, 200, PLAY_PAGE, true);
    return;
  }
  if (path === "/v1/defs" || path === "/play/definitions") {
    await sendDefinitions(deps, res);
    return;
  }
  const asset = /^\/play\/static\/(play\.(?:js|css))$/.exec(path);
  if (asset?.[1] !== undefined) {
    await sendStatic(res, asset[1]);
    return;
  }
  const lex = /^\/play\/lexicon\/([a-z]+)\/([a-zA-Z0-9-]+)\.json$/.exec(path);
  if (lex?.[1] !== undefined && lex[2] !== undefined) {
    await sendLexicon(res, lex[1], lex[2]);
    return;
  }
  const book = await skins();
  const html = wantsHtml(headerLine(req, "accept"));
  const lang = shellLang(headerLine(req, "accept-language"));
  const chosen = resolveSkin(book, search);
  if (path === "/act") {
    sendHtml(res, 200, indexHtml(chosen.query, lang), true);
    return;
  }
  const slug = FORM_PATH.exec(path);
  if (slug?.[1] !== undefined) {
    const spec = formBySlug(slug[1]);
    if (spec === null) return notFound(res);
    sendHtml(res, 200, formHtml(spec, chosen.query, lang), true);
    return;
  }
  const hit = routeOf(path);
  if (hit === null) return notFound(res);
  if (!html) {
    if (hit.kind === "index") {
      sendPage(req, res, indexDoc(book, chosen.query));
      return;
    }
    const doc = await renderPage(deps.db, { kind: hit.kind, ref: hit.ref, lexicon: chosen.lexicon });
    if (doc === null) return notFound(res);
    sendPage(req, res, doc);
    return;
  }
  const view = browserSkin(book, hit.kind, hit.ref, search, lang);
  if (hit.kind === "index") {
    sendHtml(res, 200, homeHtml(lang, book), true);
    return;
  }
  const doc = await renderPage(deps.db, { kind: hit.kind, ref: hit.ref, lexicon: view.lexicon });
  if (doc === null) return notFound(res);
  sendHtml(res, 200, publicHtml(lang, doc.markdown, view.query), true);
}

async function handlePost(deps: PublicDeps, req: IncomingMessage, res: ServerResponse, path: string, search: URLSearchParams): Promise<void> {
  const slug = FORM_PATH.exec(path)?.[1];
  const spec = slug === undefined ? null : formBySlug(slug);
  if (spec === null) return notFound(res);
  const type = req.headers["content-type"] ?? "";
  if (!type.startsWith("application/x-www-form-urlencoded")) {
    send(res, 415, "text/plain", "expected application/x-www-form-urlencoded\n", { "Cache-Control": "no-store" });
    return;
  }
  const raw = await readFormBody(req);
  if (raw === "" && Number(req.headers["content-length"] ?? 0) > BODY_MAX) {
    send(res, 400, "text/plain", "form body too large\n", { "Cache-Control": "no-store" });
    return;
  }
  const posted = new URLSearchParams(raw);
  const fields = new Map<string, string>();
  for (const [k, v] of posted.entries()) fields.set(k, v);
  const code = fields.get("code") ?? "";
  const out = await deps.dispatch({
    verb: spec.verb,
    body: { args: argsFromPost(spec, fields) },
    bearer: spec.needsCode ? code : null,
    door: "web",
  });
  const book = await skins();
  const lang = shellLang(headerLine(req, "accept-language"));
  sendHtml(res, out.status, resultHtml(spec, out, resolveSkin(book, search).query, lang), true);
}

async function handlePlay(deps: PublicDeps, req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  const verb = /^\/play\/v1\/([a-z]{1,32})$/.exec(path)?.[1];
  if (verb === undefined) return notFound(res);
  const type = req.headers["content-type"] ?? "";
  if (!type.startsWith("application/json")) {
    send(res, 415, "application/json", JSON.stringify({ ok: false, error: { code: "INVALID_ARGUMENT" } }), {
      "Cache-Control": "no-store",
      "Content-Security-Policy": CSP,
    });
    return;
  }
  const raw = await readFormBody(req);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    send(res, 400, "application/json", JSON.stringify({ ok: false, error: { code: "INVALID_ARGUMENT" } }), {
      "Cache-Control": "no-store",
      "Content-Security-Policy": CSP,
    });
    return;
  }
  const out = await deps.dispatch({ verb, body, bearer: parseBearer(req.headers.authorization), door: "web" });
  if (verb === "look" && out.body.ok && (body as { args?: { section?: string } })?.args?.section === "place") {
    const result = out.body.result as LookResult;
    const people = await selectRows(deps.db, "char", "loc = $1 AND state <> 'buried'", [result.place.id]);
    const items = await selectRows(deps.db, "item", "record = 'instance' AND holder ->> 'kind' = 'place' AND holder ->> 'id' = $1 AND state = 'available'", [result.place.id]);
    const enriched = { ...out.body, result: { ...result, people: people.map(publicChar), items } };
    send(res, out.status, "application/json", JSON.stringify(enriched), { "Cache-Control": "no-store", "Content-Security-Policy": CSP });
    return;
  }
  const json = out.json ?? JSON.stringify(out.body);
  send(res, out.status, "application/json", json, { "Cache-Control": "no-store", "Content-Security-Policy": CSP });
}

export async function handlePublic(deps: PublicDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://public.local");
  const path = decodeURI(url.pathname);
  if (req.method === "GET" || req.method === "HEAD") {
    await handleGet(deps, req, res, path, url.searchParams);
    return;
  }
  if (req.method === "POST" && path.startsWith("/play/v1/")) {
    await handlePlay(deps, req, res, path);
    return;
  }
  if (req.method === "POST") {
    await handlePost(deps, req, res, path, url.searchParams);
    return;
  }
  send(res, 405, "text/plain", "method not allowed\n", { Allow: "GET, HEAD, POST", "Cache-Control": "no-store" });
}
