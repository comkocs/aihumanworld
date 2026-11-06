// S45: a wrong-place task submit names the turn-in place; whoami says when a
// breakthrough would clear stage / tier / xp / training.

import assert from "node:assert/strict";
import { test } from "node:test";
import { startApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { insertRow, mustGetRow } from "../src/facts/store.ts";
import { worldId } from "../src/facts/ids.ts";
import { Writer } from "../src/facts/writer.ts";
import { gridNumbers } from "../src/growth/balance.ts";
import { learnedSkill, skillDefinition } from "../src/growth/facts.ts";
import type { TaskTemplateRow } from "../src/facts/types.ts";
import { setQuiet } from "../src/log.ts";

type Json = any;

const START = "r1:place:start_xiuxian";
const MARKET = "r1:place:market_neutral";
const TPL = "r1:task:s45_reach_market";

const reachMarket: TaskTemplateRow = {
  id: TPL,
  created_tick: "0",
  updated_tick: "0",
  record: "template",
  content_key: "content.r1.task.s45_reach_market",
  tpl: "reach",
  tier: 1,
  stage: 1,
  condition: { tpl: "reach", mode: "place", place: MARKET },
  reward_spec: { coin: 0, xp: 0, potential: 0, rep: 0, item_defs: [] },
  duration_ticks: 1440,
  by: null,
};

test("S45: submit names the turn-in place; whoami next_breakthrough then stage", async () => {
  setQuiet(true);
  const config = await loadConfig({ ...process.env, AIHW_DB_DRIVER: "pglite", AIHW_PGLITE_DIR: "memory", AIHW_PORT: "0", AIHW_CONTENT_DIR: "null" });
  const app = await startApp(config);
  const balance = app.services.balance();
  const call = async (verb: string, args: object, code: string | null = null): Promise<Json> =>
    (await app.dispatch({ verb, body: { args }, bearer: code, door: "api" })).body;
  const fixture = async (fn: (w: Writer) => Promise<void>): Promise<void> => {
    await app.db.tx(async (q) => {
      const row = await mustGetRow(q, "world", worldId(config.realm), { lock: true });
      await fn(new Writer(q, config.realm, row.tick, row.rules_revision, true));
    });
  };
  try {
    await insertRow(app.db, "task", reachMarket);
    const entered = await call("enter", { mode: "create", skin: "xiuxian", door: "api" });
    assert.equal(entered.ok, true);
    const code: string = entered.result.identity_code;
    const actor: string = entered.result.char.id;
    assert.equal(entered.result.char.loc, START);

    const fresh = await call("whoami", { section: "char" }, code);
    assert.equal(fresh.ok, true);
    const grid = gridNumbers(balance, 1, 1);
    assert.deepEqual(fresh.result.next_breakthrough, {
      mode: "stage",
      ready: false,
      xp_need: grid.xp_need,
      inner_req: grid.inner_req,
    });

    const list = await call("task", { op: "list" }, code);
    assert.equal(list.ok, true);
    const offer = list.result.rows.find((t: Json) => t.template_id === TPL && t.state === "open");
    assert.ok(offer, "reach offer listed at the start place");
    assert.equal(offer.offer_place, START);
    const accepted = await call("task", { op: "accept", id: offer.id }, code);
    assert.equal(accepted.ok, true);

    const gone = await call("go", { dir: "south" }, code);
    assert.equal(gone.ok, true, JSON.stringify(gone.error));
    assert.equal(gone.result.to, MARKET);
    const looked = await call("look", {}, code);
    assert.equal(looked.ok, true);

    const there = await call("task", { op: "submit", id: offer.id }, code);
    assert.equal(there.ok, false);
    assert.equal(there.error.code, "CONDITION_UNMET");
    assert.deepEqual(there.error.details, { reason: "location", place_id: START });

    await app.db.query("UPDATE worlds SET tick_started_at = tick_started_at - interval '60 seconds'");
    const back = await call("go", { dir: "north" }, code);
    assert.equal(back.ok, true);
    assert.equal(back.result.to, START);
    const done = await call("task", { op: "submit", id: offer.id }, code);
    assert.equal(done.ok, true, JSON.stringify(done.error));

    const innerDef = await skillDefinition(app.db, "inner");
    assert.ok(innerDef);
    const inner = await learnedSkill(app.db, actor, innerDef.id);
    assert.ok(inner);
    await fixture(async (w) => {
      await w.update("char", actor, { xp: grid.xp_need, ap_spent: 0 });
      await w.update("skill", inner.id, { level: grid.inner_req, cap: Math.max(inner.cap, grid.inner_req) });
    });
    const ready = await call("whoami", { section: "char" }, code);
    assert.equal(ready.ok, true);
    assert.equal(ready.result.next_breakthrough.ready, true);
    assert.equal(ready.result.next_breakthrough.mode, "stage");
    assert.equal(ready.result.next_breakthrough.xp_need, grid.xp_need);
    assert.equal(ready.result.next_breakthrough.inner_req, grid.inner_req);

    const stage = await call("breakthrough", { mode: "stage" }, code);
    assert.equal(stage.ok, true, JSON.stringify(stage.error));
    assert.equal(stage.result.outcome, "success");
    assert.equal(stage.result.stage, 2);
  } finally {
    await app.close();
  }
});
