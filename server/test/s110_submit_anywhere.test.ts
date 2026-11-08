// S110: find / reach submit on the spot; fixed turn-in points and slay targets are explicit.

import assert from "node:assert/strict";
import { test } from "node:test";
import { startApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { insertRow, mustGetRow } from "../src/facts/store.ts";
import type { CharRow, Condition, ItemDefinitionRow, TaskInstanceRow, TaskTemplateRow } from "../src/facts/types.ts";
import { setQuiet } from "../src/log.ts";

type Json = any;

const START = "r1:place:start_xiuxian";
const MARKET = "r1:place:market_neutral";
const PARCEL = "r1:item:s110_parcel";
const TARGET = "r1:char:s110_find_target";
const MARKET_SUBMIT = { place_id: MARKET, name: "归墟坊市" };

const template = (local: string, condition: Condition): TaskTemplateRow => ({
  id: `r1:task:s110_tpl_${local}`,
  created_tick: "0",
  updated_tick: "0",
  record: "template",
  content_key: `content.r1.task.s110_${local}`,
  tpl: condition.tpl,
  tier: 1,
  stage: 1,
  condition,
  reward_spec: { coin: 0, xp: 0, potential: 0, rep: 0, item_defs: [] },
  duration_ticks: 1440,
  by: null,
  note: null,
});

const parcelDef: ItemDefinitionRow = {
  id: PARCEL, created_tick: "0", updated_tick: "0", record: "definition",
  content_key: "content.r1.item.s110_parcel", kind: "ore", tier: 1, grade: 1,
  element: "none", slots: 0, cap: 0, dura_max: 0,
  modifiers: { vigor: 0, power: 0, guard: 0, speed: 0 }, effect: { kind: "none" }, by: null, note: null,
};

test("S110: reach / find submit anywhere; turn-in names and local slay status are visible", async () => {
  setQuiet(true);
  const config = await loadConfig({ ...process.env, AIHW_DB_DRIVER: "pglite", AIHW_PGLITE_DIR: "memory", AIHW_PORT: "0", AIHW_CONTENT_DIR: "null" });
  config.clock.enabled = false;
  const app = await startApp(config);
  try {
    const db = app.db;
    const call = async (verb: string, args: object, code?: string): Promise<Json> => {
      const headers: Record<string, string> = { "Content-Type": "application/json; charset=utf-8" };
      if (code !== undefined) headers.Authorization = `Bearer ${code}`;
      return await (await fetch(`${app.url}/v1/actions/${verb}`, { method: "POST", headers, body: JSON.stringify({ args }) })).json();
    };
    const ok = async (verb: string, args: object, code?: string): Promise<Json> => {
      const r = await call(verb, args, code);
      assert.equal(r.ok, true, `${verb} ${JSON.stringify(args)} → ${JSON.stringify(r.error)}`);
      return r;
    };
    const nextTick = async (): Promise<void> => {
      await db.query("UPDATE worlds SET tick_started_at = tick_started_at - interval '60 seconds'");
    };
    const reach = template("reach", { tpl: "reach", mode: "place", place: MARKET });
    await insertRow(db, "task", reach);
    const entered = await ok("enter", { mode: "create", skin: "xiuxian", door: "api" });
    const code: string = entered.result.identity_code;
    const me: string = entered.result.char.id;
    const offerOf = async (id: string): Promise<Json> => {
      const listed = await ok("task", { op: "list" }, code);
      const row = listed.result.rows.find((t: Json) => t.template_id === id);
      assert.ok(row, `offer for ${id}`);
      return row;
    };

    // Arrival is still required, but no return trip is needed after its evidence is recorded.
    const reachOffer = await offerOf(reach.id);
    assert.equal(reachOffer.submit_at, "anywhere");
    const acceptedReach = await ok("task", { op: "accept", id: reachOffer.id }, code);
    assert.equal(acceptedReach.result.submit_at, "anywhere");
    const premature = await call("task", { op: "submit", id: reachOffer.id }, code);
    assert.equal(premature.error.code, "CONDITION_UNMET");
    assert.deepEqual(premature.error.details, { reason: "task" });
    const moved = await ok("go", { dir: "south" }, code);
    assert.equal(moved.result.to, MARKET);
    const reachList = await ok("task", { op: "list", filter: "accepted" }, code);
    assert.equal(reachList.result.rows[0].submit_at, "anywhere");
    assert.equal(reachList.result.rows[0].progress.count, 1);
    const reached = await ok("task", { op: "submit", id: reachOffer.id }, code);
    assert.equal(reached.result.task.state, "completed");
    assert.equal((await mustGetRow(db, "char", me)).loc, MARKET);

    await nextTick();
    await ok("go", { dir: "north" }, code);
    const base = await mustGetRow(db, "char", me);
    const npc = (id: string, patch: Partial<CharRow> = {}): CharRow => ({
      ...base, id, kind: "npc", door: null, handle: null, email_hash: null, model: null,
      archetype: "monster", body: "beast", tier: 1, stage: 1, state: "active",
      life: "alive", revive_tick: null, loc: MARKET, respawn_place: MARKET,
      patrol_route: [], patrol_index: 0, ...patch,
    });
    await insertRow(db, "char", npc(TARGET, { archetype: "quest_giver" }));
    await insertRow(db, "item", parcelDef);
    const find = template("find", { tpl: "find", target: TARGET });
    const deliver = template("deliver", { tpl: "deliver", item_def: PARCEL, count: 1, to_place: MARKET, to_char: null });
    await insertRow(db, "task", find);
    await insertRow(db, "task", deliver);
    const deliverOffer = await offerOf(deliver.id);
    assert.deepEqual(deliverOffer.submit_at, MARKET_SUBMIT);
    const acceptedDeliver = await ok("task", { op: "accept", id: deliverOffer.id }, code);
    assert.deepEqual(acceptedDeliver.result.submit_at, MARKET_SUBMIT);
    const wrongPlace = await call("task", { op: "submit", id: deliverOffer.id }, code);
    assert.equal(wrongPlace.error.code, "CONDITION_UNMET");
    assert.deepEqual(wrongPlace.error.details, {
      reason: "location", place_id: MARKET, place_name: "归墟坊市", hint: "回 归墟坊市 交",
    });
    const findOffer = await offerOf(find.id);
    assert.equal(findOffer.submit_at, "anywhere");
    const acceptedFind = await ok("task", { op: "accept", id: findOffer.id }, code);
    assert.equal(acceptedFind.result.submit_at, "anywhere");
    await nextTick();
    const unseen = await call("task", { op: "submit", id: findOffer.id }, code);
    assert.equal(unseen.error.code, "CONDITION_UNMET");
    assert.deepEqual(unseen.error.details, { reason: "task" });
    await ok("go", { dir: "south" }, code);
    const found = await ok("task", { op: "submit", id: findOffer.id }, code);
    assert.equal(found.result.task.state, "completed");
    assert.equal(found.result.task.progress.count, 1);
    assert.equal((await mustGetRow(db, "char", me)).loc, MARKET);

    // Local counts exclude other tiers, archetypes and places; targeted status is not local-only.
    const remote = "r1:char:s110_remote";
    await insertRow(db, "char", npc(remote, { loc: START, life: "dead", revive_tick: "40" }));
    await insertRow(db, "char", npc("r1:char:s110_alive"));
    await insertRow(db, "char", npc("r1:char:s110_early", { life: "dead", revive_tick: "80" }));
    await insertRow(db, "char", npc("r1:char:s110_late", { life: "dead", revive_tick: "120" }));
    await insertRow(db, "char", npc("r1:char:s110_wrong_tier", { tier: 2, life: "dead", revive_tick: "20" }));
    await insertRow(db, "char", npc("r1:char:s110_wrong_archetype", { archetype: "tutorial_opponent", life: "dead", revive_tick: "10" }));
    const slayOffer = async (local: string, target: string | null, tier = 1): Promise<string> => {
      const condition: Condition = { tpl: "slay", target, archetype: "monster", tier, count: 1 };
      const tpl = template(local, condition);
      await insertRow(db, "task", tpl);
      const row: TaskInstanceRow = {
        id: `r1:task:s110_${local}`, created_tick: "0", updated_tick: "0", record: "instance",
        template_id: tpl.id, kind: "system", tpl: "slay", issuer: { kind: "system", id: "r1:world:main" },
        offer_place: MARKET, eligible_char: me, issuer_tier: null, taker: null, condition,
        reward: { coin: 0, xp: 0, potential: 0, rep: 0, items: [] }, escrow: { coin: 0, items: [] },
        state: "open", accepted_seq: null, progress: { count: 0, evidence: [] }, expires_tick: "1440", note: null,
      };
      await insertRow(db, "task", row);
      return row.id;
    };
    const targeted = await slayOffer("targeted", remote);
    const generic = await slayOffer("generic", null);
    const empty = await slayOffer("empty", null, 9);
    const slays = await ok("task", { op: "list" }, code);
    const rowOf = (id: string): Json => slays.result.rows.find((t: Json) => t.id === id);
    assert.deepEqual(rowOf(targeted).submit_at, MARKET_SUBMIT);
    assert.deepEqual(rowOf(targeted).target_status, { life: "dead", revive_tick: "40", loc: START });
    assert.deepEqual(rowOf(generic).target_status, { alive_here: 1, next_revive_tick_here: "80" });
    assert.deepEqual(rowOf(empty).target_status, { alive_here: 0, next_revive_tick_here: null });
    await nextTick();
    const acceptedSlay = await ok("task", { op: "accept", id: targeted }, code);
    assert.deepEqual(acceptedSlay.result.submit_at, MARKET_SUBMIT);
    await ok("task", { op: "accept", id: generic }, code);
    await ok("go", { dir: "north" }, code);
    const away = await ok("task", { op: "list", filter: "accepted" }, code);
    assert.deepEqual(away.result.rows.find((t: Json) => t.id === generic).target_status, { alive_here: 0, next_revive_tick_here: "40" });
    assert.deepEqual(away.result.rows.find((t: Json) => t.id === deliverOffer.id).submit_at, MARKET_SUBMIT);
    await nextTick();
    const slayWrongPlace = await call("task", { op: "submit", id: targeted }, code);
    assert.equal(slayWrongPlace.error.code, "CONDITION_UNMET");
    assert.deepEqual(slayWrongPlace.error.details, wrongPlace.error.details);
  } finally {
    await app.close();
  }
});
