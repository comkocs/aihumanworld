// Tick scheduler. World time advances in whole ticks of rules.tick_seconds:
// tick N spans [tick_started_at, tick_started_at + tick_seconds). Advancing runs
// PHASES inside one transaction holding the world row lock, so a tick is
// processed exactly once even with the lazy catch-up that every request
// triggers before its own transaction. After downtime, missed ticks are
// processed one by one (bounded per transaction). The calendar is tick-based
// (S5 clock): day_index = tick ÷ day_ticks, week_index = tick ÷ week_ticks.

import type { Db, Queryable } from "../db/db.ts";
import { worldId } from "../facts/ids.ts";
import { getRow, mustGetRow, updateRow } from "../facts/store.ts";
import type { Tick, WorldRow } from "../facts/types.ts";
import { Writer } from "../facts/writer.ts";
import type { Balance } from "../growth/balance.ts";
import { errText, log } from "../log.ts";
import { nextTick } from "./budget.ts";
import { PHASES } from "./phases.ts";

const IDLE_POLL_MS = 5_000;

export interface ClockOptions {
  realm: string;
  maxCatchupPerTx: number;
  balance: () => Balance;
  now?: () => Date;
}

/** S5 calendar of a tick (数值表 clock.day_ticks / week_ticks), floored. */
export function calendarOf(balance: Balance, tick: Tick): { day_index: number; week_index: number } {
  const clock = balance.numbers.clock as unknown as Record<string, unknown>;
  const per = (k: "day_ticks" | "week_ticks"): bigint => {
    const v = clock[k];
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v <= 0) throw new Error(`S5 clock.${k} missing`);
    return BigInt(v);
  };
  const t = BigInt(tick);
  return { day_index: Number(t / per("day_ticks")), week_index: Number(t / per("week_ticks")) };
}

export function tickDueAt(w: WorldRow): number | null {
  const ts = w.rules.tick_seconds;
  if (ts === null || ts <= 0) return null;
  return Date.parse(w.tick_started_at) + ts * 1000;
}

export class Clock {
  private readonly db: Db;
  private readonly opts: ClockOptions;
  private readonly now: () => Date;
  private running: Promise<number> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private stopped = true;

  constructor(db: Db, opts: ClockOptions) {
    this.db = db;
    this.opts = opts;
    this.now = opts.now ?? (() => new Date());
  }

  private isDue(w: WorldRow): boolean {
    const due = tickDueAt(w);
    return due !== null && this.now().getTime() >= due;
  }

  /** Advance every due tick; concurrent callers share one run. Returns ticks advanced. */
  advanceDue(): Promise<number> {
    if (this.running !== null) return this.running;
    this.running = this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async run(): Promise<number> {
    const id = worldId(this.opts.realm);
    let total = 0;
    for (;;) {
      const peek = await getRow(this.db, "world", id);
      if (peek === null || !this.isDue(peek)) return total;
      const n = await this.db.tx(async (q) => {
        let w = await mustGetRow(q, "world", id, { lock: true });
        let k = 0;
        while (k < this.opts.maxCatchupPerTx && this.isDue(w)) {
          w = await this.step(q, w);
          k += 1;
        }
        return k;
      });
      total += n;
      if (n === 0) return total;
    }
  }

  private async step(q: Queryable, world: WorldRow): Promise<WorldRow> {
    const from = world.tick;
    const to = nextTick(from);
    // The new tick's calendar first, so every phase sees this tick's day / week.
    const newStart = Date.parse(world.tick_started_at) + (world.rules.tick_seconds as number) * 1000;
    const { day_index: dayIndex, week_index: weekIndex } = calendarOf(this.opts.balance(), to);
    const view: WorldRow = { ...world, day_index: dayIndex, week_index: weekIndex };
    const w = new Writer(q, world.realm, to, world.rules_revision, true);
    const now = this.now();
    for (const phase of PHASES) {
      await phase.run({ q, w, world: view, rules: world.rules, balance: this.opts.balance(), from_tick: from, to_tick: to, now });
    }
    await updateRow(
      q,
      "world",
      world.id,
      {
        tick: to,
        tick_started_at: new Date(newStart).toISOString(),
        day_index: dayIndex,
        week_index: weekIndex,
      },
      to,
    );
    return mustGetRow(q, "world", world.id);
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.loop();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Waits for an in-flight advance (used on shutdown). */
  async idle(): Promise<void> {
    if (this.running !== null) await this.running.catch(() => 0);
  }

  private async loop(): Promise<void> {
    let delay = IDLE_POLL_MS;
    try {
      const advanced = await this.advanceDue();
      if (advanced > 0) log.info("tick", { advanced });
      const w = await getRow(this.db, "world", worldId(this.opts.realm));
      const due = w === null ? null : tickDueAt(w);
      if (due !== null) delay = Math.min(60_000, Math.max(20, due - this.now().getTime()));
    } catch (err) {
      log.error("clock advance failed", { err: errText(err) });
      delay = 1_000;
    }
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.loop(), delay);
    this.timer.unref();
  }
}
