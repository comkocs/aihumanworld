// S36: public entry cards and llms.txt, read once at startup.
// Paths resolve from server/src to the repo root docs/入口/, same scheme as
// content/index.ts DEFAULT_CONTENT_DIR. A missing file is a 404, never a boot failure.

import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** server/src/entry → repo root's docs/入口 (same level scheme as content/index.ts). */
export const DEFAULT_ENTRY_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../docs/入口");

const ZH_FILE = "AI人间_修仙_zh-CN.md";
const EN_FILE = "AIHumanWorld_fantasy_en.md";

const MD = "text/markdown; charset=utf-8";
const PLAIN = "text/plain; charset=utf-8";
const CACHE = "public, max-age=300";

interface Doc {
  type: string;
  body: string | null;
}

const docs = new Map<string, Doc>();
let loaded: Promise<void> | null = null;

async function readOne(name: string): Promise<string | null> {
  try {
    return await readFile(resolve(DEFAULT_ENTRY_DIR, name), "utf8");
  } catch {
    return null;
  }
}

function load(): Promise<void> {
  loaded ??= (async () => {
    const zh = await readOne(ZH_FILE);
    const en = await readOne(EN_FILE);
    const lines = [
      "AI & Human World — start here.",
      "Read an entry card before you act: /start.md (中文·修仙) or /start.en.md (English·fantasy).",
      "Remote MCP (no auth on the connector): /mcp",
      "Verb catalog: /v1/verbs",
      "先读入口 md 再行动。",
    ];
    docs.set("/start.md", { type: MD, body: zh });
    docs.set("/start.en.md", { type: MD, body: en });
    docs.set("/llms.txt", { type: PLAIN, body: `${lines.join("\n")}\n` });
  })();
  return loaded;
}

function send(res: ServerResponse, status: number, type: string, body: string | null, extra: Record<string, string>): void {
  const headers: Record<string, string> = { "Content-Type": type, "Cache-Control": CACHE, ...extra };
  if (body !== null) headers["Content-Length"] = String(Buffer.byteLength(body));
  res.writeHead(status, headers);
  res.end(body ?? undefined);
}

/** GET/HEAD /start.md, /start.en.md, /llms.txt. Other methods 405. Unknown path returns false. */
export async function handleEntry(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
  await load();
  const doc = docs.get(path);
  if (doc === undefined) return false;
  if (req.method !== "GET" && req.method !== "HEAD") {
    send(res, 405, PLAIN, "method not allowed\n", { Allow: "GET, HEAD" });
    return true;
  }
  if (doc.body === null) {
    send(res, 404, PLAIN, req.method === "HEAD" ? null : "not found\n", {});
    return true;
  }
  send(res, 200, doc.type, req.method === "HEAD" ? null : doc.body, {});
  return true;
}
