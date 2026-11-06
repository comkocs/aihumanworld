// [S46] 论道 (discourse): a small public reward for two participants talking to each other.
//
// Rule (设计者 11-07 「偶遇奖励选 A 论道」): two different participating chars (player / official,
// never NPCs) at the same place; one speaks to the other first (direct, or place channel while the
// other is there); the other answers within `window_ticks` (direct to the first speaker, or on the
// place channel). The second sentence makes the discourse. Both get xp / potential = their own
// tier's full task value × a rate (numbers `tasks.deed_bonus.discourse`), through the same
// creditGrowth path as the world-first bonuses: the pair's very first discourse (初识) pays
// `first_xp_bp` / `first_potential_bp` (half a task), every later one `xp_bp` / `potential_bp`
// (a fifth of a task). One world-visible `discourse` deed names both in `targets`; each gets a
// `reward_granted` event, and the answering speaker's `say` result carries its own `changes`. A pair
// pays once per game day, a char at most `daily_max` times per game day (初识 and later alike);
// past that, speech goes on and nothing is paid.
//
// Weak constraint (产品文档第一节): nobody asks whether two chars share an owner; the daily caps
// alone bound the farm. State is read from the fact tables, so a restart forgets nothing.

import type { DbRow, Queryable } from "../db/db.ts";
import { countRows, getRow } from "../facts/store.ts";
import { decodeRow } from "../facts/tables.ts";
import type { Change, CharRow, EventRow, ID, Reward, Seq } from "../facts/types.ts";
import { creditGrowth, publicChanges } from "../tasks/common.ts";
import type { VerbContext } from "../verbs/types.ts";
import { mulDiv, tierNumbers } from "./balance.ts";

const PAGE = 20;
const SCAN_CAP = 400;
/** Most first-speakers one reply can settle (a crowded place channel). */
const CANDIDATE_CAP = 8;

export type EventSource = { inbox: ID } | { place: ID };

/**
 * Events of one source, newest first, below cursor `before` (exclusive), stopping at the first event
 * older than `minTick` or not newer than cursor `after` (cursor and tick grow together). Cost follows
 * what happened to the source inside the window, not the history.
 */
export async function eventsSince(
  q: Queryable,
  src: EventSource,
  minTick: bigint,
  before: Seq | null = null,
  after: bigint | null = null,
  cap: number = SCAN_CAP,
): Promise<EventRow[]> {
  const out: EventRow[] = [];
  let cursor = before;
  for (;;) {
    const params: unknown[] = ["inbox" in src ? src.inbox : src.place];
    const cut = cursor === null ? "" : ` AND ${"inbox" in src ? "i" : "e"}.cursor < $2`;
    if (cursor !== null) params.push(cursor);
    const sql =
      "inbox" in src
        ? `SELECT e.* FROM event_inbox i JOIN events e ON e.cursor = i.cursor WHERE i.char_id = $1${cut} ORDER BY i.cursor DESC LIMIT ${PAGE}`
        : `SELECT e.* FROM events e WHERE e.scope = 'place' AND e.place_id = $1${cut} ORDER BY e.cursor DESC LIMIT ${PAGE}`;
    const r = await q.query<DbRow>(sql, params);
    let last: EventRow | undefined;
    for (const row of r.rows) {
      const e = decodeRow("event", row);
      if (BigInt(e.tick) < minTick || (after !== null && BigInt(e.cursor) <= after)) return out;
      out.push(e);
      if (out.length >= cap) return out;
      last = e;
    }
    if (r.rows.length < PAGE || last === undefined) return out;
    cursor = last.cursor;
  }
}

/** Who spoke to `me` inside the window, newest first: speaker → cursor of their latest first sentence. */
async function firstSpeakers(ctx: VerbContext, me: CharRow, speech: EventRow, lo: bigint, onlyFrom: ID | null): Promise<Map<ID, bigint>> {
  const heard = new Map<ID, bigint>();
  const note = (who: ID, cursor: Seq): void => {
    if (who !== me.id && !heard.has(who)) heard.set(who, BigInt(cursor));
  };
  // Direct sentences to me (my inbox holds the direct speech of both sides).
  const mine = await eventsSince(ctx.q, { inbox: me.id }, lo, speech.cursor);
  for (const e of mine) if (e.type === "speech") note(e.data.speaker, e.cursor);
  if (onlyFrom !== null && heard.has(onlyFrom)) return heard;
  // Place sentences here that I was present for: no arrival of mine after the sentence.
  let arrived = 0n;
  for (const e of mine) {
    if (e.type === "moved" && e.data.char_id === me.id && e.data.to === me.loc && BigInt(e.cursor) > arrived) arrived = BigInt(e.cursor);
  }
  const here = await eventsSince(ctx.q, { place: me.loc }, lo, speech.cursor);
  for (const e of here) if (e.type === "speech" && BigInt(e.cursor) > arrived) note(e.data.speaker, e.cursor);
  return heard;
}

function rewardOf(ctx: VerbContext, c: CharRow, xpBp: number, potentialBp: number, repMult: number): Reward {
  const t = tierNumbers(ctx.balance, c.tier);
  return {
    coin: 0,
    xp: mulDiv(t.task_xp, xpBp, 10000),
    potential: mulDiv(t.task_potential, potentialBp, 10000),
    rep: t.rep_bounty * repMult,
    items: [],
  };
}

/**
 * Called by `say` right after its speech event is written, inside the same transaction:
 * pays out every discourse this sentence completes and returns the speaker's own fact changes
 * (xp / potential) for the `say` result. No-op for NPCs and for numbers without
 * `tasks.deed_bonus.discourse`.
 */
export async function settleDiscourse(ctx: VerbContext, speech: EventRow): Promise<Change[]> {
  const rule = ctx.balance.numbers.tasks.deed_bonus.discourse;
  const first = ctx.actor;
  const own: Change[] = [];
  if (rule === undefined || first === null || first.kind === "npc" || speech.type !== "speech") return own;
  if (rule.daily_max === 0) return own;
  let me: CharRow = first;
  const replyTo = speech.data.channel === "direct" ? speech.data.target : null;

  const lo = BigInt(ctx.tick) - BigInt(rule.window_ticks);
  const heard = await firstSpeakers(ctx, me, speech, lo, replyTo);
  const wanted = [...heard.entries()]
    .filter(([who]) => replyTo === null || who === replyTo)
    .sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0))
    .slice(0, CANDIDATE_CAP);
  if (wanted.length === 0) return own;

  const dayStart = (BigInt(ctx.world.day_index) * BigInt(ctx.balance.numbers.clock.day_ticks)).toString();
  const todays = (ids: ID[]): Promise<number> =>
    countRows(ctx.q, "deed", "kind = 'discourse' AND tick >= $1 AND participants @> $2::jsonb", [dayStart, JSON.stringify(ids)]);
  const everMet = (ids: ID[]): Promise<number> =>
    countRows(ctx.q, "deed", "kind = 'discourse' AND participants @> $1::jsonb", [JSON.stringify(ids)]);
  let myCount = await todays([me.id]);

  for (const [otherId] of wanted) {
    if (myCount >= rule.daily_max) return own;
    const other = await getRow(ctx.q, "char", otherId, { lock: true });
    if (other === null || other.kind === "npc" || other.id === me.id) continue;
    if ((other.state !== "draft" && other.state !== "active") || other.life !== "alive" || other.loc !== me.loc) continue;
    if ((await todays([other.id])) >= rule.daily_max) continue;
    // 初识 = the pair's first discourse ever; later ones pay once per game day.
    const firstMeeting = (await everMet([me.id, other.id])) === 0;
    if (!firstMeeting && (await todays([me.id, other.id])) > 0) continue;
    const xpBp = firstMeeting ? rule.first_xp_bp : rule.xp_bp;
    const potentialBp = firstMeeting ? rule.first_potential_bp : rule.potential_bp;
    if (xpBp === 0 && potentialBp === 0 && rule.rep_mult === 0) continue;

    const mine = rewardOf(ctx, me, xpBp, potentialBp, rule.rep_mult);
    const theirs = rewardOf(ctx, other, xpBp, potentialBp, rule.rep_mult);
    const changes: Change[] = [];
    const g1 = await creditGrowth(ctx.q, ctx.w, me, mine);
    me = g1.row;
    changes.push(...g1.changes);
    own.push(...g1.changes);
    const g2 = await creditGrowth(ctx.q, ctx.w, other, theirs);
    changes.push(...g2.changes);
    const deed = await ctx.w.deed({
      actor: me.id,
      verb: "say",
      kind: "discourse",
      targets: [me.id, other.id],
      place_id: me.loc,
      result: { outcome: "success", changes: publicChanges(changes), roll: null, proposal: null },
      visibility: "world",
      participants: [me.id, other.id],
    });
    await ctx.w.emit({ scope: "self", recipients: [me.id], type: "reward_granted", deed_id: deed.id, data: { char_id: me.id, source: deed.id, reward: mine, social: { kind: "discourse", with: other.id } } });
    await ctx.w.emit({ scope: "self", recipients: [other.id], type: "reward_granted", deed_id: deed.id, data: { char_id: other.id, source: deed.id, reward: theirs, social: { kind: "discourse", with: me.id } } });
    myCount += 1;
    ctx.actor = me;
  }
  return own;
}
