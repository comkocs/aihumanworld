// S89: deterministic arrival facts, their self events and credited rewards.
import assert from "node:assert/strict";
import { test } from "node:test";
import { startApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { insertRow, mustGetRow, updateRow } from "../src/facts/store.ts";
import type { ItemDefinitionRow } from "../src/facts/types.ts";
import { u32 } from "../src/growth/settlement.ts";
import { setQuiet } from "../src/log.ts";

type Json = any;
const start = "r1:place:start_xiuxian";
const dest = "r1:place:market_neutral";
const material: ItemDefinitionRow = {
  id: "r1:item:s89_ore", created_tick: "0", updated_tick: "0", record: "definition",
  content_key: "content.r1.item.s89_ore", kind: "ore", tier: 1, grade: 1, element: "none",
  slots: 0, cap: 0, dura_max: 0, modifiers: { vigor: 0, power: 0, guard: 0, speed: 0 },
  effect: { kind: "none" }, by: null, note: null,
};

test("S89: three arrival facts, no event, replay and same-tick repeat", async () => {
  setQuiet(true);
  const config = await loadConfig({ ...process.env, AIHW_DB_DRIVER: "pglite", AIHW_PGLITE_DIR: "memory", AIHW_PORT: "0", AIHW_CONTENT_DIR: "null" });
  config.clock.enabled = false;
  const app = await startApp(config);
  try {
    await insertRow(app.db, "item", material);
    const invoke = async (verb: string, args: object, bearer: string | null): Promise<Json> =>
      (await app.dispatch({ verb, body: { args }, bearer, door: "api" })).body;
    const enter = await invoke("enter", { mode: "create", skin: "xiuxian", door: "api" }, null);
    assert.equal(enter.ok, true, JSON.stringify(enter));
    const id: string = enter.result.char.id;
    const code: string = enter.result.identity_code;
    const world = await mustGetRow(app.db, "world", "r1:world:main");
    assert.equal(world.rules_revision, "balance.v1.15");
    const seed = (tick: number): string => JSON.stringify(["r1", id, String(tick), dest]);
    const choose = (predicate: (tick: number) => boolean): number => {
      for (let tick = 1; tick < 100000; tick++) if (predicate(tick)) return tick;
      throw new Error("fixed test seed not found");
    };
    const noTick = choose((t) => u32(seed(t), "encounter") % 10000 >= 600);
    const ticks = [0, 1, 2].map((kind) => choose((t) => u32(seed(t), "encounter") % 10000 < 300 && u32(seed(t), "kind") % 3 === kind));
    const goAt = async (tick: number): Promise<{ before: Awaited<ReturnType<typeof mustGetRow<"char">>>; body: Json }> => {
      await app.db.query("UPDATE worlds SET tick = $1, tick_started_at = now() WHERE id = $2", [String(tick), world.id]);
      await updateRow(app.db, "char", id, { loc: start, ap_spent: 0, ap_tick: String(tick) }, String(tick));
      const before = await mustGetRow(app.db, "char", id);
      const body = await invoke("go", { dir: "south" }, code);
      assert.equal(body.ok, true, JSON.stringify(body));
      return { before, body };
    };
    const none = await goAt(noTick);
    assert.equal(Object.hasOwn(none.body.result, "encounter"), false);
    for (const [index, tick] of ticks.entries()) {
      const { before, body } = await goAt(tick!);
      const fact = body.result.encounter;
      assert.equal(fact.kind, ["item", "xp", "coin"][index]);
      const after = await mustGetRow(app.db, "char", id);
      if (fact.kind === "item") {
        assert.equal(fact.def_id, material.id);
        const item = await mustGetRow(app.db, "item", fact.item_id);
        assert.equal(item.record, "instance");
        if (item.record === "instance") assert.deepEqual(item.holder, { kind: "char", id });
      } else if (fact.kind === "xp") {
        assert.equal(fact.xp, 3);
        assert.equal(after.xp, before.xp + fact.xp);
      } else {
        assert.equal(fact.coin, 1);
        assert.equal(after.coin, before.coin + fact.coin);
      }
      const events = await app.db.query<{ scope: string; data: Json }>(
        "SELECT scope, data FROM events WHERE type = 'reward_granted' AND data->'encounter' = $1::jsonb", [JSON.stringify(fact)],
      );
      assert.equal(events.rows.length, 1);
      assert.equal(events.rows[0]!.scope, "self");
      assert.deepEqual(events.rows[0]!.data.encounter, fact);
    }
    const replay = await goAt(ticks[1]!);
    assert.equal(Object.hasOwn(replay.body.result, "encounter"), false);
    assert.equal((await mustGetRow(app.db, "char", id)).xp, replay.before.xp);
    const repeatTick = choose((t) => {
      const r = u32(seed(t), "encounter") % 10000;
      return r >= 300 && r < 600;
    });
    const first = await goAt(repeatTick);
    assert.ok(first.body.result.encounter);
    const repeat = await goAt(repeatTick);
    assert.equal(Object.hasOwn(repeat.body.result, "encounter"), false);
  } finally {
    await app.close();
    setQuiet(false);
  }
});

test("S96: same-tick return to the same place grants encounter only once", async () => {
  setQuiet(true);
  const config = await loadConfig({ ...process.env, AIHW_DB_DRIVER: "pglite", AIHW_PGLITE_DIR: "memory", AIHW_PORT: "0", AIHW_CONTENT_DIR: "null" });
  config.clock.enabled = false;
  const app = await startApp(config);
  try {
    const invoke = async (verb: string, args: object, bearer: string | null): Promise<Json> =>
      (await app.dispatch({ verb, body: { args }, bearer, door: "api" })).body;
    const enter = await invoke("enter", { mode: "create", skin: "xiuxian", door: "api" }, null);
    assert.equal(enter.ok, true, JSON.stringify(enter));
    const id: string = enter.result.char.id;
    const code: string = enter.result.identity_code;
    let tick = 1;
    while (tick < 100000) {
      const seed = JSON.stringify(["r1", id, String(tick), dest]);
      if (u32(seed, "encounter") % 10000 < 300 && u32(seed, "kind") % 3 === 1) break;
      tick++;
    }
    assert.ok(tick < 100000, "fixed test seed not found");
    await app.db.query("UPDATE worlds SET tick = $1, tick_started_at = now() WHERE id = $2", [String(tick), "r1:world:main"]);
    await updateRow(app.db, "char", id, { ap_spent: 0, ap_tick: String(tick) }, String(tick));
    const first = await invoke("go", { dir: "south" }, code);
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.deepEqual(first.result.encounter, { kind: "xp", xp: 3 });
    const away = await invoke("go", { dir: "north" }, code);
    assert.equal(away.ok, true, JSON.stringify(away));
    const before = await mustGetRow(app.db, "char", id);
    const again = await invoke("go", { dir: "south" }, code);
    assert.equal(again.ok, true, JSON.stringify(again));
    assert.equal(Object.hasOwn(again.result, "encounter"), false);
    assert.equal((await mustGetRow(app.db, "char", id)).xp, before.xp);
  } finally {
    await app.close();
    setQuiet(false);
  }
});
