// HTTP entry (动词表 §1): the only action route is POST /v1/actions/<verb> with a
// JSON body {"args":{…}} and `Authorization: Bearer <code>`. GET never runs an
// action; every other request goes to the public-page router (S13).
// No request body, header or identity code is ever logged.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { parseBearer } from "../identity/auth.ts";
import { errText, log } from "../log.ts";
import { ActionError } from "../protocol/errors.ts";
import { handlePublic, type PublicDeps } from "../public/routes.ts";
import { dispatch, errEnvelope, outcomeUnknown, type DispatchOutput, type RunnerDeps } from "../verbs/runner.ts";

const ACTION_PREFIX = "/v1/actions/";
const VERB_RE = /^[a-z]{1,32}$/;

export interface HttpDeps extends RunnerDeps {
  bodyMaxBytes: number;
  public: PublicDeps;
}

function send(res: ServerResponse, out: DispatchOutput, extra: Record<string, string> = {}): void {
  const body = out.json ?? JSON.stringify(out.body);
  res.writeHead(out.status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
    ...extra,
  });
  res.end(body);
}

function protocolError(expected: string, field: string | null = null): DispatchOutput {
  return errEnvelope(new ActionError("INVALID_ARGUMENT", { expected }, field), { tick: null, ap: null });
}

class TooLarge extends Error {}

async function readBody(req: IncomingMessage, max: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const b = chunk as Buffer;
    size += b.length;
    if (size > max) throw new TooLarge();
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}

function isJsonContentType(ct: string | undefined): boolean {
  if (ct === undefined) return false;
  const [type, ...params] = ct.split(";").map((s) => s.trim().toLowerCase());
  if (type !== "application/json") return false;
  return params.every((p) => !p.startsWith("charset=") || p === "charset=utf-8" || p === 'charset="utf-8"');
}

async function handleAction(deps: HttpDeps, req: IncomingMessage, res: ServerResponse, verb: string): Promise<void> {
  if (req.method !== "POST") {
    send(res, protocolError("POST"), { Allow: "POST" });
    return;
  }
  if (!VERB_RE.test(verb)) {
    send(res, await dispatch(deps, { verb: "", body: null, bearer: null, door: "api" }));
    return;
  }
  if (!isJsonContentType(req.headers["content-type"])) {
    send(res, protocolError("Content-Type: application/json; charset=utf-8"));
    return;
  }
  let raw: Buffer;
  try {
    raw = await readBody(req, deps.bodyMaxBytes);
  } catch (err) {
    if (err instanceof TooLarge) {
      send(res, protocolError(`JSON body of at most ${deps.bodyMaxBytes} bytes`), { Connection: "close" });
      return;
    }
    throw err;
  }
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  } catch {
    send(res, protocolError("UTF-8 JSON body"));
    return;
  }
  const bearer = parseBearer(req.headers.authorization);
  const out = await dispatch(deps, { verb, body, bearer, door: "api" });
  // From here the action may be committed: a failure must not claim committed:false.
  try {
    send(res, out);
  } catch (err) {
    log.error("http response failed after dispatch", { err: errText(err) });
    if (res.headersSent) res.destroy();
    else send(res, outcomeUnknown(out.body.tick));
  }
}

export function createHttpServer(deps: HttpDeps): Server {
  return createServer((req, res) => {
    const started = performance.now();
    const path = (req.url ?? "/").split("?")[0] ?? "/";
    const done = (route: string): void => {
      log.info("http", { method: req.method ?? "", route, status: res.statusCode, ms: Math.round(performance.now() - started) });
    };
    const isAction = path.startsWith(ACTION_PREFIX);
    const work = isAction
      ? handleAction(deps, req, res, path.slice(ACTION_PREFIX.length)).then(() => {
          const v = path.slice(ACTION_PREFIX.length);
          done(VERB_RE.test(v) ? `action:${v}` : "action:?");
        })
      : handlePublic(deps.public, req, res).then(() => done("public"));
    work.catch((err: unknown) => {
      log.error("http handler failed", { err: errText(err) });
      if (res.headersSent) {
        res.destroy();
        return;
      }
      // Action path: anything reaching here failed before dispatch returned, so nothing
      // committed. Public path: the form shell may have dispatched — outcome unknown.
      send(
        res,
        isAction ? errEnvelope(new ActionError("RETRY_LATER", { committed: false }), { tick: null, ap: null }) : outcomeUnknown(null),
      );
    });
  });
}
