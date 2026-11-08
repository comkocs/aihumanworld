// S72 scheduled world events. One window per period_ticks, open from the tick the
// period starts and held for duration_ticks. Two kinds alternate by the period's
// own number, so the schedule is a pure function of the tick and a restart can
// only ever reproduce it:
//   beast_tide    the place grows a few extra monsters of its own tier; they are
//                 ordinary monster NPCs. The close checks participant kills and,
//                 if not repelled, persists the next destination and regional pressure.
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
import { log } from "../log.ts";
import { numberAt, requireRevision } from "../orgs/numbers.ts";
import { organizationAt } from "../orgs/weekly.ts";
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
 * dungeon whose keyed door leads somewhere, even after a player unlocked it.
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
  const candidates = places.filter((p) => p.region === "neutral" && p.kind === "dungeon" && p.exits.some((e) => e.key_def !== null));
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
async function spawnMonster(ctx: ClockCtx, tpl: CharRow, place: PlaceRow, n: number): Promise<ID> {
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
    loc: place.id,
    respawn_place: place.id,
    known_places: [place.id],
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
  const local = await tideTemplate(ctx.q, place.id, tier);
  const tpl = local ?? (await selectRows(ctx.q, "char", "kind = 'npc' AND archetype = 'monster' AND tier = $1", [tier], 'ORDER BY id COLLATE "C" LIMIT 1'))[0];
  const ids: ID[] = [];
  if (tpl !== undefined) {
    for (let i = 0; i < extra; i += 1) ids.push(await spawnMonster(ctx, tpl, place, i));
  }
  return { ids, changes: [] };
}

/** The first keyed exit remains a realm candidate after permanent player unlocking. */
function barredExit(place: PlaceRow): Exit | undefined {
  return place.exits.find((e) => e.key_def !== null);
}

/** Remember the destination even for an already-open gate, but only undo our own unlock. */
async function openRealm(ctx: ClockCtx, place: PlaceRow): Promise<{ spawned: { place_id: ID; dir: string; relock: boolean }[]; changes: Change[] }> {
  const exit = barredExit(place);
  if (exit === undefined) return { spawned: [], changes: [] };
  const spawned = [{ place_id: place.id, dir: exit.dir, relock: exit.locked }];
  if (!exit.locked) return { spawned, changes: [] };
  const exits = place.exits.map((e) => (e.dir === exit.dir ? { ...e, locked: false } : e));
  const change = await ctx.w.update("place", place.id, { exits });
  return { spawned, changes: change === null ? [] : [change] };
}

/** Put back the lock the opening took off. A door someone unlocked for good in between stays open. */
async function closeRealm(ctx: ClockCtx, row: EventRow): Promise<Change[]> {
  const spawned = Array.isArray(row.spawned) ? row.spawned : [];
  const changes: Change[] = [];
  for (const entry of spawned) {
    if (typeof entry !== "object" || entry === null || (entry as { relock?: boolean }).relock === false) continue;
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

interface TideState {
  next_place_id: ID | null;
  pressured_regions: PlaceRow["region"][];
  reward_bp: number;
}

async function tideState(q: Queryable, realm: string): Promise<TideState | null> {
  return (await q.query<TideState>("SELECT next_place_id, pressured_regions, reward_bp FROM s88_tide_state WHERE realm = $1", [realm])).rows[0] ?? null;
}

/** Regional pressure is fixed on the new system offer; old escrows and player bounties stay intact. */
export async function systemTaskRewardBp(q: Queryable, place: PlaceRow): Promise<number> {
  const state = await tideState(q, place.id.split(":")[0]!);
  return state?.pressured_regions.includes(place.region) ? state.reward_bp : 10000;
}

/** First traversable outward exit by destination id, then direction. No pve requirement at the new site. */
async function adjacentPlace(q: Queryable, from: PlaceRow): Promise<PlaceRow | null> {
  const exits = from.exits.filter((e) => !e.locked && e.to !== from.id && e.to.split(":")[0] === from.id.split(":")[0])
    .sort((a, b) => a.to < b.to ? -1 : a.to > b.to ? 1 : a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0);
  for (const exit of exits) {
    const dest = await getRow(q, "place", exit.to);
    if (dest !== null && dest.combat !== "safe" && dest.combat !== "duel") return dest;
  }
  return null;
}

interface TideResolution {
  defeated: boolean;
  next_place_id: ID | null;
  pressured_regions: PlaceRow["region"][];
  task_reward_bp: number;
  org_ids: ID[];
  message: string;
}

async function closeTide(ctx: ClockCtx, row: EventRow): Promise<TideResolution> {
  const ids = new Set(Array.isArray(row.spawned) ? row.spawned.filter((id): id is ID => typeof id === "string") : []);
  const kills = new Map<ID, { winner: ID; tick: string; seq: string }>();
  const events = await selectRows(ctx.q, "event",
    "type = 'combat_resolved' AND scope = 'place' AND tick >= $1 AND tick < $2 AND data -> 'dead' ?| $3::text[]",
    [row.open_tick, row.close_tick, [...ids]], "ORDER BY cursor");
  for (const event of events) {
    if (event.type !== "combat_resolved" || event.data.winner === null || event.deed_id === null || event.data.mode === "duel") continue;
    const winner = await getRow(ctx.q, "char", event.data.winner);
    const deed = await getRow(ctx.q, "deed", event.deed_id);
    if (winner === null || winner.kind === "npc" || deed === null) continue;
    for (const id of event.data.dead) {
      if (!ids.has(id) || kills.has(id) || !deed.result.changes.some((c) => c.table === "char" && c.id === id && c.after.life === "dead")) continue;
      kills.set(id, { winner: winner.id, tick: deed.tick, seq: deed.seq });
    }
  }
  const defeated = ids.size > 0 && kills.size === ids.size;
  const orgs = new Set<ID>();
  if (defeated) {
    for (const kill of kills.values()) {
      const org = await organizationAt(ctx.q, kill.winner, kill.tick, kill.seq);
      if (org !== null) orgs.add(org);
    }
  }
  const place = await getRow(ctx.q, "place", row.place_id);
  const next = defeated || place === null ? null : await adjacentPlace(ctx.q, place);
  if (!defeated && next === null) log.warn("兽潮没有可扩散的相邻地点，下一场留在原处", { place_id: row.place_id, open_tick: row.open_tick });
  const old = await tideState(ctx.q, ctx.world.realm);
  const regions = new Set(old?.pressured_regions ?? []);
  if (place !== null) regions.add(place.region);
  if (next !== null) regions.add(next.region);
  const rewardBp = defeated ? 10000 : numberAt(ctx.balance, "world_events.beast_tide_task_reward_bp");
  if (rewardBp > 10000) throw new Error("world_events.beast_tide_task_reward_bp exceeds basis-point range");
  const resolution: TideResolution = {
    defeated,
    next_place_id: defeated ? null : next?.id ?? row.place_id,
    pressured_regions: defeated ? [] : [...regions].sort(),
    task_reward_bp: rewardBp,
    org_ids: [...orgs].sort(),
    message: defeated
      ? `兽潮已打退，${[...regions].sort().join("、")}区系统差事报酬恢复 ×1.0。`
      : `兽潮没打退，${next === null ? `无可达邻地，留在 ${row.place_id}` : `扩到 ${next.id}`}；${[...regions].sort().join("、")}区系统差事报酬降两成（×0.8）。`,
  };
  await ctx.q.query(
    "INSERT INTO s88_tide_state (realm, next_place_id, pressured_regions, reward_bp, updated_tick) VALUES ($1, $2, $3::jsonb, $4, $5) ON CONFLICT (realm) DO UPDATE SET next_place_id = EXCLUDED.next_place_id, pressured_regions = EXCLUDED.pressured_regions, reward_bp = EXCLUDED.reward_bp, updated_tick = EXCLUDED.updated_tick",
    [ctx.world.realm, resolution.next_place_id, JSON.stringify(resolution.pressured_regions), rewardBp, ctx.to_tick],
  );
  await ctx.q.query("UPDATE s72_world_events SET resolution = $2::jsonb WHERE open_tick = $1", [row.open_tick, JSON.stringify(resolution)]);
  return resolution;
}

async function announce(
  ctx: ClockCtx,
  phase: "open" | "close",
  row: { kind: WorldEventKind; place_id: ID; tier: number; open_tick: string; close_tick: string },
  changes: Change[],
  resolution?: TideResolution,
): Promise<void> {
  const data = {
    kind: row.kind,
    phase,
    place_id: row.place_id,
    tier: row.tier as Tier,
    open_tick: row.open_tick,
    until_tick: row.close_tick,
    ...(resolution ?? {}),
  };
  const result = { outcome: "success" as const, changes, roll: null, proposal: null, world_event: data };
  const deed = await ctx.w.deed({
    actor: null,
    verb: "clock",
    kind: "world_event",
    targets: [row.place_id],
    place_id: row.place_id,
    result,
    visibility: "world",
    participants: [],
  });
  await ctx.w.emit({ scope: "world", type: "world_event", deed_id: deed.id, data });
}

async function openWindow(ctx: ClockCtx, rule: WorldEventNumbers, open: bigint, close: bigint, kind: WorldEventKind): Promise<void> {
  const pending = kind === "beast_tide" ? await tideState(ctx.q, ctx.world.realm) : null;
  const spread = pending?.next_place_id === null || pending?.next_place_id === undefined ? null : await getRow(ctx.q, "place", pending.next_place_id);
  const chosen = spread === null ? await choosePlace(ctx.q, kind) : { place: spread, tier: spread.tier };
  if (chosen === null) {
    log.warn("世界事件没有可用地点，跳过本场", { kind, open_tick: open.toString() });
    return;
  }
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
  const resolution = row.kind === "beast_tide" ? await closeTide(ctx, row) : undefined;
  await ctx.q.query("UPDATE s72_world_events SET state = 'closed' WHERE open_tick = $1", [row.open_tick]);
  await announce(ctx, "close", row, changes, resolution);
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
    "SELECT 1 FROM deeds WHERE kind = 'world_event' AND verb = 'go' AND place_id = $2 AND (actor = $1 OR (actor IS NOT NULL AND tick >= $3 AND tick < $4))",
    [me.id, dest.id, row.open_tick, row.close_tick],
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
