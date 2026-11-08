// S69: killing an NPC of archetype monster drops one equipment definition of that monster's own tier
// onto the place (who takes it, keeps it). The roll comes from the combat seed, so the same fight
// always drops the same thing. Killing a player never takes this path.

import assert from "node:assert/strict";
import { test } from "node:test";
import { startApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { ITEM_CATEGORY } from "../src/facts/enums.ts";
import { mustGetRow, updateRow } from "../src/facts/store.ts";
import { setQuiet } from "../src/log.ts";

type Json = any;

const EQUIPMENT = new Set(["weapon", "armor", "accessory"]);

test("S69: a killed monster drops its own tier's equipment; killing a player does not", async () => {
  setQuiet(true);
  const config = await loadConfig({ ...process.env, AIHW_DB_DRIVER: "pglite", AIHW_PGLITE_DIR: "memory", AIHW_PORT: "0" });
  config.clock.enabled = false;
  const app = await startApp(config);
  try {
    const invoke = async (verb: string, args: object, bearer: string | null): Promise<Json> =>
      (await app.dispatch({ verb, body: { args }, bearer, door: "api" })).body;
    const enter = async (): Promise<{ id: string; code: string }> => {
      const body = await invoke("enter", { mode: "create", skin: "xiuxian", door: "api", class: null }, null);
      assert.equal(body.ok, true, JSON.stringify(body));
      return { id: body.result.char.id, code: body.result.identity_code };
    };
    const hunter = await enter();
    const victim = await enter();
    const world = await mustGetRow(app.db, "world", "r1:world:main");
    const combat = app.services.balance().numbers.combat;
    assert.equal(world.rules_revision, "balance.v1.15");
    assert.equal(combat.monster_drop_chance_bp, 2000);
    assert.deepEqual(combat.monster_drop_grade_weight, [7000, 2500, 500]);

    const mobs = await app.db.query<{ id: string; tier: number; loc: string }>(
      "SELECT c.id, c.tier, c.loc FROM chars c JOIN places p ON p.id = c.loc WHERE c.kind = 'npc' AND c.archetype = 'monster' AND c.life = 'alive' AND p.combat = 'pve' ORDER BY c.tier, c.id",
    );
    const mob = mobs.rows[0];
    assert.ok(mob, "the imported world has a living monster");
    const place = mob.loc;

    // One strong hunter, one monster brought back to the same place each time. 60 kills at 20% is
    // overwhelmingly likely to drop at least once, and the seed makes the whole run replayable.
    await updateRow(app.db, "char", hunter.id, { loc: place, vigor: 1000000, tier: mob.tier }, world.tick);
    await updateRow(app.db, "world", world.id, { rules: { ...world.rules, ap_per_tick: 1000 } }, world.tick);

    const dropped: { item_id: string; def_id: string }[] = [];
    for (let i = 0; i < 60 && dropped.length === 0; i += 1) {
      await updateRow(app.db, "char", mob.id, { vigor: 1, life: "alive", revive_tick: null, loc: place, state: "active" }, world.tick);
      await updateRow(app.db, "char", hunter.id, { vigor: 1000000, ap_spent: 0 }, world.tick);
      const res = await invoke("attack", { target: mob.id }, hunter.code);
      assert.equal(res.ok, true, JSON.stringify(res.error));
      if (res.result.dropped !== undefined) dropped.push(...res.result.dropped);
    }
    assert.ok(dropped.length > 0, "sixty kills of a same-tier monster produced no drop");

    const drop = dropped[0]!;
    const item = await mustGetRow(app.db, "item", drop.item_id);
    assert.equal(item.record, "instance");
    if (item.record !== "instance") return;
    assert.equal(item.def_id, drop.def_id);
    assert.deepEqual(item.holder, { kind: "place", id: place });
    assert.equal(item.state, "available");
    assert.equal(item.equipped, false);
    const def = await mustGetRow(app.db, "item", item.def_id);
    assert.equal(def.record, "definition");
    if (def.record !== "definition") return;
    assert.equal(def.tier, mob.tier, "the drop is the monster's own tier");
    assert.ok(EQUIPMENT.has(ITEM_CATEGORY[def.kind]), `a monster dropped a non-equipment ${def.kind}`);
    assert.equal(item.dura, def.dura_max);

    const lying = await app.db.query<{ id: string }>(
      "SELECT id FROM items WHERE record = 'instance' AND holder->>'kind' = 'place' AND holder->>'id' = $1 AND id = $2",
      [place, item.id],
    );
    assert.equal(lying.rows.length, 1, "the drop is queryable as lying on the place");
    const taken = await invoke("take", { item: item.id }, hunter.code);
    assert.equal(taken.ok, true, JSON.stringify(taken.error));
    const mine = await mustGetRow(app.db, "item", item.id);
    if (mine.record === "instance") assert.deepEqual(mine.holder, { kind: "char", id: hunter.id });

    // Killing a player (pk place, vigor 1) drops nothing of its own: no `dropped` field.
    // The victim was just created, so the newbie window still covers it; move the world clock past it (S48).
    await updateRow(app.db, "world", world.id, { tick: "5" }, world.tick);
    const pk = await app.db.query<{ id: string }>("SELECT id FROM places WHERE combat = 'pk' LIMIT 1");
    const pkPlace = pk.rows[0]?.id;
    assert.ok(pkPlace, "the imported world has a pk place");
    await updateRow(app.db, "char", hunter.id, { loc: pkPlace, vigor: 1000000, ap_spent: 0 }, world.tick);
    await updateRow(app.db, "char", victim.id, { loc: pkPlace, vigor: 1, life: "alive", state: "active" }, world.tick);
    const kill = await invoke("attack", { target: victim.id }, hunter.code);
    assert.equal(kill.ok, true, JSON.stringify(kill.error));
    assert.equal(kill.result.dropped, undefined, "killing a player must not report a monster drop");
    const minted = await app.db.query<{ n: string }>(
      "SELECT count(*) AS n FROM items WHERE record = 'instance' AND created_tick = $1 AND id <> $2",
      [world.tick, item.id],
    );
    assert.equal(minted.rows[0]?.n, "0", "killing a player minted no item");

    // A participant can also obtain a monster drop at a pk place.
    const pkDropped: { item_id: string; def_id: string }[] = [];
    for (let i = 0; i < 60 && pkDropped.length === 0; i += 1) {
      await updateRow(app.db, "char", mob.id, { vigor: 1, life: "alive", revive_tick: null, loc: pkPlace, state: "active" }, world.tick);
      await updateRow(app.db, "char", hunter.id, { loc: pkPlace, vigor: 1000000, ap_spent: 0 }, world.tick);
      const res = await invoke("attack", { target: mob.id }, hunter.code);
      assert.equal(res.ok, true, JSON.stringify(res.error));
      if (res.result.dropped !== undefined) pkDropped.push(...res.result.dropped);
    }
    assert.ok(pkDropped.length > 0, "sixty monster kills at a pk place produced no drop");
    const pkItem = await mustGetRow(app.db, "item", pkDropped[0]!.item_id);
    assert.equal(pkItem.record, "instance");
    if (pkItem.record === "instance") {
      assert.equal(pkItem.def_id, pkDropped[0]!.def_id);
      assert.deepEqual(pkItem.holder, { kind: "place", id: pkPlace });
    }
  } finally {
    await app.close();
  }
});
