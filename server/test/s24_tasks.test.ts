// S24 acceptance, one chain (设计者 11-06: 不要有过多的复杂测试、不要重复全量测试):
// enter → task list → accept deliver → take → go → submit (paid once) → the same
// char repeats a system task the same day (reward decays to zero, S5) → bounty
// post → another char takes and completes it → post → cancel (full refund),
// total coin checked at every step → protocol refusals of go / take / give.
// The content an importer (S16) would bring is inserted as fixtures first.

import assert from "node:assert/strict";
import { test } from "node:test";
import { startApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { insertRow, mustGetRow } from "../src/facts/store.ts";
import { Writer } from "../src/facts/writer.ts";
import { taskBuriedPhase } from "../src/tasks/clock.ts";
import type { Holder, ItemDefinitionRow, ItemInstanceRow, TaskTemplateRow } from "../src/facts/types.ts";
import { setQuiet } from "../src/log.ts";

// Response bodies are checked field by field below.
type Json = any;

const START = "r1:place:start_xiuxian";
const MARKET = "r1:place:market_neutral";
const PARCEL = "r1:item:s24_parcel";
const T_MARKET = "r1:task:s24_to_market";
const T_HOME = "r1:task:s24_to_home";

const parcelDef: ItemDefinitionRow = {
  id: PARCEL,
  created_tick: "0",
  updated_tick: "0",
  record: "definition",
  content_key: "content.r1.item.s24_parcel",
  kind: "ore",
  tier: 1,
  grade: 1,
  element: "none",
  slots: 0,
  cap: 0,
  dura_max: 0,
  modifiers: { vigor: 0, power: 0, guard: 0, speed: 0 },
  effect: { kind: "none" },
  by: null,
  note: null,
};

const parcel = (local: string, holder: Holder): ItemInstanceRow => ({
  id: `r1:item:${local}`,
  created_tick: "0",
  updated_tick: "0",
  record: "instance",
  def_id: PARCEL,
  holder,
  state: "available",
  equipped: false,
  dura: 0,
  sockets: [],
  note: null,
});

// Tier-1 deliver template; reward_spec equals the S5 tier-1 deliver row (100 / 300 / 30).
const deliverTo = (id: string, toPlace: string): TaskTemplateRow => ({
  id,
  created_tick: "0",
  updated_tick: "0",
  record: "template",
  content_key: `content.r1.task.${id.split(":")[2]}`,
  tpl: "deliver",
  tier: 1,
  stage: 1,
  condition: { tpl: "deliver", item_def: PARCEL, count: 1, to_place: toPlace, to_char: null },
  reward_spec: { coin: 100, xp: 300, potential: 30, rep: 0, item_defs: [] },
  duration_ticks: 1440,
  by: null,
  note: null,
});

test("S24 chain: deliver task → daily decay → bounty escrow / payout / refund → refusals", async () => {
  setQuiet(true);
  // Clean world: no content/world import, only the seed plus this test's fixtures.
  const config = await loadConfig({ ...process.env, AIHW_DB_DRIVER: "pglite", AIHW_PGLITE_DIR: "memory", AIHW_PORT: "0", AIHW_CONTENT_DIR: "null" });
  const app = await startApp(config);
  try {
    const db = app.db;
    const call = async (verb: string, args: object, code?: string): Promise<{ status: number; body: Json }> => {
      const headers: Record<string, string> = { "Content-Type": "application/json; charset=utf-8" };
      if (code !== undefined) headers.Authorization = `Bearer ${code}`;
      const res = await fetch(`${app.url}/v1/actions/${verb}`, { method: "POST", headers, body: JSON.stringify({ args }) });
      return { status: res.status, body: (await res.json()) as Json };
    };
    const ok = async (verb: string, args: object, code?: string): Promise<Json> => {
      const r = await call(verb, args, code);
      assert.equal(r.body.ok, true, `${verb} ${JSON.stringify(args)} → ${JSON.stringify(r.body.error)}`);
      return r.body;
    };
    // Next request runs one more world tick (fresh action budget for everyone).
    const nextTick = async (): Promise<void> => {
      await db.query("UPDATE worlds SET tick_started_at = tick_started_at - interval '60 seconds'");
    };
    const coinOf = async (id: string): Promise<number> =>
      Number((await db.query<{ coin: unknown }>("SELECT coin FROM chars WHERE id = $1", [id])).rows[0]?.coin);
    // Every coin in the world: balances plus bounty escrow not yet settled.
    const totalCoin = async (): Promise<number> => {
      const c = await db.query<{ n: unknown }>("SELECT COALESCE(SUM(coin), 0) AS n FROM chars");
      const e = await db.query<{ n: unknown }>(
        "SELECT COALESCE(SUM((escrow ->> 'coin')::bigint), 0) AS n FROM tasks WHERE record = 'instance' AND kind = 'bounty' AND state IN ('open', 'accepted')",
      );
      return Number(c.rows[0]?.n) + Number(e.rows[0]?.n);
    };
    const offerOf = async (code: string, template: string): Promise<Json> => {
      const list = await ok("task", { op: "list" }, code);
      const row = list.result.rows.find((t: Json) => t.template_id === template && t.state === "open");
      assert.ok(row, `offer of ${template} listed here`);
      return row;
    };

    await insertRow(db, "item", parcelDef);
    await insertRow(db, "item", parcel("s24_parcel_ground", { kind: "place", id: START }));
    await insertRow(db, "task", deliverTo(T_MARKET, MARKET));
    await insertRow(db, "task", deliverTo(T_HOME, START));

    // ---- enter → list → accept deliver → take → go → submit, paid once ----
    const enterA = await ok("enter", { mode: "create", skin: "xiuxian", door: "api" });
    const codeA: string = enterA.result.identity_code;
    const a: string = enterA.result.char.id;
    const supplied = enterA.result.changes.filter((c: Json) => c.table === "task").map((c: Json) => c.after.template_id);
    assert.deepEqual(supplied.sort(), [T_HOME, T_MARKET]);

    const offer = await offerOf(codeA, T_MARKET);
    assert.equal(offer.eligible_char, a);
    assert.equal(offer.offer_place, START);
    const accepted = await ok("task", { op: "accept", id: offer.id }, codeA);
    assert.equal(accepted.result.task.state, "accepted");
    assert.equal(accepted.result.task.taker, a);
    const took = await ok("take", { item: "r1:item:s24_parcel_ground" }, codeA);
    assert.deepEqual(took.result.item.holder, { kind: "char", id: a });
    const went = await ok("go", { dir: "south" }, codeA);
    assert.deepEqual([went.result.from, went.result.to], [START, MARKET]);
    assert.equal(went.ap.remaining, 0);

    // go to a missing exit (with budget left): NOT_FOUND, no point spent.
    await nextTick();
    const noExit = await call("go", { dir: "up" }, codeA);
    assert.equal(noExit.body.error.code, "NOT_FOUND");
    assert.equal(noExit.body.ap.remaining, noExit.body.ap.per_tick);

    const coin0 = await coinOf(a);
    const done = await ok("task", { op: "submit", id: offer.id }, codeA);
    assert.equal(done.result.task.state, "completed");
    assert.deepEqual(done.result.task.escrow, { coin: 0, items: [] });
    assert.deepEqual(done.result.reward, { coin: 100, xp: 300, potential: 30, rep: 0, items: [] });
    assert.equal(done.result.hint, undefined);
    assert.equal(await coinOf(a), coin0 + 100);
    const parcelAt = await db.query<{ k: string; at: string }>(
      "SELECT holder ->> 'kind' AS k, holder ->> 'id' AS at FROM items WHERE id = 'r1:item:s24_parcel_ground'",
    );
    assert.deepEqual([parcelAt.rows[0]?.k, parcelAt.rows[0]?.at], ["place", MARKET]);
    const again = await call("task", { op: "submit", id: offer.id }, codeA);
    assert.equal(again.body.error.code, "TASK_STATE");
    assert.deepEqual(again.body.error.details, { state: "completed" });
    assert.equal(await coinOf(a), coin0 + 100);

    // ---- same char, same day: system reward decays by 20% a task down to zero (S5) ----
    for (let i = 1; i <= 5; i += 1) await insertRow(db, "item", parcel(`s24_parcel_a${i}`, { kind: "char", id: a }));
    const coins: number[] = [];
    const xps: number[] = [];
    for (let k = 1; k <= 5; k += 1) {
      await nextTick();
      const home = await offerOf(codeA, T_HOME);
      await ok("task", { op: "accept", id: home.id }, codeA);
      if (k === 1) await ok("go", { dir: "north" }, codeA);
      const r = await ok("task", { op: "submit", id: home.id }, codeA);
      assert.equal(r.result.task.state, "completed");
      if (k < 4) assert.equal(r.result.hint, undefined);
      else {
        assert.match(r.result.hint.zh, k === 4 ? /下一件起/ : /收益已满/);
        assert.match(r.result.hint.en, k === 4 ? /next task/ : /exhausted/);
        for (const text of [r.result.hint.zh, r.result.hint.en]) assert.ok(text.length > 0);
      }
      coins.push(r.result.reward.coin);
      xps.push(r.result.reward.xp);
    }
    const fullList = await ok("task", { op: "list" }, codeA);
    assert.match(fullList.result.hint.zh, /收益已满/);
    assert.match(fullList.result.hint.en, /exhausted/);
    const acceptedList = await ok("task", { op: "list", filter: "accepted" }, codeA);
    assert.deepEqual(acceptedList.result.hint, fullList.result.hint);
    assert.deepEqual(coins, [80, 60, 40, 20, 0]);
    assert.deepEqual(xps, [240, 180, 120, 60, 0]);
    const today = await db.query<{ n: unknown }>("SELECT system_tasks_today AS n FROM chars WHERE id = $1", [a]);
    assert.equal(Number(today.rows[0]?.n), 6);
    assert.equal(await coinOf(a), coin0 + 300);
    await db.query("UPDATE chars SET day_index = day_index + 1 WHERE id = $1", [a]);
    const resetList = await ok("task", { op: "list" }, codeA);
    assert.equal(resetList.result.hint, undefined);
    await db.query("UPDATE chars SET day_index = day_index - 1 WHERE id = $1", [a]);

    // ---- bounty: post (escrow) → another char takes and completes it → paid ----
    const enterB = await ok("enter", { mode: "create", skin: "xiuxian", door: "api" });
    const codeB: string = enterB.result.identity_code;
    const b: string = enterB.result.char.id;
    const total = await totalCoin();

    await nextTick();
    const now = BigInt(String((await db.query<{ tick: unknown }>("SELECT tick FROM worlds")).rows[0]?.tick));
    const posted = await ok(
      "bounty",
      { op: "post", condition: { tpl: "reach", mode: "place", place: MARKET }, reward: { coin: 50, items: [] }, expires_tick: String(now + 120n) },
      codeA,
    );
    const bounty = posted.result.task;
    assert.equal(bounty.kind, "bounty");
    assert.deepEqual(bounty.escrow, { coin: 50, items: [] });
    assert.deepEqual(bounty.issuer, { kind: "char", id: a });
    assert.equal(await coinOf(a), coin0 + 250);
    assert.equal(await totalCoin(), total);

    const board = await ok("task", { op: "list" }, codeB);
    assert.ok(board.result.rows.some((t: Json) => t.id === bounty.id), "bounty on the board at its offer place");
    await ok("task", { op: "accept", id: bounty.id }, codeB);
    await ok("go", { dir: "south" }, codeB);
    await ok("go", { dir: "north" }, codeB);
    assert.equal(await totalCoin(), total);
    await nextTick();
    await db.query("UPDATE chars SET day_index = (SELECT day_index FROM worlds LIMIT 1), system_tasks_today = 5 WHERE id = $1", [b]);
    const paid = await ok("task", { op: "submit", id: bounty.id }, codeB);
    assert.equal(paid.result.hint, undefined);
    assert.equal(paid.result.task.state, "completed");
    assert.equal(paid.result.reward.coin, 50);
    assert.equal(paid.result.reward.rep, 1);
    assert.equal(await coinOf(b), 50);
    assert.equal(await totalCoin(), total);

    // ---- post → cancel: escrow back in full ----
    await nextTick();
    const before = await coinOf(a);
    const second = await ok(
      "bounty",
      { op: "post", condition: { tpl: "reach", mode: "place", place: MARKET }, reward: { coin: 30, items: [] }, expires_tick: String(now + 200n) },
      codeA,
    );
    assert.equal(await coinOf(a), before - 30);
    assert.equal(await totalCoin(), total);
    const cancelled = await ok("bounty", { op: "cancel", id: second.result.task.id }, codeA);
    assert.equal(cancelled.result.task.state, "cancelled");
    assert.deepEqual(cancelled.result.task.escrow, { coin: 0, items: [] });
    assert.equal(await coinOf(a), before);
    assert.equal(await totalCoin(), total);

    // ---- refusals: take an item that is not here, give to someone not here ----
    await nextTick();
    await ok("go", { dir: "south" }, codeB);
    const ground = await db.query<{ id: string }>(
      "SELECT id FROM items WHERE record = 'instance' AND holder ->> 'kind' = 'place' AND holder ->> 'id' = $1 ORDER BY id LIMIT 1",
      [START],
    );
    const far = ground.rows[0]?.id;
    assert.ok(far !== undefined, "a parcel lies at the start place");
    const notHere = await call("take", { item: far }, codeB);
    assert.equal(notHere.body.error.code, "NOT_HERE");
    assert.equal(notHere.body.ap.remaining, 2);
    const gift = await call("give", { target: b, asset: { kind: "coin", amount: 10 } }, codeA);
    assert.equal(gift.body.error.code, "NOT_HERE");
    assert.equal(gift.body.ap.remaining, gift.body.ap.per_tick);
    assert.equal(await totalCoin(), total);

    await nextTick();
    await ok("go", { dir: "north" }, codeB);
    const given = await ok("give", { target: b, asset: { kind: "coin", amount: 10 } }, codeA);
    assert.ok(given.result.changes.every((c: Json) => c.table !== "char" || c.id === a));
    const giveDeed = await mustGetRow(db, "deed", given.deed_ids[0]);
    assert.ok(giveDeed.result.changes.every((c) => c.table !== "char" || !Object.hasOwn(c.after, "coin")));
    for (const credential of [codeA, codeB]) {
      const seen = await ok("look", { section: "deeds", page: { after: `r1:deed:d${BigInt(giveDeed.seq) - 1n}`, through: giveDeed.seq } }, credential);
      assert.ok(seen.result.rows.find((d: Json) => d.id === giveDeed.id));
      assert.ok(seen.result.rows.find((d: Json) => d.id === giveDeed.id).result.changes.every((c: Json) => c.table !== "char" || !Object.hasOwn(c.after, "coin")));
    }
    const giftEvents = await db.query<Json>("SELECT scope, recipients, data FROM events WHERE deed_id = $1 AND type = 'fact_changed'", [giveDeed.id]);
    assert.equal(giftEvents.rows.length, 2);
    for (const e of giftEvents.rows) {
      assert.equal(e.scope, "self");
      assert.equal(e.recipients.length, 1);
      assert.ok(e.data.changes.every((c: Json) => c.id === e.recipients[0]));
    }
    assert.equal(await totalCoin(), total);

    await nextTick();
    const post = async (code: string, coin: number): Promise<Json> => (await ok("bounty", {
      op: "post", condition: { tpl: "reach", mode: "place", place: MARKET },
      reward: { coin, items: [] }, expires_tick: String(now + 500n),
    }, code)).result.task;
    const issuerBefore = await coinOf(a);
    const open = await post(codeA, 10);
    const held = await post(codeA, 20);
    await ok("task", { op: "accept", id: held.id }, codeB);
    const independent = await post(codeB, 5);
    await nextTick();
    await ok("task", { op: "accept", id: independent.id }, codeA);
    await db.query("UPDATE chars SET state = 'buried' WHERE id = $1", [a]);
    const release = async (): Promise<void> => {
      await db.tx(async (q) => {
        const world = await mustGetRow(q, "world", "r1:world:main", { lock: true });
        const w = new Writer(q, "r1", world.tick, world.rules_revision, true);
        await taskBuriedPhase.run({ q, w, world, rules: world.rules, balance: app.services.balance(), from_tick: world.tick, to_tick: world.tick, now: new Date() });
      });
    };
    await release();
    for (const id of [open.id, held.id]) {
      const t = await mustGetRow(db, "task", id);
      assert.equal(t.record === "instance" && t.state, "cancelled");
      assert.deepEqual(t.record === "instance" && t.escrow, { coin: 0, items: [] });
    }
    const reopened = await mustGetRow(db, "task", independent.id);
    assert.equal(reopened.record === "instance" && reopened.state, "open");
    assert.equal(reopened.record === "instance" && reopened.taker, null);
    assert.equal(await coinOf(a), issuerBefore);
    assert.equal(await totalCoin(), total);
    await release();
    assert.equal(await coinOf(a), issuerBefore);
    assert.equal(await totalCoin(), total);
  } finally {
    await app.close();
  }
});
