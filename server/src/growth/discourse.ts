// [S46 / S51] 论道 (discourse): talking to each other pays, by time, a little faster than training does.
//
// Rule (设计者 11-07 「偶遇奖励选 A 论道」, 01:5x 「交流奖励不要限制次数…交流的收益要刚好大于练级收益一点」):
// two different participating chars (player / official, never NPCs) at the same place; one speaks to the other
// first (direct, or place channel while the other is there); the other answers within `window_ticks`
// (direct to the first speaker, or on the place channel). The second sentence makes a discourse, and every
// discourse pays, without any count limit and without "once per pair per day".
//
// What it pays is time: each of the two gets, from their own tier, the full-attendance day (`daily_xp_full`, and
// the same recipe for potential) x `talk_rate_bp` (1.1) / day_ticks per tick since THEIR OWN previous discourse
// reward, at most `talk_accrue_max_ticks` ticks (an hour). So the fastest anybody can earn by talking is 1.1 x
// the full-attendance training rate, however many partners and lines there are; a long silence is paid for one
// hour only. The previous reward is read from the char's own `reward_granted` events (social.kind = discourse),
// which also carry the fraction left over (`carry`, in 1/(10000 x day_ticks) units) so no rate is lost to rounding;
// a char with no reward yet counts from its creation. A pair's very first discourse (初识) adds half a task
// (`first_xp_bp` / `first_potential_bp` of the tier's full task value) once per pair, ever, and is also written
// as one world-visible `discourse` deed naming both; ordinary talk writes no deed, only the two reward events.
// The answering speaker's `say` result carries its own `changes`.
//
// Weak constraint (产品文档第一节): nobody asks whether two chars share an owner; the time rate alone bounds it.
// State is read from the fact tables, so a restart forgets nothing.

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

type Social = { kind: "discourse" | "duel" | "pk" | "hunt"; with: ID; carry?: { xp?: number; potential?: number } };

interface Accrual {
  reward: Reward;
  /** What is left over after paying whole points; stored in the reward event for the next accrual. */
  carry: { xp: number; potential: number };
}

/**
 * What `c` earns by this discourse: the time since its own previous discourse reward (capped), plus the 初识 bonus.
 * Integer arithmetic only: units are 1/(10000 x day_ticks) of a point.
 */
async function accrue(ctx: VerbContext, c: CharRow, rule: DiscourseRule, firstMeeting: boolean): Promise<Accrual> {
  const n = ctx.balance.numbers;
  const t = tierNumbers(ctx.balance, c.tier);
  const cap = rule.talk_accrue_max_ticks;
  const recent = await eventsSince(ctx.q, { inbox: c.id }, BigInt(ctx.tick) - BigInt(cap));
  const last = recent.find((e) => e.type === "reward_granted" && e.data.social !== undefined && e.data.social.kind === "discourse");
  const base = last === undefined ? BigInt(c.created_tick) : BigInt(last.tick);
  const gap = BigInt(ctx.tick) - base;
  const ticks = Number(gap < 0n ? 0n : gap > BigInt(cap) ? BigInt(cap) : gap);
  const carried = last !== undefined && last.type === "reward_granted" ? ((last.data.social as Social | undefined)?.carry ?? {}) : {};

  const unit = 10000 * n.clock.day_ticks;
  // Full-attendance day, same recipe as tiers[].daily_xp_full = 3 task_xp + 144 train_xp (数值表 §3.1).
  const dayPotential = (n.tasks.supply_per_char ?? 3) * t.task_potential + Math.floor(n.clock.day_ticks / n.clock.train_period_ticks) * t.train_potential;
  const xpUnits = t.daily_xp_full * rule.talk_rate_bp * ticks + (carried.xp ?? 0);
  const potentialUnits = dayPotential * rule.talk_rate_bp * ticks + (carried.potential ?? 0);
  let xp = Math.floor(xpUnits / unit);
  let potential = Math.floor(potentialUnits / unit);
  if (firstMeeting) {
    xp += mulDiv(t.task_xp, rule.first_xp_bp, 10000);
    potential += mulDiv(t.task_potential, rule.first_potential_bp, 10000);
  }
  return {
    reward: { coin: 0, xp, potential, rep: t.rep_bounty * rule.rep_mult, items: [] },
    carry: { xp: xpUnits % unit, potential: potentialUnits % unit },
  };
}

type DiscourseRule = NonNullable<VerbContext["balance"]["numbers"]["tasks"]["deed_bonus"]["discourse"]>;

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
  let me: CharRow = first;
  const replyTo = speech.data.channel === "direct" ? speech.data.target : null;

  const lo = BigInt(ctx.tick) - BigInt(rule.window_ticks);
  const heard = await firstSpeakers(ctx, me, speech, lo, replyTo);
  const wanted = [...heard.entries()]
    .filter(([who]) => replyTo === null || who === replyTo)
    .sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0))
    .slice(0, CANDIDATE_CAP);
  if (wanted.length === 0) return own;

  const everMet = (ids: ID[]): Promise<number> =>
    countRows(ctx.q, "deed", "kind = 'discourse' AND participants @> $1::jsonb", [JSON.stringify(ids)]);

  for (const [otherId] of wanted) {
    const other = await getRow(ctx.q, "char", otherId, { lock: true });
    if (other === null || other.kind === "npc" || other.id === me.id) continue;
    if ((other.state !== "draft" && other.state !== "active") || other.life !== "alive" || other.loc !== me.loc) continue;
    // 初识 = the pair's first discourse ever (only that one is a deed).
    const firstMeeting = (await everMet([me.id, other.id])) === 0;
    const mine = await accrue(ctx, me, rule, firstMeeting);
    const theirs = await accrue(ctx, other, rule, firstMeeting);
    const pays = (a: Accrual): boolean => a.reward.xp > 0 || a.reward.potential > 0 || a.reward.rep > 0;
    if (!pays(mine) && !pays(theirs)) continue;

    const changes: Change[] = [];
    if (pays(mine)) {
      const g = await creditGrowth(ctx.q, ctx.w, me, mine.reward);
      me = g.row;
      changes.push(...g.changes);
      own.push(...g.changes);
    }
    if (pays(theirs)) changes.push(...(await creditGrowth(ctx.q, ctx.w, other, theirs.reward)).changes);
    const deed = firstMeeting
      ? await ctx.w.deed({
          actor: me.id,
          verb: "say",
          kind: "discourse",
          targets: [me.id, other.id],
          place_id: me.loc,
          result: { outcome: "success", changes: publicChanges(changes), roll: null, proposal: null },
          visibility: "world",
          participants: [me.id, other.id],
        })
      : null;
    const source = deed === null ? speech.id : deed.id;
    for (const [who, partner, got] of [[me, other, mine], [other, me, theirs]] as [CharRow, CharRow, Accrual][]) {
      if (!pays(got)) continue;
      const social: Social = { kind: "discourse", with: partner.id, carry: got.carry };
      await ctx.w.emit({
        scope: "self", recipients: [who.id], type: "reward_granted", deed_id: deed === null ? null : deed.id,
        data: { char_id: who.id, source, reward: got.reward, social },
      });
    }
    ctx.actor = me;
  }
  return own;
}
