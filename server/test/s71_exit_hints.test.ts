import assert from "node:assert/strict";
import { test } from "node:test";
import { startApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { setQuiet } from "../src/log.ts";

type Json = any;

const ANCHOR = "r1:place:xiuxian_out_reed_path";
const OUTER = "r1:place:xiuxian_out_pine_wild";

test("S71: exits show destination tier and danger in look and public place", async () => {
  setQuiet(true);
  const env: NodeJS.ProcessEnv = { ...process.env, AIHW_DB_DRIVER: "pglite", AIHW_PGLITE_DIR: "memory", AIHW_PORT: "0" };
  delete env.AIHW_CONTENT_DIR;
  const config = await loadConfig(env);
  config.clock.enabled = false;
  const app = await startApp(config);
  const call = async (verb: string, args: object, code: string | null = null): Promise<Json> =>
    (await app.dispatch({ verb, body: { args }, bearer: code, door: "api" })).body;
  try {
    const entered = await call("enter", { mode: "create", skin: "xiuxian", door: "api" });
    assert.equal(entered.ok, true);
    const code: string = entered.result.identity_code;
    const start = await call("look", {}, code);
    assert.equal(start.ok, true);
    const safeExit = start.result.place.exits.find((e: Json) => e.to === "r1:place:market_neutral");
    assert.equal(safeExit.danger, "low");
    assert.equal(safeExit.region, "neutral");

    await app.db.query("UPDATE chars SET loc = $1 WHERE id = $2", [ANCHOR, entered.result.char.id]);
    for (const section of ["place", "people"]) {
      const result = await call("look", { section }, code);
      assert.equal(result.ok, true);
      const place = result.result.place;
      const exit = place.exits.find((e: Json) => e.to === OUTER);
      assert.ok(exit);
      assert.equal(place.tier, 3);
      assert.equal(place.danger, "low");
      assert.equal(exit.tier, 4);
      assert.equal(exit.danger, "medium");
      assert.equal(exit.region, "xiuxian");
      assert.equal(exit.locked, false);
      assert.ok(exit.tier > place.tier);
    }

    const response = await fetch(`${app.url}/place/${ANCHOR}`);
    assert.equal(response.status, 200);
    const etag = response.headers.get("etag");
    assert.ok(etag);
    const body = await response.text();
    assert.match(body, /north → `r1:place:xiuxian_out_pine_wild`[^\n]*`tier4`[^\n]*`danger\.medium`/);
    await app.db.query("UPDATE places SET danger = 'high' WHERE id = $1", [OUTER]);
    const changed = await fetch(`${app.url}/place/${ANCHOR}`, { headers: { "If-None-Match": etag } });
    assert.equal(changed.status, 200);
    assert.match(await changed.text(), /north → `r1:place:xiuxian_out_pine_wild`[^\n]*`danger\.high`/);
  } finally {
    await app.close();
  }
});
