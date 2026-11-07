// S27 acceptance, one chain (设计者 11-06: 不要有过多的复杂测试、不要重复全量测试):
// boot imports content/world (resource spots + shop lists) → first tick fills
// every holder once → walk to wild_t1, the spot has ground items and take works
// (①) → empty the herb, 121 ticks later restock brings it back to cap and
// nothing is above cap (②) → the deliver task herb_t1 ×2 → camp_neutral is
// accepted from an open offer and submitted (④) → the merchant at
// market_neutral holds stock and use buy trades (③) → a content dir whose
// deliver wants an unproducible item aborts startup, naming task and item (⑤).

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { resolve } from "node:path";
import { startApp } from "../src/app.ts";
import { loadConfig, SERVER_ROOT } from "../src/config.ts";
import { verifyKeySources } from "../src/content/index.ts";
import { insertRow } from "../src/facts/store.ts";
import type { Holder, TaskInstanceRow } from "../src/facts/types.ts";
import { setQuiet } from "../src/log.ts";

type Json = any;

const START = "r1:place:start_xiuxian";
const MARKET = "r1:place:market_neutral";
const GATE = "r1:place:gate_confluence";
const CAMP = "r1:place:camp_neutral";
const WILD = "r1:place:wild_t1";
const HERB = "r1:item:herb_t1";
const ORE = "r1:item:ore_t1";
const MERCHANT = "r1:char:merchant_t3";
const DELIVER_T1 = "r1:task:deliver_t1";
const FIXTURE = "r1:task:s27_deliver_fixture";

/** ids of available, unequipped instances of def held by holder. */
const held = (db: any, holder: Holder, def: string): Promise<string[]> =>
  db.query(
    "SELECT id FROM items WHERE record = 'instance' AND def_id = $1 AND state = 'available' AND equipped = false AND holder ->> 'kind' = $2 AND holder ->> 'id' = $3 ORDER BY id COLLATE \"C\"",
    [def, holder.kind, holder.id],
  ).then((r: any) => r.rows.map((row: { id: string }) => row.id));

test("S27 chain: first-tick fill → take → 120-tick restock to cap → deliver → merchant buy", async () => {
  setQuiet(true);
  // Full content/world import (default content_dir), in-memory PGlite.
  const env: NodeJS.ProcessEnv = { ...process.env, AIHW_DB_DRIVER: "pglite", AIHW_PGLITE_DIR: "memory", AIHW_PORT: "0" };
  delete env.AIHW_CONTENT_DIR;
  const app = await startApp(await loadConfig(env));
  try {
    const db = app.db;
    const call = async (verb: string, args: object, code?: string): Promise<{ status: number; body: Json }> => {
      const headers: Record<string, string> = { "Content-Type": "application/json; charset=utf-8" };
      if (code !== undefined) headers.Authorization = `Bearer ${code}`;
      const res = await fetch(`${app.url}/v1/actions/${verb}`, { method: "POST", headers, body: JSON.stringify({ args }) });
      return { status: res.status, body: (await res.json()) as Json };
    };
    const ok = async (verb: string, args: object, code?: string): Promise<Json> => {
      const r = await call(verb, args, code);
      assert.equal(r.body.ok, true, `${verb} ${JSON.stringify(args)} → ${JSON.stringify(r.body.error)}`);
      return r.body;
    };
    // Lazily advance one world tick (tick_seconds = 60) before the next action.
    const nextTick = async (): Promise<void> => {
      await db.query("UPDATE worlds SET tick_started_at = tick_started_at - interval '60 seconds'");
    };
    const tickNow = async (): Promise<bigint> =>
      BigInt(String((await db.query<{ tick: unknown }>("SELECT tick FROM worlds")).rows[0]?.tick));
    const coinOf = async (id: string): Promise<number> =>
      Number((await db.query<{ coin: unknown }>("SELECT coin FROM chars WHERE id = $1", [id])).rows[0]?.coin);

    // ---- boot + first tick: every holder filled once (① has ground items) ----
    await nextTick();
    const enter = await ok("enter", { mode: "create", skin: "xiuxian", door: "api" });
    const code: string = enter.result.identity_code;
    const a: string = enter.result.char.id;
    const groundHerb = await held(db, { kind: "place", id: WILD }, HERB);
    const groundOre = await held(db, { kind: "place", id: WILD }, ORE);
    assert.equal(groundHerb.length, 4, "wild_t1 starts with cap 4 herb_t1 after the first tick");
    assert.equal(groundOre.length, 2, "wild_t1 starts with cap 2 ore_t1");
    assert.ok((await held(db, { kind: "char", id: MERCHANT }, "r1:item:potion_restore_t2_g1")).length === 4, "merchant_t3 restocked");
    for (let tier = 4; tier <= 9; tier += 1) {
      const def = `r1:item:key_t${tier}`;
      assert.equal((await held(db, { kind: "place", id: `r1:place:dungeon_t${tier}` }, def)).length, 2, `${def} has a same-tier outer-dungeon source`);
    }
    // Reuse this imported world: missing and self-locked sources must both be named.
    await db.query("DELETE FROM s27_supply WHERE def_id = 'r1:item:key_t4'");
    await assert.rejects(verifyKeySources(db, "r1"), /locked exit content\.r1\.place\.dungeon_t4 in.*key_t4.*no resource spot or merchant/);
    await db.query("INSERT INTO s27_supply (holder_kind, holder_id, def_id, cap, due_tick) VALUES ('place', 'r1:place:inner_t4', 'r1:item:key_t4', 2, NULL)");
    await assert.rejects(verifyKeySources(db, "r1"), /locked exit content\.r1\.place\.dungeon_t4 in.*key_t4.*unreachable/);
    await db.query("UPDATE s27_supply SET holder_id = 'r1:place:dungeon_t4' WHERE def_id = 'r1:item:key_t4'");

    // An open system deliver offer for this char (S24-style fixture; the walk below is all verbs).
    const world = (await db.query<{ id: string }>("SELECT id FROM worlds")).rows[0]!.id;
    const now = await tickNow();
    await insertRow(db, "task", {
      id: FIXTURE,
      created_tick: String(now),
      updated_tick: String(now),
      record: "instance",
      template_id: DELIVER_T1,
      kind: "system",
      tpl: "deliver",
      issuer: { kind: "system", id: world },
      offer_place: START,
      eligible_char: a,
      issuer_tier: null,
      taker: null,
      condition: { tpl: "deliver", item_def: HERB, count: 2, to_place: CAMP, to_char: null },
      reward: { coin: 100, xp: 300, potential: 30, rep: 0, items: [] },
      escrow: { coin: 100, items: [] },
      state: "open",
      accepted_seq: null,
      progress: { count: 0, evidence: [] },
      expires_tick: String(now + 1440n),
      note: null,
    } satisfies TaskInstanceRow);
    await nextTick();
    const accepted = await ok("task", { op: "accept", id: FIXTURE }, code);
    assert.equal(accepted.result.task.state, "accepted");

    // ---- walk start_xiuxian → market → gate → camp → wild_t1 ----
    for (const [dir, to] of [["south", MARKET], ["in", GATE], ["north", CAMP], ["north", WILD]] as const) {
      await nextTick();
      const went = await ok("go", { dir }, code);
      assert.equal(went.result.to, to);
    }
    const look = await ok("look", { section: "items" }, code);
    assert.ok(look.result.counts.items >= 6, `wild_t1 lists its ground items (${look.result.counts.items})`);

    // ---- ① take works; ② empty the herb, wake, restock after 120 ticks ----
    const taken: string[] = [];
    for (const id of groundHerb) {
      await nextTick();
      const r = await ok("take", { item: id }, code);
      assert.deepEqual(r.result.item.holder, { kind: "char", id: a });
      taken.push(id);
    }
    assert.equal((await held(db, { kind: "place", id: WILD }, HERB)).length, 0, "herb_t1 emptied");
    const due = await db.query<{ due_tick: string | null }>(
      "SELECT due_tick FROM s27_supply WHERE holder_kind = 'place' AND holder_id = $1 AND def_id = $2",
      [WILD, HERB],
    );
    assert.equal(typeof due.rows[0]?.due_tick, "string", "emptying the spot woke its supply row");

    const before = await tickNow();
    await db.query("UPDATE worlds SET tick_started_at = tick_started_at - interval '121 minutes'");
    await ok("look", { section: "place" }, code); // any request lazily catches the ticks up
    assert.ok((await tickNow()) - before >= 121n, "world advanced past the respawn period");
    assert.equal((await held(db, { kind: "place", id: WILD }, HERB)).length, 4, "herb_t1 restocked to cap");
    assert.equal((await held(db, { kind: "place", id: WILD }, ORE)).length, 2, "ore_t1 stays at its cap");

    // ---- ④ deliver: at camp_neutral, hand 2 herbs in, paid ----
    await nextTick();
    await ok("go", { dir: "south" }, code); // wild_t1 → camp_neutral
    const coin0 = await coinOf(a);
    const done = await ok("task", { op: "submit", id: FIXTURE }, code);
    assert.equal(done.result.task.state, "completed");
    assert.equal(done.result.reward.coin, 100);
    assert.ok((await coinOf(a)) === coin0 + 100, "deliver reward paid once");

    // ---- ③ merchant stock + use buy ----
    await db.query("UPDATE chars SET coin = coin + 500 WHERE id = $1", [a]);
    await nextTick();
    await ok("go", { dir: "south" }, code); // camp_neutral → gate_confluence
    await nextTick();
    await ok("go", { dir: "out" }, code); // gate_confluence → market_neutral
    const shopResponse = await fetch(`${app.url}/v1/shops/${encodeURIComponent(MERCHANT)}`);
    assert.equal(shopResponse.status, 200);
    const shop = await shopResponse.json() as Json;
    assert.equal(shop.npc.id, MERCHANT);
    assert.equal(shop.npc.coin, undefined, "shop does not expose the merchant's private coin pool");
    const offer = shop.items.find((row: Json) => row.item.def_id === "r1:item:potion_restore_t2_g1");
    assert.ok(offer && offer.price > 0, "public shop exposes a purchasable instance and its price");
    const coin1 = await coinOf(a);
    const bought = await ok("use", { op: "buy", item: offer.item.id, npc: MERCHANT }, code);
    assert.equal(bought.result.price, offer.price, "quote and settlement use the same price");
    assert.equal(bought.result.op, "buy");
    assert.ok(bought.result.price > 0, "buy reports a price");
    assert.deepEqual(bought.result.changes.find((c: Json) => c.table === "item")?.after?.holder, { kind: "char", id: a });
    assert.equal(await coinOf(a), coin1 - bought.result.price, "coin left the buyer by exactly the price");
    const shopDue = await db.query<{ due_tick: string | null }>(
      "SELECT due_tick FROM s27_supply WHERE holder_kind = 'char' AND holder_id = $1 AND def_id = $2",
      [MERCHANT, "r1:item:potion_restore_t2_g1"],
    );
    assert.equal(typeof shopDue.rows[0]?.due_tick, "string", "the sale woke the shop's supply row");
  } finally {
    await app.close();
  }
});

test("S27 import check: a deliver wanting an unproducible item aborts startup, named", async () => {
  setQuiet(true);
  // 临时件照派单只放 _work/临时/: one file whose deliver wants ghost_ore,
  // while the only spot produces plain_ore.
  const dir = resolve(SERVER_ROOT, "../_work/临时/s27_bad_content");
  await mkdir(dir, { recursive: true });
  await writeFile(
    resolve(dir, "bad.json"),
    JSON.stringify(
      {
        schema: "aihw.content.v1",
        places: [
          { local: "s27_camp_bad", region: "scifi", kind: "settlement", features: [], tier: 1, danger: "safe", combat: "safe", owner_org: null, exits: [] },
          { local: "s27_wild_bad", region: "scifi", kind: "wilderness", features: ["resource"], tier: 1, danger: "low", combat: "pve", owner_org: null, exits: [] },
        ],
        items: [
          { local: "s27_ghost_ore", kind: "ore", tier: 1, grade: 1, element: "none", slots: 0, cap: 0, dura_max: 0, modifiers: { vigor: 0, power: 0, guard: 0, speed: 0 }, effect: { kind: "none" } },
          { local: "s27_plain_ore", kind: "ore", tier: 1, grade: 1, element: "none", slots: 0, cap: 0, dura_max: 0, modifiers: { vigor: 0, power: 0, guard: 0, speed: 0 }, effect: { kind: "none" } },
        ],
        tasks: [
          { local: "s27_deliver_bad", tpl: "deliver", tier: 1, stage: 1, condition: { tpl: "deliver", item_def: "item:s27_ghost_ore", count: 1, to_place: "place:s27_camp_bad", to_char: null }, reward_spec: { coin: 100, xp: 300, potential: 30, rep: 0, item_defs: [] }, duration_ticks: 1440 },
        ],
        resource_spots: [{ place: "place:s27_wild_bad", items: [{ def: "item:s27_plain_ore", cap: 2 }] }],
      },
      null,
      2,
    ),
    "utf8",
  );
  const env = { ...process.env, AIHW_DB_DRIVER: "pglite", AIHW_PGLITE_DIR: "memory", AIHW_PORT: "0", AIHW_CONTENT_DIR: dir };
  await assert.rejects(
    startApp(await loadConfig(env)),
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      assert.match(msg, /s27_deliver_bad/);
      assert.match(msg, /s27_ghost_ore/);
      assert.match(msg, /no resource spot or merchant/);
      return true;
    },
    "the source check names the task and the item",
  );
});
