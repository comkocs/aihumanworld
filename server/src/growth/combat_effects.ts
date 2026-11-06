// Combat follow-up facts. All mutations stay on the request's Writer/transaction.

import { getRow, selectRows } from "../facts/store.ts";
import type { Change, CharRow, Combatant, ID, PlaceRow, ReputationRow, WantedRow } from "../facts/types.ts";
import type { VerbContext } from "../verbs/types.ts";
import { addUInt, mulDiv, tierNumbers } from "./balance.ts";

export async function markWanted(ctx: VerbContext, char: CharRow, place: PlaceRow, reason: "attack_guard" | "kill_player"): Promise<Change[]> {
  if (char.kind === "npc") return [];
  const duration = reason === "attack_guard" ? ctx.balance.numbers.wanted.attack_guard_ticks : ctx.balance.numbers.wanted.kill_player_ticks;
  const until = BigInt(ctx.tick) + BigInt(duration);
  const rows = await selectRows(ctx.q, "wanted", "char_id = $1 AND region = $2 AND reason = $3 AND state = 'active'", [char.id, place.region, reason]);
  const old = rows[0];
  const wanted: WantedRow = old === undefined ? {
    id: await ctx.w.newId("wanted"), created_tick: ctx.tick, updated_tick: ctx.tick,
    char_id: char.id, region: place.region, reason, until_tick: until.toString(), state: "active", bounty_task: null,
  } : { ...old, until_tick: (until > BigInt(old.until_tick) ? until : BigInt(old.until_tick)).toString(), updated_tick: ctx.tick };
  const change = old === undefined ? await ctx.w.insert("wanted", wanted) : await ctx.w.update("wanted", old.id, { until_tick: wanted.until_tick });
  const changes = change === null ? [] : [change];
  const deed = await ctx.w.deed({
    actor: char.id, verb: "attack", kind: "wanted", targets: [wanted.id], place_id: place.id,
    result: { outcome: "success", changes, roll: null, proposal: null }, visibility: "world", participants: [char.id],
  });
  await ctx.w.emit({ scope: "self", recipients: [char.id], type: "wanted_changed", deed_id: deed.id, data: { wanted } });
  await ctx.w.emit({ scope: "world", type: "wanted_changed", deed_id: deed.id, data: { wanted } });
  return changes;
}

// slay task progress is not written here: the task stream verifies combat deeds at
// submit (0 号窗 11-06). First kills and their S5 bonus stay below.

export async function firstKill(ctx: VerbContext, killerId: ID, defeated: Combatant): Promise<Change[]> {
  if (defeated.archetype === null) return [];
  const key = `first_kill:person.npc·body.${defeated.body}·npc.${defeated.archetype}·tier${defeated.tier}·stage${defeated.stage}`;
  if (await ctx.w.firstTaken(key)) return [];
  const killer = await getRow(ctx.q, "char", killerId);
  if (killer === null || killer.kind === "npc") return [];
  const t = tierNumbers(ctx.balance, defeated.tier);
  const bonus = ctx.balance.numbers.tasks.deed_bonus.first_kill;
  const reward = { xp: mulDiv(t.task_xp, bonus.xp_bp, 10000), potential: mulDiv(t.task_potential, bonus.potential_bp, 10000), rep: mulDiv(t.rep_bounty, bonus.rep_mult, 1), coin: 0, items: [] };
  const changes: Change[] = [];
  const push = (c: Change | null): void => { if (c !== null) changes.push(c); };
  const patch = { xp: addUInt(killer.xp, reward.xp), potential: addUInt(killer.potential, reward.potential) };
  push(await ctx.w.update("char", killerId, patch));
  if (ctx.actor?.id === killerId) ctx.actor = { ...ctx.actor, ...patch };
  const reps = await selectRows(ctx.q, "reputation", "char_id = $1 AND scope = 'world'", [killerId]);
  const old = reps[0];
  const rep: ReputationRow = old === undefined ? {
    id: await ctx.w.newId("reputation"), created_tick: ctx.tick, updated_tick: ctx.tick,
    char_id: killerId, scope: "world", org_id: null, value: reward.rep,
  } : { ...old, value: old.value + reward.rep, updated_tick: ctx.tick };
  push(old === undefined ? await ctx.w.insert("reputation", rep) : await ctx.w.update("reputation", old.id, { value: rep.value }));
  const source = await ctx.w.deed({
    actor: killerId, verb: "attack", kind: "discover", targets: [defeated.char_id], place_id: killer.loc,
    result: { outcome: "success", changes, roll: null, proposal: null }, visibility: "self", participants: [killerId],
  });
  const deed = await ctx.w.deed({
    actor: killerId, verb: "attack", kind: "first_kill", targets: [defeated.char_id], place_id: killer.loc, first_key: key,
    result: { outcome: "success", changes: changes.filter((c) => c.table === "reputation"), roll: null, proposal: null }, visibility: "world", participants: [killerId],
  });
  await ctx.w.emit({ scope: "self", recipients: [killerId], type: "reward_granted", deed_id: source.id, data: { char_id: killerId, source: deed.id, reward } });
  await ctx.w.emit({ scope: "self", recipients: [killerId], type: "fact_changed", deed_id: source.id, data: { changes } });
  await ctx.w.emit({ scope: "self", recipients: [killerId], type: "reputation_changed", deed_id: deed.id, data: { reputation: rep } });
  await ctx.w.emit({ scope: "world", type: "reputation_changed", deed_id: deed.id, data: { reputation: rep } });
  return changes;
}

