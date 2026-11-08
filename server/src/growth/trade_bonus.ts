// [S92] Completed exchanges, never speech frequency, pay discourse cultivation.
// The world lock serialises credits. Durable events remember each item and
// each participant's lifetime net-coin outflow high-water mark.

import { itemPrice } from "../economy/prices.ts";
import { getRow, selectRows } from "../facts/store.ts";
import type { Change, CharRow, DeedRow, ID, Reward, TaskInstanceRow } from "../facts/types.ts";
import { numberAt } from "../orgs/numbers.ts";
import { creditGrowth } from "../tasks/common.ts";
import type { VerbContext } from "../verbs/types.ts";
import { mulDiv, tierNumbers } from "./balance.ts";

type TradeKind = "give_item" | "give_coin" | "bounty" | "hunt" | "learn";
interface TradeNote {
  kind: TradeKind;
  key: string;
  pair: string;
  coin_owner?: string;
  coin_position?: string;
  coin_high?: string;
}

const path = "tasks.deed_bonus.trade";
const rule = (ctx: VerbContext, name: string): number => numberAt(ctx.balance, `${path}.${name}`);
const pairKey = (a: ID, b: ID): string => [a, b].sort().join("|");
const participant = (c: CharRow): boolean => c.kind !== "npc" && (c.state === "active" || c.state === "draft");

export type TradeReward = { xp: number; potential: number };
type TradeSettlement = { changes: Change[]; trade_reward?: TradeReward };
const noTrade = (): TradeSettlement => ({ changes: [] });

async function paid(ctx: VerbContext, key: string, pair: string): Promise<boolean> {
  const r = await ctx.q.query(
    "SELECT 1 FROM events WHERE type = 'reward_granted' AND data->'trade'->>'key' = $1 AND data->'trade'->>'pair' = $2 LIMIT 1",
    [key, pair],
  );
  return r.rows.length > 0;
}

/** Both get the lower tier's task value, scaled by real value up to one full exchange. */
async function creditPair(ctx: VerbContext, aId: ID, bId: ID, deed: DeedRow, note: TradeNote, value?: number): Promise<TradeSettlement> {
  const a = await getRow(ctx.q, "char", aId, { lock: true });
  const b = await getRow(ctx.q, "char", bId, { lock: true });
  if (a === null || b === null || a.id === b.id || !participant(a) || !participant(b) || await paid(ctx, note.key, note.pair)) return noTrade();
  const t = tierNumbers(ctx.balance, Math.min(a.tier, b.tier));
  const fullValue = mulDiv(t.task_coin, rule(ctx, "full_value_bp"), 10000);
  const minimum = Math.max(1, mulDiv(t.task_coin, rule(ctx, "min_value_bp"), 10000));
  if (value !== undefined && value < minimum) return noTrade();
  const weight = value === undefined ? fullValue : Math.min(value, fullValue);
  const denominator = 10000 * fullValue;
  const reward: Reward = {
    coin: 0,
    xp: mulDiv(t.task_xp, rule(ctx, "xp_bp") * weight, denominator),
    potential: mulDiv(t.task_potential, rule(ctx, "potential_bp") * weight, denominator),
    rep: 0, items: [],
  };
  const own: Change[] = [];
  let trade_reward: TradeReward | undefined;
  for (const [who, other] of [[a, b], [b, a]] as const) {
    const got = await creditGrowth(ctx.q, ctx.w, who, reward);
    // `trade` is optional S92 metadata on the existing reward event, not a new event kind.
    const data = { char_id: who.id, source: deed.id, reward, social: { kind: "discourse" as const, with: other.id }, trade: note };
    await ctx.w.emit({ scope: "self", recipients: [who.id], type: "reward_granted", deed_id: deed.id, data });
    if (note.kind !== "give_coin") await ctx.w.emit({ scope: "self", recipients: [who.id], type: "fact_changed", deed_id: deed.id, data: { changes: got.changes } });
    if (ctx.actor?.id === who.id) {
      ctx.actor = got.row;
      own.push(...got.changes);
      if (reward.xp > 0 || reward.potential > 0) trade_reward = { xp: reward.xp, potential: reward.potential };
    }
  }
  return { changes: own, ...(trade_reward === undefined ? {} : { trade_reward }) };
}

/** Only the first transfer of an instance between participants is eligible. */
export async function settleGiveItem(ctx: VerbContext, giver: ID, receiver: ID, item: ID, deed: DeedRow): Promise<TradeSettlement> {
  const instance = await getRow(ctx.q, "item", item);
  const a = await getRow(ctx.q, "char", giver);
  const b = await getRow(ctx.q, "char", receiver);
  if (instance?.record !== "instance" || a === null || b === null || !participant(a) || !participant(b)) return noTrade();
  const previous = await ctx.q.query(
    "SELECT 1 FROM events WHERE type = 'reward_granted' AND data->'trade'->>'key' IN ($1, $2) LIMIT 1",
    [`item-journal:${item}`, `item:${item}`],
  );
  if (previous.rows.length > 0) return noTrade();
  const pair = pairKey(giver, receiver);
  const note: TradeNote = { kind: "give_item", key: `item:${item}`, pair };
  const data = { char_id: giver, source: deed.id, reward: { coin: 0, xp: 0, potential: 0, rep: 0, items: [] },
    trade: { ...note, key: `item-journal:${item}` } };
  await ctx.w.emit({ scope: "self", recipients: [giver], type: "reward_granted", deed_id: deed.id, data });
  return creditPair(ctx, giver, receiver, deed, note, await itemPrice(ctx.q, ctx.balance, instance.def_id));
}

/** Only the giver's new all-participant net-outflow high water earns credit. */
export async function settleGiveCoin(ctx: VerbContext, giver: ID, receiver: ID, amount: number, deed: DeedRow): Promise<TradeSettlement> {
  const a = await getRow(ctx.q, "char", giver);
  const b = await getRow(ctx.q, "char", receiver);
  if (a === null || b === null || !participant(a) || !participant(b)) return noTrade();
  const pair = pairKey(giver, receiver);
  const replay = await ctx.q.query("SELECT 1 FROM events WHERE type = 'reward_granted' AND deed_id = $1 AND data->'trade'->>'key' = $2 LIMIT 1", [deed.id, `journal:${deed.id}`]);
  if (replay.rows.length > 0) return noTrade();
  let fresh = 0n;
  let giverNote: TradeNote | undefined;
  for (const [owner, delta] of [[giver, BigInt(amount)], [receiver, -BigInt(amount)]] as const) {
    const last = await ctx.q.query<{ trade: TradeNote }>(
      "SELECT data->'trade' AS trade FROM events WHERE type = 'reward_granted' AND data->'trade'->>'kind' = 'give_coin' " +
        "AND data->'trade'->>'coin_owner' = $1 AND data->'trade'->>'key' LIKE 'journal:%' ORDER BY cursor DESC LIMIT 1", [owner],
    );
    const old = last.rows[0]?.trade;
    const position = BigInt(old?.coin_position ?? "0") + delta;
    const high = BigInt(old?.coin_high ?? "0");
    const note: TradeNote = { kind: "give_coin", key: `journal:${deed.id}`, pair, coin_owner: owner,
      coin_position: position.toString(), coin_high: (position > high ? position : high).toString() };
    if (owner === giver) {
      fresh = position > high ? position - high : 0n;
      giverNote = note;
    }
    const data = { char_id: owner, source: deed.id, reward: { coin: 0, xp: 0, potential: 0, rep: 0, items: [] }, trade: note };
    await ctx.w.emit({ scope: "self", recipients: [owner], type: "reward_granted", deed_id: deed.id, data });
  }
  return creditPair(ctx, giver, receiver, deed, { ...giverNote!, key: `coin:${deed.id}` }, Number(fresh));
}

/** Player-funded bounty completion: escrow value scales the bonus; system/NPC bounties never count. */
export async function settleBountyTrade(ctx: VerbContext, task: TaskInstanceRow, deed: DeedRow): Promise<TradeSettlement> {
  if (task.kind !== "bounty" || task.issuer.kind !== "char" || task.taker === null) return noTrade();
  let value = task.escrow.coin;
  for (const item of task.escrow.items) {
    const instance = await getRow(ctx.q, "item", item);
    if (instance?.record === "instance") value += await itemPrice(ctx.q, ctx.balance, instance.def_id);
  }
  return creditPair(ctx, task.issuer.id, task.taker, deed,
    { kind: "bounty", key: `bounty:${task.id}`, pair: pairKey(task.issuer.id, task.taker) }, value);
}

/** A successful level/cap advancement is one teaching exchange, not repeat credit for the deed. */
export async function settleLearnTrade(ctx: VerbContext, student: ID, master: ID, deed: DeedRow): Promise<TradeSettlement> {
  return creditPair(ctx, student, master, deed, { kind: "learn", key: `learn:${deed.id}`, pair: pairKey(student, master) });
}

/** Recent bouts against any suitable monster at the same place qualify, including ambushes. */
export async function settleCoKillTrade(ctx: VerbContext, monster: CharRow, kill: DeedRow, killerId: ID): Promise<Change[]> {
  const killer = await getRow(ctx.q, "char", killerId);
  if (killer === null || !participant(killer) || monster.tier < killer.tier) return [];
  const rows = await selectRows(ctx.q, "deed",
    "verb IN ('attack', 'clock') AND kind IN ('combat_win', 'combat_loss', 'combat_draw', 'duel_win') " +
      "AND place_id = $1 AND tick >= $2::bigint AND tick <= $3::bigint AND seq < $4::bigint",
    [kill.place_id, (BigInt(ctx.tick) - BigInt(rule(ctx, "hunt_window_ticks"))).toString(), ctx.tick, kill.seq], "ORDER BY seq DESC");
  const helpers = new Set<ID>();
  for (const d of rows) {
    const input = d.result.roll?.inputs;
    if (input === undefined || input.target?.archetype !== "monster" || input.target.tier < input.actor.tier) continue;
    const isAttack = d.verb === "attack" && d.actor === input.actor.char_id && d.targets.includes(input.target.char_id);
    const isAmbush = d.verb === "clock" && d.actor === input.target.char_id && d.targets.includes(input.actor.char_id);
    if ((isAttack || isAmbush) && input.actor.char_id !== killerId) helpers.add(input.actor.char_id);
  }
  const own: Change[] = [];
  for (const helper of helpers) {
    const c = await getRow(ctx.q, "char", helper);
    if (c === null || c.loc !== kill.place_id || !participant(c) || monster.tier < c.tier) continue;
    const pair = pairKey(killerId, helper);
    const recent = await ctx.q.query(
      "SELECT 1 FROM events WHERE type = 'reward_granted' AND data->'trade'->>'kind' = 'hunt' " +
        "AND data->'trade'->>'pair' = $1 AND tick > $2::bigint LIMIT 1",
      [pair, (BigInt(ctx.tick) - BigInt(rule(ctx, "hunt_pair_cooldown_ticks"))).toString()],
    );
    if (recent.rows.length > 0) continue;
    own.push(...(await creditPair(ctx, killerId, helper, kill,
      { kind: "hunt", key: `hunt:${kill.id}`, pair })).changes);
  }
  return own;
}
