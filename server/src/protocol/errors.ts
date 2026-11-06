// Closed error-code set of 动词表_v1 §3, plus NOT_IMPLEMENTED (S9 addition:
// the verb table has no "not implemented" code; it disappears once every verb
// has a handler). `details` is typed per code so no undeclared field can leak.

import type { ID, Seq, Tick, UInt } from "../facts/types.ts";
import type { EventScope, IdentityState, TaskState } from "../facts/enums.ts";

export interface ErrorDetailsMap {
  INVALID_ARGUMENT: { expected: string };
  INVALID_KEY: { expected: string };
  UNKNOWN_VERB: Record<string, never>;
  AUTH_REQUIRED: Record<string, never>;
  AUTH_INVALID: Record<string, never>;
  STATE_BLOCKED: { state: IdentityState; required_action: "enter" };
  LIFE_BLOCKED: { revive_tick: Tick };
  IDENTITY_EXPIRED: { can_create: true };
  RULES_UNSET: { rule_key: string };
  AP_EXHAUSTED: { remaining: UInt; required: UInt; next_tick: Tick };
  NOT_FOUND: Record<string, never>;
  NOT_HERE: Record<string, never>;
  NOT_ALLOWED: { reason: "combat" | "ownership" | "rank" | "registry" | "service" | "faith_locked" | "org" };
  EXIT_BLOCKED: { reason: "locked" | "guard" };
  INSUFFICIENT_RESOURCE: {
    resource: "coin" | "potential" | "item" | "vigor";
    required: UInt;
    available: UInt;
  };
  CAPACITY_EXCEEDED: { required: UInt; available: UInt };
  ITEM_STATE: { reason: "consumed" | "equipped" | "socket" | "type" | "durability" };
  SKILL_CAP: { level: UInt; cap: UInt };
  TEACHER_REQUIRED: { reason: "tier" | "level" | "bond" | "payment" };
  TASK_STATE: { state: TaskState };
  TASK_LIMIT: { kind: "accepted" | "bounty"; limit: UInt };
  CONDITION_UNMET: {
    reason: "task" | "xp" | "stage" | "tier" | "location" | "training" | "rank" | "relation";
    skill?: string;
    required?: UInt;
    level?: UInt;
    cap?: UInt;
    have?: UInt;
    /** Where to turn the task in, when reason is "location". */
    place_id?: ID;
  };
  DUPLICATE_KEY: { table: "place" | "item" | "task" };
  BUILD_INVALID: { reason: "shape" | "reference" | "tier" | "name"; field: string };
  INVALID_CURSOR: Record<string, never>;
  CURSOR_CONTEXT: { place_id: ID; resume_cursor: Seq };
  CURSOR_EXPIRED: { scope: EventScope; resume_cursor: Seq; resync_required: true };
  OFFER_STATE: { reason: "expired" | "used" | "recipient" };
  RETRY_LATER: { committed: false };
  NOT_IMPLEMENTED: Record<string, never>;
}

export type ErrorCode = keyof ErrorDetailsMap;

export const ERROR_HTTP: Readonly<Record<ErrorCode, number>> = {
  INVALID_ARGUMENT: 400,
  INVALID_KEY: 400,
  UNKNOWN_VERB: 404,
  AUTH_REQUIRED: 401,
  AUTH_INVALID: 401,
  STATE_BLOCKED: 409,
  LIFE_BLOCKED: 409,
  IDENTITY_EXPIRED: 410,
  RULES_UNSET: 503,
  AP_EXHAUSTED: 409,
  NOT_FOUND: 404,
  NOT_HERE: 409,
  NOT_ALLOWED: 403,
  EXIT_BLOCKED: 409,
  INSUFFICIENT_RESOURCE: 409,
  CAPACITY_EXCEEDED: 409,
  ITEM_STATE: 409,
  SKILL_CAP: 409,
  TEACHER_REQUIRED: 409,
  TASK_STATE: 409,
  TASK_LIMIT: 409,
  CONDITION_UNMET: 409,
  DUPLICATE_KEY: 409,
  BUILD_INVALID: 400,
  INVALID_CURSOR: 400,
  CURSOR_CONTEXT: 409,
  CURSOR_EXPIRED: 410,
  OFFER_STATE: 409,
  RETRY_LATER: 503,
  NOT_IMPLEMENTED: 501,
};

/** A protocol rejection: rolls the transaction back, no fact changes, no AP spent. */
export class ActionError<C extends ErrorCode = ErrorCode> extends Error {
  override readonly name = "ActionError";
  readonly code: C;
  readonly field: string | null;
  readonly details: ErrorDetailsMap[C];
  constructor(code: C, details: ErrorDetailsMap[C], field: string | null = null) {
    super(code);
    this.code = code;
    this.details = details;
    this.field = field;
  }
}

export function reject<C extends ErrorCode>(
  code: C,
  details: ErrorDetailsMap[C],
  field: string | null = null,
): never {
  throw new ActionError(code, details, field);
}

export const NO_DETAILS: Record<string, never> = Object.freeze({}) as Record<string, never>;
