// S25 weekly goals: ingest committed task_done facts once, settle a snapshot once,
// then snapshot active member bonds for the next S5 week. No task-stream calls.

import type { ClockCtx, ClockPhase } from "../clock/phases.ts";
import { getRow, selectRows } from "../facts/store.ts";
import type { Change, ID, OrgGoal, OrgRow } from "../facts/types.ts";
import { orgReputation } from "./membership.ts";
import { checkedUInt, numberAt, periodAt, requireRevision } from "./numbers.ts";

async function notify(ctx: ClockCtx, org: OrgRow, goal: OrgGoal, changes: Change[], reps: Awaited<ReturnType<typeof orgReputation>>[] = []): Promise<void> {
  const deed = await ctx.w.deed({
    actor: null, verb: "clock", kind: "org_goal", targets: [org.id], place_id: org.hall,
    result: { outcome: "success", changes, roll: null, proposal: null }, visibility: "self", participants: goal.member_ids,
  });
  if (goal.member_ids.length > 0) await ctx.w.emit({ scope: "self", recipients: goal.member_ids, type: "org_changed", deed_id: deed.id, data: { org_id: org.id, goal } });
  for (const rep of reps) await ctx.w.emit({ scope: "self", recipients: [rep.row.char_id], type: "reputation_changed", deed_id: deed.id, data: { reputation: rep.row } });
  await ctx.w.emit({ scope: "place", place_id: org.hall, type: "org_changed", deed_id: deed.id, data: { org_id: org.id, goal: { ...goal, member_ids: [] } } });
}

async function settle(ctx: ClockCtx, org: OrgRow): Promise<OrgRow> {
  if (org.goal.settled || org.goal.progress < org.goal.target) return org;
  const goal = { ...org.goal, settled: true };
  const changes: Change[] = [];
  const c = await ctx.w.update("org", org.id, { goal });
  if (c !== null) changes.push(c);
  const reps: Awaited<ReturnType<typeof orgReputation>>[] = [];
  for (const id of goal.member_ids) {
    const rep = await orgReputation(ctx.q, ctx.w, id, org.id, goal.reward_rep);
    reps.push(rep); changes.push(rep.change);
  }
  await notify(ctx, org, goal, changes, reps);
  return { ...org, goal, updated_tick: ctx.to_tick };
}

async function snapshot(ctx: ClockCtx, org: OrgRow, week: number): Promise<OrgRow> {
  const members = await selectRows(ctx.q, "bond", "kind = 'member' AND b = $1 AND state = 'active'", [org.id], 'ORDER BY a COLLATE "C"');
  const member_ids = members.map((m) => m.a);
  const perHead = numberAt(ctx.balance, org.goal.kind === "system_tasks" ? "orgs.goal_per_head_system_tasks" : "orgs.goal_per_head_deliver_items");
  const target = Math.max(numberAt(ctx.balance, "orgs.goal_min_target"), checkedUInt(BigInt(member_ids.length) * BigInt(perHead)));
  const goal: OrgGoal = { week, kind: org.goal.kind, target, progress: 0, member_ids, reward_rep: numberAt(ctx.balance, "orgs.goal_reward_rep"), settled: false };
  const change = await ctx.w.update("org", org.id, { goal });
  await notify(ctx, org, goal, change === null ? [] : [change]);
  return { ...org, goal, updated_tick: ctx.to_tick };
}

async function creditTasks(ctx: ClockCtx, orgs: Map<ID, OrgRow>): Promise<void> {
  const cursor = await ctx.q.query<{ through_seq: string }>("SELECT through_seq FROM s25_org_clock WHERE realm = $1", [ctx.world.realm]);
  const through = (await getRow(ctx.q, "world", ctx.world.id))?.deed_head ?? ctx.world.deed_head;
  const deeds = await selectRows(ctx.q, "deed", "verb = 'task' AND kind = 'task_done' AND seq > $1 AND seq <= $2", [cursor.rows[0]?.through_seq ?? "0", through], "ORDER BY seq");
  const weekTicks = periodAt(ctx.balance, "clock.week_ticks");
  for (const deed of deeds) {
    if (deed.actor === null || deed.result.outcome !== "success") continue;
    const week = checkedUInt(BigInt(deed.tick) / weekTicks);
    for (const id of deed.targets) {
      const task = await getRow(ctx.q, "task", id);
      if (task?.record !== "instance" || task.kind !== "system" || task.state !== "completed" || task.taker !== deed.actor) continue;
      // Membership at the actual submission, not at the later heartbeat. End tick
      // alone is ambiguous for several actions in one tick, so compare bond deeds.
      const bonds = await selectRows(ctx.q, "bond", "kind = 'member' AND a = $1 AND since_tick <= $2 AND (ended_tick IS NULL OR ended_tick >= $2)", [deed.actor, deed.tick], 'ORDER BY since_tick DESC, id COLLATE "C"');
      let org: OrgRow | undefined;
      for (const bond of bonds) {
        const start = await selectRows(ctx.q, "deed", "kind IN ('identity', 'org_join') AND seq < $1 AND result -> 'changes' @> $2::jsonb", [deed.seq, JSON.stringify([{ table: "bond", id: bond.id }])], "ORDER BY seq LIMIT 1");
        if (start.length === 0 && bond.created_tick === deed.tick) continue;
        const ended = await selectRows(ctx.q, "deed", "kind IN ('org_leave', 'org_expel') AND seq < $1 AND result -> 'changes' @> $2::jsonb", [deed.seq, JSON.stringify([{ table: "bond", id: bond.id, after: { state: "ended" } }])], "LIMIT 1");
        if (ended.length > 0) continue;
        org = orgs.get(bond.b);
        if (org === undefined) {
          org = await getRow(ctx.q, "org", bond.b) ?? undefined;
          if (org !== undefined) orgs.set(org.id, org);
        }
        if (org !== undefined) break;
      }
      if (org === undefined || org.goal.week !== week || org.goal.settled) continue;
      const credited = await ctx.q.query("INSERT INTO s25_org_task_credit (task_id, org_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING task_id", [task.id, org.id]);
      if (credited.rows.length === 0) continue;
      const amount = org.goal.kind === "system_tasks" ? 1 : task.condition.tpl === "deliver" ? task.condition.count : 0;
      if (amount === 0) continue;
      const goal = { ...org.goal, progress: checkedUInt(BigInt(org.goal.progress) + BigInt(amount)) };
      const change = await ctx.w.update("org", org.id, { goal });
      await notify(ctx, org, goal, change === null ? [] : [change]);
      orgs.set(org.id, await settle(ctx, { ...org, goal }));
    }
  }
  const scannedThrough = deeds.at(-1)?.seq;
  if (scannedThrough !== undefined) await ctx.q.query("INSERT INTO s25_org_clock (realm, through_seq) VALUES ($1, $2) ON CONFLICT (realm) DO UPDATE SET through_seq = EXCLUDED.through_seq", [ctx.world.realm, scannedThrough]);
}

export const orgGoalPhase: ClockPhase = {
  name: "org_goal",
  owner: "S25",
  async run(ctx) {
    requireRevision(ctx.balance, ctx.world.rules_revision, ctx.rules.balance_key);
    const currentWeek = checkedUInt(BigInt(ctx.to_tick) / periodAt(ctx.balance, "clock.week_ticks"));
    const rows = await selectRows(ctx.q, "org", `id LIKE $1 AND (
      NOT EXISTS (SELECT 1 FROM s25_org_roster WHERE org_id = orgs.id) OR
      (goal ->> 'week')::bigint < $2::bigint OR
      ((goal ->> 'settled')::boolean = false AND (goal ->> 'progress')::numeric >= (goal ->> 'target')::numeric))`,
      [`${ctx.world.realm}:org:%`, currentWeek], 'ORDER BY id COLLATE "C"');
    const orgs = new Map(rows.map((org) => [org.id, org]));
    for (const org of rows) {
      const initialized = await ctx.q.query("SELECT 1 FROM s25_org_roster WHERE org_id = $1", [org.id]);
      if (initialized.rows.length === 0) {
        if (org.goal.member_ids.length === 0 && org.goal.progress === 0) orgs.set(org.id, await snapshot(ctx, org, org.goal.week));
        await ctx.q.query("INSERT INTO s25_org_roster (org_id, week) VALUES ($1, $2)", [org.id, org.goal.week]);
      }
    }
    await creditTasks(ctx, orgs);
    for (let org of orgs.values()) {
      org = await settle(ctx, org);
      if (org.goal.week < currentWeek) {
        await snapshot(ctx, org, currentWeek);
        await ctx.q.query("UPDATE s25_org_roster SET week = $2 WHERE org_id = $1", [org.id, currentWeek]);
      }
    }
  },
};
