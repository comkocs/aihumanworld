// Per-char, per-tick action budget (产品文档 §10.3 「共享时钟即节流」).
// Budgets are lazy: char.ap_tick names the tick ap_spent belongs to; a char
// whose ap_tick is older simply has the full per-tick budget. Pure functions.

import type { Tick, UInt } from "../facts/types.ts";

export interface ApView {
  remaining: UInt;
  per_tick: UInt;
  next_tick: Tick;
}

export interface BudgetState {
  ap_tick: Tick;
  ap_spent: UInt;
}

export const nextTick = (tick: Tick): Tick => (BigInt(tick) + 1n).toString();

function spentIn(state: BudgetState, tick: Tick): UInt {
  return BigInt(state.ap_tick) >= BigInt(tick) ? state.ap_spent : 0;
}

export function apView(state: BudgetState, tick: Tick, perTick: UInt): ApView {
  return { remaining: Math.max(0, perTick - spentIn(state, tick)), per_tick: perTick, next_tick: nextTick(tick) };
}

export type SpendResult =
  | { ok: true; state: BudgetState; view: ApView }
  | { ok: false; remaining: UInt; required: UInt; next_tick: Tick };

/** Spend `cost` points in `tick`; refuses (no partial spend) when the budget is short. */
export function trySpend(state: BudgetState, tick: Tick, perTick: UInt, cost: UInt): SpendResult {
  const view = apView(state, tick, perTick);
  if (cost > view.remaining) return { ok: false, remaining: view.remaining, required: cost, next_tick: view.next_tick };
  const next: BudgetState = { ap_tick: tick, ap_spent: spentIn(state, tick) + cost };
  return { ok: true, state: next, view: apView(next, tick, perTick) };
}
