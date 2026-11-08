// S88 acceptance: missed tide spreads / rewards fall; a repelled tide restores them,
// credits the live weekly board, and settles one public result. Already-open realms work.

import assert from "node:assert/strict";
import { test } from "node:test";
import { startApp } from "../src/app.ts";
import type { ClockPhase } from "../src/clock/phases.ts";
import { loadConfig } from "../src/config.ts";
import { mustGetRow, selectRows, updateRow } from "../src/facts/store.ts";
import type { PlaceRow, TaskInstanceRow, TaskTemplateRow } from "../src/facts/types.ts";
import { Writer } from "../src/facts/writer.ts";
import { setQuiet } from "../src/log.ts";
import { orgGoalPhase } from "../src/orgs/clock.ts";
import { organizationAt } from "../src/orgs/weekly.ts";
import { worldEventPhase } from "../src/world_events/clock.ts";

type Json = any;

test("S88: tide spread, regional offers / look, live organization board and weekly settlement", async (t) => {
  setQuiet(true);
  const config = await loadConfig({ ...process.env, AIHW_DB_DRIVER: "pglite", AIHW_PGLITE_DIR: "memory", AIHW_PORT: "0" });
  config.clock.enabled = false;
  const app = await startApp(config);
  const balance = app.services.balance();
  const rule = balance.numbers.world_events!;
  const worldId = `${config.realm}:world:main`;
  let first: Json;
  let second: Json;
  let spreadPlace: PlaceRow;
  let reduced: TaskInstanceRow[] = [];
  let reducedId: string;
  let actor: { id: string; code: string };
  let helper: { id: string; code: string };
  let orgId: string;

  const ok = async (verb: string, args: object, code: string | null = null): Promise<Json> => {
    const out = await app.dispatch({ verb, body: { args }, bearer: code, door: "api" });
    const body = out.body as Json;
    assert.equal(body.ok, true, `${verb}: ${JSON.stringify(body.error)}`);
    return body;
  };
  const create = async (): Promise<{ id: string; code: string }> => {
    const entered = await ok("enter", { mode: "create", skin: "xiuxian", door: "api" });
    return { id: entered.result.char.id, code: entered.result.identity_code };
  };
  const phase = async (p: ClockPhase, tick: number): Promise<void> => {
    await app.db.tx(async (q) => {
      const world = await mustGetRow(q, "world", worldId, { lock: true });
      const to = String(tick);
      const writer = new Writer(q, config.realm, to, world.rules_revision, true);
      await p.run({ q, w: writer, world, rules: world.rules, balance, from_tick: world.tick, to_tick: to, now: new Date() });
      await updateRow(q, "world", world.id, { tick: to, tick_started_at: new Date().toISOString(), day_index: Math.floor(tick / balance.numbers.clock.day_ticks), week_index: Math.floor(tick / balance.numbers.clock.week_ticks) }, to);
    });
  };
  const eventAt = async (tick: number): Promise<Json> => (await app.db.query<Json>("SELECT * FROM s72_world_events WHERE open_tick = $1", [String(tick)])).rows[0];
  const board = async (): Promise<Json> => {
    const response = await fetch(`${app.url}/v1/weekly`);
    assert.equal(response.status, 200);
    return response.json();
  };
  const newOffers = async (placeId: string): Promise<TaskInstanceRow[]> => {
    const world = await mustGetRow(app.db, "world", worldId);
    await updateRow(app.db, "char", actor.id, { loc: placeId, tier: 2, stage: 1, ap_spent: 0 }, world.tick);
    await app.db.query("UPDATE tasks SET state = 'cancelled' WHERE eligible_char = $1 AND state = 'open'", [actor.id]);
    const list = await ok("task", { op: "list" }, actor.code);
    return list.result.rows.filter((r: Json) => r.kind === "system" && r.eligible_char === actor.id);
  };

  try {
    // Keep S88's memory fixture on its assigned key while parallel work bumps the shared bundle.
    balance.numbers.meta.revision_key = "balance.v1.13";
    const boot = await mustGetRow(app.db, "world", worldId);
    await updateRow(app.db, "world", worldId, { rules_revision: "balance.v1.13", rules: { ...boot.rules, balance_key: "balance.v1.13" } }, boot.tick);
    actor = await create();
    helper = await create();
    const world = await mustGetRow(app.db, "world", worldId);
    assert.equal(world.rules_revision, "balance.v1.13");
    await updateRow(app.db, "world", worldId, { rules: { ...world.rules, ap_per_tick: 1000 } }, world.tick);
    orgId = (await selectRows(app.db, "bond", "kind = 'member' AND state = 'active' AND a = $1", [actor.id]))[0]!.b;
    assert.deepEqual((await board()).current.rankings, []);
    assert.equal((await board()).previous, null);

    await t.test("missed tide persists deterministic adjacent destination and a non-stacking regional 0.8", async () => {
      await phase(worldEventPhase, rule.period_ticks);
      first = await eventAt(rule.period_ticks);
      assert.equal(first.spawned.length, rule.beast_tide_extra);
      await phase(worldEventPhase, rule.period_ticks + rule.duration_ticks);
      first = await eventAt(rule.period_ticks);
      assert.equal(first.resolution.defeated, false);
      assert.match(first.resolution.message, /没打退.*扩到.*报酬降两成/);
      const origin = await mustGetRow(app.db, "place", first.place_id);
      const candidates: PlaceRow[] = [];
      for (const exit of origin.exits.filter((e) => !e.locked && e.to !== origin.id)) {
        const place = await mustGetRow(app.db, "place", exit.to);
        if (place.combat !== "safe" && place.combat !== "duel") candidates.push(place);
      }
      candidates.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      assert.equal(first.resolution.next_place_id, candidates[0]?.id);
      spreadPlace = await mustGetRow(app.db, "place", first.resolution.next_place_id);
      assert.ok(first.resolution.pressured_regions.includes(spreadPlace.region));
      const state = (await app.db.query<Json>("SELECT * FROM s88_tide_state WHERE realm = $1", [config.realm])).rows[0]!;
      assert.equal(state.reward_bp, 8000);
      await phase(worldEventPhase, rule.period_ticks + rule.duration_ticks);
      assert.equal((await app.db.query<Json>("SELECT reward_bp FROM s88_tide_state WHERE realm = $1", [config.realm])).rows[0]?.reward_bp, 8000);
      reduced = await newOffers(spreadPlace.id);
      assert.equal(reduced.length, 3);
      reducedId = reduced[0]!.id;
      for (const offer of reduced) {
        const template = await mustGetRow(app.db, "task", offer.template_id!) as TaskTemplateRow;
        const base = (balance.numbers as unknown as { task_rewards: { tier: number; tpl: string; coin: number; xp: number; potential: number }[] }).task_rewards.find((r) => r.tier === template.tier && r.tpl === template.tpl)!;
        for (const key of ["coin", "xp", "potential"] as const) assert.equal(offer.reward[key], Math.floor(Math.min(template.reward_spec[key], base[key]) * 8000 / 10000));
      }
      const look = await ok("look", {}, actor.code);
      assert.equal(look.result.place.system_task_reward_bp, 8000);
      const unaffected = (await selectRows(app.db, "place", "region <> ALL($1::text[])", [state.pressured_regions], "ORDER BY id LIMIT 1"))[0];
      assert.ok(unaffected);
      await updateRow(app.db, "char", actor.id, { loc: unaffected.id }, String(rule.period_ticks + rule.duration_ticks));
      assert.equal((await ok("look", {}, actor.code)).result.place.system_task_reward_bp, undefined);
    });

    await t.test("already-unlocked keyed gates still open a realm, announce, reward only the first visitor and stay open", async () => {
      for (const place of await selectRows(app.db, "place", "region = 'neutral' AND kind = 'dungeon'")) {
        await updateRow(app.db, "place", place.id, { exits: place.exits.map((e) => ({ ...e, locked: false })) }, String(rule.period_ticks + rule.duration_ticks));
      }
      await phase(worldEventPhase, 2 * rule.period_ticks);
      const realm = await eventAt(2 * rule.period_ticks);
      assert.equal(realm.kind, "secret_realm");
      const door = realm.spawned[0];
      assert.equal(door.relock, false);
      const gate = await mustGetRow(app.db, "place", realm.place_id);
      const exit = gate.exits.find((e) => e.dir === door.dir)!;
      assert.equal(exit.locked, false);
      assert.ok(exit.key_def);
      await updateRow(app.db, "char", actor.id, { loc: gate.id, tier: 2, vigor: 3000, ap_spent: 0 }, String(2 * rule.period_ticks));
      const entered = await ok("go", { dir: door.dir }, actor.code);
      assert.ok(entered.result.changes.length > 0);
      assert.equal((await app.db.query("SELECT 1 FROM deeds WHERE kind = 'world_event' AND verb = 'go' AND actor = $1", [actor.id])).rows.length, 1);
      await updateRow(app.db, "char", helper.id, { loc: gate.id, tier: 2, vigor: 3000, ap_spent: 0 }, String(2 * rule.period_ticks));
      await ok("go", { dir: door.dir }, helper.code);
      assert.equal((await app.db.query("SELECT 1 FROM deeds WHERE kind = 'world_event' AND verb = 'go' AND actor = $1", [helper.id])).rows.length, 0);
      await phase(worldEventPhase, 2 * rule.period_ticks + rule.duration_ticks);
      assert.equal((await mustGetRow(app.db, "place", gate.id)).exits.find((e) => e.dir === door.dir)?.locked, false);
      const announced = await app.db.query("SELECT 1 FROM events WHERE type = 'world_event' AND scope = 'world' AND data ->> 'open_tick' = $1", [String(2 * rule.period_ticks)]);
      assert.equal(announced.rows.length, 2);
    });

    await t.test("next tide opens next door after reconstructing its context; participant kills restore and score once per org", async () => {
      await phase(worldEventPhase, 3 * rule.period_ticks);
      second = await eventAt(3 * rule.period_ticks);
      assert.equal(second.place_id, spreadPlace.id);
      assert.equal(second.spawned.length, rule.beast_tide_extra);
      for (const id of second.spawned as string[]) {
        const mob = await mustGetRow(app.db, "char", id);
        assert.equal(mob.loc, spreadPlace.id);
        await updateRow(app.db, "char", actor.id, { loc: spreadPlace.id, tier: 9, stage: 4, vigor: 1000000, life: "alive", revive_tick: null, ap_spent: 0 }, String(3 * rule.period_ticks));
        await updateRow(app.db, "char", mob.id, { vigor: 1 }, String(3 * rule.period_ticks));
        await ok("attack", { target: mob.id }, actor.code);
        assert.equal((await mustGetRow(app.db, "char", mob.id)).life, "dead");
      }
      // A revived monster still counts: the predicate is the within-window kill, not life at close.
      await updateRow(app.db, "char", second.spawned[0], { life: "alive", revive_tick: null, vigor: 1 }, String(3 * rule.period_ticks + 1));
      await phase(worldEventPhase, 3 * rule.period_ticks + rule.duration_ticks);
      second = await eventAt(3 * rule.period_ticks);
      assert.equal(second.resolution.defeated, true);
      assert.deepEqual(second.resolution.org_ids, [orgId]);
      assert.match(second.resolution.message, /打退.*恢复/);
      const look = await ok("look", {}, actor.code);
      assert.equal(look.result.place.system_task_reward_bp, undefined);
      assert.equal((await mustGetRow(app.db, "task", reducedId) as TaskInstanceRow).reward.coin, reduced[0]!.reward.coin, "old quoted reward is unchanged");
      for (const region of first.resolution.pressured_regions as string[]) {
        const place = (await selectRows(app.db, "place", "region = $1", [region], "ORDER BY id LIMIT 1"))[0]!;
        await updateRow(app.db, "char", actor.id, { loc: place.id }, String(3 * rule.period_ticks + rule.duration_ticks));
        assert.equal((await ok("look", {}, actor.code)).result.place.system_task_reward_bp, undefined);
      }
      const restored = await newOffers(spreadPlace.id);
      assert.equal(restored.length, 3);
      for (const offer of restored) {
        const template = await mustGetRow(app.db, "task", offer.template_id!) as TaskTemplateRow;
        const base = (balance.numbers as unknown as { task_rewards: { tier: number; tpl: string; coin: number; xp: number; potential: number }[] }).task_rewards.find((r) => r.tier === template.tier && r.tpl === template.tpl)!;
        for (const key of ["coin", "xp", "potential"] as const) assert.equal(offer.reward[key], Math.min(template.reward_spec[key], base[key]));
      }
      const live = await board();
      assert.deepEqual(live.current.rankings.find((r: Json) => r.org_id === orgId), { org_id: orgId, org_name: live.current.rankings[0].org_name, total: 10, beast_tide: 10, bounty: 0, breakthrough: 0 });
      await phase(worldEventPhase, 3 * rule.period_ticks + rule.duration_ticks);
      assert.equal((await board()).current.rankings[0].total, 10);
      const close = (await app.db.query<Json>("SELECT scope, data FROM events WHERE type = 'world_event' AND data ->> 'open_tick' = $1 AND data ->> 'phase' = 'close'", [second.open_tick])).rows[0]!;
      assert.equal(close.scope, "world");
      assert.equal(close.data.task_reward_bp, 10000);
    });

    await t.test("real bounty completion and member breakthrough update JSON / homepage immediately, then settle once", async () => {
      const tick = String(3 * rule.period_ticks + rule.duration_ticks);
      const home = (await mustGetRow(app.db, "char", helper.id)).respawn_place;
      await updateRow(app.db, "char", helper.id, { loc: home, coin: 1000, ap_spent: 0 }, tick);
      await updateRow(app.db, "char", actor.id, { loc: home, tier: 2, stage: 1, ap_spent: 0, xp: 1000000 }, tick);
      const target = (await selectRows(app.db, "char", "kind = 'npc' AND state <> 'buried'", [], "ORDER BY id LIMIT 1"))[0]!;
      await updateRow(app.db, "char", target.id, { loc: home }, tick);
      const bounty = await ok("bounty", { op: "post", condition: { tpl: "find", target: target.id }, reward: { coin: 50, items: [] }, expires_tick: String(Number(tick) + 120) }, helper.code);
      await ok("task", { op: "accept", id: bounty.result.task.id }, actor.code);
      await ok("look", {}, actor.code);
      const paid = await ok("task", { op: "submit", id: bounty.result.task.id }, actor.code);
      assert.equal(paid.result.reward.coin, 50, "player bounty escrow is not regionally reduced");
      assert.equal((await board()).current.rankings[0].bounty, 3);
      assert.equal((await board()).current.rankings[0].total, 13);
      const inner = (await app.db.query<{ id: string }>("SELECT s.id FROM skills s JOIN skills d ON d.id = s.def_id WHERE s.record = 'learned' AND s.char_id = $1 AND d.key = 'inner'", [actor.id])).rows[0]!;
      await updateRow(app.db, "skill", inner.id, { level: 12, cap: 12 }, tick);
      const grown = await ok("breakthrough", { mode: "stage" }, actor.code);
      assert.equal(grown.result.outcome, "success");
      const live = await board();
      assert.deepEqual(live.current.rankings[0], { org_id: orgId, org_name: live.current.rankings[0].org_name, total: 15, beast_tide: 10, bounty: 3, breakthrough: 2 });
      assert.notEqual(live.current.rankings[0].org_name, (await mustGetRow(app.db, "org", orgId)).content_key);
      const homepage = await fetch(`${app.url}/`, { headers: { Accept: "text/markdown" } });
      const markdown = await homepage.text();
      assert.match(markdown, /本周组织榜/);
      assert.match(markdown, /15 分/);
      assert.match(markdown, /\/v1\/weekly/);
      const head = (await mustGetRow(app.db, "world", worldId)).deed_head;
      assert.equal(await organizationAt(app.db, actor.id, tick, head), orgId);
      // Leaving later in the same tick cannot move the just-earned points to the new org.
      const joinedDeed = (await selectRows(app.db, "deed", "kind = 'stage_up' AND actor = $1", [actor.id], "ORDER BY seq DESC LIMIT 1"))[0]!;
      await app.db.tx(async (q) => {
        const member = (await selectRows(q, "bond", "kind = 'member' AND a = $1 AND state = 'active'", [actor.id]))[0]!;
        const writer = new Writer(q, config.realm, tick, world.rules_revision, true);
        const change = await writer.update("bond", member.id, { state: "ended", ended_tick: tick });
        await writer.deed({ actor: actor.id, verb: "use", kind: "org_leave", targets: [orgId], place_id: home, result: { outcome: "success", changes: change === null ? [] : [change], roll: null, proposal: null }, visibility: "self", participants: [actor.id] });
      });
      assert.equal(await organizationAt(app.db, actor.id, tick, joinedDeed.seq), orgId);
      assert.equal((await board()).current.rankings[0].total, 15);
      await phase(orgGoalPhase, balance.numbers.clock.week_ticks);
      await phase(orgGoalPhase, balance.numbers.clock.week_ticks);
      const after = await board();
      assert.deepEqual(after.current.rankings, []);
      assert.equal(after.previous.settled, true);
      assert.deepEqual(after.previous.rankings, live.current.rankings);
      const results = await app.db.query<Json>("SELECT d.visibility, d.kind, d.result FROM s88_weekly_results s JOIN deeds d ON d.id = s.deed_id WHERE s.realm = $1 AND s.week = 0", [config.realm]);
      assert.equal(results.rows.length, 1);
      assert.equal(results.rows[0].visibility, "world");
      assert.equal(results.rows[0].kind, "org_goal");
      assert.equal(results.rows[0].result.weekly.rankings[0].total, 15);
      assert.match(results.rows[0].result.weekly.message, /周组织榜结算/);
      const chronicle = await fetch(`${app.url}/chronicle`, { headers: { Accept: "text/markdown" } });
      assert.ok((await chronicle.text()).includes(orgId), "settlement deed appears in the public chronicle");
    });
  } finally {
    await app.close();
  }
});
