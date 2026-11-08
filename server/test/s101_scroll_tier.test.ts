import assert from "node:assert/strict";
import { test } from "node:test";
import { startApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { insertRow, mustGetRow, updateRow } from "../src/facts/store.ts";
import type { ItemDefinitionRow, ItemInstanceRow } from "../src/facts/types.ts";
import { learnedSkill, skillDefinition } from "../src/growth/facts.ts";
import { setQuiet } from "../src/log.ts";

type Json = any;

test("S101 scroll tier and skill cap", async (t) => {
  setQuiet(true);
  const config = await loadConfig({ ...process.env, AIHW_DB_DRIVER: "pglite", AIHW_PGLITE_DIR: "memory", AIHW_PORT: "0" });
  config.clock.enabled = false;
  const app = await startApp(config);
  try {
    const join = async (): Promise<{ id: string; code: string }> => {
      const out = await app.dispatch({ verb: "enter", body: { args: { mode: "create", skin: "xiuxian", door: "api" } }, bearer: null, door: "api" });
      assert.equal(out.status, 200);
      const body = out.body as Json;
      return { id: body.result.char.id, code: body.result.identity_code };
    };
    const high = await join();
    const low = await join();
    await updateRow(app.db, "char", high.id, { tier: 2 }, "0");
    const skill = await skillDefinition(app.db, "strike");
    assert.ok(skill);
    const highSkill = await learnedSkill(app.db, high.id, skill.id);
    const lowSkill = await learnedSkill(app.db, low.id, skill.id);
    assert.ok(highSkill);
    assert.ok(lowSkill);
    const stamp = { created_tick: "0", updated_tick: "0" };
    const scroll = (tier: number): ItemDefinitionRow => ({
      id: `r1:item:s101_def_${tier}`, ...stamp, record: "definition", content_key: `content.r1.item.s101_${tier}`,
      kind: "scroll", tier, grade: 1, element: "none", slots: 0, cap: 0, dura_max: 0,
      modifiers: { vigor: 0, power: 0, guard: 0, speed: 0 }, effect: { kind: "learn", skill: "strike", levels: 2 }, by: null, note: null,
    });
    const one = scroll(1);
    const two = scroll(2);
    const instance = (local: string, def: ItemDefinitionRow, owner: string): ItemInstanceRow => ({
      id: `r1:item:s101_${local}`, ...stamp, record: "instance", def_id: def.id,
      holder: { kind: "char", id: owner }, state: "available", equipped: false, dura: 0, sockets: [], note: null,
    });
    const plus = instance("plus", one, high.id);
    const clamp = instance("clamp", one, high.id);
    const capped = instance("capped", one, high.id);
    const tooHigh = instance("high", two, low.id);
    const same = instance("same", one, low.id);
    const sameCapped = instance("same_capped", one, low.id);
    await app.db.tx(async (q) => {
      for (const def of [one, two]) await insertRow(q, "item", def);
      for (const item of [plus, clamp, capped, tooHigh, same, sameCapped]) await insertRow(q, "item", item);
    });
    const consume = async (item: ItemInstanceRow, code: string): Promise<Json> =>
      (await app.dispatch({ verb: "use", body: { args: { op: "consume", item: item.id } }, bearer: code, door: "api" })).body;

    await t.test("higher-tier character gains two levels without losing an existing higher cap", async () => {
      await updateRow(app.db, "skill", highSkill.id, { level: 4, cap: 20 }, "0");
      assert.equal((await consume(plus, high.code)).ok, true);
      const learned = await learnedSkill(app.db, high.id, skill.id);
      assert.equal(learned?.level, 6);
      assert.equal(learned?.cap, 20);
      assert.equal((await mustGetRow(app.db, "item", plus.id) as ItemInstanceRow).state, "consumed");
    });
    await t.test("low-tier scroll stops at its tier cap", async () => {
      await updateRow(app.db, "skill", highSkill.id, { level: 11, cap: 20 }, "0");
      assert.equal((await consume(clamp, high.code)).ok, true);
      const learned = await learnedSkill(app.db, high.id, skill.id);
      assert.equal(learned?.level, 12);
      assert.equal(learned?.cap, 20);
    });
    await t.test("low-tier cap rejects and preserves item and AP", async () => {
      const before = await mustGetRow(app.db, "char", high.id);
      const out = await consume(capped, high.code);
      assert.equal(out.ok, false);
      assert.equal(out.error.code, "SKILL_CAP");
      assert.deepEqual(out.error.details, { level: 12, cap: 12, scroll_tier: 1 });
      assert.deepEqual(await mustGetRow(app.db, "item", capped.id), capped);
      assert.equal((await mustGetRow(app.db, "char", high.id)).ap_spent, before.ap_spent);
    });
    await t.test("higher-tier scroll rejects and preserves item", async () => {
      const out = await consume(tooHigh, low.code);
      assert.equal(out.ok, false);
      assert.equal(out.error.code, "ITEM_STATE");
      assert.deepEqual(out.error.details, { reason: "tier", required_tier: 2 });
      assert.deepEqual(await mustGetRow(app.db, "item", tooHigh.id), tooHigh);
    });
    await t.test("same-tier scroll retains existing cap behavior", async () => {
      await updateRow(app.db, "skill", lowSkill.id, { level: 10, cap: 10 }, "0");
      assert.equal((await consume(same, low.code)).ok, true);
      const learned = await learnedSkill(app.db, low.id, skill.id);
      assert.equal(learned?.level, 12);
      assert.equal(learned?.cap, 12);
      const out = await consume(sameCapped, low.code);
      assert.equal(out.error.code, "SKILL_CAP");
      assert.deepEqual(out.error.details, { level: 12, cap: 12 });
      assert.deepEqual(await mustGetRow(app.db, "item", sameCapped.id), sameCapped);
    });
  } finally {
    await app.close();
  }
});
