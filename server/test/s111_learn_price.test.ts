import assert from "node:assert/strict";
import { test } from "node:test";
import { startApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { worldId } from "../src/facts/ids.ts";
import { mustGetRow } from "../src/facts/store.ts";
import { Writer } from "../src/facts/writer.ts";
import { learnedSkill, skillDefinition } from "../src/growth/facts.ts";
import { setQuiet } from "../src/log.ts";

test("S111: 二阶学费与师父阶数提示", async () => {
  setQuiet(true);
  const config = await loadConfig({ ...process.env, AIHW_DB_DRIVER: "pglite", AIHW_PGLITE_DIR: "memory", AIHW_PORT: "0" });
  config.clock.enabled = false;
  const app = await startApp(config);
  const call = async (verb: string, args: object, code: string | null = null): Promise<any> =>
    (await app.dispatch({ verb, body: { args }, bearer: code, door: "api" })).body;
  try {
    const student = await call("enter", { mode: "create", skin: "xiuxian", door: "api" });
    const teacher = await call("enter", { mode: "create", skin: "xiuxian", door: "api" });
    assert.equal(student.ok, true);
    assert.equal(teacher.ok, true);
    const actor: string = student.result.char.id;
    const master: string = teacher.result.char.id;
    const code: string = student.result.identity_code;
    const definition = await skillDefinition(app.db, "inner");
    assert.ok(definition);
    const teacherSkill = await learnedSkill(app.db, master, definition.id);
    assert.ok(teacherSkill);
    const price = app.services.balance().numbers.tier_prices.find((row) => row.tier === 2)!.learn_coin;
    await app.db.tx(async (q) => {
      const world = await mustGetRow(q, "world", worldId(config.realm), { lock: true });
      const w = new Writer(q, config.realm, world.tick, world.rules_revision, true);
      await w.update("char", actor, { state: "active", tier: 2, coin: price + 100 });
      await w.update("char", master, { state: "active", loc: student.result.char.loc, kind: "npc", door: null, archetype: "master", tier: 2, coin: 0 });
      await w.update("skill", teacherSkill.id, { level: 16, cap: 20 });
    });
    const rejected = await call("learn", { master, skill: "inner", payment: "coin" }, code);
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error.code, "TEACHER_REQUIRED");
    assert.deepEqual(rejected.error.details, { reason: "tier", need_master_tier: 3, master_tier: 2 });
    assert.equal((await mustGetRow(app.db, "char", actor)).coin, price + 100);
    await app.db.tx(async (q) => {
      const world = await mustGetRow(q, "world", worldId(config.realm), { lock: true });
      const w = new Writer(q, config.realm, world.tick, world.rules_revision, true);
      await w.update("char", master, { tier: 3 });
    });
    const learned = await call("learn", { master, skill: "inner", payment: "coin" }, code);
    assert.equal(learned.ok, true);
    assert.equal(learned.result.paid.coin, price);
    assert.equal((await mustGetRow(app.db, "char", actor)).coin, 100);
    assert.equal((await mustGetRow(app.db, "char", master)).coin, price);
  } finally {
    await app.close();
  }
});
