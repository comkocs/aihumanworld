// S72 scheduled world events. One window per period_ticks, open from the tick the
// period starts and held for duration_ticks. Two kinds alternate by the period's
// own number, so the schedule is a pure function of the tick and a restart can
// only ever reproduce it:
//   beast_tide    the place grows a few extra monsters of its own tier; they are
//                 ordinary monster NPCs and leave by the ordinary death / revive
//                 rules, so the close only announces.
//   secret_realm  one locked door of a neutral dungeon is unbarred for the window
//                 (the key is waived, not spent); the close puts the lock back,
//                 and the first non-NPC to walk into the room beyond collects a
//                 small once-only bonus on top of the ordinary first-arrival reward.
// Nothing here is opt-in: the announcement is a world-layer event plus a
// world-visible deed, and a char goes or stays as it likes.

import type { Queryable } from "../db/db.ts";
import type { ClockCtx, ClockPhase } from "../clock/phases.ts";
import { getRow, selectRows } from "../facts/store.ts";
import type { Change, CharRow, Exit, ID, PlaceRow, Tier, UInt } from "../facts/types.ts";
import type { Balance } from "../growth/balance.ts";
import { mulDiv, tierNumbers } from "../growth/balance.ts";
import { stats } from "../npc/facts.ts";
import { requireRevision } from "../orgs/numbers.ts";
import { creditGrowth } from "../tasks/common.ts";

export type WorldEventKind = "beast_tide" | "secret_realm";

interface WorldEventNumbers {
  period_ticks: number;
  duration_ticks: number;
  kinds: WorldEventKind[];
  beast_tide_extra: number;
  secret_realm_reward_bp: number;
}

/** The loaded S72 numbers, or null when the bundle carries no world-event section. */
export function worldEventNumbers(balance: Balance): WorldEventNumbers | null {
  const raw = balance.numbers.world_events;
  if (raw === undefined) return null;
  return {
    period_ticks: raw.period_ticks,
    duration_ticks: raw.duration_ticks,
    kinds: raw.kinds as WorldEventKind[],
    beast_tide_extra: raw.beast_tide_extra,
    secret_realm_reward_bp: raw.secret_realm_reward_bp,
  };
}

/**
 * Window covering `tick`, derived from the numbers alone. A window opens on a period
 * boundary and holds for duration_ticks. Tick 0 is the boot tick and is never processed
 * (the clock first steps to tick 1), so the first window is the first period boundary and
 * the kind follows the window's own ordinal: the 1st boundary takes kinds[0].
 */
export function windowAt(n: WorldEventNumbers, tick: bigint): { open: bigint; close: bigint; kind: WorldEventKind } | null {
  if (tick < 1n) return null;
  const period = BigInt(n.period_ticks);
  const index = tick / period;
  if (index < 1n) return null;
  const open = index * period;
  const close = open + BigInt(n.duration_ticks);
  if (tick < open || tick >= close) return null;
  const kind = n.kinds[Number((index - 1n) % BigInt(n.kinds.length))];
  if (kind === undefined) return null;
  return { open, close, kind };
}

interface EventRow {
  open_tick: string;
  close_tick: string;
  kind: WorldEventKind;
  place_id: ID;
  tier: number;
  state: "open" | "closed";
  spawned: unknown;
}

/** The one window still open, if any. Read by go.ts to price the secret-realm bonus. */
export async function openWorldEvent(q: Queryable): Promise<EventRow | null> {
  const r = await q.query<EventRow>("SELECT open_tick, close_tick, kind, place_id, tier, state, spawned FROM s72_world_events WHERE state = 'open'");
  return r.rows[0] ?? null;
}

const TIDE_BODIES = ["beast", "undead", "construct", "spirit"] as const;

/**
 * Where a window lands. Neutral places come first (every origin can reach them),
 * then the lowest tier, then the id, so the pick never moves between boots.
 * A beast tide wants a pve place that already fields a monster of its own tier,
 * because the extra monsters copy that one. A secret realm wants a neutral
 * dungeon whose locked door leads somewhere.
 */
async function choosePlace(q: Queryable, kind: WorldEventKind): Promise<{ place: PlaceRow; tier: Tier } | null> {
  const places = await selectRows(q, "place", "", [], 'ORDER BY id COLLATE "C"');
  const rank = (p: PlaceRow): string => `${p.region === "neutral" ? 0 : 1}:${String(p.tier).padStart(2, "0")}:${p.id}`;
  if (kind === "beast_tide") {
    const monsters = await selectRows(q, "char", "kind = 'npc' AND archetype = 'monster' AND life = 'alive'", []);
    const home = new Map<ID, Tier>();
    for (const m of monsters) {
      const tier = home.get(m.loc);
      if (tier === undefined || m.tier < tier) home.set(m.loc, m.tier);
    }
    const candidates = places.filter((p) => p.combat === "pve" && home.has(p.id));
    candidates.sort((a, b) => (rank(a) < rank(b) ? -1 : 1));
    const place = candidates[0];
    const tier = place === undefined ? undefined : home.get(place.id);
    return place === undefined || tier === undefined ? null : { place, tier };
  }
  const candidates = places.filter((p) => p.region === "neutral" && p.kind === "dungeon" && p.exits.some((e) => e.locked && e.key_def !== null));
  candidates.sort((a, b) => (rank(a) < rank(b) ? -1 : 1));
  const place = candidates[0];
  return place === undefined ? null : { place, tier: place.tier };
}

/** The monster a beast tide copies: alive, at the place, of the window's tier, lowest id. */
async function tideTemplate(q: Queryable, placeId: ID, tier: Tier): Promise<CharRow | null> {
  const rows = await selectRows(
    q, "char",
    "kind = 'npc' AND archetype = 'monster' AND life = 'alive' AND loc = $1 AND tier = $2",
    [placeId, tier],
    'ORDER BY id COLLATE "C"',
  );
  return rows[0] ?? null;
}

/** One extra monster, a copy of `tpl` with its own id and a full vigor bar. */
async function spawnMonster(ctx: ClockCtx, tpl: CharRow, n: number): Promise<ID> {
  const id = await ctx.w.newId("char");
  const row: CharRow = {
    ...tpl,
    id,
    created_tick: ctx.to_tick,
    updated_tick: ctx.to_tick,
    xp: 0,
    potential: 0,
    coin: 0,
    cycles: 0,
    legacy: 0,
    life: "alive",
    revive_tick: null,
    state: "active",
    state_since: ctx.to_tick,
    last_seen_tick: ctx.to_tick,
    last_yield_tick: ctx.to_tick,
    ap_tick: ctx.to_tick,
    ap_spent: 0,
    train_skill: null,
    day_index: 0,
    system_tasks_today: 0,
    known_places: [tpl.loc],
    patrol_route: [],
    patrol_index: 0,
    // Rotates the body so the copies are not the same creature four times over.
    body: TIDE_BODIES[(n + TIDE_BODIES.indexOf(tpl.body as (typeof TIDE_BODIES)[number]) + 1) % TIDE_BODIES.length] ?? "beast",
  };
  row.vigor = (await stats(ctx.q, ctx.balance, row)).vigor_max;
  await ctx.w.insert("char", row);
  return id;
}

interface TideSpawn {
  ids: ID[];
  changes: Change[];
}

async function openTide(ctx: ClockCtx, place: PlaceRow, tier: Tier, extra: number): Promise<TideSpawn> {
  const tpl = await tideTemplate(ctx.q, place.id, tier);
  const ids: ID[] = [];
  if (tpl !== null) {
    for (let i = 0; i < extra; i += 1) ids.push(await spawnMonster(ctx, tpl, i));
  }
  return { ids, changes: [] };
}

/** The locked exit a secret realm unbars: first locked, keyed exit in direction order. */
function barredExit(place: PlaceRow): Exit | undefined {
  return place.exits.find((e) => e.locked && e.key_def !== null);
}

/** Unbar the door. The spawned array remembers which exit, so the close relocks that one only. */
async function openRealm(ctx: ClockCtx, place: PlaceRow): Promise<{ spawned: { place_id: ID; dir: string }[]; changes: Change[] }> {
  const exit = barredExit(place);
  if (exit === undefined) return { spawned: [], changes: [] };
  const exits = place.exits.map((e) => (e.dir === exit.dir ? { ...e, locked: false } : e));
  const change = await ctx.w.update("place", place.id, { exits });
  return { spawned: [{ place_id: place.id, dir: exit.dir }], changes: change === null ? [] : [change] };
}

/** Put back the lock the opening took off. A door someone unlocked for good in between stays open. */
async function closeRealm(ctx: ClockCtx, row: EventRow): Promise<Change[]> {
  const spawned = Array.isArray(row.spawned) ? row.spawned : [];
  const changes: Change[] = [];
  for (const entry of spawned) {
    if (typeof entry !== "object" || entry === null) continue;
    const placeId = (entry as { place_id?: unknown }).place_id;
    const dir = (entry as { dir?: unknown }).dir;
    if (typeof placeId !== "string" || typeof dir !== "string") continue;
    const place = await getRow(ctx.q, "place", placeId);
    if (place === null) continue;
    const exit = place.exits.find((e) => e.dir === dir);
    // Only relock what is still a keyed door; a consumed key already opened it properly.
    if (exit === undefined || exit.key_def === null || exit.locked) continue;
    const exits = place.exits.map((e) => (e.dir === dir ? { ...e, locked: true } : e));
    const change = await ctx.w.update("place", place.id, { exits });
    if (change !== null) changes.push(change);
  }
  return changes;
}

async function announce(
  ctx: ClockCtx,
  phase: "open" | "close",
  row: { kind: WorldEventKind; place_id: ID; tier: number; open_tick: string; close_tick: string },
  changes: Change[],
): Promise<void> {
  const data = {
    kind: row.kind,
    phase,
    place_id: row.place_id,
    tier: row.tier as Tier,
    open_tick: row.open_tick,
    until_tick: row.close_tick,
  };
  const deed = await ctx.w.deed({
    actor: null,
    verb: "clock",
    kind: "world_event",
    targets: [row.place_id],
    place_id: row.place_id,
    result: { outcome: "success", changes, roll: null, proposal: null },
    visibility: "world",
    participants: [],
  });
  await ctx.w.emit({ scope: "world", type: "world_event", deed_id: deed.id, data });
}

async function openWindow(ctx: ClockCtx, rule: WorldEventNumbers, open: bigint, close: bigint, kind: WorldEventKind): Promise<void> {
  const chosen = await choosePlace(ctx.q, kind);
  if (chosen === null) return;
  const { place, tier } = chosen;
  const effect = kind === "beast_tide" ? await openTide(ctx, place, tier, rule.beast_tide_extra) : await openRealm(ctx, place);
  const row = { open_tick: open.toString(), close_tick: close.toString(), kind, place_id: place.id, tier };
  const spawned = "ids" in effect ? effect.ids : effect.spawned;
  await ctx.q.query(
    "INSERT INTO s72_world_events (open_tick, close_tick, kind, place_id, tier, state, spawned) VALUES ($1, $2, $3, $4, $5, 'open', $6::jsonb)",
    [row.open_tick, row.close_tick, kind, place.id, tier, JSON.stringify(spawned)],
  );
  await announce(ctx, "open", row, effect.changes);
}

async function closeWindow(ctx: ClockCtx, row: EventRow): Promise<void> {
  const changes = row.kind === "secret_realm" ? await closeRealm(ctx, row) : [];
  await ctx.q.query("UPDATE s72_world_events SET state = 'closed' WHERE open_tick = $1", [row.open_tick]);
  await announce(ctx, "close", row, changes);
}

export const worldEventPhase: ClockPhase = {
  name: "world_events",
  owner: "unassigned",
  async run(ctx) {
    requireRevision(ctx.balance, ctx.world.rules_revision, ctx.rules.balance_key);
    const rule = worldEventNumbers(ctx.balance);
    if (rule === null) return;

    const due = await ctx.q.query<EventRow>(
      "SELECT open_tick, close_tick, kind, place_id, tier, state, spawned FROM s72_world_events WHERE state = 'open' AND close_tick <= $1 ORDER BY open_tick",
      [ctx.to_tick],
    );
    for (const row of due.rows) await closeWindow(ctx, row);

    const win = windowAt(rule, BigInt(ctx.to_tick));
    if (win === null || win.open !== BigInt(ctx.to_tick)) return;
    const seen = await ctx.q.query("SELECT 1 FROM s72_world_events WHERE open_tick = $1", [win.open.toString()]);
    if (seen.rows.length > 0) return;
    await openWindow(ctx, rule, win.open, win.close, win.kind);
  },
};

/**
 * S72: the once-only bonus for the first non-NPC to walk into a secret realm's
 * inner room while its window is open, paid on top of the ordinary first-arrival
 * reward. Null when no secret realm is open, the char did not just enter its far
 * side, or this char already took it.
 */
export async function secretRealmBonus(
  ctx: Pick<ClockCtx, "q" | "w" | "balance">,
  me: CharRow,
  dest: PlaceRow,
): Promise<{ row: CharRow; changes: Change[]; reward: { coin: number; xp: number; potential: number; rep: number } } | null> {
  const rule = worldEventNumbers(ctx.balance);
  if (rule === null || me.kind === "npc") return null;
  const row = await openWorldEvent(ctx.q);
  if (row === null || row.kind !== "secret_realm") return null;
  const spawned = Array.isArray(row.spawned) ? row.spawned : [];
  const door = spawned.find((e): e is { place_id: string; dir: string } =>
    typeof e === "object" && e !== null && typeof (e as { place_id?: unknown }).place_id === "string");
  if (door === undefined) return null;
  const gate = await getRow(ctx.q, "place", door.place_id);
  const exit = gate?.exits.find((e) => e.dir === door.dir);
  if (exit === undefined || exit.to !== dest.id) return null;
  const prior = await ctx.q.query(
    "SELECT 1 FROM deeds WHERE kind = 'world_event' AND actor = $1 AND place_id = $2",
    [me.id, dest.id],
  );
  if (prior.rows.length > 0) return null;
  const reward = {
    coin: 0,
    xp: mulDiv(tierNumbers(ctx.balance, dest.tier).task_xp, rule.secret_realm_reward_bp, 10000),
    potential: mulDiv(tierNumbers(ctx.balance, dest.tier).task_potential, rule.secret_realm_reward_bp, 10000),
    rep: 0,
  };
  const paid = await creditGrowth(ctx.q, ctx.w, me, reward);
  return { row: paid.row, changes: paid.changes, reward };
}

/** Exposed so the test can assert the bonus against the tier table without re-deriving it. */
export function secretRealmReward(balance: Balance, tier: Tier): { xp: UInt; potential: UInt } {
  const rule = worldEventNumbers(balance);
  if (rule === null) return { xp: 0, potential: 0 };
  const t = tierNumbers(balance, tier);
  return {
    xp: mulDiv(t.task_xp, rule.secret_realm_reward_bp, 10000),
    potential: mulDiv(t.task_potential, rule.secret_realm_reward_bp, 10000),
  };
}
