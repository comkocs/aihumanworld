import assert from "node:assert/strict";
import { test } from "node:test";
import { startApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { insertRow, mustGetRow, selectRows, updateRow } from "../src/facts/store.ts";
import type { CharRow } from "../src/facts/types.ts";
import { Writer } from "../src/facts/writer.ts";
import { setQuiet } from "../src/log.ts";
import { npcPhase } from "../src/npc/clock.ts";

test("S77 patrol and high-danger ambush", async () => {
  setQuiet(true);
  const config = await loadConfig({ ...process.env, AIHW_DB_DRIVER: "pglite", AIHW_PGLITE_DIR: "memory", AIHW_PORT: "0" });
  config.clock.enabled = false;
  const app = await startApp(config);
  try {
    const join = async () => {
      const out = await app.dispatch({ verb: "enter", body: { args: { mode: "create", skin: "xiuxian", door: "api" } }, bearer: null, door: "api" });
      assert.equal(out.status, 200);
      const body = out.body as any;
      return { id: body.result.char.id as string, code: body.result.identity_code as string };
    };
    const veteran = await join();
    const novice = await join();
    const world = await mustGetRow(app.db, "world", "r1:world:main");
    const base = await mustGetRow(app.db, "char", veteran.id);
    const patrol = await mustGetRow(app.db, "char", "r1:char:s77_xiuxian_patrol");
    const origin = patrol.loc;
    const next = patrol.patrol_route[1];
    assert.ok(next);
    const high = "r1:place:wild_t5";
    const monster: CharRow = { ...base, id: "r1:char:s77_test_monster", kind: "npc", door: null, handle: null, email_hash: null, model: null,
      body: "beast", archetype: "monster", tier: 5, stage: 1, life: "alive", state: "active", vigor: 100000,
      loc: high, respawn_place: high, patrol_route: [], patrol_index: 0 };
    await app.db.tx(async (q) => {
      await q.query("UPDATE chars SET state = 'dormant' WHERE kind = 'npc' AND archetype = 'monster'");
      await insertRow(q, "char", monster);
      await updateRow(q, "char", veteran.id, { loc: high, tier: 5, stage: 1, vigor: 100000, last_seen_tick: "5" }, "0");
      await updateRow(q, "char", novice.id, { loc: high, tier: 5, stage: 1, vigor: 100000, last_seen_tick: "5" }, "0");
      await q.query("UPDATE chars SET created_tick = 4 WHERE id = $1", [novice.id]);
    });
    const balance = structuredClone(app.services.balance());
    Object.assign(balance.numbers.npc, { ambush_interval_ticks: 1, ambush_chance_bp: 10000, ambush_cooldown_ticks: 60 });
    const phase = async (tick: string) => app.db.tx(async (q) => {
      const w = await mustGetRow(q, "world", world.id, { lock: true });
      await npcPhase.run({ q, w: new Writer(q, w.realm, tick, w.rules_revision, true), world: w, rules: w.rules, balance,
        from_tick: (BigInt(tick) - 1n).toString(), to_tick: tick, now: new Date(w.tick_started_at) });
    });
    await phase("5");
    assert.notEqual(origin, next);
    assert.equal((await mustGetRow(app.db, "char", patrol.id)).loc, next);
    const inbox = async (who: string) => app.db.query<{ data: any }>(
      "SELECT e.data FROM event_inbox i JOIN events e ON e.cursor = i.cursor WHERE i.char_id = $1 AND e.type = 'combat_resolved' AND e.data->>'ambush' = 'true'", [who]);
    assert.equal((await inbox(veteran.id)).rows.length, 1);
    assert.equal((await inbox(novice.id)).rows.length, 0);
    const event = (await inbox(veteran.id)).rows[0]!.data;
    assert.equal(event.attacker, monster.id);
    assert.equal(event.target, veteran.id);
    await phase("6");
    await phase("7");
    assert.equal((await inbox(veteran.id)).rows.length, 1);
    assert.equal((await inbox(novice.id)).rows.length, 0);
    const placed = await selectRows(app.db, "char", "archetype = 'patroller' AND id LIKE 'r1:char:s77_%'");
    assert.equal(placed.length, 5);
  } finally {
    await app.close();
  }
});
