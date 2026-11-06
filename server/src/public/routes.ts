// Public pages (S13): chronicle / region / place / biography as Markdown, plus
// one minimal HTML form per action. Everything that is not POST /v1/actions/<verb>
// lands here (http/server.ts). Pages are projections of facts and never contain
// identity codes or their hashes. A form submits through `dispatch` with door
// "web" — no second action path, no session, no cookie.

import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import type { Db } from "../db/db.ts";
import { SERVER_ROOT } from "../config.ts";
import { VERBS } from "../facts/enums.ts";
import type { DispatchInput, DispatchOutput } from "../verbs/runner.ts";
import { argsFromPost, formBySlug, formsOf, type WebForm } from "./forms.ts";
import { indexDoc, isFactId, renderPage, resolveSkin, type PageDoc, type PageKind } from "./pages.ts";
import { loadSkins, type SkinBook } from "./skins.ts";

export interface PublicDeps {
  db: Db;
  realm: string;
  /** Run a verb exactly like the JSON API does (use door: "web"). */
  dispatch(input: DispatchInput): Promise<DispatchOutput>;
}

const BODY_MAX = 65536;
const SKINS_DIR = join(SERVER_ROOT, "..", "content", "skins");

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

function sendHtml(res: ServerResponse, status: number, body: string): void {
  send(res, status, "text/html", body, { "Cache-Control": "no-store" });
}

function notFound(res: ServerResponse): void {
  send(res, 404, "text/plain", "not found\n", { "Cache-Control": "no-store" });
}

function esc(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function formHtml(spec: WebForm, skinQuery: string): string {
  const inputs = spec.fields
    .map((f) => {
      const control =
        f.kind === "select"
          ? `<select name="${esc(f.name)}">${(f.options ?? []).map((o) => `<option value="${esc(o)}">${esc(o === "" ? "(empty)" : o)}</option>`).join("")}</select>`
          : `<input name="${esc(f.name)}" type="${f.name === "code" ? "password" : "text"}" autocomplete="off">`;
      return `<label>${esc(f.label)}<br>${control}</label>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>${esc(spec.title)}</title></head>
<body>
<p><a href="/${skinQuery}">公开页</a> · <a href="/act${skinQuery}">全部动作</a></p>
<h1>${esc(spec.title)}</h1>
<p>verb <code>${esc(spec.verb)}</code> · door <code>web</code> · 身份码只在这次提交里,不进网址。</p>
<form method="post" action="/act/${esc(spec.slug)}">
${inputs}
<button type="submit">提交</button>
</form>
</body></html>
`;
}

function indexHtml(skinQuery: string): string {
  const items = VERBS.map((verb) => {
    const forms = formsOf(verb);
    if (forms.length === 0) return `<li><code>${verb}</code> — 参数是嵌套对象,走 JSON 接口 <code>POST /v1/actions/${verb}</code></li>`;
    const links = forms.map((f) => `<a href="/act/${esc(f.slug)}${skinQuery}">${esc(f.title)}</a>`).join(" · ");
    return `<li><code>${verb}</code> — ${links}</li>`;
  }).join("\n");
  return `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>动作表单</title></head>
<body>
<p><a href="/${skinQuery}">公开页</a></p>
<h1>动作 · 网页表单</h1>
<p>每个动作一张表单。身份码填在表单里提交,不出现在网址上。提交走与 JSON 接口同一个分发,入口记 web。</p>
<ul>
${items}
</ul>
</body></html>
`;
}

function resultHtml(spec: WebForm, out: DispatchOutput, skinQuery: string): string {
  const body = JSON.stringify(out.body, null, 2);
  return `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>${esc(spec.title)} · 结果</title></head>
<body>
<p><a href="/act/${esc(spec.slug)}${skinQuery}">返回表单</a> · <a href="/${skinQuery}">公开页</a></p>
<h1>${esc(spec.title)} · 结果</h1>
<p>HTTP ${out.status} · door web</p>
<pre>${esc(body)}</pre>
</body></html>
`;
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

async function handleGet(deps: PublicDeps, req: IncomingMessage, res: ServerResponse, path: string, search: URLSearchParams): Promise<void> {
  const book = await skins();
  const chosen = resolveSkin(book, search);
  if (path === "/act") {
    sendHtml(res, 200, indexHtml(chosen.query));
    return;
  }
  const slug = /^\/act\/([a-z0-9-]+)$/.exec(path);
  if (slug?.[1] !== undefined) {
    const spec = formBySlug(slug[1]);
    if (spec === null) return notFound(res);
    sendHtml(res, 200, formHtml(spec, chosen.query));
    return;
  }
  const hit = routeOf(path);
  if (hit === null) return notFound(res);
  if (hit.kind === "index") {
    sendPage(req, res, indexDoc(book, chosen.query));
    return;
  }
  const doc = await renderPage(deps.db, { kind: hit.kind, ref: hit.ref, lexicon: chosen.lexicon });
  if (doc === null) return notFound(res);
  sendPage(req, res, doc);
}

async function handlePost(deps: PublicDeps, req: IncomingMessage, res: ServerResponse, path: string, search: URLSearchParams): Promise<void> {
  const slug = /^\/act\/([a-z0-9-]+)$/.exec(path)?.[1];
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
  sendHtml(res, out.status, resultHtml(spec, out, resolveSkin(book, search).query));
}

export async function handlePublic(deps: PublicDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://public.local");
  const path = decodeURI(url.pathname);
  if (req.method === "GET" || req.method === "HEAD") {
    await handleGet(deps, req, res, path, url.searchParams);
    return;
  }
  if (req.method === "POST") {
    await handlePost(deps, req, res, path, url.searchParams);
    return;
  }
  send(res, 405, "text/plain", "method not allowed\n", { Allow: "GET, HEAD, POST", "Cache-Control": "no-store" });
}
