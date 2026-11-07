// S72: a shared clock opens one world event per period and closes it a few ticks later.
// beast_tide adds monsters of the place's own tier; secret_realm unbars one locked
// door and pays the first char through it a small once-only bonus. Both announce on
// the world event layer and in the chronicle, and a restart must not open a second
// copy of a window it already passed.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { startApp } from "../src/app.ts";
import { Clock } from "../src/clock/scheduler.ts";
import { loadConfig } from "../src/config.ts";
import { worldId } from "../src/facts/ids.ts";
import { mustGetRow, updateRow } from "../src/facts/store.ts";
import { setQuiet } from "../src/log.ts";
import { secretRealmReward } from "../src/world_events/clock.ts";

type Json = any;

test("S72: beast tide and secret realm open, pay, and close on the shared clock", async () => {
  setQuiet(true);
  const contentDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../content/world");
  const config = await loadConfig({ ...process.env, AIHW_DB_DRIVER: "pglite", AIHW_PGLITE_DIR: "memory", AIHW_PORT: "0", AIHW_CONTENT_DIR: contentDir });
  config.clock.enabled = false;
  const app = await startApp(config);
  const balance = app.services.balance();
  const rule = balance.numbers.world_events;
  assert.ok(rule, "numbers carry a world_events section");
  if (rule === undefined) return;
  try {
    const world = await mustGetRow(app.db, "world", worldId(config.realm));
    assert.equal(world.rules_revision, "balance.v1.13");
    assert.equal(rule.period_ticks, 720);
    assert.equal(rule.duration_ticks, 30);
    assert.deepEqual(rule.kinds, ["beast_tide", "secret_realm"]);

    // The world boots at tick 0 with tick_started_at = now, so nothing is due yet.
    // A window sits 720 ticks out, so one advance must be allowed to walk the whole gap.
    const clock = new Clock(app.db, { realm: config.realm, maxCatchupPerTx: rule.period_ticks + rule.duration_ticks, balance: () => balance, now: () => new Date() });
    assert.equal(await clock.advanceDue(), 0, "a fresh world has no tick due");
    assert.equal((await count("events", "type = 'world_event'")), 0);

    // The first window opens at tick 720. Step the start back so exactly that one tick is due.
    await jumpTo(rule.period_ticks);
    const opened = await clock.advanceDue();
    assert.equal(opened, rule.period_ticks, "the clock walks to the first window");
    const atOpen = await mustGetRow(app.db, "world", world.id);
    assert.equal(atOpen.tick, String(rule.period_ticks));

    const tide = await one("SELECT open_tick, close_tick, kind, place_id, tier, state, spawned FROM s72_world_events");
    assert.equal(tide.kind, "beast_tide");
    assert.equal(tide.state, "open");
    assert.equal(tide.open_tick, String(rule.period_ticks));
    assert.equal(tide.close_tick, String(rule.period_ticks + rule.duration_ticks));
    const spawned = asArray(tide.spawned);
    assert.equal(spawned.length, rule.beast_tide_extra, "the tide added its extra monsters");

    const place = await mustGetRow(app.db, "place", String(tide.place_id));
    assert.equal(place.region, "neutral", "neutral places are gathered to first");
    for (const id of spawned) {
      const mob = await mustGetRow(app.db, "char", String(id));
      assert.equal(mob.kind, "npc");
      assert.equal(mob.archetype, "monster");
      assert.equal(mob.life, "alive");
      assert.equal(mob.loc, place.id);
      assert.equal(mob.tier, Number(tide.tier), "a tide monster matches the place's own tier");
    }
    const before = await count("chars", "kind = 'npc' AND archetype = 'monster' AND life = 'alive' AND loc = $1 AND tier = $2", [place.id, tide.tier]);
    assert.ok(before > rule.beast_tide_extra, "the place already had a monster to copy");

    const openEvent = await one("SELECT scope, type, data FROM events WHERE type = 'world_event' ORDER BY cursor DESC LIMIT 1");
    assert.equal(openEvent.scope, "world");
    const openData = asObj(openEvent.data);
    assert.deepEqual(
      [openData.kind, openData.phase, openData.place_id, openData.tier],
      ["beast_tide", "open", place.id, Number(tide.tier)],
    );
    const openDeed = await one("SELECT visibility, kind, actor, place_id FROM deeds WHERE kind = 'world_event' ORDER BY seq DESC LIMIT 1");
    assert.equal(openDeed.visibility, "world");
    assert.equal(openDeed.actor, null);
    assert.equal(openDeed.place_id, place.id);

    // The close tick removes nothing living (monsters leave by the ordinary revive
    // rules) but announces the end, and the same tick must not re-open the window.
    await jumpTo(rule.period_ticks + rule.duration_ticks);
    assert.equal(await clock.advanceDue(), rule.duration_ticks);
    const closed = await one("SELECT state FROM s72_world_events WHERE open_tick = $1", [String(rule.period_ticks)]);
    assert.equal(closed.state, "closed");
    const still = await count("chars", "id = ANY($1::text[]) AND life = 'alive'", [spawned]);
    assert.equal(still, spawned.length, "closing a tide does not kill its monsters");
    const closeEvent = await one("SELECT data FROM events WHERE type = 'world_event' ORDER BY cursor DESC LIMIT 1");
    assert.equal(asObj(closeEvent.data).phase, "close");
    assert.equal(await count("s72_world_events", "open_tick = $1", [String(rule.period_ticks)]), 1, "a passed window is not opened twice");

    // Period 1 opens a secret realm: one locked door of a neutral dungeon, unbarred.
    await jumpTo(2 * rule.period_ticks);
    assert.equal(await clock.advanceDue(), rule.period_ticks - rule.duration_ticks);
    const realm = await one("SELECT open_tick, close_tick, kind, place_id, tier, state, spawned FROM s72_world_events WHERE state = 'open'");
    assert.equal(realm.kind, "secret_realm");
    assert.equal(realm.open_tick, String(2 * rule.period_ticks));
    const door = asArray(realm.spawned)[0] as Json;
    assert.equal(typeof door.place_id, "string");
    assert.equal(typeof door.dir, "string");
    const gate = await mustGetRow(app.db, "place", String(realm.place_id));
    assert.equal(gate.region, "neutral");
    const exit = gate.exits.find((e) => e.dir === door.dir);
    assert.ok(exit, "the waived door is one of the place's exits");
    if (exit === undefined) return;
    assert.equal(exit.locked, false, "the door is open for the window");
    assert.ok(exit.key_def !== null, "the waived door is a keyed door");

    // A char walks through with no key and takes the once-only bonus; a second
    // crossing pays nothing more.
    const enter = await app.dispatch({ verb: "enter", body: { args: { mode: "create", skin: "xiuxian", door: "api", class: null } }, bearer: null, door: "api" });
    const body = enter.body as Json;
    assert.equal(body.ok, true, JSON.stringify(body.error));
    const code = body.result.identity_code as string;
    const charId = body.result.char.id as string;
    const tick = (await mustGetRow(app.db, "world", world.id)).tick;
    await updateRow(app.db, "char", charId, { loc: gate.id, ap_spent: 0 }, tick);
    await updateRow(app.db, "world", world.id, { rules: { ...(await mustGetRow(app.db, "world", world.id)).rules, ap_per_tick: 1000 } }, tick);

    const go = async (): Promise<Json> => (await app.dispatch({ verb: "go", body: { args: { dir: door.dir } }, bearer: code, door: "api" })).body;
    const first = await go();
    assert.equal(first.ok, true, JSON.stringify(first.error));
    const inner = await mustGetRow(app.db, "place", exit.to);
    const expect = secretRealmReward(balance, inner.tier);
    assert.ok(expect.xp > 0, "the bonus is non-zero");
    const grown = await mustGetRow(app.db, "char", charId);
    const numbers = JSON.parse(await readFile(new URL("../../content/rules/numbers.v1.json", import.meta.url), "utf8")) as Json;
    const arrival = numbers.tasks.deed_bonus.first_found;
    const tierXp = balance.numbers.tiers.find((t) => t.tier === Math.min(grown.tier, inner.tier))!.task_xp;
    const arrivalXp = Math.floor(tierXp * arrival.xp_bp / 10000);
    assert.equal(grown.xp, arrivalXp + expect.xp, "the bonus stacks once on the ordinary first arrival");

    await updateRow(app.db, "char", charId, { loc: gate.id, ap_spent: 0 }, tick);
    const second = await go();
    assert.equal(second.ok, true, JSON.stringify(second.error));
    const after = await mustGetRow(app.db, "char", charId);
    assert.equal(after.xp, grown.xp, "the bonus is once per char");

    // The close puts the lock back, and the door blocks again.
    await jumpTo(2 * rule.period_ticks + rule.duration_ticks);
    assert.equal(await clock.advanceDue(), rule.duration_ticks);
    const shut = await mustGetRow(app.db, "place", gate.id);
    const relocked = shut.exits.find((e) => e.dir === door.dir);
    assert.equal(relocked?.locked, true, "the door is locked again after the close");
    await updateRow(app.db, "char", charId, { loc: gate.id, ap_spent: 0 }, (await mustGetRow(app.db, "world", world.id)).tick);
    const blocked = await go();
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error.code, "EXIT_BLOCKED");

    const chronicle = await count("deeds", "kind = 'world_event' AND visibility = 'world'");
    assert.ok(chronicle >= 4, "open and close of both windows reached the chronicle");
  } finally {
    await app.close();
  }

  async function count(table: string, where: string, params: unknown[] = []): Promise<number> {
    const r = await app.db.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table} WHERE ${where}`, params);
    return Number(r.rows[0]?.n ?? 0);
  }
  async function one(sql: string, params: unknown[] = []): Promise<Json> {
    const r = await app.db.query<Json>(sql, params);
    assert.equal(r.rows.length, 1, sql);
    return r.rows[0];
  }
  /** Move the world's start back so the next advance runs exactly the ticks up to `tick`. */
  async function jumpTo(tick: number): Promise<void> {
    const w = await mustGetRow(app.db, "world", worldId(config.realm));
    const seconds = (w.rules.tick_seconds as number) * 1000;
    // One tick's worth of time per tick still to run, plus a hair so the last one is due.
    const started = new Date(Date.now() - (tick - Number(w.tick)) * seconds).toISOString();
    await updateRow(app.db, "world", w.id, { tick_started_at: started }, w.tick);
  }
});

function asArray(v: unknown): unknown[] {
  const parsed = typeof v === "string" ? JSON.parse(v) : v;
  assert.ok(Array.isArray(parsed));
  return parsed as unknown[];
}

function asObj(v: unknown): Json {
  return (typeof v === "string" ? JSON.parse(v) : v) as Json;
}
