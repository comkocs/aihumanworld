// Stateless Streamable HTTP: one JSON-RPC response, no session and no SSE.

import type { IncomingMessage, ServerResponse } from "node:http";
import { worldId } from "../facts/ids.ts";
import { mustGetRow } from "../facts/store.ts";
import { parseBearer } from "../identity/auth.ts";
import { log } from "../log.ts";
import { dispatch, type RunnerDeps } from "../verbs/runner.ts";
import { findVerb } from "../verbs/registry.ts";
import { INSTRUCTIONS, mcpTools } from "./catalog.ts";

interface McpDeps extends RunnerDeps {
  bodyMaxBytes: number;
}

type RpcId = string | number | null;

class RpcError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

class TooLarge extends Error {}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidParams(): never {
  throw new RpcError(-32602, "Invalid params");
}

function send(res: ServerResponse, status: number, body: object, extra: Record<string, string> = {}): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(json),
    ...extra,
  });
  res.end(json);
}

function sendError(res: ServerResponse, status: number, id: RpcId, code: number, message: string, extra: Record<string, string> = {}): void {
  send(res, status, { jsonrpc: "2.0", id, error: { code, message } }, extra);
}

async function readJson(req: IncomingMessage, max: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    const data = chunk as Buffer;
    size += data.length;
    if (size > max) throw new TooLarge();
    chunks.push(data);
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch {
    throw new RpcError(-32700, "Parse error");
  }
}

async function result(deps: McpDeps, req: IncomingMessage, method: string, params: unknown): Promise<object> {
  if (params !== undefined && !object(params)) invalidParams();
  switch (method) {
    case "initialize": {
      if (!object(params) || typeof params.protocolVersion !== "string" || !object(params.capabilities) ||
          !object(params.clientInfo) || typeof params.clientInfo.name !== "string" || typeof params.clientInfo.version !== "string") invalidParams();
      const world = await mustGetRow(deps.db, "world", worldId(deps.realm));
      return {
        protocolVersion: ["2025-11-25", "2025-06-18", "2025-03-26"].includes(params.protocolVersion) ? params.protocolVersion : "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "aihumanworld", version: world.rules_revision },
        instructions: INSTRUCTIONS,
      };
    }
    case "ping":
      return {};
    case "tools/list": {
      if (object(params) && params.cursor !== undefined && typeof params.cursor !== "string") invalidParams();
      const world = await mustGetRow(deps.db, "world", worldId(deps.realm));
      return { tools: mcpTools(world.rules, world.rules_revision) };
    }
    case "tools/call": {
      if (!object(params) || typeof params.name !== "string" || findVerb(params.name) === null) invalidParams();
      const args = params.arguments === undefined ? {} : params.arguments;
      if (!object(args)) invalidParams();
      const { code, ...actionArgs } = args;
      const headerCode = parseBearer(req.headers.authorization);
      if (headerCode === null && code !== undefined && typeof code !== "string") invalidParams();
      const out = await dispatch(deps, {
        verb: params.name,
        body: { args: actionArgs },
        bearer: headerCode ?? (typeof code === "string" ? code : null),
        door: "api",
      });
      return {
        structuredContent: out.body,
        content: [{ type: "text", text: out.json ?? JSON.stringify(out.body) }],
        ...(out.body.ok ? {} : { isError: true }),
      };
    }
    default:
      throw new RpcError(-32601, "Method not found");
  }
}

export async function handleMcp(deps: McpDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") {
    sendError(res, 405, null, -32600, "Method not allowed", { Allow: "POST" });
    return;
  }
  let id: RpcId = null;
  try {
    const ct = req.headers["content-type"]?.split(";").map((part) => part.trim().toLowerCase());
    if (ct?.[0] !== "application/json" || ct.slice(1).some((part) => part.startsWith("charset=") && part !== "charset=utf-8" && part !== 'charset="utf-8"')) {
      sendError(res, 415, null, -32600, "Expected application/json with UTF-8 charset");
      return;
    }
    const body = await readJson(req, deps.bodyMaxBytes);
    if (!object(body) || body.jsonrpc !== "2.0" || typeof body.method !== "string" ||
        (Object.hasOwn(body, "id") && body.id !== null && typeof body.id !== "string" && typeof body.id !== "number")) {
      throw new RpcError(-32600, "Invalid Request");
    }
    if (!Object.hasOwn(body, "id")) {
      res.writeHead(202, { "Cache-Control": "no-store", "Content-Length": "0" });
      res.end();
      return;
    }
    id = body.id as RpcId;
    const value = await result(deps, req, body.method, body.params);
    send(res, 200, { jsonrpc: "2.0", id, result: value });
  } catch (err) {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    if (err instanceof TooLarge) {
      sendError(res, 413, null, -32600, "Request body too large", { Connection: "close" });
    } else if (err instanceof RpcError) {
      sendError(res, err.code === -32700 || err.code === -32600 ? 400 : 200, id, err.code, err.message);
    } else {
      // Never log exception text: database / parser errors may contain arguments.
      log.error("mcp handler failed");
      sendError(res, 500, id, -32603, "Internal error; action outcome may be unknown");
    }
  }
}
