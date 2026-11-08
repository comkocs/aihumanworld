// S103: participant PK settles a whole bout once; duel settlement and PK follow-up rules stay intact.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { startApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { insertRow, mustGetRow, selectRows, updateRow } from "../src/facts/store.ts";
import type { Combatant, ItemInstanceRow } from "../src/facts/types.ts";
import { parseBalance } from "../src/growth/balance.ts";
import { combatant, neutralFacts } from "../src/growth/facts.ts";
import { PK_BOUT_ROUND_CAP, resolveCombat, u32 } from "../src/growth/settlement.ts";
import { setQuiet } from "../src/log.ts";

type Json = any;

const numbersUrl = new URL("../../content/rules/numbers.v1.json", import.meta.url);

test("S103: PK repeats deterministic rounds to death or the cap, while duels stay one round", async () => {
  const balance = parseBalance(JSON.parse(await readFile(numbersUrl, "utf8")));
  const grid = balance.numbers.grid.find((r) => r.tier === 1 && r.stage === 1)!;
  const actor: Combatant = {
    char_id: "r1:char:s103_actor", body: "humanoid", archetype: null, tier: 1, stage: 1,
    xp: 0, vigor: grid.vigor_max, cycles: 0, legacy: 0, skills: [], equipment: [],
    stats: { power: grid.power, guard: grid.guard, speed: grid.speed, vigor_max: grid.vigor_max, cap_max: balance.numbers.tiers[0]!.cap_max },
  };
  const target = { ...actor, char_id: "r1:char:s103_target" };
  assert.equal(PK_BOUT_ROUND_CAP, 8);
  const strong = { ...actor, stats: { ...actor.stats, power: actor.stats.power * 3 } };
  const win = resolveCombat(balance, "s103:win", strong, target, "pk");
  assert.equal(win.outcome, "win");
  assert.equal(win.winner, actor.char_id);
  assert.equal(win.target_vigor, 0);
  assert.ok(win.actor_vigor > 0);
  assert.ok(win.rounds > 1 && win.rounds <= PK_BOUT_ROUND_CAP);
  assert.deepEqual(win, resolveCombat(balance, "s103:win", strong, target, "pk"));
  assert.equal(win.actor_wear_bp, balance.numbers.combat.wear_winner_bp);
  assert.equal(win.target_wear_bp, balance.numbers.combat.wear_loser_bp);

  const lose = resolveCombat(balance, "s103:lose", actor, { ...strong, char_id: target.char_id }, "pk");
  assert.equal(lose.outcome, "lose");
  assert.equal(lose.winner, target.char_id);
  assert.equal(lose.actor_vigor, 0);
  assert.ok(lose.target_vigor > 0);
  assert.ok(lose.rounds > 1 && lose.rounds <= PK_BOUT_ROUND_CAP);

  // Fixed draws exercise the cap without changing any on-disk numbers or rule keys.
  const fixed = structuredClone(balance);
  fixed.numbers.combat.roll_spread_bp = 0;
  const draw = resolveCombat(fixed, "s103:draw", actor, target, "pk");
  const drawLoss = Math.floor(grid.vigor_max * fixed.numbers.combat.draw_loss_bp / 10000);
  assert.equal(draw.outcome, "draw");
  assert.equal(draw.winner, null);
  assert.equal(draw.rounds, PK_BOUT_ROUND_CAP);
  assert.equal(draw.actor_vigor, grid.vigor_max - PK_BOUT_ROUND_CAP * drawLoss);
  assert.equal(draw.target_vigor, draw.actor_vigor);
  assert.ok(draw.actor_vigor > 0 && draw.actor_vigor < actor.vigor);
  assert.equal(draw.roll.seed, "s103:draw#r7");
  assert.equal(draw.actor_wear_bp, fixed.numbers.combat.wear_draw_bp);
  assert.equal(draw.target_wear_bp, fixed.numbers.combat.wear_draw_bp);
  assert.deepEqual(draw, resolveCombat(fixed, "s103:draw", actor, target, "pk"));

  const duel = resolveCombat(fixed, "s103:duel", actor, target, "duel");
  assert.equal(duel.rounds, 1);
  assert.equal(duel.actor_vigor, actor.vigor - drawLoss);
  assert.equal(duel.target_vigor, target.vigor - drawLoss);
  assert.equal(resolveCombat(balance, "s103:npc", actor, { ...target, archetype: "guard" }, "pk").rounds, 1);
  const mutual = resolveCombat(fixed, "s103:mutual", { ...actor, vigor: 1 }, { ...target, vigor: 1 }, "pk");
  assert.deepEqual([mutual.outcome, mutual.winner, mutual.actor_vigor, mutual.target_vigor, mutual.rounds], ["win", actor.char_id, 0, 0, 1]);
});

test("S103: one participant attack settles PK, wears once, preserves death/red name/loot/reward and leaves duel single-round", async () => {
  setQuiet(true);
  const config = await loadConfig({ ...process.env, AIHW_DB_DRIVER: "pglite", AIHW_PGLITE_DIR: "memory", AIHW_PORT: "0" });
  config.clock.enabled = false;
  const app = await startApp(config);
  try {
    const invoke = async (verb: string, args: object, bearer: string | null): Promise<Json> => {
      const r = (await app.dispatch({ verb, body: { args }, bearer, door: "api" })).body as Json;
      assert.equal(r.ok, true, `${verb}: ${JSON.stringify(r.error)}`);
      return r;
    };
    const enter = async () => {
      const r = await invoke("enter", { mode: "create", skin: "xiuxian", door: "api" }, null);
      return { id: r.result.char.id as string, code: r.result.identity_code as string };
    };
    const a = await enter();
    const b = await enter();
    const killer = await enter();
    const victim = await enter();
    const balance = app.services.balance();
    const n = balance.numbers;
    const world = await mustGetRow(app.db, "world", "r1:world:main");
    const tick = (BigInt(world.tick) + BigInt(n.combat.newbie_protect_ticks ?? 0)).toString();
    await updateRow(app.db, "world", world.id, { tick }, tick);
    const place = (await mustGetRow(app.db, "char", a.id)).loc;
    assert.notEqual((await mustGetRow(app.db, "place", place)).combat, "duel");
    const equipDef = (await selectRows(app.db, "item", "record = 'definition' AND kind = 'blade' AND tier = 1 AND grade = 1"))[0];
    assert.ok(equipDef?.record === "definition");
    const gear = (id: string, owner: string, equipped: boolean): ItemInstanceRow => ({
      id, created_tick: tick, updated_tick: tick, record: "instance", def_id: equipDef.id,
      holder: { kind: "char", id: owner }, state: "available", equipped,
      dura: equipDef.dura_max, sockets: Array.from({ length: equipDef.slots }, () => null), note: null,
    });
    const aGear = gear("r1:item:s103_a_gear", a.id, true);
    const bGear = gear("r1:item:s103_b_gear", b.id, true);
    await insertRow(app.db, "item", aGear);
    await insertRow(app.db, "item", bGear);
    const row = (id: string) => mustGetRow(app.db, "char", id);
    for (const p of [a, b, killer, victim]) {
      const c = await row(p.id);
      const full = combatant(balance, c, await neutralFacts(app.db, c)).stats.vigor_max;
      await updateRow(app.db, "char", p.id, { vigor: full, ap_spent: 0, last_yield_tick: tick }, tick);
      assert.ok(BigInt(tick) >= BigInt(c.created_tick) + BigInt(n.combat.newbie_protect_ticks ?? 0));
    }

    // Full-vigor peers in a non-duel place: one deed and one event per scope, no withdrawal between rounds.
    const aBefore = await row(a.id);
    const bBefore = await row(b.id);
    const aInput = combatant(balance, aBefore, await neutralFacts(app.db, aBefore));
    const bInput = combatant(balance, bBefore, await neutralFacts(app.db, bBefore));
    const full = await invoke("attack", { target: b.id }, a.code);
    assert.ok(["win", "lose", "draw"].includes(full.result.outcome));
    const seed = (full.result.roll.seed as string).replace(/#r\d+$/, "");
    const played = resolveCombat(balance, seed, aInput, bInput, "pk");
    assert.deepEqual(full.result.roll, played.roll);
    assert.equal(full.result.outcome, played.outcome);
    assert.equal(full.result.winner, played.winner);
    assert.ok(played.rounds > 1 && played.rounds <= PK_BOUT_ROUND_CAP);
    const aAfter = await row(a.id);
    const bAfter = await row(b.id);
    assert.equal(aAfter.vigor, played.actor_vigor);
    assert.equal(bAfter.vigor, played.target_vigor);
    if (full.result.outcome === "win") assert.equal(bAfter.life, "dead");
    if (full.result.outcome === "lose") assert.equal(aAfter.life, "dead");
    if (full.result.outcome === "draw") {
      assert.equal(played.rounds, PK_BOUT_ROUND_CAP);
      assert.equal(aAfter.life, "alive");
      assert.equal(bAfter.life, "alive");
      assert.ok(aAfter.vigor > 0 && aAfter.vigor < aBefore.vigor);
      assert.ok(bAfter.vigor > 0 && bAfter.vigor < bBefore.vigor);
    }
    for (const [item, wear] of [[aGear, played.actor_wear_bp], [bGear, played.target_wear_bp]] as const) {
      const after = await mustGetRow(app.db, "item", item.id);
      assert.ok(after.record === "instance");
      assert.equal(after.dura, item.dura - Math.max(1, Math.floor(equipDef.dura_max * wear / 10000)));
      assert.equal(full.result.changes.filter((c: Json) => c.table === "item" && c.id === item.id && c.after.dura !== undefined).length, 1);
    }
    const rules = JSON.parse(await readFile(numbersUrl, "utf8")) as Json;
    assert.equal(aAfter.ap_spent, rules.world_rules.ap_costs.attack);
    const events = (await app.db.query<Json>("SELECT scope, data FROM events WHERE type = 'combat_resolved' AND deed_id = $1", [full.result.deed_id])).rows;
    assert.deepEqual(events.map((e) => e.scope).sort(), ["place", "self"]);
    for (const e of events) assert.deepEqual([e.data.mode, e.data.winner, e.data.outcome], ["pk", played.winner, played.outcome]);
    const deeds = await app.db.query<{ n: string }>("SELECT count(*)::text AS n FROM deeds WHERE actor = $1 AND verb = 'attack' AND kind IN ('combat_win', 'combat_loss', 'combat_draw')", [a.id]);
    assert.equal(deeds.rows[0]!.n, "1");

    // A fresh same-tier player/official pair: a lethal initiator win keeps every existing PK follow-up.
    await updateRow(app.db, "char", victim.id, { kind: "official", vigor: 1, xp: 1000 }, tick);
    const loot = gear("r1:item:s103_loot", victim.id, false);
    await insertRow(app.db, "item", loot);
    const killerBefore = await row(killer.id);
    const victimBefore = await row(victim.id);
    const kill = await invoke("attack", { target: victim.id }, killer.code);
    assert.equal(kill.result.outcome, "win");
    assert.equal(kill.result.winner, killer.id);
    const victimAfter = await row(victim.id);
    assert.equal(victimAfter.life, "dead");
    assert.equal(victimAfter.vigor, 0);
    assert.equal(victimAfter.revive_tick, (BigInt(kill.tick) + BigInt(n.death.revive_wait_ticks)).toString());
    const grid = n.grid.find((r) => r.tier === victimBefore.tier && r.stage === victimBefore.stage)!;
    assert.equal(victimAfter.xp, victimBefore.xp - Math.min(victimBefore.xp, Math.floor(grid.xp_need * n.death.xp_loss_bp / 10000)));
    const wanted = (await selectRows(app.db, "wanted", "char_id = $1 AND reason = 'kill_player' AND state = 'active'", [killer.id]))[0];
    assert.ok(wanted);
    assert.equal(wanted.until_tick, (BigInt(kill.tick) + BigInt(n.wanted.kill_peer_ticks!)).toString());
    assert.ok(wanted.bounty_task !== null);
    const bounty = await mustGetRow(app.db, "task", wanted.bounty_task);
    assert.ok(bounty.record === "instance");
    assert.equal(bounty.kind, "bounty");
    assert.equal(bounty.state, "open");
    assert.equal((await selectRows(app.db, "wanted", "char_id = $1", [victim.id])).length, 0);
    const task = n.tiers.find((r) => r.tier === killerBefore.tier)!;
    const rule = n.tasks.deed_bonus.combat_social!;
    assert.equal((await row(killer.id)).xp - killerBefore.xp, Math.floor(task.task_xp * rule.pk_win_bp / 10000));
    assert.equal((await row(killer.id)).potential - killerBefore.potential, Math.floor(task.task_potential * rule.pk_win_bp / 10000));
    const rewards = await app.db.query<Json>("SELECT data FROM events WHERE deed_id = $1 AND type = 'reward_granted' AND data->'social'->>'kind' = 'pk'", [kill.result.deed_id]);
    assert.equal(rewards.rows.length, 1);
    const rootSeed = (kill.result.roll.seed as string).replace(/#r\d+$/, "");
    const dropped = u32(rootSeed, "dropchance") % 10000 < n.death.pk_drop_chance_bp;
    const lootAfter = await mustGetRow(app.db, "item", loot.id);
    assert.ok(lootAfter.record === "instance");
    assert.deepEqual(lootAfter.holder, dropped ? { kind: "place", id: place } : { kind: "char", id: victim.id });

    // Switching to a duel place keeps exactly one round and never kills either participant.
    await updateRow(app.db, "place", place, { combat: "duel" }, tick);
    for (const p of [killer, victim]) {
      const c = await row(p.id);
      const fullVigor = combatant(balance, c, await neutralFacts(app.db, c)).stats.vigor_max;
      await updateRow(app.db, "char", p.id, { vigor: fullVigor, life: "alive", revive_tick: null, ap_spent: 0, last_yield_tick: tick }, tick);
    }
    const duelActor = await row(killer.id);
    const duelTarget = await row(victim.id);
    const duelA = combatant(balance, duelActor, await neutralFacts(app.db, duelActor));
    const duelB = combatant(balance, duelTarget, await neutralFacts(app.db, duelTarget));
    const duel = await invoke("attack", { target: victim.id }, killer.code);
    const oneRound = resolveCombat(balance, duel.result.roll.seed, duelA, duelB, "duel");
    assert.equal(oneRound.rounds, 1);
    assert.deepEqual(duel.result.roll, oneRound.roll);
    assert.equal((await row(killer.id)).vigor, oneRound.actor_vigor);
    assert.equal((await row(victim.id)).vigor, oneRound.target_vigor);
    assert.equal((await row(killer.id)).life, "alive");
    assert.equal((await row(victim.id)).life, "alive");
    assert.ok(oneRound.actor_vigor > 0 && oneRound.target_vigor > 0);
  } finally {
    await app.close();
  }
});
