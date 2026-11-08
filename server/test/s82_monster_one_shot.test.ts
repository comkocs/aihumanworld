// S82: one attack on a monster settles the whole bout. A same-tier monster is dead or the hunter is,
// in that one result, and a win pays the recomputed reward. A duel and a pk stay one round each.

import assert from "node:assert/strict";
import { test } from "node:test";
import { startApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { insertRow, mustGetRow, updateRow } from "../src/facts/store.ts";
import type { CharRow } from "../src/facts/types.ts";
import { combatant, neutralFacts } from "../src/growth/facts.ts";
import { MONSTER_BOUT_ROUND_CAP, resolveCombat } from "../src/growth/settlement.ts";
import { setQuiet } from "../src/log.ts";

type Json = any;

test("S82: one attack settles a whole monster bout; a duel and a pk stay one round", async () => {
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
    const other = await enter();
    const world = await mustGetRow(app.db, "world", "r1:world:main");
    const numbers = app.services.balance().numbers;
    assert.equal(world.rules_revision, "balance.v1.15");
    assert.equal(numbers.combat.monster_kill_xp_bp, 825);
    assert.equal(MONSTER_BOUT_ROUND_CAP, 8);
    const task = numbers.tiers.find((r) => r.tier === 1)!;
    const perKill = Math.floor((task.task_xp * 825) / 10000);
    assert.equal(perKill, 24);

    const base = await mustGetRow(app.db, "char", hunter.id);
    const place = "r1:place:xiuxian_landmark_ash_altar";
    const monster = (id: string, vigor: number): CharRow => ({
      ...base, id, kind: "npc", door: null, handle: null, email_hash: null, model: null,
      body: "beast", archetype: "monster", tier: 1, stage: 1, life: "alive", state: "active", vigor,
      loc: place, respawn_place: place, patrol_route: [], patrol_index: 0, xp: 0, potential: 0,
    });
    await app.db.tx(async (q) => {
      await insertRow(q, "char", monster("r1:char:s82_peer", 1));
      await updateRow(q, "char", hunter.id, { loc: place }, world.tick);
      await updateRow(q, "world", world.id, { rules: { ...world.rules, ap_per_tick: 1000 } }, world.tick);
    });

    // A one-vigor same-tier monster dies on the one attack, and that attack pays the recomputed reward.
    await updateRow(app.db, "char", hunter.id, { vigor: 1000000, ap_spent: 0 }, world.tick);
    const win = await invoke("attack", { target: "r1:char:s82_peer" }, hunter.code);
    assert.equal(win.ok, true, JSON.stringify(win.error));
    assert.equal(win.result.outcome, "win");
    assert.equal(win.result.winner, hunter.id);
    assert.deepEqual(win.result.reward, { xp: perKill, potential: Math.floor((task.task_potential * 825) / 10000) });
    const dead = await mustGetRow(app.db, "char", "r1:char:s82_peer");
    assert.equal(dead.life, "dead");
    assert.equal(dead.vigor, 0);

    // A full-vigor same-tier monster is also settled in that one attack: one combat_resolved, and one side at 0.
    await updateRow(app.db, "char", "r1:char:s82_peer", { vigor: 1800, life: "alive", revive_tick: null, loc: place, state: "active" }, world.tick);
    const before = await app.db.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM events WHERE type = 'combat_resolved' AND data->>'target' = $1", ["r1:char:s82_peer"],
    );
    await updateRow(app.db, "char", hunter.id, { vigor: 2000, ap_spent: 0 }, world.tick);
    const full = await invoke("attack", { target: "r1:char:s82_peer" }, hunter.code);
    assert.equal(full.ok, true, JSON.stringify(full.error));
    assert.ok(full.result.outcome === "win" || full.result.outcome === "lose" || full.result.outcome === "draw");
    const after = await mustGetRow(app.db, "char", "r1:char:s82_peer");
    const hunterAfter = await mustGetRow(app.db, "char", hunter.id);
    if (full.result.outcome === "win") assert.equal(after.life, "dead");
    if (full.result.outcome === "lose") assert.equal(hunterAfter.vigor, 0);
    if (full.result.outcome === "draw") {
      assert.equal(after.life, "alive");
      assert.ok(after.vigor > 0 && after.vigor < 1800, "a draw hurts the monster without killing it");
      assert.ok(hunterAfter.vigor > 0 && hunterAfter.vigor < 2000, "a draw hurts the hunter too");
    }
    const events = await app.db.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM events WHERE type = 'combat_resolved' AND data->>'target' = $1", ["r1:char:s82_peer"],
    );
    // One resolution emits two rows of the same event: one to the two fighters, one to the place.
    assert.equal(Number(events.rows[0]!.n) - Number(before.rows[0]!.n), 2, "the whole bout is one resolution");

    // The same inputs replay: a participant versus a monster plays up to the cap and ends decisively.
    const balance = app.services.balance();
    const me = await mustGetRow(app.db, "char", hunter.id);
    const mob = monster("r1:char:s82_probe", 1800);
    const seed = "s82:probe";
    const bout = resolveCombat(balance, seed, combatant(balance, { ...me, vigor: 2000 }, await neutralFacts(app.db, me)), combatant(balance, mob, { skills: [], equipment: [] }), "pve");
    assert.deepEqual(bout, resolveCombat(balance, seed, combatant(balance, { ...me, vigor: 2000 }, await neutralFacts(app.db, me)), combatant(balance, mob, { skills: [], equipment: [] }), "pve"));
    assert.ok(bout.rounds >= 1 && bout.rounds <= MONSTER_BOUT_ROUND_CAP);
    assert.ok(bout.actor_vigor === 0 || bout.target_vigor === 0 || bout.rounds === MONSTER_BOUT_ROUND_CAP);

    // A duel and a pk between participants stay a single round: the vigor left is exactly one round's.
    app.services.balance().numbers.combat.newbie_protect_ticks = 0;
    await updateRow(app.db, "place", place, { combat: "duel" }, world.tick);
    await updateRow(app.db, "char", hunter.id, { vigor: 2000, ap_spent: 0, life: "alive" }, world.tick);
    await updateRow(app.db, "char", other.id, { loc: place, vigor: 2000, ap_spent: 0 }, world.tick);
    const duelHunter = await mustGetRow(app.db, "char", hunter.id);
    const duelOther = await mustGetRow(app.db, "char", other.id);
    const duelFacts = { hunter: await neutralFacts(app.db, duelHunter), other: await neutralFacts(app.db, duelOther) };
    const oneRound = resolveCombat(balance, "s82:duel", combatant(balance, duelHunter, duelFacts.hunter), combatant(balance, duelOther, duelFacts.other), "duel");
    assert.equal(oneRound.rounds, 1, "a duel resolves as one round");
    const roundLoss = 2000 - oneRound.target_vigor;
    const duel = await invoke("attack", { target: other.id }, hunter.code);
    assert.equal(duel.ok, true, JSON.stringify(duel.error));
    assert.equal(duel.result.reward, undefined, "a duel pays no monster reward");
    const duelLeft = await mustGetRow(app.db, "char", other.id);
    assert.equal(duelLeft.life, "alive", "a duel is never lethal");
    assert.ok(duelLeft.vigor > 0, "a duel never spends a fighter out");
    // One round only. The server draws its own seed, so replay that exact roll: it must be the one-round
    // resolution, and the vigor it leaves must be what the duel actually left.
    const played = resolveCombat(balance, duel.result.roll.seed, combatant(balance, duelHunter, duelFacts.hunter), combatant(balance, duelOther, duelFacts.other), "duel");
    assert.equal(played.rounds, 1, "a duel plays one round");
    assert.equal(duelLeft.vigor, played.target_vigor, "a duel leaves exactly one round of vigor");
    assert.equal(roundLoss > 0, true);
  } finally {
    await app.close();
  }
});
