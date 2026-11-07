// S80: killing a monster of the killer's own tier or higher pays cultivation, and the attack
// result says how much. A lower-tier monster pays nothing. The daily duel / pk five is not touched.

import assert from "node:assert/strict";
import { test } from "node:test";
import { startApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { insertRow, mustGetRow, updateRow } from "../src/facts/store.ts";
import type { CharRow } from "../src/facts/types.ts";
import { setQuiet } from "../src/log.ts";

type Json = any;

test("S80: a same-tier monster kill pays cultivation the result can show; a lower tier pays none; the duel five is untouched", async () => {
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
    const sparring = await enter();
    const world = await mustGetRow(app.db, "world", "r1:world:main");
    const numbers = app.services.balance().numbers;
    assert.equal(world.rules_revision, "balance.v1.13");
    assert.equal(numbers.combat.monster_kill_xp_bp, 825);
    const task = numbers.tiers.find((r) => r.tier === 1);
    assert.ok(task, `tier 1 row missing; tiers seen: ${numbers.tiers.map((r) => r.tier).join(",")}`);
    const perKill = Math.floor((task.task_xp * numbers.combat.monster_kill_xp_bp) / 10000);
    const perKillPot = Math.floor((task.task_potential * numbers.combat.monster_kill_xp_bp) / 10000);
    assert.equal(perKill, 24, `tier 1 task_xp ${task.task_xp} x ${numbers.combat.monster_kill_xp_bp}bp`);

    const base = await mustGetRow(app.db, "char", hunter.id);
    // The birth place is safe and refuses an attack on an NPC, so the fight happens at a pve place.
    const place = "r1:place:xiuxian_landmark_ash_altar";
    const monster = (id: string, tier: number): CharRow => ({
      ...base, id, kind: "npc", door: null, handle: null, email_hash: null, model: null,
      body: "beast", archetype: "monster", tier, stage: 1, life: "alive", state: "active", vigor: 1,
      loc: place, respawn_place: place, patrol_route: [], patrol_index: 0, xp: 0, potential: 0,
    });
    await app.db.tx(async (q) => {
      await insertRow(q, "char", monster("r1:char:s80_peer", 1));
      await insertRow(q, "char", monster("r1:char:s80_weak", 1));
      await updateRow(q, "char", hunter.id, { loc: place }, world.tick);
      await updateRow(q, "world", world.id, { rules: { ...world.rules, ap_per_tick: 1000 } }, world.tick);
    });

    const xpOf = async (id: string): Promise<number> => (await mustGetRow(app.db, "char", id)).xp;
    const kill = async (id: string): Promise<Json> => {
      await updateRow(app.db, "char", id, { vigor: 1, life: "alive", revive_tick: null, loc: place, state: "active" }, world.tick);
      await updateRow(app.db, "char", hunter.id, { vigor: 1000000, ap_spent: 0 }, world.tick);
      const res = await invoke("attack", { target: id }, hunter.code);
      assert.equal(res.ok, true, JSON.stringify(res.error));
      assert.equal(res.result.outcome, "win");
      return res;
    };

    const before = await xpOf(hunter.id);
    const same = await kill("r1:char:s80_peer");
    assert.deepEqual(same.result.reward, { xp: perKill, potential: perKillPot });
    // The balance also moves by the one-time first-kill bonus (tier 1: floor(300 x 1500 / 10000) = 45).
    const firstKillXp = Math.floor((task.task_xp * numbers.tasks.deed_bonus.first_kill.xp_bp) / 10000);
    assert.equal((await xpOf(hunter.id)) - before, perKill + firstKillXp);
    const event = await app.db.query<{ data: Json }>(
      "SELECT e.data FROM events e WHERE e.type = 'combat_resolved' AND e.data->>'target' = $1 ORDER BY e.cursor DESC LIMIT 1",
      ["r1:char:s80_peer"],
    );
    assert.deepEqual(event.rows[0]?.data.reward, { xp: perKill, potential: perKillPot });

    // The same monster, killed again, pays again: there is no daily count on monster kills.
    const mid = await xpOf(hunter.id);
    const again = await kill("r1:char:s80_peer");
    assert.deepEqual(again.result.reward, { xp: perKill, potential: perKillPot });
    assert.equal((await xpOf(hunter.id)) - mid, perKill);

    await updateRow(app.db, "char", hunter.id, { tier: 2, stage: 1 }, world.tick);
    const high = await xpOf(hunter.id);
    const low = await kill("r1:char:s80_weak");
    assert.equal(low.result.reward, undefined);
    assert.equal(await xpOf(hunter.id), high, "a monster below the killer's tier pays nothing");

    // The duel / pk five counts reward_granted events that carry social.kind duel or pk. A monster kill carries none.
    const social = await app.db.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM events WHERE type = 'reward_granted' AND data->'social'->>'kind' IN ('duel', 'pk') AND recipients @> $1::jsonb",
      [JSON.stringify([hunter.id])],
    );
    assert.equal(social.rows[0]?.n, "0");

    await updateRow(app.db, "place", place, { combat: "duel" }, world.tick);
    app.services.balance().numbers.combat.newbie_protect_ticks = 0;
    await updateRow(app.db, "char", hunter.id, { tier: 1, stage: 1, vigor: 1000000, ap_spent: 0 }, world.tick);
    await updateRow(app.db, "char", sparring.id, { loc: place, vigor: 1000000, ap_spent: 0 }, world.tick);
    const duel = await invoke("attack", { target: sparring.id }, hunter.code);
    assert.equal(duel.ok, true, JSON.stringify(duel.error));
    assert.equal(duel.result.reward, undefined, "a duel against a participant is not a monster kill");
    const afterDuel = await app.db.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM events WHERE type = 'reward_granted' AND data->'social'->>'kind' = 'duel' AND recipients @> $1::jsonb",
      [JSON.stringify([hunter.id])],
    );
    assert.equal(afterDuel.rows[0]?.n, "1", "the duel still takes one of the daily five");
  } finally {
    await app.close();
  }
});
