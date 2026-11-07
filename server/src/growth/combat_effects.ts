// Combat follow-up facts. All mutations stay on the request's Writer/transaction.

import { getRow, selectRows } from "../facts/store.ts";
import type { Change, CharRow, Combatant, DeedRow, ID, PlaceRow, ReputationRow, Reward, TaskInstanceRow, WantedRow } from "../facts/types.ts";
import { creditGrowth, emitTaskChanged, merged, must, publicChanges } from "../tasks/common.ts";
import type { VerbContext } from "../verbs/types.ts";
import { addUInt, mulDiv, tierNumbers } from "./balance.ts";
import { eventsSince } from "./discourse.ts";

/** `duration` overrides the numbers' duration of the reason (S48: red-name length by tier relation). */
export async function markWanted(ctx: VerbContext, char: CharRow, place: PlaceRow, reason: "attack_guard" | "kill_player", duration?: number): Promise<Change[]> {
  if (char.kind === "npc") return [];
  return (await upsertWanted(ctx, char, place, reason, duration)).changes;
}

async function upsertWanted(
  ctx: VerbContext,
  char: CharRow,
  place: PlaceRow,
  reason: "attack_guard" | "kill_player",
  override?: number,
): Promise<{ wanted: WantedRow; changes: Change[] }> {
  if (char.kind === "npc") throw new Error("npc chars are never wanted");
  const wantedNumbers = ctx.balance.numbers.wanted;
  const duration = override ?? (reason === "attack_guard" ? wantedNumbers.attack_guard_ticks : wantedNumbers.kill_player_ticks);
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
  return { wanted, changes };
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


// ---- S46 切磋 / PK: a reward for fighting another participant ----
//
// Two participants (player / official, never NPCs) fight where the place is `duel` or `pk`:
//   duel  any resolved result pays: winner duel_win_bp, loser duel_lose_bp, both duel_draw_bp on a draw;
//   pk    only a kill pays: the winner pk_win_bp (the loser keeps the ordinary death rules, nothing extra).
// The base is the full task value of the LOWER tier of the two (a high tier cannot farm low ones); xp and
// potential use the same rate, reputation is not touched. A pair is paid once per game day and kind (first
// fight); a char gets at most `daily_max` duel + pk rewards per game day (talking has its own count).
// Both facts are read from the `social`-marked reward_granted events of the two chars' inboxes.

export interface SocialFight {
  /** Acting char as it stands after settlement (ctx.actor). */
  me: CharRow;
  /** Target as loaded before the fight (only id / tier / kind are used). */
  target: CharRow;
  place: PlaceRow;
  outcome: "win" | "lose" | "draw";
  winner: ID | null;
  /** Chars that died in this fight. */
  dead: readonly ID[];
  deed: DeedRow;
}

/** Returns the acting char's own fact changes (xp / potential) for the attack result. */
export async function socialCombatReward(ctx: VerbContext, f: SocialFight): Promise<Change[]> {
  const rule = ctx.balance.numbers.tasks.deed_bonus.combat_social;
  const { me, target, place } = f;
  const own: Change[] = [];
  if (rule === undefined || rule.daily_max === 0 || me.kind === "npc" || target.kind === "npc") return own;
  if (place.combat !== "duel" && place.combat !== "pk") return own;
  const kind = place.combat;

  const shares: { id: ID; other: ID; bp: number }[] = [];
  if (kind === "duel") {
    if (f.outcome === "draw") {
      shares.push({ id: me.id, other: target.id, bp: rule.duel_draw_bp }, { id: target.id, other: me.id, bp: rule.duel_draw_bp });
    } else if (f.winner !== null) {
      const loser = f.winner === me.id ? target.id : me.id;
      shares.push({ id: f.winner, other: loser, bp: rule.duel_win_bp }, { id: loser, other: f.winner, bp: rule.duel_lose_bp });
    }
  } else if (f.winner !== null) {
    const loser = f.winner === me.id ? target.id : me.id;
    if (f.dead.includes(loser)) shares.push({ id: f.winner, other: loser, bp: rule.pk_win_bp });
  }
  if (shares.length === 0) return own;

  const dayStart = BigInt(ctx.world.day_index) * BigInt(ctx.balance.numbers.clock.day_ticks);
  const socials = async (id: ID) =>
    (await eventsSince(ctx.q, { inbox: id }, dayStart, null, null, 20000)).flatMap((e) =>
      e.type === "reward_granted" && e.data.social !== undefined && (e.data.social.kind === "duel" || e.data.social.kind === "pk") ? [e.data.social] : []);
  const todays = new Map<ID, { kind: string; with: ID }[]>([[me.id, await socials(me.id)], [target.id, await socials(target.id)]]);
  const paidPair = [...(todays.get(me.id) ?? [])].some((s) => s.kind === kind && s.with === target.id) ||
    [...(todays.get(target.id) ?? [])].some((s) => s.kind === kind && s.with === me.id);
  if (paidPair) return own;

  const t = tierNumbers(ctx.balance, Math.min(me.tier, target.tier));
  for (const share of shares) {
    if ((todays.get(share.id)?.length ?? 0) >= rule.daily_max) continue;
    if (share.bp === 0) continue;
    const reward: Reward = { coin: 0, xp: mulDiv(t.task_xp, share.bp, 10000), potential: mulDiv(t.task_potential, share.bp, 10000), rep: 0, items: [] };
    const char = share.id === me.id ? (ctx.actor ?? me) : await getRow(ctx.q, "char", share.id);
    if (char === null) continue;
    const g = await creditGrowth(ctx.q, ctx.w, char, reward);
    if (share.id === me.id) {
      ctx.actor = g.row;
      own.push(...g.changes);
    }
    await ctx.w.emit({
      scope: "self", recipients: [share.id], type: "reward_granted", deed_id: f.deed.id,
      data: { char_id: share.id, source: f.deed.id, reward, social: { kind, with: share.other } },
    });
  }
  return own;
}

// ---- S48 红名 / 悬赏 / 反杀 ----
//
// In a pk place the INITIATOR (whoever called attack) who kills another participant is wanted ("red name")
// and gets a system bounty hung on them; how long the red name lasts follows the tier relation
// (higher kills lower: kill_lower_ticks, peers: kill_peer_ticks, lower kills higher: kill_higher_ticks).
// Killing a lower tier pays no PK reward (S46 pays peers and the lower-tier killer as before). The
// passive side killing the initiator is not wanted and is paid as in S46. Killing someone who is wanted
// (any reason, whoever initiated, whatever the tier) is never punished; if the dead one was a red name
// with a bounty, the killer is paid the bounty (coin) and N times the PK value at the RED NAME's tier,
// the wanted record ends, and the hunt is counted apart from the 5 duel / pk rewards of the day.

export type RedNameRelation = "lower" | "peer" | "higher";

function redNameTicks(ctx: VerbContext, relation: RedNameRelation): number {
  const w = ctx.balance.numbers.wanted;
  const own = relation === "lower" ? w.kill_lower_ticks : relation === "peer" ? w.kill_peer_ticks : w.kill_higher_ticks;
  return own ?? w.kill_player_ticks;
}

/** Wanted (red name) + system bounty for `killer`, who just killed in a pk place. Returns the killer's own changes. */
export async function markRedName(ctx: VerbContext, killer: CharRow, place: PlaceRow, relation: RedNameRelation): Promise<Change[]> {
  if (killer.kind === "npc") return [];
  const up = await upsertWanted(ctx, killer, place, "kill_player", redNameTicks(ctx, relation));
  const changes = [...up.changes];
  const rule = ctx.balance.numbers.tasks.deed_bonus.combat_social;
  const pct = ctx.balance.numbers.wanted.bounty_coin_pct_of_task_coin;
  if (rule === undefined || pct === undefined) return changes;
  const t = tierNumbers(ctx.balance, killer.tier);

  const existing = up.wanted.bounty_task === null ? null : await getRow(ctx.q, "task", up.wanted.bounty_task);
  if (existing !== null && existing.record === "instance" && (existing.state === "open" || existing.state === "accepted")) {
    // Still red: the bounty lasts as long as the wanted record.
    if (BigInt(up.wanted.until_tick) > BigInt(existing.expires_tick)) {
      const change = must(await ctx.w.update("task", existing.id, { expires_tick: up.wanted.until_tick }));
      changes.push(change);
      await emitTaskChanged(ctx.w, merged(existing, { expires_tick: up.wanted.until_tick }, ctx.tick), null);
    }
    return changes;
  }

  const hunt = huntReward(ctx, killer.tier, rule);
  const coin = mulDiv(t.task_coin, pct, 100);
  const id = await ctx.w.newId("task");
  const row: TaskInstanceRow = {
    id, created_tick: ctx.tick, updated_tick: ctx.tick, record: "instance", template_id: null, kind: "bounty", tpl: "slay",
    issuer: { kind: "system", id: ctx.world.id }, offer_place: place.id, eligible_char: null, issuer_tier: null, taker: null,
    condition: { tpl: "slay", target: killer.id, archetype: null, tier: killer.tier, count: 1 },
    reward: { ...hunt, coin }, escrow: { coin, items: [] }, state: "open", accepted_seq: null,
    progress: { count: 0, evidence: [] }, expires_tick: up.wanted.until_tick, note: null,
  };
  const posted: Change[] = [must(await ctx.w.insert("task", row)), must(await ctx.w.update("wanted", up.wanted.id, { bounty_task: id }))];
  const deed = await ctx.w.deed({
    actor: null, verb: "attack", kind: "bounty_post", targets: [id, killer.id], place_id: place.id,
    result: { outcome: "success", changes: publicChanges(posted), roll: null, proposal: null }, visibility: "world", participants: [killer.id],
  });
  const wanted = { ...up.wanted, bounty_task: id, updated_tick: ctx.tick };
  await emitTaskChanged(ctx.w, row, deed.id);
  await ctx.w.emit({ scope: "self", recipients: [killer.id], type: "wanted_changed", deed_id: deed.id, data: { wanted } });
  await ctx.w.emit({ scope: "world", type: "wanted_changed", deed_id: deed.id, data: { wanted } });
  changes.push(...posted);
  return changes;
}

/** What killing a red name of tier `tier` pays in xp / potential: that tier's task value x pk_win_bp x hunt_mult. */
function huntReward(ctx: VerbContext, tier: number, rule: { pk_win_bp: number; hunt_mult: number }): Reward {
  const t = tierNumbers(ctx.balance, tier);
  const bp = rule.pk_win_bp * rule.hunt_mult;
  return { coin: 0, xp: mulDiv(t.task_xp, bp, 10000), potential: mulDiv(t.task_potential, bp, 10000), rep: 0, items: [] };
}

interface WantedStatus {
  /** Any active wanted record: the killer of this char is never punished. */
  any: boolean;
  /** The active red-name record that carries a live system bounty. */
  hunted: { wanted: WantedRow; task: TaskInstanceRow } | null;
}

async function wantedStatus(ctx: VerbContext, charId: ID): Promise<WantedStatus> {
  const rows = await selectRows(ctx.q, "wanted", "char_id = $1 AND state = 'active' AND until_tick > $2", [charId, ctx.tick]);
  for (const wanted of rows) {
    if (wanted.reason !== "kill_player" || wanted.bounty_task === null) continue;
    const task = await getRow(ctx.q, "task", wanted.bounty_task, { lock: true });
    if (task !== null && task.record === "instance" && (task.state === "open" || task.state === "accepted")) {
      return { any: true, hunted: { wanted, task } };
    }
  }
  return { any: rows.length > 0, hunted: null };
}

/**
 * The killer collects the bounty of a red name it just killed: coin from the escrow, xp / potential at N times the
 * PK value of the red name's tier. Once per red name per killer per game day, `hunt_daily_max` a day, apart from
 * the duel / pk five. Returns the killer's own changes when the killer is the acting char.
 */
async function collectBounty(
  ctx: VerbContext,
  rule: { pk_win_bp: number; hunt_mult: number; hunt_daily_max: number },
  hunter: CharRow,
  victim: CharRow,
  hunted: NonNullable<WantedStatus["hunted"]>,
  place: PlaceRow,
  actingId: ID,
): Promise<Change[]> {
  const dayStart = BigInt(ctx.world.day_index) * BigInt(ctx.balance.numbers.clock.day_ticks);
  const hunts = (await eventsSince(ctx.q, { inbox: hunter.id }, dayStart, null, null, 20000)).flatMap((e) =>
    e.type === "reward_granted" && e.data.social !== undefined && e.data.social.kind === "hunt" ? [e.data.social] : []);
  if (hunts.length >= rule.hunt_daily_max || hunts.some((h) => h.with === victim.id)) return [];

  const { wanted, task } = hunted;
  const reward: Reward = { ...huntReward(ctx, victim.tier, rule), coin: task.escrow.coin };
  const paid = await creditGrowth(ctx.q, ctx.w, hunter, reward);
  const own: Change[] = hunter.id === actingId ? [...paid.changes] : [];
  if (hunter.id === actingId) ctx.actor = paid.row;

  const taskPatch = { state: "completed" as const, taker: hunter.id, reward, escrow: { coin: 0, items: [] as ID[] }, progress: { count: 1, evidence: task.progress.evidence } };
  const taskChange = must(await ctx.w.update("task", task.id, taskPatch));
  const wantedChange = must(await ctx.w.update("wanted", wanted.id, { state: "cleared" }));
  const done = await ctx.w.deed({
    actor: hunter.id, verb: "attack", kind: "bounty_done", targets: [task.id, victim.id], place_id: place.id,
    result: { outcome: "success", changes: publicChanges([...paid.changes, taskChange]), roll: null, proposal: null },
    visibility: "world", participants: [hunter.id, victim.id],
  });
  const ended = await ctx.w.deed({
    actor: hunter.id, verb: "attack", kind: "wanted_end", targets: [wanted.id], place_id: place.id,
    result: { outcome: "success", changes: [wantedChange], roll: null, proposal: null }, visibility: "world", participants: [victim.id],
  });
  await emitTaskChanged(ctx.w, merged(task, taskPatch, ctx.tick), done.id);
  const cleared = { ...wanted, state: "cleared" as const, updated_tick: ctx.tick };
  await ctx.w.emit({ scope: "self", recipients: [victim.id], type: "wanted_changed", deed_id: ended.id, data: { wanted: cleared } });
  await ctx.w.emit({ scope: "world", type: "wanted_changed", deed_id: ended.id, data: { wanted: cleared } });
  await ctx.w.emit({
    scope: "self", recipients: [hunter.id], type: "reward_granted", deed_id: done.id,
    data: { char_id: hunter.id, source: task.id, reward, social: { kind: "hunt", with: victim.id } },
  });
  if (paid.rep !== null) await ctx.w.emit({ scope: "self", recipients: [hunter.id], type: "reputation_changed", deed_id: done.id, data: { reputation: paid.rep } });
  return [...own, taskChange, wantedChange];
}

export interface PkKill {
  /** Who called attack. */
  initiator: ID;
  /** The killer (winner) as it stands now: ctx.actor when it is the acting char, else the target row. */
  winner: CharRow;
  /** The dead participant as loaded before the fight. */
  loser: CharRow;
  place: PlaceRow;
  fight: SocialFight;
}

/** Everything a pk kill of one participant by another sets off. Returns the acting char's own changes. */
export async function settlePkKill(ctx: VerbContext, k: PkKill): Promise<Change[]> {
  const rule = ctx.balance.numbers.tasks.deed_bonus.combat_social;
  const status = await wantedStatus(ctx, k.loser.id);
  const own: Change[] = [];
  if (status.hunted !== null && rule !== undefined) {
    return collectBounty(ctx, rule, k.winner, k.loser, status.hunted, k.place, k.fight.me.id);
  }
  if (!status.any && k.winner.id === k.initiator) {
    const relation: RedNameRelation = k.winner.tier > k.loser.tier ? "lower" : k.winner.tier === k.loser.tier ? "peer" : "higher";
    own.push(...await markRedName(ctx, k.winner, k.place, relation));
    if (relation === "lower") return own;
  }
  own.push(...await socialCombatReward(ctx, k.fight));
  return own;
}
