// Verb dispatch: the single path every action takes, from any entry shell.
//   envelope {"args":{…}} → args validation → lazy tick catch-up → transaction:
//   world row (locked for lock="world") → auth (char row locked) →
//   NOT_IMPLEMENTED if no handler → AP cost → presence gate → spend →
//   access stamp → handler → response envelope.
// A rejection (ActionError) rolls everything back: no fact change, no AP spent.

import type { Db } from "../db/db.ts";
import { AmbiguousCommitError, RetryableDbError } from "../db/db.ts";
import type { Door } from "../facts/enums.ts";
import { worldId } from "../facts/ids.ts";
import { getRow, mustGetRow } from "../facts/store.ts";
import type { CharRow, ID, Seq, Tick } from "../facts/types.ts";
import { Writer } from "../facts/writer.ts";
import { apView, trySpend, type ApView } from "../clock/budget.ts";
import type { Clock } from "../clock/scheduler.ts";
import { authenticate, touchSeen } from "../identity/auth.ts";
import { errText, log } from "../log.ts";
import { ActionError, ERROR_HTTP, NO_DETAILS, reject, type ErrorCode } from "../protocol/errors.ts";
import { apCost, requireRule } from "../rules/world_rules.ts";
import { briefingStart, rememberBriefingStart, type Briefing } from "./briefing.ts";
import { envelopeExtras, type NewSpeech, type Notice } from "./envelope_extras.ts";
import { findVerb } from "./registry.ts";
import type { AnyVerbDef, Gate, Services, VerbContext } from "./types.ts";

export const PROTOCOL = "aihw.v1";

export interface OkEnvelope {
  protocol: typeof PROTOCOL;
  ok: true;
  tick: Tick;
  rules_revision: string;
  ap: ApView;
  result: unknown;
  deed_ids: ID[];
  event_head: Seq;
  /** S46: direct sentences others said to this char since its previous successful action (≤5, absent when none). */
  new_speech?: NewSpeech[];
  /** S46/S81: "entry guide updated", a short burst per char per content/notice.json rev. */
  notice?: Notice;
  /** S81: current entry guide revision, when the notice file is valid. */
  guide_rev?: string;
  /** S87: bounded offline facts, once per returning interval. */
  briefing?: Briefing;
}

export interface ErrEnvelope {
  protocol: typeof PROTOCOL;
  ok: false;
  tick: Tick | null;
  error: { code: ErrorCode; field: string | null; details: object };
  ap: ApView | null;
}

export interface DispatchOutput {
  status: number;
  body: OkEnvelope | ErrEnvelope;
  /**
   * Body already serialised. Successful actions serialise inside the
   * transaction, before COMMIT: a serialisation failure rolls back, so it can
   * truthfully answer RETRY_LATER {committed:false}.
   */
  json?: string;
}

export interface DispatchInput {
  verb: string;
  /** Parsed JSON request body. */
  body: unknown;
  /** Bearer code (null = no Authorization header, "" = malformed). */
  bearer: string | null;
  door: Door;
}

export interface RunnerDeps {
  db: Db;
  realm: string;
  clock: Clock;
  services: Services;
  now?: () => Date;
}

interface Trace {
  tick: Tick | null;
  ap: ApView | null;
  /** Run after a successful COMMIT (S46: what the envelope showed is remembered only once it is true). */
  afterCommit?: (() => void)[];
}

const MAX_ATTEMPTS = 3;

export function errEnvelope(err: ActionError, trace: Trace): DispatchOutput {
  return {
    status: ERROR_HTTP[err.code],
    body: {
      protocol: PROTOCOL,
      ok: false,
      tick: trace.tick,
      error: { code: err.code, field: err.field, details: err.details as object },
      ap: trace.ap,
    },
  };
}

/** RETRY_LATER when the outcome cannot be known: details stay empty, never `committed:false`. */
export function outcomeUnknown(tick: Tick | null): DispatchOutput {
  return {
    status: ERROR_HTTP.RETRY_LATER,
    body: { protocol: PROTOCOL, ok: false, tick, error: { code: "RETRY_LATER", field: null, details: {} }, ap: null },
  };
}

async function peekTick(deps: RunnerDeps): Promise<Tick | null> {
  try {
    return (await getRow(deps.db, "world", worldId(deps.realm)))?.tick ?? null;
  } catch {
    return null;
  }
}

function applyGate(c: CharRow, gate: Gate): void {
  if (gate === "none") return;
  if (c.state !== "draft" && c.state !== "active") {
    reject("STATE_BLOCKED", { state: c.state, required_action: "enter" });
  }
  if (gate === "acting" && c.life !== "alive") {
    reject("LIFE_BLOCKED", { revive_tick: c.revive_tick ?? "0" });
  }
}

async function runInTx(deps: RunnerDeps, def: AnyVerbDef, args: unknown, input: DispatchInput, trace: Trace): Promise<DispatchOutput> {
  return deps.db.tx(async (q) => {
    const now = (deps.now ?? (() => new Date()))();
    const locked = def.lock === "world";
    const world = await mustGetRow(q, "world", worldId(deps.realm), { lock: locked });
    trace.tick = world.tick;
    const rules = world.rules;
    const perTick = requireRule(rules, "ap_per_tick");
    const w = new Writer(q, deps.realm, world.tick, world.rules_revision, locked);

    let actor: CharRow | null = null;
    /** The authenticated char's previous successful action tick (null = no char before the handler, e.g. enter create). */
    let previousSeen: Tick | null = null;
    if (def.auth(args)) {
      actor = await authenticate(q, input.bearer, { lock: true });
      trace.ap = apView(actor, world.tick, perTick);
    }
    if (def.handler === undefined) return reject("NOT_IMPLEMENTED", NO_DETAILS);

    const cost = apCost(rules, def.costKey(args));
    if (actor !== null) {
      applyGate(actor, def.gate?.(args) ?? (cost > 0 ? "acting" : "none"));
      if (cost > 0) {
        const s = trySpend(actor, world.tick, perTick, cost);
        if (!s.ok) return reject("AP_EXHAUSTED", { remaining: s.remaining, required: s.required, next_tick: s.next_tick });
        await w.update("char", actor.id, s.state);
        actor = { ...actor, ...s.state };
      }
      previousSeen = actor.last_seen_tick;
      actor = await touchSeen(w, actor, world.tick, now);
    }

    const ctx: VerbContext = {
      q,
      w,
      world,
      rules,
      balance: deps.services.balance(),
      tick: world.tick,
      now,
      door: input.door,
      actor,
      services: deps.services,
    };
    rememberBriefingStart(ctx, previousSeen);
    const result = await def.handler(ctx, args);
    const after = ctx.actor;
    if (after === null) throw new Error(`${def.verb}: no actor after handler`);
    const head = await q.query<{ event_head: string }>("SELECT event_head FROM worlds WHERE id = $1", [world.id]);
    const body: OkEnvelope = {
      protocol: PROTOCOL,
      ok: true,
      tick: world.tick,
      rules_revision: world.rules_revision,
      ap: apView(after, world.tick, perTick),
      result,
      deed_ids: [...w.deedIds],
      event_head: String(head.rows[0]?.event_head ?? world.event_head),
    };
    const extrasSeen = briefingStart(ctx);
    if (extrasSeen !== null) {
      const extras = await envelopeExtras(q, deps.services, deps.services.speech, deps.realm, rules, after.id, extrasSeen, world.tick, body.event_head, ctx);
      if (extras.briefing !== undefined && def.verb !== "enter") body.briefing = extras.briefing;
      if (extras.new_speech !== undefined) body.new_speech = extras.new_speech;
      if (extras.notice !== undefined) body.notice = extras.notice;
      if (extras.guide_rev !== undefined) body.guide_rev = extras.guide_rev;
      trace.afterCommit?.push(extras.commit);
    }
    // Serialise before COMMIT (see DispatchOutput.json).
    return { status: 200, body, json: JSON.stringify(body) };
  });
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

export async function dispatch(deps: RunnerDeps, input: DispatchInput): Promise<DispatchOutput> {
  const trace: Trace = { tick: null, ap: null };
  const def = findVerb(input.verb);
  if (def === null) {
    trace.tick = await peekTick(deps);
    return errEnvelope(new ActionError("UNKNOWN_VERB", NO_DETAILS), trace);
  }
  let args: unknown;
  try {
    const body = input.body;
    if (!isPlainObject(body)) reject("INVALID_ARGUMENT", { expected: '{"args":{…}}' }, "body");
    for (const k of Object.keys(body)) if (k !== "args") reject("INVALID_ARGUMENT", { expected: "no such field" }, k);
    if (!Object.hasOwn(body, "args")) reject("INVALID_ARGUMENT", { expected: "required field" }, "args");
    args = def.args(body.args, "args");
  } catch (err) {
    if (err instanceof ActionError) {
      trace.tick = await peekTick(deps);
      return errEnvelope(err, trace);
    }
    throw err;
  }

  try {
    await deps.clock.advanceDue();
  } catch (err) {
    // Deliberate: the request still runs on the last committed tick (README 刻调度).
    log.error("lazy tick catch-up failed", { err: errText(err) });
  }

  for (let attempt = 1; ; attempt += 1) {
    trace.tick = null;
    trace.ap = null;
    trace.afterCommit = [];
    try {
      const out = await runInTx(deps, def, args, input, trace);
      for (const done of trace.afterCommit) done();
      return out;
    } catch (err) {
      if (err instanceof ActionError) return errEnvelope(err, trace);
      if (err instanceof RetryableDbError && attempt < MAX_ATTEMPTS) continue;
      if (err instanceof AmbiguousCommitError) {
        // Outcome unknown: never claim "not committed"; client must re-read facts first.
        log.error("commit outcome unknown", { verb: def.verb });
        return outcomeUnknown(trace.tick);
      }
      log.error("action failed", { verb: def.verb, err: errText(err) });
      return errEnvelope(new ActionError("RETRY_LATER", { committed: false }), { tick: trace.tick, ap: null });
    }
  }
}
