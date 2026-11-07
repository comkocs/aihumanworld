// Ordered tick phases (事实格式 §3.1: due tasks & refunds → identity states →
// wanted expiry → org weekly goals and last-tick yields → new budgets; budgets are
// lazy, see budget.ts). After the NPC phase, S27 tops resource spots and merchant
// shops back up to cap. Each phase lives in its owner's file; owners change their
// own file only. Adding / reordering phases is an S9 (0 号窗) change.

import type { Queryable } from "../db/db.ts";
import type { Writer } from "../facts/writer.ts";
import type { Tick, WorldRow, WorldRules } from "../facts/types.ts";
import type { Balance } from "../growth/balance.ts";
import { taskBuriedPhase, taskExpiryPhase } from "../tasks/clock.ts";
import { identityPhase } from "../identity/lifecycle.ts";
import { wantedPhase, yieldPhase } from "../growth/clock.ts";
import { orgGoalPhase } from "../orgs/clock.ts";
import { npcPhase } from "../npc/clock.ts";
import { resourcePhase } from "../resources/clock.ts";
import { worldEventPhase } from "../world_events/clock.ts";

export interface ClockCtx {
  q: Queryable;
  /** Writer stamped with to_tick (clock deeds use verb "clock"). */
  w: Writer;
  /**
   * World row as of from_tick (locked), except day_index / week_index, which
   * already hold this tick's (to_tick) values. "Week" means world.week_index.
   */
  world: WorldRow;
  rules: WorldRules;
  balance: Balance;
  from_tick: Tick;
  to_tick: Tick;
  now: Date;
}

export interface ClockPhase {
  name: string;
  owner: "S10" | "S11" | "S24" | "S25" | "S27" | "unassigned";
  run(ctx: ClockCtx): Promise<void>;
}

export const PHASES: readonly ClockPhase[] = [
  taskExpiryPhase,
  identityPhase,
  // Same tick as a burial: release the buried char's tasks and refund its bounties.
  taskBuriedPhase,
  wantedPhase,
  orgGoalPhase,
  yieldPhase,
  npcPhase,
  // S72: after npc revival, so a beast tide's template monster is alive before the
  // window copies it, and before resource restock.
  worldEventPhase,
  resourcePhase,
];
