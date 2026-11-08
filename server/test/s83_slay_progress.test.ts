// S83: a slay task shows each matching kill immediately, emits task_changed,
// and still submits against combat facts, including a monster ambush counter-kill.

import assert from "node:assert/strict";
import { test } from "node:test";
import { startApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { insertRow, mustGetRow, updateRow } from "../src/facts/store.ts";
import type { CharRow, TaskInstanceRow, TaskTemplateRow } from "../src/facts/types.ts";
import { Writer } from "../src/facts/writer.ts";
import { setQuiet } from "../src/log.ts";
import { ambush } from "../src/npc/ambush.ts";
import { recordSlayEvidence, slayEvidence } from "../src/tasks/evidence.ts";

type Json = any;

test("S83: slay progress is immediate, matching, capped and deduplicated; ambush counter-kills also submit", async () => {
  setQuiet(true);
  const config = await loadConfig({ ...process.env, AIHW_DB_DRIVER: "pglite", AIHW_PGLITE_DIR: "memory", AIHW_PORT: "0" });
  config.clock.enabled = false;
  const app = await startApp(config);
  try {
    const invoke = async (verb: string, args: object, bearer: string | null): Promise<Json> =>
      (await app.dispatch({ verb, body: { args }, bearer, door: "api" })).body;
    const entered = await invoke("enter", { mode: "create", skin: "xiuxian", door: "api", class: null }, null);
    assert.equal(entered.ok, true);
    const hunter = { id: entered.result.char.id as string, code: entered.result.identity_code as string };
    const ok = async (verb: string, args: object): Promise<Json> => {
      const body = await invoke(verb, args, hunter.code);
      assert.equal(body.ok, true, `${verb}: ${JSON.stringify(body.error)}`);
      return body;
    };
    const world = await mustGetRow(app.db, "world", "r1:world:main");
    const base = await mustGetRow(app.db, "char", hunter.id);
    const place = "r1:place:xiuxian_landmark_ash_altar";
    const peer = "r1:char:s83_peer";
    const other = "r1:char:s83_other";
    const wrongTier = "r1:char:s83_wrong_tier";
    const monster = (id: string, tier: number): CharRow => ({
      ...base, id, kind: "npc", door: null, handle: null, email_hash: null, model: null,
      body: "beast", archetype: "monster", tier, stage: 1, life: "alive", state: "active", vigor: 1,
      loc: place, respawn_place: place, patrol_route: [], patrol_index: 0, xp: 0, potential: 0,
    });
    await app.db.tx(async (q) => {
      await insertRow(q, "char", monster(peer, 1));
      await insertRow(q, "char", monster(other, 1));
      await insertRow(q, "char", monster(wrongTier, 2));
      await updateRow(q, "char", hunter.id, { loc: place }, world.tick);
      await updateRow(q, "world", world.id, { rules: { ...world.rules, ap_per_tick: 1000 } }, world.tick);
    });
    const offer = async (local: string, condition: TaskInstanceRow["condition"]): Promise<string> => {
      const template: TaskTemplateRow = {
        id: `r1:task:s83_tpl_${local}`, created_tick: world.tick, updated_tick: world.tick,
        record: "template", content_key: `content.r1.task.s83_${local}`, tpl: "slay", tier: 1, stage: 1, condition,
        reward_spec: { coin: 0, xp: 0, potential: 0, rep: 0, item_defs: [] }, duration_ticks: 1440, by: null, note: null,
      };
      await insertRow(app.db, "task", template);
      const row: TaskInstanceRow = {
        id: `r1:task:s83_${local}`, created_tick: world.tick, updated_tick: world.tick,
        record: "instance", template_id: template.id, kind: "system", tpl: "slay",
        issuer: { kind: "system", id: world.id }, offer_place: place, eligible_char: hunter.id,
        issuer_tier: null, taker: null, condition,
        reward: { coin: 0, xp: 0, potential: 0, rep: 0, items: [] }, escrow: { coin: 0, items: [] },
        state: "open", accepted_seq: null, progress: { count: 0, evidence: [] },
        expires_tick: (BigInt(world.tick) + 1440n).toString(), note: null,
      };
      await insertRow(app.db, "task", row);
      return row.id;
    };
    const task = async (id: string): Promise<TaskInstanceRow> => {
      const row = await mustGetRow(app.db, "task", id);
      assert.equal(row.record, "instance");
      return row as TaskInstanceRow;
    };
    const listed = async (id: string): Promise<TaskInstanceRow> => {
      const list = await ok("task", { op: "list", filter: "accepted" });
      const row = list.result.rows.find((t: Json) => t.id === id);
      assert.ok(row, `accepted task ${id} is listed`);
      return row;
    };
    const changed = async (id: string): Promise<Json[]> => (await app.db.query<Json>(
      "SELECT e.deed_id, e.tick, e.data FROM event_inbox i JOIN events e ON e.cursor = i.cursor " +
        "WHERE i.char_id = $1 AND e.type = 'task_changed' AND e.data->>'task_id' = $2 " +
        "AND (e.data->>'progress')::int > 0 ORDER BY e.cursor",
      [hunter.id, id],
    )).rows;
    const kill = async (id: string): Promise<string> => {
      await updateRow(app.db, "char", id, { vigor: 1, life: "alive", revive_tick: null, loc: place, state: "active" }, world.tick);
      await updateRow(app.db, "char", hunter.id, { vigor: 1000000, ap_spent: 0 }, world.tick);
      const result = await ok("attack", { target: id });
      assert.equal(result.result.outcome, "win");
      assert.equal((await mustGetRow(app.db, "char", id)).life, "dead");
      return result.result.deed_id;
    };

    // Wrong-tier kills do not count. A matching kill is visible without submitting,
    // and another matching kill cannot raise the completed progress or emit again.
    const generic = await offer("generic", { tpl: "slay", target: null, archetype: "monster", tier: 1, count: 1 });
    const unaccepted = await offer("unaccepted", { tpl: "slay", target: null, archetype: "monster", tier: 1, count: 1 });
    await ok("task", { op: "accept", id: generic });
    await kill(wrongTier);
    assert.deepEqual((await listed(generic)).progress, { count: 0, evidence: [] });
    assert.equal((await changed(generic)).length, 0);
    const first = await kill(peer);
    const live = (await listed(generic)).progress;
    assert.deepEqual(live, { count: 1, evidence: [first] });
    const event = await changed(generic);
    assert.equal(event.length, 1);
    assert.equal(event[0].deed_id, first);
    assert.equal(event[0].data.progress, 1);
    assert.equal(event[0].data.state, "accepted");
    assert.equal(event[0].tick, (await mustGetRow(app.db, "deed", first)).tick);
    assert.deepEqual((await task(unaccepted)).progress, { count: 0, evidence: [] });
    await kill(other);
    assert.deepEqual((await listed(generic)).progress, live);
    assert.equal((await changed(generic)).length, 1);
    const submitted = await ok("task", { op: "submit", id: generic });
    assert.equal(submitted.result.task.state, "completed");
    assert.deepEqual(submitted.result.task.progress, live);

    // A target ID takes precedence over archetype. Two kills of that target are
    // distinct evidence; replaying the first deed while still below the cap is not.
    const targeted = await offer("targeted", { tpl: "slay", target: peer, archetype: "tutorial_opponent", tier: 1, count: 2 });
    await ok("task", { op: "accept", id: targeted });
    await kill(other);
    assert.deepEqual((await task(targeted)).progress, { count: 0, evidence: [] });
    const targetFirst = await kill(peer);
    await app.db.tx(async (q) => {
      const current = await mustGetRow(q, "world", world.id, { lock: true });
      const w = new Writer(q, current.realm, current.tick, current.rules_revision, true);
      const char = await mustGetRow(q, "char", hunter.id);
      const deed = await mustGetRow(q, "deed", targetFirst);
      assert.deepEqual(await recordSlayEvidence({ q, w, tick: current.tick }, char, deed), []);
      const older = await mustGetRow(q, "deed", first);
      assert.deepEqual(await recordSlayEvidence({ q, w, tick: current.tick }, char, older), []);
    });
    assert.deepEqual((await task(targeted)).progress, { count: 1, evidence: [targetFirst] });
    assert.equal((await changed(targeted)).length, 1);
    const targetSecond = await kill(peer);
    const targetProgress = (await listed(targeted)).progress;
    assert.deepEqual(targetProgress, { count: 2, evidence: [targetFirst, targetSecond] });
    assert.deepEqual(await slayEvidence(app.db, await mustGetRow(app.db, "char", hunter.id), await task(targeted)), targetProgress.evidence);
    const targetDone = await ok("task", { op: "submit", id: targeted });
    assert.equal(targetDone.result.task.state, "completed");
    assert.deepEqual(targetDone.result.task.progress, targetProgress);

    const expired = await offer("expired", { tpl: "slay", target: null, archetype: "monster", tier: 1, count: 1 });
    await ok("task", { op: "accept", id: expired });
    await updateRow(app.db, "task", expired, { expires_tick: world.tick }, world.tick);
    await kill(peer);
    assert.deepEqual((await task(expired)).progress, { count: 0, evidence: [] });
    assert.equal((await changed(expired)).length, 0);

    // An ambush deed belongs to the monster (combat_loss), while its roll inputs
    // lead with the participant. Live progress and submit must agree on this fact.
    const counterTask = await offer("counter", { tpl: "slay", target: null, archetype: "monster", tier: 1, count: 1 });
    await ok("task", { op: "accept", id: counterTask });
    const balance = structuredClone(app.services.balance());
    Object.assign(balance.numbers.npc, { ambush_interval_ticks: 1, ambush_chance_bp: 10000 });
    const counterTick = (BigInt(world.tick) + BigInt(balance.numbers.combat.newbie_protect_ticks ?? 0) + 1n).toString();
    await app.db.tx(async (q) => {
      const current = await mustGetRow(q, "world", world.id, { lock: true });
      await updateRow(q, "world", current.id, { tick: counterTick }, counterTick);
      await updateRow(q, "place", place, { danger: "high", tier: 1 }, counterTick);
      await updateRow(q, "char", hunter.id, { vigor: 1000000, ap_spent: 0, last_seen_tick: counterTick }, counterTick);
      await updateRow(q, "char", peer, { vigor: 1, life: "alive", revive_tick: null }, counterTick);
      const w = new Writer(q, current.realm, counterTick, current.rules_revision, true);
      await ambush({ q, w, world: { ...current, tick: counterTick }, rules: current.rules, balance,
        from_tick: (BigInt(counterTick) - 1n).toString(), to_tick: counterTick, now: new Date() }, await mustGetRow(q, "char", peer));
    });
    assert.equal((await mustGetRow(app.db, "char", peer)).life, "dead");
    const counterProgress = (await listed(counterTask)).progress;
    assert.equal(counterProgress.count, 1);
    assert.equal(counterProgress.evidence.length, 1);
    const counterDeed = await mustGetRow(app.db, "deed", counterProgress.evidence[0]!);
    assert.equal(counterDeed.actor, peer);
    assert.equal(counterDeed.kind, "combat_loss");
    assert.equal(counterDeed.result.roll?.inputs.actor.char_id, hunter.id);
    assert.equal(counterDeed.result.roll?.inputs.target?.char_id, peer);
    const counterEvents = await changed(counterTask);
    assert.equal(counterEvents.length, 1);
    assert.equal(counterEvents[0].deed_id, counterDeed.id);
    assert.equal(counterEvents[0].tick, counterTick);
    assert.deepEqual(await slayEvidence(app.db, await mustGetRow(app.db, "char", hunter.id), await task(counterTask)), counterProgress.evidence);
    const counterDone = await ok("task", { op: "submit", id: counterTask });
    assert.equal(counterDone.result.task.state, "completed");
    assert.deepEqual(counterDone.result.task.progress, counterProgress);
  } finally {
    await app.close();
  }
});
