// world.rules: fixed field set of 事实格式 §3.1. Values are placeholders until
// S5 / S10 load the neutral numbers; a null slot answers RULES_UNSET, never a
// made-up default.

import { AP_COST_KEYS, type ApCostKey } from "../facts/enums.ts";
import type { UInt, WorldRules } from "../facts/types.ts";
import { reject } from "../protocol/errors.ts";

const UINT_SLOTS = [
  "tick_seconds",
  "ap_per_tick",
  "draft_expire_ticks",
  "dormant_after_ticks",
  "bury_after_ticks",
  "revive_window_ticks",
  "speech_ttl_ticks",
  "page_size",
  "text_max_chars",
  "build_min_tier",
  "bounty_open_max",
  "active_task_max",
  "socket_max",
] as const;
export type UIntRuleSlot = (typeof UINT_SLOTS)[number];

const KEY_RE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/;

function isUIntOrNull(v: unknown): v is UInt | null {
  return v === null || (typeof v === "number" && Number.isSafeInteger(v) && v >= 0);
}

/** Throws a plain Error describing the first violation (boot-time check). */
export function parseWorldRules(input: unknown, revision: unknown): { rules: WorldRules; rules_revision: string } {
  if (typeof revision !== "string" || !KEY_RE.test(revision)) throw new Error("rules_revision must be a Key");
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Error("rules must be an object");
  const src = input as Record<string, unknown>;
  const allowed = new Set<string>([...UINT_SLOTS, "ap_costs", "balance_key"]);
  for (const k of Object.keys(src)) if (!allowed.has(k)) throw new Error(`rules.${k} is not a world.rules field`);
  const out: Record<string, unknown> = {};
  for (const k of UINT_SLOTS) {
    const v = src[k];
    if (!isUIntOrNull(v)) throw new Error(`rules.${k} must be UInt or null`);
    out[k] = v;
  }
  if (out.build_min_tier !== null && ((out.build_min_tier as number) < 1 || (out.build_min_tier as number) > 9)) {
    throw new Error("rules.build_min_tier must be a tier 1..9 or null");
  }
  if (out.tick_seconds === 0) throw new Error("rules.tick_seconds must be positive");
  if (out.page_size === 0) throw new Error("rules.page_size must be positive");
  const costs = src.ap_costs;
  if (typeof costs !== "object" || costs === null || Array.isArray(costs)) throw new Error("rules.ap_costs must be an object");
  const costOut: Partial<Record<ApCostKey, UInt | null>> = {};
  const known = new Set<string>(AP_COST_KEYS);
  for (const [k, v] of Object.entries(costs as Record<string, unknown>)) {
    if (!known.has(k)) throw new Error(`rules.ap_costs.${k} is not an ap cost key`);
    if (!isUIntOrNull(v)) throw new Error(`rules.ap_costs.${k} must be UInt or null`);
    costOut[k as ApCostKey] = v;
  }
  out.ap_costs = costOut;
  const bk = src.balance_key;
  if (!(bk === null || (typeof bk === "string" && KEY_RE.test(bk)))) throw new Error("rules.balance_key must be a Key or null");
  out.balance_key = bk;
  const d = out.dormant_after_ticks as number | null;
  const b = out.bury_after_ticks as number | null;
  if (d !== null && b !== null && !(0 < d && d < b)) {
    throw new Error("rules require 0 < dormant_after_ticks < bury_after_ticks");
  }
  return { rules: out as unknown as WorldRules, rules_revision: revision };
}

/** A loaded UInt slot, or RULES_UNSET. */
export function requireRule(rules: WorldRules, slot: UIntRuleSlot): UInt {
  const v = rules[slot];
  if (v === null || v === undefined) return reject("RULES_UNSET", { rule_key: `rules.${slot}` });
  return v;
}

/** AP cost of a cost key, or RULES_UNSET. */
export function apCost(rules: WorldRules, key: ApCostKey): UInt {
  const v = rules.ap_costs[key];
  if (v === null || v === undefined) return reject("RULES_UNSET", { rule_key: `rules.ap_costs.${key}` });
  return v;
}
