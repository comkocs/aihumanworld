import assert from "node:assert/strict";
import { test } from "node:test";
import { startApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { publicChar } from "../src/facts/project.ts";
import { insertRow, mustGetRow, updateRow } from "../src/facts/store.ts";
import type { CharRow } from "../src/facts/types.ts";
import { setQuiet } from "../src/log.ts";

type Json = any;

test("S109: look people shows roles, relative tiers and revival ticks", async () => {
  setQuiet(true);
  const config = await loadConfig({ ...process.env, AIHW_DB_DRIVER: "pglite", AIHW_PGLITE_DIR: "memory", AIHW_PORT: "0" });
  config.clock.enabled = false;
  const app = await startApp(config);
  const call = async (verb: string, args: object, code: string | null = null): Promise<Json> =>
    (await app.dispatch({ verb, body: { args }, bearer: code, door: "api" })).body;
  try {
    const entered = await call("enter", { mode: "create", skin: "xiuxian", door: "api" });
    assert.equal(entered.ok, true, JSON.stringify(entered.error));
    const code: string = entered.result.identity_code;
    const base = await mustGetRow(app.db, "char", entered.result.char.id);
    const world = await mustGetRow(app.db, "world", "r1:world:main");
    const tick = "100";
    await updateRow(app.db, "world", world.id, {
      tick, rules: { ...world.rules, tick_seconds: 86400, page_size: 100 },
    }, tick);
    await updateRow(app.db, "char", base.id, { tier: 1, stage: 3 }, tick);

    const npc: CharRow = {
      ...base, id: "r1:char:s109_patrol", kind: "npc", door: null, handle: null, email_hash: null, model: null,
      archetype: "patroller", tier: 2, stage: 1, life: "alive", revive_tick: null, state: "active",
      patrol_route: [], patrol_index: 0,
    };
    const fixtures: CharRow[] = [
      npc,
      { ...npc, id: "r1:char:s109_guard", archetype: "guard", tier: 1 },
      { ...npc, id: "r1:char:s109_monster", archetype: "monster", tier: 1, stage: 4, life: "dead", vigor: 0, revive_tick: "107" },
      { ...npc, id: "r1:char:s109_overdue", archetype: "monster", tier: 1, life: "dead", vigor: 0, revive_tick: "97" },
      { ...npc, id: "r1:char:s109_tutorial", archetype: "tutorial_opponent", tier: 1 },
      { ...npc, id: "r1:char:s109_merchant", archetype: "merchant", tier: 1 },
      { ...base, id: "r1:char:s109_official", kind: "official", handle: null, tier: 1, stage: 1 },
    ];
    for (const fixture of fixtures) await insertRow(app.db, "char", fixture);

    const people = await call("look", { section: "people", limit: 100 }, code);
    assert.equal(people.ok, true, JSON.stringify(people.error));
    assert.equal(people.tick, tick);
    assert.equal(people.result.has_more, false);
    const rows = new Map<string, Json>(people.result.rows.map((row: Json) => [row.id, row]));
    const expectedRoles = ["guard", "guard", "monster", "monster", "monster", "npc", "official"];
    for (const [index, fixture] of fixtures.entries()) {
      const shown = rows.get(fixture.id);
      assert.ok(shown, fixture.id);
      assert.equal(shown.role, expectedRoles[index], fixture.id);
      assert.equal(shown.vs_you, fixture.tier > 1 ? "higher" : "same", fixture.id);
      for (const [field, value] of Object.entries(publicChar(fixture))) assert.deepEqual(shown[field], value, `${fixture.id}.${field}`);
      if (fixture.life === "alive") {
        assert.equal(Object.hasOwn(shown, "revive_tick"), false, fixture.id);
        assert.equal(Object.hasOwn(shown, "revives_in"), false, fixture.id);
      }
    }
    assert.equal(rows.get("r1:char:s109_monster").revive_tick, "107");
    assert.equal(rows.get("r1:char:s109_monster").revives_in, 7);
    assert.equal(rows.get("r1:char:s109_overdue").revive_tick, "97");
    assert.equal(rows.get("r1:char:s109_overdue").revives_in, 0);
    const self = rows.get(base.id);
    assert.ok(self);
    assert.equal(self.role, "player");
    assert.equal(Object.hasOwn(self, "vs_you"), false);
    assert.equal(Object.hasOwn(self, "revive_tick"), false);
    assert.equal(Object.hasOwn(self, "revives_in"), false);

    await updateRow(app.db, "char", base.id, { tier: 3 }, tick);
    const higherViewer = await call("look", { section: "people", limit: 100 }, code);
    assert.equal(higherViewer.ok, true, JSON.stringify(higherViewer.error));
    assert.equal(higherViewer.result.rows.find((row: Json) => row.id === npc.id).vs_you, "lower");
  } finally {
    await app.close();
  }
});
