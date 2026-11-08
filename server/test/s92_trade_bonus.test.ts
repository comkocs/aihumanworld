// S92: speech pays nothing; four completed exchanges pay both participants once.
import assert from "node:assert/strict";
import { test } from "node:test";
import { startApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { insertRow, mustGetRow, selectRows, updateRow } from "../src/facts/store.ts";
import type { CharRow, ItemInstanceRow } from "../src/facts/types.ts";
import { Writer } from "../src/facts/writer.ts";
import { setQuiet } from "../src/log.ts";
import { ambush } from "../src/npc/ambush.ts";

type Json = any;

test("S92: 30 ticks of speech, four bilateral exchanges, durable dedupe, coin returns and NPC exclusion", async () => {
  setQuiet(true);
  const config = await loadConfig({ ...process.env, AIHW_DB_DRIVER: "pglite", AIHW_PGLITE_DIR: "memory", AIHW_PORT: "0" });
  config.clock.enabled = false;
  const app = await startApp(config);
  try {
    const call = async (verb: string, args: object, bearer: string | null = null): Promise<Json> => {
      const r = (await app.dispatch({ verb, body: { args }, bearer, door: "api" })).body as Json;
      assert.equal(r.ok, true, `${verb}: ${JSON.stringify(r.error)}`);
      return r;
    };
    const join = async () => {
      const r = await call("enter", { mode: "create", skin: "xiuxian", door: "api" });
      return { id: r.result.char.id as string, code: r.result.identity_code as string };
    };
    const a = await join();
    const b = await join();
    const c = await join();
    const world = await mustGetRow(app.db, "world", "r1:world:main");
    const place = (await mustGetRow(app.db, "char", a.id)).loc;
    await updateRow(app.db, "world", world.id, { rules: { ...world.rules, ap_per_tick: 1000 } }, world.tick);
    const row = (id: string) => mustGetRow(app.db, "char", id);
    const growth = async () => Promise.all([a, b].map(async (p) => { const r = await row(p.id); return [r.xp, r.potential]; }));
    const beforeTalk = await growth();
    for (let i = 0; i < 30; i += 1) {
      await app.db.query("UPDATE worlds SET tick = tick + 1");
      await call("say", { text: "短句甲", target: b.id }, a.code);
      await call("say", { text: "短句乙", target: a.id }, b.code);
    }
    assert.deepEqual(await growth(), beforeTalk);
    assert.equal((await app.db.query("SELECT 1 FROM deeds WHERE kind = 'discourse'")).rows.length, 0, "no 初识 reward or deed");
    const n = app.services.balance().numbers;
    const t = n.tiers[0]!;
    const bonus = { xp: Math.floor(t.task_xp * 2000 / 10000), potential: Math.floor(t.task_potential * 2000 / 10000) };
    const checkBoth = async (act: () => Promise<Json>, expected = bonus): Promise<Json> => {
      const before = await growth();
      const r = await act();
      const after = await growth();
      for (let i = 0; i < 2; i += 1) assert.deepEqual(after[i]!.map((v, j) => v - before[i]![j]!), [expected.xp, expected.potential]);
      return r;
    };
    const checkTradeReward = async (r: Json, actor: string, kind: string) => {
      const events = await app.db.query<Json>("SELECT data->'reward' AS reward FROM events WHERE deed_id = $1 AND type = 'reward_granted' AND data->>'char_id' = $2 AND data->'trade'->>'kind' = $3 AND data->'trade'->>'key' NOT LIKE '%journal:%'", [r.deed_ids[0], actor, kind]);
      assert.equal(events.rows.length, 1);
      assert.deepEqual(r.result.trade_reward, { xp: events.rows[0]!.reward.xp, potential: events.rows[0]!.reward.potential });
    };
    const def = (await selectRows(app.db, "item", "record = 'definition' AND kind = 'blade' AND tier = 1 AND grade = 1"))[0];
    assert.ok(def?.record === "definition");
    const item: ItemInstanceRow = {
      id: "r1:item:s92_gift", created_tick: world.tick, updated_tick: world.tick,
      record: "instance", def_id: def.id, holder: { kind: "char", id: a.id }, state: "available", equipped: false,
      dura: def.dura_max, sockets: Array.from({ length: def.slots }, () => null), note: null,
    };
    await insertRow(app.db, "item", item);
    const gift = await checkBoth(() => call("give", { target: b.id, asset: { kind: "item", item: item.id } }, a.code));
    assert.ok(gift.result.changes.some((x: Json) => x.id === a.id && x.after.xp !== undefined));
    await checkTradeReward(gift, a.id, "give_item");
    const beforeSecondHand = await Promise.all([b, c].map(async (p) => { const r = await row(p.id); return [r.xp, r.potential]; }));
    const secondHand = await call("give", { target: c.id, asset: { kind: "item", item: item.id } }, b.code);
    assert.deepEqual(await Promise.all([b, c].map(async (p) => { const r = await row(p.id); return [r.xp, r.potential]; })), beforeSecondHand);
    assert.equal(Object.hasOwn(secondHand.result, "trade_reward"), false);
    assert.equal((await app.db.query("SELECT 1 FROM events WHERE deed_id = $1 AND data->'trade'->>'kind' = 'give_item'", [secondHand.deed_ids[0]])).rows.length, 0);
    await call("give", { target: a.id, asset: { kind: "item", item: item.id } }, c.code);
    await checkBoth(() => call("give", { target: b.id, asset: { kind: "item", item: item.id } }, a.code), { xp: 0, potential: 0 });

    await updateRow(app.db, "char", a.id, { coin: 10000 }, world.tick);
    const tooSmall = await checkBoth(() => call("give", { target: b.id, asset: { kind: "coin", amount: 1 } }, a.code), { xp: 0, potential: 0 });
    assert.equal(Object.hasOwn(tooSmall.result, "trade_reward"), false);
    await checkBoth(() => call("give", { target: a.id, asset: { kind: "coin", amount: 1 } }, b.code), { xp: 0, potential: 0 });
    const coinTrade = await checkBoth(() => call("give", { target: b.id, asset: { kind: "coin", amount: 101 } }, a.code));
    await checkTradeReward(coinTrade, a.id, "give_coin");
    await checkBoth(() => call("give", { target: a.id, asset: { kind: "coin", amount: 101 } }, b.code), { xp: 0, potential: 0 });
    await checkBoth(() => call("give", { target: b.id, asset: { kind: "coin", amount: 101 } }, a.code), { xp: 0, potential: 0 });
    const partial = await checkBoth(() => call("give", { target: b.id, asset: { kind: "coin", amount: 10 } }, a.code), { xp: 6, potential: 0 });
    await checkTradeReward(partial, a.id, "give_coin");
    const cheapDef = (await selectRows(app.db, "item", "record = 'definition' AND kind = 'ore' AND tier = 1 AND grade = 1"))[0];
    assert.ok(cheapDef?.record === "definition");
    const cheapItem = { ...item, id: "r1:item:s92_cheap", def_id: cheapDef.id, dura: 0, sockets: [] };
    await insertRow(app.db, "item", cheapItem);
    await checkBoth(() => call("give", { target: b.id, asset: { kind: "item", item: cheapItem.id } }, a.code), { xp: 0, potential: 0 });
    await updateRow(app.db, "char", c.id, { tier: 1 }, world.tick);
    const cheapBefore = await Promise.all([b, c].map(async (p) => { const r = await row(p.id); return [r.xp, r.potential]; }));
    await call("give", { target: c.id, asset: { kind: "item", item: cheapItem.id } }, b.code);
    assert.deepEqual(await Promise.all([b, c].map(async (p) => { const r = await row(p.id); return [r.xp, r.potential]; })), cheapBefore);

    // Every giver's total net outflow returns to its previous level after one circuit.
    await updateRow(app.db, "char", c.id, { coin: 10000 }, world.tick);
    const circuit = async () => [
      await call("give", { target: b.id, asset: { kind: "coin", amount: 30 } }, a.code),
      await call("give", { target: c.id, asset: { kind: "coin", amount: 30 } }, b.code),
      await call("give", { target: a.id, asset: { kind: "coin", amount: 30 } }, c.code),
    ];
    await circuit();
    const beforeCircuit = await Promise.all([a, b, c].map(async (p) => { const r = await row(p.id); return [r.xp, r.potential]; }));
    const secondCircuit = await circuit();
    assert.deepEqual(await Promise.all([a, b, c].map(async (p) => { const r = await row(p.id); return [r.xp, r.potential]; })), beforeCircuit);
    for (const transfer of secondCircuit) {
      const paid = await app.db.query<Json>("SELECT data->'reward' AS reward FROM events WHERE deed_id = $1 AND type = 'reward_granted' AND data->'trade'->>'kind' = 'give_coin'", [transfer.deed_ids[0]]);
      assert.ok(paid.rows.length > 0);
      assert.ok(paid.rows.every((e) => e.reward.xp === 0 && e.reward.potential === 0));
      assert.equal(Object.hasOwn(transfer.result, "trade_reward"), false);
    }

    const current = await mustGetRow(app.db, "world", world.id);
    const post = await call("bounty", { op: "post", condition: { tpl: "reach", mode: "tier", tier: 1, stage: 1 }, reward: { coin: 100, items: [] }, expires_tick: (BigInt(current.tick) + 120n).toString() }, a.code);
    await call("task", { op: "accept", id: post.result.task.id }, b.code);
    const bountyTrade = await checkBoth(() => call("task", { op: "submit", id: post.result.task.id }, b.code));
    await checkTradeReward(bountyTrade, b.id, "bounty");
    assert.equal(bountyTrade.result.reward.coin, 100);
    const again = (await app.dispatch({ verb: "task", body: { args: { op: "submit", id: post.result.task.id } }, bearer: b.code, door: "api" })).body as Json;
    assert.equal(again.ok, false);
    assert.equal(again.error.code, "TASK_STATE");

    const skill = (await selectRows(app.db, "skill", "record = 'definition' AND key = 'inner'"))[0];
    assert.ok(skill?.record === "definition");
    await updateRow(app.db, "char", b.id, { tier: 2, kind: "official" }, current.tick);
    const teacher = (await selectRows(app.db, "skill", "record = 'learned' AND char_id = $1 AND def_id = $2", [b.id, skill.id]))[0];
    assert.ok(teacher?.record === "learned");
    await updateRow(app.db, "skill", teacher.id, { level: 16, cap: 16 }, current.tick);
    await insertRow(app.db, "bond", { id: "r1:bond:s92_mentor", created_tick: current.tick, updated_tick: current.tick, kind: "mentor", a: b.id, b: a.id, state: "active", weight: 0, rank: null, since_tick: current.tick, ended_tick: null });
    const learnTrade = await checkBoth(() => call("learn", { master: b.id, skill: "inner", payment: "bond" }, a.code));
    await checkTradeReward(learnTrade, a.id, "learn");
    await updateRow(app.db, "char", b.id, { tier: 1, stage: 4, vigor: 2300 }, current.tick);

    // Two separately resolved fights against different monsters qualify, without a prior loss.
    const base = await row(a.id);
    const monster: CharRow = { ...base, id: "r1:char:s92_monster", kind: "npc", door: null, handle: null, email_hash: null, model: null,
      body: "beast", archetype: "monster", state: "active", tier: 1, stage: 1, vigor: 1, xp: 0, potential: 0,
      life: "alive", revive_tick: null, loc: place, respawn_place: place, patrol_route: [], patrol_index: 0 };
    const otherMonster = { ...monster, id: "r1:char:s92_monster_other" };
    await insertRow(app.db, "char", monster);
    await insertRow(app.db, "char", otherMonster);
    await updateRow(app.db, "place", place, { combat: "pve", danger: "low" }, current.tick);
    for (const p of [a, b]) {
      const learned = (await selectRows(app.db, "skill", "record = 'learned' AND char_id = $1", [p.id]))[0];
      assert.ok(learned?.record === "learned");
      await updateRow(app.db, "skill", learned.id, { level: 1000, cap: 1000 }, current.tick);
      await updateRow(app.db, "char", p.id, { vigor: 2300 }, current.tick);
    }
    const first = await call("attack", { target: otherMonster.id }, a.code);
    assert.equal(first.result.outcome, "win");
    await app.db.query("UPDATE worlds SET tick = tick + 10");
    const beforeKill = await growth();
    const kill = await call("attack", { target: monster.id }, b.code);
    assert.equal(kill.result.outcome, "win");
    assert.equal((await row(a.id)).xp - beforeKill[0]![0]!, bonus.xp);
    const tradeEvents = (await app.db.query<Json>("SELECT data FROM events WHERE deed_id = $1 AND type = 'reward_granted' AND data->'trade'->>'kind' = 'hunt'", [kill.result.deed_id])).rows;
    assert.equal(tradeEvents.length, 2);
    for (const e of tradeEvents) assert.deepEqual([e.data.reward.xp, e.data.reward.potential], [bonus.xp, bonus.potential]);
    await updateRow(app.db, "char", monster.id, { vigor: 1, life: "alive", revive_tick: null }, current.tick);
    const second = await call("attack", { target: monster.id }, b.code);
    assert.equal((await app.db.query("SELECT 1 FROM events WHERE deed_id = $1 AND data->'trade'->>'kind' = 'hunt'", [second.result.deed_id])).rows.length, 0);
    await app.db.query("UPDATE worlds SET tick = tick + 29");
    await updateRow(app.db, "char", otherMonster.id, { vigor: 1, life: "alive", revive_tick: null }, current.tick);
    const cooldownProbe = await call("attack", { target: otherMonster.id }, a.code);
    assert.equal((await app.db.query("SELECT 1 FROM events WHERE deed_id = $1 AND data->'trade'->>'kind' = 'hunt'", [cooldownProbe.result.deed_id])).rows.length, 0);
    await app.db.query("UPDATE worlds SET tick = tick + 1");
    await updateRow(app.db, "char", monster.id, { vigor: 1, life: "alive", revive_tick: null }, current.tick);
    const afterCooldown = await call("attack", { target: monster.id }, b.code);
    assert.equal((await app.db.query("SELECT 1 FROM events WHERE deed_id = $1 AND data->'trade'->>'kind' = 'hunt'", [afterCooldown.result.deed_id])).rows.length, 2);

    // A separate ambush counter-kill also credits a recent participant fighting another monster.
    await app.db.query("UPDATE worlds SET tick = tick + 31");
    await updateRow(app.db, "char", otherMonster.id, { vigor: 1, life: "alive", revive_tick: null }, current.tick);
    await call("attack", { target: otherMonster.id }, a.code);
    const balance = structuredClone(app.services.balance());
    Object.assign(balance.numbers.npc, { ambush_interval_ticks: 1, ambush_chance_bp: 10000 });
    await app.db.tx(async (q) => {
      const wrow = await mustGetRow(q, "world", world.id, { lock: true });
      const tick = (BigInt(wrow.tick) + 1n).toString();
      await updateRow(q, "world", world.id, { tick }, tick);
      await updateRow(q, "place", place, { danger: "high", tier: 1 }, tick);
      await updateRow(q, "char", a.id, { last_seen_tick: "0" }, tick);
      await updateRow(q, "char", c.id, { last_seen_tick: "0" }, tick);
      await updateRow(q, "char", b.id, { vigor: 1000000, last_seen_tick: tick }, tick);
      await updateRow(q, "char", monster.id, { vigor: 1, life: "alive", revive_tick: null }, tick);
      const w = new Writer(q, wrow.realm, tick, wrow.rules_revision, true);
      await ambush({ q, w, world: { ...wrow, tick }, rules: wrow.rules, balance,
        from_tick: wrow.tick, to_tick: tick, now: new Date() }, await mustGetRow(q, "char", monster.id));
    });
    const ambushDeeds = await app.db.query<Json>("SELECT id FROM deeds WHERE verb = 'clock' AND actor = $1 AND kind = 'combat_loss' ORDER BY seq DESC LIMIT 1", [monster.id]);
    assert.equal(ambushDeeds.rows.length, 1);
    assert.equal((await app.db.query("SELECT 1 FROM events WHERE deed_id = $1 AND data->'trade'->>'kind' = 'hunt'", [ambushDeeds.rows[0]!.id])).rows.length, 2);

    const npc = (await selectRows(app.db, "char", "kind = 'npc' AND archetype = 'merchant'"))[0];
    assert.ok(npc);
    await updateRow(app.db, "char", npc.id, { loc: place }, current.tick);
    const beforeNpc = await row(b.id);
    await call("say", { text: "交易怎么做", target: npc.id }, b.code);
    await call("give", { target: npc.id, asset: { kind: "coin", amount: 10 } }, b.code);
    await updateRow(app.db, "char", b.id, { coin: 10000 }, current.tick);
    const stock = { ...item, id: "r1:item:s92_stock", holder: { kind: "char" as const, id: npc.id } };
    await insertRow(app.db, "item", stock);
    await call("use", { op: "buy", npc: npc.id, item: stock.id }, b.code);
    await call("use", { op: "sell", npc: npc.id, item: stock.id }, b.code);
    const afterNpc = await row(b.id);
    assert.deepEqual([afterNpc.xp, afterNpc.potential], [beforeNpc.xp, beforeNpc.potential]);
    assert.equal((await app.db.query("SELECT 1 FROM events WHERE type = 'reward_granted' AND data->'trade'->>'pair' LIKE $1", [`%${npc.id}%`])).rows.length, 0);
  } finally {
    await app.close();
  }
});
