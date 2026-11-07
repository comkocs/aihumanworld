// S25 acceptance only: short use/economy, membership/relation and clock chains.

import assert from "node:assert/strict";
import { test } from "node:test";
import { startApp } from "../src/app.ts";
import type { ClockPhase } from "../src/clock/phases.ts";
import { loadConfig } from "../src/config.ts";
import { importWorldContent } from "../src/content/index.ts";
import { getRow, insertRow, mustGetRow, selectRows, updateRow } from "../src/facts/store.ts";
import type { CharRow, ItemDefinitionRow, ItemInstanceRow, OrgRow, TaskInstanceRow, TaskTemplateRow } from "../src/facts/types.ts";
import { Writer } from "../src/facts/writer.ts";
import { loadRulesBundle } from "../src/growth/rules_source.ts";
import { setQuiet } from "../src/log.ts";
import { npcPhase } from "../src/npc/clock.ts";
import { orgGoalPhase } from "../src/orgs/clock.ts";

// Envelopes are asserted field-by-field; no identity codes are logged or saved.
type Json = any;

test("S25 use, organization and NPC acceptance chains", async (t) => {
  setQuiet(true);
  const config = await loadConfig({ ...process.env, AIHW_DB_DRIVER: "pglite", AIHW_PGLITE_DIR: "memory", AIHW_PORT: "0" });
  config.clock.enabled = false;
  config.rules_file = "../../content/rules/numbers.v1.json";
  const app = await startApp(config);
  try {
    const call = async (args: object, bearer: string): Promise<Json> => {
      const out = await app.dispatch({ verb: "use", body: { args }, bearer, door: "api" });
      return out.body;
    };
    const join = async (): Promise<{ id: string; code: string }> => {
      const out = await app.dispatch({ verb: "enter", body: { args: { mode: "create", skin: "xiuxian", door: "api" } }, bearer: null, door: "api" });
      assert.equal(out.status, 200);
      const body = out.body as Json;
      return { id: body.result.char.id, code: body.result.identity_code };
    };
    const A = await join();
    const B = await join();
    const me = await mustGetRow(app.db, "char", A.id);
    const world = await mustGetRow(app.db, "world", "r1:world:main");
    await updateRow(app.db, "world", world.id, { rules: { ...world.rules, ap_per_tick: 1000 } }, "0");
    await updateRow(app.db, "char", A.id, { coin: 10000, vigor: 1900 }, "0");
    const stamp = { created_tick: "0", updated_tick: "0" };
    const def = (local: string, patch: Partial<ItemDefinitionRow>): ItemDefinitionRow => ({
      id: `r1:item:s25_def_${local}`, ...stamp, record: "definition", content_key: `content.r1.item.s25_${local}`,
      kind: "blade", tier: 1, grade: 1, element: "none", slots: 1, cap: 33, dura_max: 100,
      modifiers: { vigor: 0, power: 40, guard: 0, speed: 0 }, effect: { kind: "none" }, by: null, ...patch,
    });
    const potion = def("potion", { kind: "potion", slots: 0, cap: 0, dura_max: 0, modifiers: { vigor: 0, power: 0, guard: 0, speed: 0 }, effect: { kind: "restore", vigor: 1200 } });
    const large = def("large", { tier: 9, cap: 825, dura_max: 340 });
    const blade = def("blade", {});
    const npc = (local: string, archetype: NonNullable<CharRow["archetype"]>, patch: Partial<CharRow> = {}): CharRow => ({
      ...me, id: `r1:char:s25_${local}`, ...stamp, kind: "npc", door: null, model: null, archetype, handle: null, email_hash: null,
      state: "active", vigor: archetype === "tutorial_opponent" ? 600 : 2000, coin: 3000, ...patch,
    });
    const merchant = npc("merchant", "merchant");
    const repairer = npc("repairer", "repairer");
    const patrol = npc("patrol", "patroller", { patrol_route: [me.loc, "r1:place:market_neutral"], patrol_index: 0 });
    const monster = npc("monster", "monster", { life: "dead", vigor: 0, revive_tick: "30", loc: "r1:place:market_neutral" });
    const tutorial = npc("tutorial", "tutorial_opponent", { life: "dead", vigor: 0, revive_tick: "1" });
    const instance = (local: string, d: ItemDefinitionRow, owner: string, dura = d.dura_max): ItemInstanceRow => ({
      id: `r1:item:s25_${local}`, ...stamp, record: "instance", def_id: d.id,
      holder: { kind: "char", id: owner }, state: "available", equipped: false, dura, sockets: Array.from({ length: d.slots }, () => null),
    });
    const medicine = instance("potion", potion, A.id);
    const tooLarge = instance("large", large, A.id);
    const goods = instance("goods", blade, merchant.id, 50);
    const org: OrgRow = {
      id: "r1:org:s25_guild", ...stamp, content_key: "content.r1.org.s25_guild", region: "xiuxian", hall: me.loc, registry: false,
      ranks: [{ rank: 0, key: "org_rank.member", can_promote: false, can_expel: false }, { rank: 1, key: "org_rank.elder", can_promote: true, can_expel: true }],
      skill_defs: [], treasury: 0,
      goal: { week: 0, kind: "system_tasks", target: 5, progress: 0, member_ids: [], reward_rep: 5, settled: false },
    };
    await app.db.tx(async (q) => {
      for (const d of [potion, large, blade]) await insertRow(q, "item", d);
      for (const c of [merchant, repairer, patrol, monster, tutorial]) await insertRow(q, "char", c);
      for (const it of [medicine, tooLarge, goods]) await insertRow(q, "item", it);
      await insertRow(q, "org", org);
    });
    const phase = async (p: ClockPhase, tick: string): Promise<void> => {
      await app.db.tx(async (q) => {
        const w = await mustGetRow(q, "world", world.id, { lock: true });
        const writer = new Writer(q, "r1", tick, w.rules_revision, true);
        await p.run({ q, w: writer, world: w, rules: w.rules, balance: app.services.balance(), from_tick: (BigInt(tick) - 1n).toString(), to_tick: tick, now: new Date(w.tick_started_at) });
      });
    };

    await t.test("consume caps vigor; refused equip preserves facts and AP", async () => {
      const consumed = await call({ op: "consume", item: medicine.id }, A.code);
      assert.equal(consumed.ok, true);
      assert.equal((await mustGetRow(app.db, "char", A.id)).vigor, 2000);
      assert.equal((await mustGetRow(app.db, "item", medicine.id) as ItemInstanceRow).state, "consumed");
      const before = await mustGetRow(app.db, "char", A.id);
      const heads = await mustGetRow(app.db, "world", world.id);
      const refused = await call({ op: "equip", item: tooLarge.id }, A.code);
      assert.equal(refused.error.code, "CAPACITY_EXCEEDED");
      assert.deepEqual(refused.error.details, { required: 825, available: 200 });
      assert.deepEqual(await mustGetRow(app.db, "char", A.id), before);
      assert.deepEqual(await mustGetRow(app.db, "item", tooLarge.id), tooLarge);
      const after = await mustGetRow(app.db, "world", world.id);
      assert.equal(after.deed_head, heads.deed_head);
      assert.equal(after.event_head, heads.event_head);
    });

    await t.test("buy, repair and sell conserve both balances and one item", async () => {
      const total = async () => (await mustGetRow(app.db, "char", A.id)).coin + (await mustGetRow(app.db, "char", merchant.id)).coin + (await mustGetRow(app.db, "char", repairer.id)).coin;
      const before = await total();
      const buy = await call({ op: "buy", item: goods.id, npc: merchant.id }, A.code);
      assert.equal(buy.ok, true);
      assert.equal(buy.result.price, 600);
      assert.equal(await total(), before);
      assert.deepEqual((await mustGetRow(app.db, "item", goods.id) as ItemInstanceRow).holder, { kind: "char", id: A.id });
      const r0 = (await mustGetRow(app.db, "char", repairer.id)).coin;
      const repaired = await call({ op: "repair", item: goods.id, npc: repairer.id }, A.code);
      assert.equal(repaired.ok, true);
      assert.equal((await mustGetRow(app.db, "char", repairer.id)).coin - r0, 60);
      assert.equal((await mustGetRow(app.db, "item", goods.id) as ItemInstanceRow).dura, 100);
      assert.equal(await total(), before);
      const sell = await call({ op: "sell", item: goods.id, npc: merchant.id }, A.code);
      assert.equal(sell.ok, true);
      assert.equal(sell.result.price, 240);
      assert.equal(await total(), before);
      assert.deepEqual((await mustGetRow(app.db, "item", goods.id) as ItemInstanceRow).holder, { kind: "char", id: merchant.id });
      assert.equal((await selectRows(app.db, "item", "record = 'instance' AND def_id = $1", [blade.id])).length, 1);
      assert.ok(buy.result.changes.every((c: Json) => c.table !== "char" || c.id === A.id));
    });

    await t.test("org join/leave charge S5 fee, treasury and departure cost", async () => {
      const before = (await mustGetRow(app.db, "char", A.id)).coin;
      assert.equal((await call({ op: "org_join", org: org.id }, A.code)).ok, true);
      assert.equal((await mustGetRow(app.db, "char", A.id)).coin, before - 200);
      assert.equal((await mustGetRow(app.db, "org", org.id)).treasury, 200);
      const members = await selectRows(app.db, "bond", "kind = 'member' AND a = $1 AND state = 'active'", [A.id]);
      assert.deepEqual(members.map((b) => b.b), [org.id]);
      await phase(orgGoalPhase, "1");
      assert.deepEqual((await mustGetRow(app.db, "org", org.id)).goal.member_ids, [A.id]);
      assert.equal((await call({ op: "org_leave" }, A.code)).ok, true);
      assert.equal((await mustGetRow(app.db, "char", A.id)).coin, before - 700);
      assert.deepEqual((await selectRows(app.db, "bond", "kind = 'member' AND a = $1 AND state = 'active'", [A.id])).map((b) => b.b), [world.registry_orgs.xiuxian]);
      assert.equal((await selectRows(app.db, "reputation", "char_id = $1 AND org_id = $2", [A.id, org.id]))[0]?.value, -10);
    });

    await t.test("relation offer/accept creates one sorted bond; offer cannot replay", async () => {
      const offered = await call({ op: "relation_offer", kind: "ally", target: B.id }, A.code);
      assert.equal(offered.ok, true);
      const offer = await mustGetRow(app.db, "deed", offered.result.offer);
      assert.deepEqual(offer.result.proposal, { kind: "ally", a: A.id, b: B.id, expires_tick: "1440" });
      assert.equal((await call({ op: "relation_accept", offer: offer.id }, B.code)).ok, true);
      const bonds = await selectRows(app.db, "bond", "kind = 'ally' AND state = 'active'");
      assert.equal(bonds.length, 1);
      assert.deepEqual([bonds[0]?.a, bonds[0]?.b], [A.id, B.id].sort());
      const before = await mustGetRow(app.db, "char", B.id);
      const replay = await call({ op: "relation_accept", offer: offer.id }, B.code);
      assert.deepEqual(replay.error.details, { reason: "used" });
      assert.equal(replay.error.code, "OFFER_STATE");
      assert.deepEqual(await mustGetRow(app.db, "char", B.id), before);
    });

    await t.test("weekly goal snapshots headcount and awards org reputation once", async () => {
      // A left after the snapshot: the old roster still receives the reward.
      await updateRow(app.db, "char", B.id, { coin: 1000 }, "0");
      assert.equal((await call({ op: "org_join", org: org.id }, B.code)).ok, true);
      const initial = (await mustGetRow(app.db, "org", org.id)).goal;
      assert.equal(initial.target, 5);
      assert.deepEqual(initial.member_ids, [A.id]);
      const template: TaskTemplateRow = {
        id: "r1:task:s25_template", ...stamp, record: "template", content_key: "content.r1.task.s25_goal", tpl: "reach", tier: 1, stage: 1,
        condition: { tpl: "reach", mode: "place", place: me.loc }, reward_spec: { coin: 0, xp: 0, potential: 0, rep: 0, item_defs: [] }, duration_ticks: 1440, by: null,
      };
      await app.db.tx(async (q) => {
        await mustGetRow(q, "world", world.id, { lock: true });
        await insertRow(q, "task", template);
        const w = new Writer(q, "r1", "0", world.rules_revision, true);
        for (let i = 0; i < 5; i += 1) {
          const task: TaskInstanceRow = {
            id: `r1:task:s25_done_${i}`, ...stamp, record: "instance", template_id: template.id, kind: "system", tpl: "reach",
            issuer: { kind: "system", id: world.id }, offer_place: me.loc, eligible_char: B.id, issuer_tier: null, taker: B.id,
            condition: template.condition, reward: { coin: 0, xp: 0, potential: 0, rep: 0, items: [] }, escrow: { coin: 0, items: [] },
            state: "completed", accepted_seq: "0", progress: { count: 1, evidence: [] }, expires_tick: "1440",
          };
          await insertRow(q, "task", task);
          await w.deed({ actor: B.id, verb: "task", kind: "task_done", targets: [task.id, template.id], place_id: me.loc,
            result: { outcome: "success", changes: [], roll: null, proposal: null }, visibility: "self", participants: [B.id] });
        }
      });
      await phase(orgGoalPhase, "2");
      const settled = await mustGetRow(app.db, "org", org.id);
      assert.equal(settled.goal.progress, 5);
      assert.equal(settled.goal.settled, true);
      assert.equal((await selectRows(app.db, "reputation", "char_id = $1 AND org_id = $2", [A.id, org.id]))[0]?.value, -5);
      assert.equal((await selectRows(app.db, "reputation", "char_id = $1 AND org_id = $2", [B.id, org.id])).length, 0);
      await phase(orgGoalPhase, "2");
      assert.deepEqual(await mustGetRow(app.db, "org", org.id), settled);
      assert.equal((await selectRows(app.db, "reputation", "char_id = $1 AND org_id = $2", [A.id, org.id]))[0]?.value, -5);
      await phase(orgGoalPhase, "3");
      assert.deepEqual(await mustGetRow(app.db, "org", org.id), settled);
      assert.ok(!(await selectRows(app.db, "org", "split_part(id, ':', 1) = $1 AND clock_due_tick <= $2::bigint", [config.realm, "4"])).some((o) => o.id === org.id));
      await phase(orgGoalPhase, "10080");
      const next = (await mustGetRow(app.db, "org", org.id)).goal;
      assert.equal(next.week, 1);
      assert.deepEqual(next.member_ids, [B.id]);
      assert.equal(next.target, 5);
      assert.equal(next.progress, 0);
    });

    await t.test("org masters teach members after idempotent backfill", async () => {
      const sect = await mustGetRow(app.db, "org", "r1:org:xiuxian_taihua");
      const master = await mustGetRow(app.db, "char", "r1:char:xiuxian_master_t2");
      assert.equal(master.loc, sect.hall);
      assert.equal(master.archetype, "master");
      const definitions = await Promise.all(sect.skill_defs.map((id) => mustGetRow(app.db, "skill", id)));
      assert.ok(definitions.length > 1);
      const first = definitions[0]!;
      const second = definitions[1]!;
      assert.equal(first.record, "definition");
      assert.equal(second.record, "definition");
      if (first.record !== "definition" || second.record !== "definition") throw new Error("org skill definition missing");
      const masterSkills = async () => selectRows(app.db, "skill", "record = 'learned' AND char_id = $1 AND def_id = $2", [master.id, first.id]);
      const original = (await masterSkills())[0];
      assert.ok(original?.record === "learned");
      const hard = app.services.balance().numbers.tiers.find((row) => row.tier === master.tier)?.skill_cap_hard;
      assert.equal(original.level, hard);
      assert.equal(original.cap, hard);
      const unchanged = (await selectRows(app.db, "skill", "record = 'learned' AND char_id = $1 AND def_id = $2", [master.id, second.id]))[0];
      assert.ok(unchanged?.record === "learned");
      await app.db.query("DELETE FROM skills WHERE id = $1", [original.id]);
      const bundle = await loadRulesBundle(config.config_dir, config.rules_file);
      assert.notEqual(config.content_dir, null);
      const recovered = await importWorldContent(app.db, config.realm, bundle, config.content_dir!);
      assert.equal(recovered.inserted.skill, 1);
      const restored = (await masterSkills())[0];
      assert.ok(restored?.record === "learned");
      assert.equal(restored.level, hard);
      assert.equal(restored.cap, hard);
      assert.deepEqual((await selectRows(app.db, "skill", "record = 'learned' AND char_id = $1 AND def_id = $2", [master.id, second.id]))[0], unchanged);
      const again = await importWorldContent(app.db, config.realm, bundle, config.content_dir!);
      assert.equal(again.inserted.skill, 0);
      assert.deepEqual(await masterSkills(), [restored]);

      await updateRow(app.db, "char", A.id, { loc: sect.hall, coin: 10000 }, "0");
      await updateRow(app.db, "char", B.id, { loc: sect.hall, coin: 10000 }, "0");
      const learn = async (bearer: string): Promise<Json> => (await app.dispatch({
        verb: "learn", body: { args: { master: master.id, skill: first.key, payment: "coin" } }, bearer, door: "api",
      })).body;
      const refused = await learn(B.code);
      assert.equal(refused.error.code, "NOT_ALLOWED");
      assert.equal(refused.error.details.reason, "rank");
      assert.equal((await selectRows(app.db, "skill", "record = 'learned' AND char_id = $1 AND def_id = $2", [B.id, first.id])).length, 0);
      assert.equal((await call({ op: "org_join", org: sect.id }, A.code)).ok, true);
      const learned = await learn(A.code);
      assert.equal(learned.ok, true);
      assert.equal(learned.result.skill.def_id, first.id);
      assert.equal((await selectRows(app.db, "skill", "record = 'learned' AND char_id = $1 AND def_id = $2", [A.id, first.id])).length, 1);
    });

    await t.test("NPC heartbeat moves patrol and revives monster only when due", async () => {
      await phase(npcPhase, "1");
      assert.equal((await mustGetRow(app.db, "char", tutorial.id)).life, "alive");
      assert.equal((await mustGetRow(app.db, "char", tutorial.id)).vigor, 600);
      await phase(npcPhase, "4");
      assert.equal((await mustGetRow(app.db, "char", patrol.id)).loc, me.loc);
      await phase(npcPhase, "5");
      assert.equal((await mustGetRow(app.db, "char", patrol.id)).loc, "r1:place:market_neutral");
      await phase(npcPhase, "5");
      assert.equal((await mustGetRow(app.db, "char", patrol.id)).patrol_index, 1);
      const travel = await selectRows(app.db, "deed", "kind = 'travel' AND targets @> $1::jsonb", [JSON.stringify([patrol.id])]);
      assert.ok(travel.length > 0);
      assert.ok(travel.every((d) => d.result.changes.every((c) => !Object.hasOwn(c.after, "patrol_index"))));
      const idle = await mustGetRow(app.db, "char", repairer.id);
      await phase(npcPhase, "6");
      assert.deepEqual(await mustGetRow(app.db, "char", repairer.id), idle);
      assert.ok(!(await selectRows(app.db, "char", "split_part(id, ':', 1) = $1 AND npc_due_tick IS NOT NULL AND npc_due_tick <= $2::bigint", [config.realm, "7"])).some((c) => c.id === repairer.id));
      await phase(npcPhase, "29");
      assert.equal((await mustGetRow(app.db, "char", monster.id)).life, "dead");
      await phase(npcPhase, "30");
      const revived = await mustGetRow(app.db, "char", monster.id);
      assert.equal(revived.life, "alive");
      assert.equal(revived.revive_tick, null);
      assert.equal(revived.vigor, 2000);
      assert.equal(revived.loc, me.respawn_place);
      const before = await selectRows(app.db, "deed", "kind = 'revive' AND targets @> $1::jsonb", [JSON.stringify([monster.id])]);
      await phase(npcPhase, "30");
      assert.equal((await selectRows(app.db, "deed", "kind = 'revive' AND targets @> $1::jsonb", [JSON.stringify([monster.id])])).length, before.length);
      assert.equal(await getRow(app.db, "char", monster.id) !== null, true);
    });
  } finally {
    await app.close();
  }
});
