// S88: read committed deeds for the live board; freeze each completed S5 week once.
// Membership is resolved at the scoring deed, not at the later read / settlement.

import { join } from "node:path";
import type { ClockCtx } from "../clock/phases.ts";
import { SERVER_ROOT } from "../config.ts";
import type { Queryable } from "../db/db.ts";
import { getRow, selectRows } from "../facts/store.ts";
import type { DeedRow, ID, OrgRow, Tick, WorldRow } from "../facts/types.ts";
import type { Balance } from "../growth/balance.ts";
import { lexiconFor, loadSkins, type SkinBook } from "../public/skins.ts";
import { checkedUInt, numberAt, periodAt } from "./numbers.ts";

export interface WeeklyEntry {
  org_id: ID;
  org_name: string;
  total: number;
  beast_tide: number;
  bounty: number;
  breakthrough: number;
}

export interface WeeklyPeriod {
  week: number;
  start_tick: Tick;
  until_tick: Tick;
  settled: boolean;
  rankings: WeeklyEntry[];
}

export interface WeeklyBoard {
  current: WeeklyPeriod;
  previous: WeeklyPeriod | null;
}

let bookPromise: Promise<SkinBook> | null = null;
async function orgName(org: OrgRow): Promise<string> {
  if (org.player_name !== undefined) return org.player_name;
  bookPromise ??= loadSkins(join(SERVER_ROOT, "..", "content", "skins"));
  const book = await bookPromise;
  const skin = org.region === "neutral" ? "xiuxian" : org.region;
  return lexiconFor(book, skin, skin === "xiuxian" || skin === "wuxia" ? "zh-CN" : "en").name(org.content_key).name;
}

/** Includes a membership ended later in the same tick, excludes a join after the deed. */
export async function organizationAt(q: Queryable, charId: ID, tick: Tick, seq: string): Promise<ID | null> {
  const char = await getRow(q, "char", charId);
  if (char === null || char.kind === "npc") return null;
  const bonds = await selectRows(q, "bond",
    "kind = 'member' AND a = $1 AND since_tick <= $2 AND (ended_tick IS NULL OR ended_tick >= $2)",
    [charId, tick], 'ORDER BY since_tick DESC, id COLLATE "C"');
  for (const bond of bonds) {
    if (bond.created_tick === tick) {
      const start = await selectRows(q, "deed",
        "kind IN ('identity', 'org_join') AND seq < $1 AND result -> 'changes' @> $2::jsonb",
        [seq, JSON.stringify([{ table: "bond", id: bond.id }])], "LIMIT 1");
      if (start.length === 0) continue;
    }
    if (bond.ended_tick === tick) {
      const ended = await selectRows(q, "deed",
        "kind IN ('org_leave', 'org_expel') AND seq < $1 AND result -> 'changes' @> $2::jsonb",
        [seq, JSON.stringify([{ table: "bond", id: bond.id, after: { state: "ended" } }])], "LIMIT 1");
      if (ended.length > 0) continue;
    }
    return bond.b;
  }
  return null;
}

async function rankWeek(q: Queryable, realm: string, balance: Balance, week: number): Promise<WeeklyEntry[]> {
  const period = periodAt(balance, "clock.week_ticks");
  const start = BigInt(week) * period;
  const deeds = await selectRows(q, "deed",
    "split_part(id, ':', 1) = $1 AND tick >= $2 AND tick < $3 AND kind IN ('bounty_done', 'stage_up', 'breakthrough', 'ascend', 'world_event')",
    [realm, start.toString(), (start + period).toString()], "ORDER BY seq");
  const scores = new Map<ID, WeeklyEntry>();
  const bountyTasks = new Set<ID>();
  const tides = new Set<string>();
  const add = async (orgId: ID | null, kind: "beast_tide" | "bounty" | "breakthrough"): Promise<void> => {
    if (orgId === null) return;
    let entry = scores.get(orgId);
    if (entry === undefined) {
      const org = await getRow(q, "org", orgId);
      if (org === null || org.registry) return;
      entry = { org_id: orgId, org_name: await orgName(org), total: 0, beast_tide: 0, bounty: 0, breakthrough: 0 };
      scores.set(orgId, entry);
    }
    const points = numberAt(balance, `orgs.weekly_points.${kind}`);
    entry[kind] = checkedUInt(BigInt(entry[kind]) + BigInt(points));
    entry.total = checkedUInt(BigInt(entry.total) + BigInt(points));
  };
  for (const deed of deeds) {
    if (deed.result.outcome !== "success") continue;
    if (deed.kind === "world_event") {
      const data = (deed.result as DeedRow["result"] & { world_event?: { kind: string; phase: string; defeated?: boolean; open_tick: string; org_ids?: ID[] } }).world_event;
      if (data?.kind !== "beast_tide" || data.phase !== "close" || data.defeated !== true || tides.has(data.open_tick)) continue;
      tides.add(data.open_tick);
      for (const id of new Set(data.org_ids ?? [])) await add(id, "beast_tide");
    } else if (deed.actor !== null && deed.kind === "bounty_done") {
      const taskId = deed.targets.find((id) => id.split(":")[1] === "task");
      if (taskId === undefined || bountyTasks.has(taskId)) continue;
      const task = await getRow(q, "task", taskId);
      if (task?.record !== "instance" || task.kind !== "bounty" || task.state !== "completed" || task.taker !== deed.actor) continue;
      bountyTasks.add(taskId);
      await add(await organizationAt(q, deed.actor, deed.tick, deed.seq), "bounty");
    } else if (deed.actor !== null && deed.verb === "breakthrough" && ["stage_up", "breakthrough", "ascend"].includes(deed.kind)) {
      await add(await organizationAt(q, deed.actor, deed.tick, deed.seq), "breakthrough");
    }
  }
  return [...scores.values()].filter((entry) => entry.total > 0).sort((a, b) => b.total - a.total || (a.org_id < b.org_id ? -1 : a.org_id > b.org_id ? 1 : 0));
}

async function periodBoard(q: Queryable, realm: string, balance: Balance, week: number): Promise<WeeklyPeriod> {
  const period = periodAt(balance, "clock.week_ticks");
  const saved = await q.query<{ rankings: WeeklyEntry[] }>("SELECT rankings FROM s88_weekly_results WHERE realm = $1 AND week = $2", [realm, week]);
  const rankings = saved.rows[0]?.rankings;
  const visible = rankings === undefined ? await rankWeek(q, realm, balance, week) : (await Promise.all(
    rankings.map(async (entry) => (await getRow(q, "org", entry.org_id))?.registry === false ? entry : null),
  )).filter((entry): entry is WeeklyEntry => entry !== null);
  return {
    week,
    start_tick: (BigInt(week) * period).toString(),
    until_tick: (BigInt(week + 1) * period).toString(),
    settled: saved.rows.length > 0,
    rankings: visible,
  };
}

/** Read-only: current scores change immediately after a committed action, without a clock tick. */
export async function weeklyBoard(q: Queryable, world: WorldRow, balance: Balance): Promise<WeeklyBoard> {
  const week = checkedUInt(BigInt(world.tick) / periodAt(balance, "clock.week_ticks"));
  return {
    current: await periodBoard(q, world.realm, balance, week),
    previous: week === 0 ? null : await periodBoard(q, world.realm, balance, week - 1),
  };
}

/** Called by the existing S25 phase. No new phase or event kind is needed. */
export async function settleWeekly(ctx: ClockCtx): Promise<void> {
  const period = periodAt(ctx.balance, "clock.week_ticks");
  if (BigInt(ctx.to_tick) % period !== 0n) return;
  const week = checkedUInt(BigInt(ctx.to_tick) / period) - 1;
  if (week < 0) return;
  const seen = await ctx.q.query("SELECT 1 FROM s88_weekly_results WHERE realm = $1 AND week = $2", [ctx.world.realm, week]);
  if (seen.rows.length > 0) return;
  const rankings = await rankWeek(ctx.q, ctx.world.realm, ctx.balance, week);
  const weekly = { week, rankings, message: rankings.length === 0 ? `第 ${week} 周组织榜结算:暂无组织得分。` : `第 ${week} 周组织榜结算:${rankings.map((r, i) => `${i + 1}. ${r.org_name} ${r.total} 分(兽潮 ${r.beast_tide}、悬赏 ${r.bounty}、破境 ${r.breakthrough})`).join("; ")}` };
  const result = { outcome: "success" as const, changes: [], roll: null, proposal: null, weekly };
  const deed = await ctx.w.deed({ actor: null, verb: "clock", kind: "org_goal", targets: rankings.map((r) => r.org_id), place_id: null, result, visibility: "world", participants: [] });
  await ctx.q.query("INSERT INTO s88_weekly_results (realm, week, rankings, settled_tick, deed_id) VALUES ($1, $2, $3::jsonb, $4, $5)", [ctx.world.realm, week, JSON.stringify(rankings), ctx.to_tick, deed.id]);
}
