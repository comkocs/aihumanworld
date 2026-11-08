import assert from "node:assert/strict";
import { test } from "node:test";
import { startApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { mustGetRow } from "../src/facts/store.ts";
import type { TaskInstanceRow } from "../src/facts/types.ts";
import { Writer } from "../src/facts/writer.ts";
import { setQuiet } from "../src/log.ts";
import { BRIEFING_MAX_BYTES, BRIEFING_SPEECH_MAX } from "../src/verbs/briefing.ts";

type Json = any;

test("S87: offline facts once, both resume paths, bounded speech and MCP forwarding", async () => {
  setQuiet(true);
  const config = await loadConfig({ ...process.env, AIHW_DB_DRIVER: "pglite", AIHW_PGLITE_DIR: "memory", AIHW_PORT: "0" });
  config.clock.enabled = false;
  const app = await startApp(config);
  try {
    const call = async (verb: string, args: object, code?: string): Promise<Json> => {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (code !== undefined) headers.Authorization = `Bearer ${code}`;
      const response = await fetch(`${app.url}/v1/actions/${verb}`, { method: "POST", headers, body: JSON.stringify({ args }) });
      return response.json();
    };
    const tick = async (value: number): Promise<void> => {
      await app.db.query("UPDATE worlds SET tick = $1, tick_started_at = $2", [String(value), new Date().toISOString()]);
    };
    const A = await call("enter", { mode: "create", skin: "xiuxian", door: "api" });
    const B = await call("enter", { mode: "create", skin: "xiuxian", door: "api" });
    assert.equal(A.ok, true);
    assert.equal(B.ok, true);
    const me: string = A.result.char.id;
    const other: string = B.result.char.id;
    const code: string = A.result.identity_code;
    const codeB: string = B.result.identity_code;
    const place: string = A.result.char.loc;
    const realm = config.realm;
    const worldRow = (await app.db.query<{ id: string }>("SELECT id FROM worlds WHERE realm = $1", [realm])).rows[0]!;
    assert.ok(worldRow.id);
    const email = "s87@example.test";
    const bind = await call("enter", { mode: "resume", email }, code);
    assert.equal(bind.ok, true);
    assert.ok(bind.result.briefing, "resume does not need a >10 tick gap");
    assert.equal(Object.hasOwn(A.result, "briefing"), false, "create has no offline interval");
    assert.equal((await call("look", {}, code)).briefing, undefined);

    await tick(1);
    const line = "等你回来，一起接悬赏。";
    assert.equal((await call("say", { target: me, text: line }, codeB)).ok, true);
    let bountyId = "";
    let unrelatedId = "";
    let orgId = "";
    await app.db.tx(async (q) => {
      const world = await mustGetRow(q, "world", worldRow.id);
      const w = new Writer(q, realm, world.tick, world.rules_revision, true);
      const membership = (await q.query<{ b: string }>("SELECT b FROM bonds WHERE kind = 'member' AND a = $1 AND state = 'active'", [me])).rows[0]!;
      orgId = membership.b;
      const org = await mustGetRow(q, "org", orgId);
      await w.update("org", orgId, { goal: { ...org.goal, target: 5, progress: 2, member_ids: [me], settled: false } });
      for (const kind of ["mentor", "ally", "enemy"] as const) {
        const bond = { id: await w.newId("bond"), created_tick: world.tick, updated_tick: world.tick,
          kind, a: kind === "ally" ? me : other, b: kind === "ally" ? other : me,
          state: "active" as const, weight: 0, rank: null, since_tick: world.tick, ended_tick: null };
        await w.insert("bond", bond);
        await w.emit({ scope: "self", recipients: [me, other], type: "bond_changed", deed_id: null, data: { bond } });
      }
      const task: TaskInstanceRow = {
        id: await w.newId("task"), created_tick: world.tick, updated_tick: world.tick,
        record: "instance", template_id: null, kind: "bounty", tpl: "slay", issuer: { kind: "char", id: other },
        offer_place: place, eligible_char: me, issuer_tier: 1, taker: me,
        condition: { tpl: "slay", target: null, archetype: "monster", tier: 1, count: 1 },
        reward: { coin: 1, xp: 0, potential: 0, rep: 0, items: [] }, escrow: { coin: 1, items: [] },
        state: "accepted", accepted_seq: "0", progress: { count: 0, evidence: [] }, expires_tick: "1000", note: null,
      };
      bountyId = task.id;
      await w.insert("task", task);
      await w.emit({ scope: "self", recipients: [me, other], type: "task_changed", deed_id: null,
        data: { task_id: task.id, state: "accepted", taker: me, progress: 0 } });
      unrelatedId = await w.newId("task");
      await w.insert("task", { ...task, id: unrelatedId, eligible_char: other, taker: other });
      await w.emit({ scope: "self", recipients: [other], type: "task_changed", deed_id: null,
        data: { task_id: unrelatedId, state: "accepted", taker: other, progress: 0 } });
      const deed = await w.deed({ actor: other, verb: "attack", kind: "combat_win", targets: [me], place_id: place,
        result: { outcome: "success", changes: [], roll: null, proposal: null }, visibility: "place", participants: [me, other] });
      await w.emit({ scope: "self", recipients: [me, other], type: "combat_resolved", deed_id: deed.id,
        data: { attacker: other, target: me, winner: other, mode: "pk", outcome: "win", dead: [me], deed_id: deed.id } });
      for (const [from, to] of [["alive", "dead"], ["dead", "alive"]] as const) {
        await w.emit({ scope: "self", recipients: [me], type: "life_changed", deed_id: deed.id,
          data: { char_id: me, from, to, place_id: place, revive_tick: to === "dead" ? "2" : null } });
      }
      const spawned = [`${realm}:char:s87-tide-1`, `${realm}:char:s87-tide-2`];
      await q.query("INSERT INTO s72_world_events (open_tick, close_tick, kind, place_id, tier, state, spawned) VALUES (1, 2, 'beast_tide', $1, 1, 'closed', $2::jsonb)", [place, JSON.stringify(spawned)]);
      await w.emit({ scope: "world", type: "world_event", deed_id: null,
        data: { kind: "beast_tide", phase: "open", place_id: place, tier: 1, open_tick: "1", until_tick: "2" } });
      await w.emit({ scope: "place", place_id: place, type: "life_changed", deed_id: deed.id,
        data: { char_id: spawned[0]!, from: "alive", to: "dead", place_id: place, revive_tick: null } });
    });
    await tick(2);
    await app.db.tx(async (q) => {
      const world = await mustGetRow(q, "world", worldRow.id);
      const w = new Writer(q, realm, world.tick, world.rules_revision, true);
      const deed = await w.deed({ actor: null, verb: "clock", kind: "world_event", targets: [place], place_id: place,
        result: { outcome: "success", changes: [], roll: null, proposal: null }, visibility: "world", participants: [] });
      await w.emit({ scope: "world", type: "world_event", deed_id: deed.id,
        data: { kind: "beast_tide", phase: "close", place_id: place, tier: 1, open_tick: "1", until_tick: "2" } });
      await w.update("task", bountyId, { state: "completed", progress: { count: 1, evidence: [] } });
      await w.emit({ scope: "self", recipients: [me, other], type: "task_changed", deed_id: null,
        data: { task_id: bountyId, state: "completed", taker: me, progress: 1 } });
    });
    await tick(10);
    const seen = (await app.db.query<{ last_seen_tick: string }>("SELECT last_seen_tick FROM chars WHERE id = $1", [me])).rows[0]!;
    assert.equal(seen.last_seen_tick, "0", "fixture leaves A offline");
    // Exactly 10 ticks is not offline enough; a rejected request does not move the boundary.
    const badArgs = await call("look", { not_a_field: true }, code);
    assert.equal(badArgs.ok, false);
    assert.equal(badArgs.briefing, undefined);
    await tick(11);
    const rejected = await call("look", {}, "not-a-code");
    assert.equal(rejected.ok, false);
    assert.equal(rejected.briefing, undefined);
    const back = await call("look", {}, code);
    assert.equal(back.ok, true);
    const brief = back.briefing;
    assert.deepEqual([brief.from_tick, brief.to_tick], ["0", "11"]);
    assert.equal(brief.speech.total, 1);
    assert.equal(brief.speech.items[0].other_speech, line);
    assert.equal(brief.speech.items[0].from, other);
    assert.equal(brief.speech.items[0].from_handle, B.result.char.handle);
    assert.equal(brief.speech.items[0].speech_status, "available");
    assert.equal(back.new_speech[0].other_speech, line, "S46 stays independent");
    assert.equal(brief.relations.total, 3);
    assert.ok(brief.relations.items.some((x: Json) => x.bond.a === other && x.bond.b === me));
    assert.equal(brief.organization.items[0].org_id, orgId);
    assert.equal(brief.organization.items[0].goal.progress, 2);
    assert.equal(brief.world_events.total, 2);
    assert.deepEqual(brief.world_events.items.map((e: Json) => e.phase).sort(), ["close", "open"]);
    assert.deepEqual(brief.world_events.items.find((e: Json) => e.phase === "close").result,
      { outcome: "success", changed_facts: 0, spawned: 2, defeated: 1 });
    assert.equal(brief.bounties.total, 2);
    assert.equal(brief.bounties.items[0].state, "completed");
    assert.equal(JSON.stringify(brief).includes(unrelatedId), false);
    assert.equal(brief.life.total, 2);
    assert.deepEqual(brief.life.items.map((e: Json) => e.to).sort(), ["alive", "dead"]);
    assert.equal(brief.attacks.total, 1);
    assert.equal(brief.attacks.items[0].attacker, other);
    assert.ok(Buffer.byteLength(JSON.stringify(brief)) <= BRIEFING_MAX_BYTES);
    assert.equal((await call("look", {}, code)).briefing, undefined);
    assert.equal((await call("enter", { mode: "resume" }, code)).result.briefing, undefined, "same interval cannot be replayed via resume");

    await tick(12);
    const second = "悬赏已结，等你来领。";
    assert.equal((await call("say", { target: me, text: second }, codeB)).ok, true);
    const resumed = await call("enter", { mode: "resume" }, code);
    assert.equal(resumed.ok, true);
    assert.deepEqual([resumed.result.briefing.from_tick, resumed.result.briefing.to_tick], ["11", "12"]);
    assert.equal(resumed.result.briefing.speech.items[0].other_speech, second);
    assert.equal(resumed.result.briefing.life, undefined, "old categories are absent");
    assert.equal((await call("look", {}, code)).briefing, undefined);

    await tick(13);
    const third = "短号续玩也能看到这句。";
    assert.equal((await call("say", { target: me, text: third }, codeB)).ok, true);
    const byHandle = await call("enter", { mode: "resume", handle: A.result.char.handle, email });
    assert.equal(byHandle.ok, true);
    assert.equal(byHandle.result.briefing.speech.items[0].other_speech, third);
    assert.equal(byHandle.new_speech[0].other_speech, third);
    assert.equal((await call("look", {}, code)).briefing, undefined);

    for (let i = 0; i < BRIEFING_SPEECH_MAX + 2; i += 1) {
      await tick(14 + i);
      const spoken = await call("say", { target: me, text: `第${i}条，${"江湖见。".repeat(30)}` }, codeB);
      assert.equal(spoken.ok, true, JSON.stringify(spoken.error));
    }
    await tick(28);
    const response = await fetch(`${app.url}/mcp`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "whoami", arguments: { code } } }) });
    const mcp = await response.json() as Json;
    const packed = mcp.result.structuredContent;
    assert.equal(packed.ok, true);
    assert.equal(mcp.result.content[0].text, JSON.stringify(packed));
    assert.equal(packed.briefing.speech.total, BRIEFING_SPEECH_MAX + 2);
    assert.equal(packed.briefing.speech.items.length, BRIEFING_SPEECH_MAX);
    assert.ok(packed.briefing.speech.items.some((s: Json) => s.text_truncated));
    assert.ok(Buffer.byteLength(JSON.stringify(packed.briefing)) <= BRIEFING_MAX_BYTES);
    assert.equal(packed.new_speech.length, 5);
    assert.equal((await call("whoami", {}, code)).briefing, undefined);

    await tick(38);
    assert.equal((await call("whoami", {}, code)).briefing, undefined, "gap of exactly 10 ticks does not trigger");
    await tick(49);
    const empty = await call("whoami", {}, code);
    assert.ok(empty.briefing);
    assert.equal(empty.briefing.speech, undefined);
    assert.equal(empty.briefing.world_events, undefined);
  } finally {
    await app.close();
  }
});
