import assert from "node:assert/strict";
import { test } from "node:test";
import { startApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { insertRow, mustGetRow } from "../src/facts/store.ts";
import type { CharRow } from "../src/facts/types.ts";
import { setQuiet } from "../src/log.ts";

type Json = any;

const START = "r1:place:start_xiuxian";
const MARKET = "r1:place:market_neutral";

test("S70: look and public places show participant combat, preserving NPC restrictions", async () => {
  setQuiet(true);
  const config = await loadConfig({ ...process.env, AIHW_DB_DRIVER: "pglite", AIHW_PGLITE_DIR: "memory", AIHW_PORT: "0", AIHW_CONTENT_DIR: "null" });
  config.clock.enabled = false;
  const app = await startApp(config);
  const call = async (verb: string, args: object, code: string | null = null): Promise<Json> =>
    (await app.dispatch({ verb, body: { args }, bearer: code, door: "api" })).body;
  try {
    const entered = await call("enter", { mode: "create", skin: "xiuxian", door: "api" });
    assert.equal(entered.ok, true);
    const code: string = entered.result.identity_code;
    const actor: string = entered.result.char.id;
    const other = await call("enter", { mode: "create", skin: "xiuxian", door: "api" });
    assert.equal(other.ok, true);

    for (const section of ["place", "people", "items", "tasks", "deeds"]) {
      const result = await call("look", { section }, code);
      assert.equal(result.ok, true);
      assert.equal(result.result.place.combat, "pk");
      assert.equal(result.result.place.danger, "low");
      assert.equal(result.result.place.npc_attackable, false);
    }
    const market = await (await fetch(`${app.url}/place/${MARKET}`)).text();
    assert.match(market, /`danger\.low`/);
    assert.match(market, /`combat\.pk`/);
    assert.match(market, /`npc_attackable=false`/);
    assert.doesNotMatch(market, /`(?:danger|combat)\.safe`/);
    const region = await (await fetch(`${app.url}/region/neutral`)).text();
    assert.match(region, /`combat\.pk`/);
    assert.match(region, /`npc_attackable=false`/);

    const me = await mustGetRow(app.db, "char", actor);
    const npc: CharRow = {
      ...me, id: "r1:char:s70_npc", kind: "npc", door: null, model: null,
      archetype: "monster", handle: null, email_hash: null, state: "active",
    };
    await insertRow(app.db, "char", npc);
    const blockedNpc = await call("attack", { target: npc.id }, code);
    assert.equal(blockedNpc.ok, false);
    assert.equal(blockedNpc.error.code, "NOT_ALLOWED");
    assert.equal(blockedNpc.error.details.reason, "combat");
    const protectedPlayer = await call("attack", { target: other.result.char.id }, code);
    assert.equal(protectedPlayer.ok, false);
    assert.equal(protectedPlayer.error.details.reason, "newbie");
    await app.db.query("UPDATE worlds SET tick_started_at = tick_started_at - interval '360 seconds'");
    const pk = await call("attack", { target: other.result.char.id }, code);
    assert.equal(pk.ok, true);
    const combat = await app.db.query<{ data: { mode: string } }>("SELECT data FROM events WHERE type = 'combat_resolved' ORDER BY cursor DESC LIMIT 1");
    assert.equal(combat.rows[0]?.data.mode, "pk");

    for (const [stored, danger, shown] of [["pve", "medium", "pk"], ["pk", "high", "pk"], ["duel", "safe", "duel"]] as const) {
      await app.db.query("UPDATE places SET combat = $1, danger = $2 WHERE id = $3", [stored, danger, START]);
      const result = await call("look", {}, code);
      assert.equal(result.ok, true);
      assert.equal(result.result.place.combat, shown);
      assert.equal(result.result.place.danger, danger === "safe" ? "low" : danger);
      assert.equal("npc_attackable" in result.result.place, false);
      const page = await (await fetch(`${app.url}/place/${START}`)).text();
      assert.match(page, new RegExp(`\\x60combat\\.${shown}\\x60`));
      assert.match(page, new RegExp(`\\x60danger\\.${danger === "safe" ? "low" : danger}\\x60`));
      assert.doesNotMatch(page, /npc_attackable=false/);
    }
    const stored = await app.db.query<{ combat: string; danger: string }>("SELECT combat, danger FROM places WHERE id = $1", [MARKET]);
    assert.deepEqual(stored.rows[0], { combat: "safe", danger: "safe" });
  } finally {
    await app.close();
  }
});
