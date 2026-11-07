// One S10 acceptance chain, using only an isolated in-memory fact world.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { startApp } from "../src/app.ts";
import { Clock } from "../src/clock/scheduler.ts";
import { loadConfig } from "../src/config.ts";
import { worldId } from "../src/facts/ids.ts";
import { mustGetRow, selectRows } from "../src/facts/store.ts";
import type { Change, CharRow, ItemDefinitionRow, ItemInstanceRow, TaskInstanceRow, WorldRow } from "../src/facts/types.ts";
import { Writer } from "../src/facts/writer.ts";
import { deriveStats, equipmentCapacity, gridNumbers } from "../src/growth/balance.ts";
import { wantedPhase, yieldPhase } from "../src/growth/clock.ts";
import { combatant, learnedSkill, neutralFacts, skillDefinition } from "../src/growth/facts.ts";
import { resolveBreakthrough, resolveCombat, u32 } from "../src/growth/settlement.ts";
import { setQuiet } from "../src/log.ts";
import { slayEvidence } from "../src/tasks/evidence.ts";
import type { Db, Queryable } from "../src/db/db.ts";

type Json = any;

test("S10: neutral combat → training → teaching → breakthrough paths → death/revival", async () => {
  setQuiet(true);
  const config = await loadConfig({ ...process.env, AIHW_DB_DRIVER: "pglite", AIHW_PGLITE_DIR: "memory", AIHW_PORT: "0" });
  config.clock.enabled = false;
  const app = await startApp(config);
  const balance = app.services.balance();
  assert.equal(balance.numbers.combat.newbie_protect_ticks, 5);
  const world = () => mustGetRow(app.db, "world", worldId(config.realm));
  const char = (id: string) => mustGetRow(app.db, "char", id);
  const call = async (verb: string, args: object, code: string | null = null): Promise<Json> => {
    return (await app.dispatch({ verb, body: { args }, bearer: code, door: "api" })).body;
  };
  const fixture = async (fn: (q: Queryable, w: Writer, world: WorldRow) => Promise<void>): Promise<void> => {
    await app.db.tx(async (q) => {
      const row = await mustGetRow(q, "world", worldId(config.realm), { lock: true });
      await fn(q, new Writer(q, config.realm, row.tick, row.rules_revision, true), row);
    });
  };
  const phase = async (to: string, wanted = false): Promise<void> => {
    await fixture(async (q, _w, row) => {
      const w = new Writer(q, config.realm, to, row.rules_revision, true);
      const ctx = { q, w, world: row, rules: row.rules, balance, from_tick: row.tick, to_tick: to, now: new Date() };
      if (wanted) await wantedPhase.run(ctx);
      else await yieldPhase.run(ctx);
      await w.update("world", row.id, { tick: to });
    });
  };
  const assertError = (body: Json, code: string): void => { assert.equal(body.ok, false); assert.equal(body.error.code, code); };
  try {
    assert.equal((await world()).rules_revision, "balance.v1.7");
    assert.deepEqual([(await world()).rules.active_task_max, (await world()).rules.bounty_open_max, (await world()).rules.socket_max], [3, 3, 3]);
    assert.equal((await world()).rules.ap_costs["task.accept"], 1);
    const a = await call("enter", { mode: "create", skin: "xiuxian", door: "api" });
    const b = await call("enter", { mode: "create", skin: "fantasy", class: "mage", door: "api" });
    const t = await call("enter", { mode: "create", skin: "scifi", door: "api" });
    assert.equal(a.ok, true); assert.equal(b.ok, true); assert.equal(t.ok, true);
    const actor: string = a.result.char.id;
    const target: string = b.result.char.id;
    const teacher: string = t.result.char.id;
    const code: string = a.result.identity_code;
    const loc: string = a.result.char.loc;
    assert.equal(a.result.char.vigor, 2000);
    const innerDef = await skillDefinition(app.db, "inner");
    assert.ok(innerDef);
    const inner = await learnedSkill(app.db, actor, innerDef.id);
    const teacherInner = await learnedSkill(app.db, teacher, innerDef.id);
    assert.ok(inner); assert.ok(teacherInner);
    assert.equal(inner.cap, 8);
    await fixture(async (_q, w) => {
      await w.update("char", actor, { state: "active" });
      await w.update("char", target, { state: "active", loc });
      await w.update("char", teacher, { state: "active", loc });
    });
    const headBefore = (await world()).deed_head;
    const until = (BigInt((await char(target)).created_tick) + 5n).toString();
    for (const combat of ["safe", "pve"] as const) {
      await fixture(async (_q, w) => { await w.update("place", loc, { combat }); });
      const blocked = await call("attack", { target }, code);
      assertError(blocked, "NOT_ALLOWED");
      assert.deepEqual(blocked.error.details, { reason: "newbie", until_tick: until });
    }
    assert.equal((await char(actor)).ap_spent, 0);
    assert.equal((await world()).deed_head, headBefore);
    await fixture(async (_q, w, row) => { await w.update("world", row.id, { tick: until }); });
    for (const combat of ["safe", "pve"] as const) {
      await fixture(async (_q, w, row) => {
        await w.update("place", loc, { combat });
        await w.update("char", actor, { vigor: 2000, ap_spent: 0, ap_tick: row.tick });
        await w.update("char", target, { vigor: 2000 });
      });
      const pk = await call("attack", { target }, code);
      assert.equal(pk.ok, true);
      assert.equal(pk.result.roll.inputs.mode, "pk");
      assert.equal((await char(actor)).life, "alive");
      assert.equal((await char(target)).life, "alive");
    }
    await fixture(async (_q, w, row) => {
      await w.update("place", loc, { combat: "duel" });
      await w.update("char", actor, { vigor: 2000, ap_spent: 0, ap_tick: row.tick });
      await w.update("char", target, { vigor: 2000 });
    });
    const me = await char(actor);
    const other = await char(target);
    assert.notEqual(me.skin, other.skin);
    const facts = await neutralFacts(app.db, me);
    assert.deepEqual(deriveStats(balance, me, facts), deriveStats(balance, other, await neutralFacts(app.db, other)));
    const actorInput = combatant(balance, me, facts);
    const targetInput = combatant(balance, other, await neutralFacts(app.db, other));
    const seed = `${(await world()).rules_revision}:${config.realm}:${(await world()).tick}:${BigInt((await world()).deed_head) + 1n}:${actor}:${target}`;
    const expected = resolveCombat(balance, seed, actorInput, targetInput, "duel");
    assert.deepEqual(expected, resolveCombat(balance, seed, actorInput, targetInput, "duel"));
    const changedPresentation = { ...me, skin: "scifi" as const, class: null, model: "different", door: "web" as const };
    assert.deepEqual(expected, resolveCombat(balance, seed, combatant(balance, changedPresentation, facts), targetInput, "duel"));
    const combat = await call("attack", { target }, code);
    assert.equal(combat.ok, true);
    assert.deepEqual(combat.result.roll, expected.roll);
    assert.equal(combat.result.outcome, expected.outcome);
    assert.equal((await char(actor)).vigor, expected.actor_vigor);
    assert.equal((await char(target)).life, "alive");
    assert.ok((await char(target)).vigor >= 1);

    await fixture(async (_q, w, row) => {
      await w.update("char", actor, { ap_spent: 0, ap_tick: row.tick, potential: 0, xp: 0 });
      await w.update("skill", inner.id, { level: 0, cap: 1 });
    });
    const trainStart = BigInt((await world()).tick);
    const trainTick = (offset: bigint): string => (trainStart + offset).toString();
    assert.equal((await call("train", { mode: "start", skill: "inner" }, code)).ok, true);
    assert.equal((await char(actor)).potential, 0); // start requires no prepaid potential
    assert.equal((await char(actor)).xp, 0);
    await fixture(async (_q, w) => { await w.update("char", actor, { potential: 29 }); });
    await phase(trainTick(9n));
    assert.equal((await char(actor)).xp, 0);
    await phase(trainTick(10n));
    assert.equal((await char(actor)).xp, 2);
    assert.equal((await char(actor)).potential, 0); // 29 + 1 yield - 30 level cost
    assert.equal((await learnedSkill(app.db, actor, innerDef.id))?.level, 1);
    await phase(trainTick(10n));
    assert.equal((await char(actor)).xp, 2); // cannot collect twice
    await fixture(async (_q, w) => { await w.update("char", target, { vigor: 2000 }); });
    const idle = await char(target);
    await phase(trainTick(11n));
    assert.deepEqual(await char(target), idle);
    assert.ok(!(await selectRows(app.db, "char", "split_part(id, ':', 1) = $1 AND growth_due_tick IS NOT NULL AND growth_due_tick <= $2::bigint", [config.realm, trainTick(12n)])).some((c) => c.id === target));
    await phase(trainTick(20n));
    assert.equal((await learnedSkill(app.db, actor, innerDef.id))?.level, 1);
    assert.equal((await char(actor)).potential, 1); // cap never spends again
    assertError(await call("train", { mode: "start", skill: "inner" }, code), "SKILL_CAP");
    await phase(trainTick(2020n)); // synthetic long gap: cap at 144 periods
    assert.equal((await char(actor)).xp, 292);
    assert.equal((await char(actor)).last_yield_tick, trainTick(2020n));
    assert.equal((await call("train", { mode: "stop" }, code)).ok, true);
    assertError(await call("train", { mode: "stop" }, code), "CONDITION_UNMET");
    const beforeCatchup = await char(actor);
    const catchupWorld = await world();
    const missedTicks = 288 * balance.numbers.clock.train_period_ticks;
    const caughtAt = new Date(Date.parse(catchupWorld.tick_started_at) + missedTicks * (catchupWorld.rules.tick_seconds as number) * 1000);
    await fixture(async (_q, w, row) => {
      await w.update("char", actor, { train_skill: "inner", last_yield_tick: row.tick });
    });
    // Fail after the first batch really commits, then discard the Clock instance.
    let committedTicks = 0;
    const interruptedDb: Db = {
      ...app.db,
      async tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
        const result = await app.db.tx(fn);
        committedTicks = Number(BigInt((await world()).tick) - BigInt(catchupWorld.tick));
        throw new Error(`S19 interrupted after commit: ${String(result)}`);
      },
    };
    const interrupted = new Clock(interruptedDb, { realm: config.realm, maxCatchupPerTx: 64, balance: () => balance, now: () => caughtAt });
    await assert.rejects(interrupted.advanceDue(), /S19 interrupted after commit/);
    assert.equal(committedTicks, 64);
    assert.equal((await char(actor)).last_yield_tick, catchupWorld.tick);
    const clock = new Clock(app.db, { realm: config.realm, maxCatchupPerTx: 64, balance: () => balance, now: () => caughtAt });
    assert.equal(await clock.advanceDue(), missedTicks - committedTicks);
    assert.equal((await char(actor)).xp - beforeCatchup.xp, 144 * balance.numbers.tiers[0]!.train_xp);
    assert.equal((await char(actor)).last_yield_tick, (await world()).tick);
    assert.equal(await clock.advanceDue(), 0);
    await fixture(async (_q, w) => { await w.update("char", actor, { train_skill: null }); });

    assertError(await call("learn", { master: teacher, skill: "inner", payment: "coin" }, code), "TEACHER_REQUIRED");
    await fixture(async (_q, w) => {
      await w.update("char", teacher, { kind: "npc", door: null, archetype: "master", tier: 2, coin: 0 });
      await w.update("char", actor, { coin: 80 });
      await w.update("skill", teacherInner.id, { level: 12, cap: 16 });
    });
    const learned = await call("learn", { master: teacher, skill: "inner", payment: "coin" }, code);
    assert.equal(learned.ok, true);
    assert.deepEqual([learned.result.skill.level, learned.result.skill.cap, learned.result.paid.coin], [3, 6, 80]);
    assert.equal((await char(actor)).coin, 0);
    assert.equal((await char(teacher)).coin, 80);
    assert.ok(learned.result.changes.every((c: Change) => c.table !== "char" || c.id === actor));
    const sharedLearn = (await selectRows(app.db, "deed", "verb = 'learn' AND actor = $1", [actor]))[0]!;
    assert.ok(sharedLearn.result.changes.every((c) => c.table !== "char" || !Object.hasOwn(c.after, "coin")));
    const balances = await selectRows(app.db, "event", "type = 'fact_changed' AND deed_id = $1", [sharedLearn.id]);
    assert.equal(balances.length, 2);
    for (const event of balances) {
      assert.equal(event.scope, "self");
      assert.equal(event.recipients.length, 1);
      if (event.type === "fact_changed") assert.ok(event.data.changes.every((c) => c.id === event.recipients[0]));
    }
    await fixture(async (_q, w, row) => {
      await w.insert("bond", { id: await w.newId("bond"), created_tick: row.tick, updated_tick: row.tick, kind: "mentor", a: teacher, b: actor, state: "active", weight: 0, rank: null, since_tick: row.tick, ended_tick: null });
    });
    const bonded = await call("learn", { master: teacher, skill: "inner", payment: "bond" }, code);
    assert.equal(bonded.ok, true);
    assert.deepEqual([bonded.result.skill.level, bonded.result.skill.cap, bonded.result.paid.coin], [5, 11, 0]);

    const grid31 = gridNumbers(balance, 3, 1);
    await fixture(async (_q, w, row) => {
      await w.update("char", actor, { tier: 3, stage: 1, xp: 0, ap_spent: 0, ap_tick: row.tick });
    });
    const shortXp = await call("breakthrough", { mode: "stage" }, code);
    assertError(shortXp, "CONDITION_UNMET");
    assert.deepEqual(shortXp.error.details, { reason: "xp", required: grid31.xp_need, have: 0 });
    await fixture(async (_q, w, row) => {
      await w.update("char", actor, { xp: grid31.xp_need, ap_spent: 0, ap_tick: row.tick });
    });
    const blocked = await call("breakthrough", { mode: "stage" }, code);
    assertError(blocked, "CONDITION_UNMET");
    assert.deepEqual(blocked.error.details, { reason: "training", skill: "inner", required: grid31.inner_req, level: 5, cap: 11 });
    await fixture(async (_q, w, row) => {
      await w.update("char", actor, { tier: 1, stage: 1, xp: 710, ap_spent: 0, ap_tick: row.tick });
    });
    const stage = await call("breakthrough", { mode: "stage" }, code);
    assert.equal(stage.ok, true);
    assert.equal(stage.result.roll, null);
    assert.equal(stage.result.stage, 2);
    assert.equal((await char(actor)).xp, 0);

    const bt = async (mode: "tier" | "cycle", success: boolean, item: string | null = null): Promise<Json> => {
      const tier = mode === "cycle" ? 9 : 1;
      const row = await world();
      const bonus = item === null ? 0 : 500;
      let tick = BigInt(row.tick) + 1n;
      let fixedSeed = "";
      for (let tries = 0; tries < 10000; tries += 1, tick += 1n) {
        fixedSeed = `${row.rules_revision}:${config.realm}:${tick}:${BigInt(row.deed_head) + 1n}:${actor}:-`;
        if (resolveBreakthrough(balance, mode, tier, bonus, fixedSeed).success === success) break;
      }
      assert.equal(resolveBreakthrough(balance, mode, tier, bonus, fixedSeed).success, success);
      await fixture(async (_q, w, current) => {
        await w.update("world", current.id, { tick: tick.toString() });
        await w.update("char", actor, { tier, stage: 4, xp: gridNumbers(balance, tier, 4).xp_need, potential: 100, vigor: 1000, ap_spent: 0, ap_tick: tick.toString(), last_seen_tick: tick.toString() });
        await w.update("skill", inner.id, { level: tier === 9 ? 36 : 4, cap: tier === 9 ? 44 : 12 });
      });
      const body = await call("breakthrough", { mode, item }, code);
      assert.equal(body.ok, true);
      assert.equal(body.result.outcome, success ? "success" : "failure");
      assert.equal(body.result.roll.seed, fixedSeed);
      assert.equal(body.result.roll.value, u32(fixedSeed, "bt") % 10000);
      return body;
    };
    const tierSuccess = await bt("tier", true);
    assert.equal(tierSuccess.result.tier, 2);
    assert.equal(tierSuccess.result.stage, 1);
    let potion = "";
    await fixture(async (_q, w, row) => {
      const def: ItemDefinitionRow = { id: await w.newId("item"), created_tick: row.tick, updated_tick: row.tick, record: "definition", content_key: "content.r1.item.s10_potion", kind: "potion", tier: 1, grade: 1, element: "none", slots: 0, cap: 0, dura_max: 0, modifiers: { vigor: 0, power: 0, guard: 0, speed: 0 }, effect: { kind: "breakthrough", bonus: 500 }, by: null, note: null };
      await w.insert("item", def);
      potion = await w.newId("item");
      await w.insert("item", { id: potion, created_tick: row.tick, updated_tick: row.tick, record: "instance", def_id: def.id, holder: { kind: "char", id: actor }, state: "available", equipped: false, dura: 0, sockets: [], note: null });
    });
    await bt("tier", false, potion);
    assert.equal((await char(actor)).xp, 880);
    assert.equal((await char(actor)).life, "alive");
    assert.equal((await char(actor)).vigor, 1000);
    const consumed = await mustGetRow(app.db, "item", potion);
    assert.equal(consumed.record === "instance" && consumed.state, "consumed");

    const gearIds: string[] = [];
    await fixture(async (_q, w, row) => {
      for (let i = 0; i < 4; i += 1) {
        const def: ItemDefinitionRow = { id: await w.newId("item"), created_tick: row.tick, updated_tick: row.tick, record: "definition", content_key: `content.r1.item.s10_gear${i}`, kind: i === 0 ? "blade" : i === 1 ? "robe" : "ring", tier: 2, grade: 3, element: "none", slots: 3, cap: 66, dura_max: 150, modifiers: { vigor: 0, power: i === 0 ? 108 : 0, guard: i === 1 ? 108 : 0, speed: i >= 2 ? 108 : 0 }, effect: { kind: "none" }, by: null, note: null };
        await w.insert("item", def);
        const id = await w.newId("item"); gearIds.push(id);
        await w.insert("item", { id, created_tick: row.tick, updated_tick: row.tick, record: "instance", def_id: def.id, holder: { kind: "char", id: actor }, state: "available", equipped: true, dura: 150, sockets: [null, null, null], note: null });
      }
    });
    await bt("cycle", true);
    const cycled = await char(actor);
    assert.deepEqual([cycled.tier, cycled.stage, cycled.xp, cycled.potential, cycled.cycles, cycled.legacy], [1, 1, 0, 0, 1, 100]);
    assert.equal((await learnedSkill(app.db, actor, innerDef.id))?.level, 12);
    const postFacts = await neutralFacts(app.db, cycled);
    assert.equal(postFacts.equipment.reduce((sum, e) => sum + equipmentCapacity(e), 0), 198);
    assert.equal(cycled.vigor, deriveStats(balance, cycled, postFacts).vigor_max);
    const largest = [...gearIds].sort().at(-1);
    const un = await mustGetRow(app.db, "item", largest as string);
    assert.equal(un.record === "instance" && un.equipped, false);
    assert.equal((await selectRows(app.db, "item", "record = 'instance' AND holder ->> 'id' = $1 AND state = 'available'", [actor])).length, 4);

    // Force only the neutral facts of a PK kill/drop; seed still comes from world.
    await fixture(async (_q, w, row) => {
      let tick = BigInt(row.tick) + 1n;
      while (u32(`${row.rules_revision}:${config.realm}:${tick}:${BigInt(row.deed_head) + 1n}:${actor}:${target}`, "dropchance") % 10000 >= 5000) tick += 1n;
      await w.update("world", row.id, { tick: tick.toString() });
      await w.update("place", loc, { combat: "pk" });
      await w.update("char", actor, { tier: 9, stage: 4, vigor: 253000, ap_spent: 0, ap_tick: tick.toString(), last_seen_tick: tick.toString() });
      await w.update("char", target, { vigor: 1, xp: 710, ap_tick: tick.toString(), state: "active" });
      for (let i = 0; i < 2; i += 1) {
        const def: ItemDefinitionRow = { id: await w.newId("item"), created_tick: row.tick, updated_tick: row.tick, record: "definition", content_key: `content.r1.item.s10_ore${i}`, kind: "ore", tier: 1, grade: 1, element: "none", slots: 0, cap: 0, dura_max: 0, modifiers: { vigor: 0, power: 0, guard: 0, speed: 0 }, effect: { kind: "none" }, by: null, note: null };
        await w.insert("item", def);
        await w.insert("item", { id: await w.newId("item"), created_tick: row.tick, updated_tick: row.tick, record: "instance", def_id: def.id, holder: { kind: "char", id: target }, state: "available", equipped: false, dura: 0, sockets: [], note: null });
      }
    });
    const pk = await call("attack", { target }, code);
    assert.equal(pk.ok, true);
    const dead = await char(target);
    assert.deepEqual([dead.life, dead.tier, dead.xp], ["dead", 1, 639]);
    const slay = { accepted_seq: "0", condition: { tpl: "slay", target, archetype: null, tier: 1, count: 1 } } as TaskInstanceRow;
    assert.equal((await slayEvidence(app.db, await char(actor), slay)).length, 1);
    assert.deepEqual(await slayEvidence(app.db, await char(actor), { ...slay, condition: { tpl: "slay", target, archetype: null, tier: 2, count: 1 } }), []);
    assert.equal((await selectRows(app.db, "item", "record = 'instance' AND holder ->> 'kind' = 'place' AND holder ->> 'id' = $1", [loc])).length, 1);
    assert.equal((await selectRows(app.db, "item", "record = 'instance' AND holder ->> 'kind' = 'char' AND holder ->> 'id' = $1", [target])).length, 1);
    await phase(dead.revive_tick as string);
    const revived = await char(target);
    assert.deepEqual([revived.life, revived.loc, revived.vigor], ["alive", revived.respawn_place, 1000]);
    const wanted = (await selectRows(app.db, "wanted", "char_id = $1 AND state = 'active'", [actor]))[0];
    assert.ok(wanted);
    await phase(wanted.until_tick, true);
    assert.equal((await mustGetRow(app.db, "wanted", wanted.id)).state, "expired");

    // No presentation field access in any production formula/handler owned here.
    const audited = ["growth/balance.ts", "growth/facts.ts", "growth/settlement.ts", "growth/clock.ts", "growth/combat_effects.ts", "verbs/attack.ts", "verbs/train.ts", "verbs/learn.ts", "verbs/breakthrough.ts"];
    for (const file of audited) {
      const source = await readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
      assert.doesNotMatch(source, /\.(?:skin|class|model|door)\b|\[\s*["'](?:skin|class|model|door)["']\s*\]/);
    }
    const placeEvents = await selectRows(app.db, "event", "scope = 'place'");
    for (const event of placeEvents) {
      if (event.type !== "fact_changed") continue;
      assert.ok(event.data.changes.every((c: Change) => c.table !== "char"));
    }
    assert.ok((await neutralFacts(app.db, await char(actor))).equipment.every((e) => (e.instance as ItemInstanceRow).dura <= e.definition.dura_max));
    assert.equal((await char(actor) as CharRow).state, "active");
    await fixture(async (_q, w) => { await w.update("char", actor, { loc: "r1:place:market_neutral" }); });
    const beforeLook = await char(actor);
    assert.equal((await call("look", {}, code)).ok, true);
    const afterLook = await char(actor);
    assert.equal(afterLook.xp, beforeLook.xp, "look does not award arrival growth");
    assert.equal((await call("look", {}, code)).ok, true);
    assert.equal((await char(actor)).xp, afterLook.xp);
  } finally {
    await app.close();
  }
});
