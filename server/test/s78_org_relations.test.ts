// S78: org stance is readable, and a merchant's price follows it.
// One chain: the content pairs are in, whoami and the org page show them,
// look marks an NPC, then ally / enemy / neutral each buy and sell once.
import assert from "node:assert/strict";
import { test } from "node:test";
import { startApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { mustGetRow, updateRow } from "../src/facts/store.ts";
import { Writer } from "../src/facts/writer.ts";
import { setQuiet } from "../src/log.ts";
import { itemPrice, tradePrice } from "../src/economy/prices.ts";
import { floorRatio, numberAt } from "../src/orgs/numbers.ts";

type Json = any;

const JIU = "r1:org:xiuxian_jiuhuan";
const TAI = "r1:org:xiuxian_taihua";
const YUN = "r1:org:xiuxian_yunzhuan";
const HERB = "r1:org:wuxia_herb";
const MERCHANT = "r1:char:xiuxian_merchant";
const MERCHANT_PLACE = "r1:place:start_xiuxian";
const DEF = "r1:item:potion_restore_t1_g1";

test("S78 org stance is readable and shifts a merchant's price", async () => {
  setQuiet(true);
  const config = await loadConfig({ ...process.env, AIHW_DB_DRIVER: "pglite", AIHW_PGLITE_DIR: "memory", AIHW_PORT: "0" });
  config.clock.enabled = false;
  const app = await startApp(config);
  try {
    const invoke = async (verb: string, args: object, bearer: string): Promise<Json> =>
      (await app.dispatch({ verb, body: { args }, bearer, door: "api" })).body;
    const enter = async (): Promise<{ id: string; code: string }> => {
      const body = await invoke("enter", { mode: "create", skin: "xiuxian", door: "api" }, "");
      assert.equal(body.ok, true, JSON.stringify(body.error));
      return { id: body.result.char.id, code: body.result.identity_code };
    };
    const ally = await enter();
    const enemy = await enter();
    const neutral = await enter();
    const world = await mustGetRow(app.db, "world", "r1:world:main");
    await updateRow(app.db, "world", world.id, { rules: { ...world.rules, ap_per_tick: 100 } }, world.tick);

    // One pair per region, plus the two that cross a region, and the neutral-file pair.
    const pairs = await app.db.query<{ a: string; b: string; stance: string }>("SELECT a, b, stance FROM s78_org_relations ORDER BY a, b");
    const has = (a: string, b: string, stance: string): boolean =>
      pairs.rows.some((r) => r.stance === stance && ((r.a === a && r.b === b) || (r.a === b && r.b === a)));
    assert.equal(has(TAI, YUN, "ally"), true);
    assert.equal(has(JIU, TAI, "enemy"), true);
    assert.equal(has("r1:org:wuxia_escort", HERB, "ally"), true);
    assert.equal(has(HERB, "r1:org:wuxia_martial", "enemy"), true);
    assert.equal(has("r1:org:fantasy_watch", "r1:org:fantasy_wayfarers", "ally"), true);
    assert.equal(has("r1:org:fantasy_conclave", "r1:org:fantasy_watch", "enemy"), true);
    assert.equal(has("r1:org:scifi_survey", "r1:org:scifi_trade", "ally"), true);
    assert.equal(has("r1:org:scifi_salvage", "r1:org:scifi_trade", "enemy"), true);
    assert.equal(has("r1:org:registry_fantasy", "r1:org:registry_scifi", "ally"), true);
    assert.equal(has("r1:org:registry_wuxia", "r1:org:registry_xiuxian", "enemy"), true);
    assert.equal(has(JIU, HERB, "ally"), true);
    assert.equal(has(TAI, "r1:org:wuxia_martial", "enemy"), true);
    assert.equal(pairs.rows.length, 14);

    // The merchant belongs to 九还; 听雨 is its ally and 太华 its enemy.
    const member = await app.db.query<{ b: string }>(
      "SELECT b FROM bonds WHERE kind = 'member' AND state = 'active' AND a = $1", [MERCHANT],
    );
    assert.equal(member.rows[0]?.b, JIU);

    for (const who of [ally, enemy, neutral]) await updateRow(app.db, "char", who.id, { coin: 100000, loc: MERCHANT_PLACE }, world.tick);
    await updateRow(app.db, "bond", (await app.db.query<{ id: string }>(
      "SELECT id FROM bonds WHERE kind = 'member' AND state = 'active' AND a = $1", [ally.id],
    )).rows[0]!.id, { b: HERB }, world.tick);
    await updateRow(app.db, "bond", (await app.db.query<{ id: string }>(
      "SELECT id FROM bonds WHERE kind = 'member' AND state = 'active' AND a = $1", [enemy.id],
    )).rows[0]!.id, { b: TAI }, world.tick);

    const self = await invoke("whoami", { section: "bonds" }, ally.code);
    assert.equal(self.ok, true, JSON.stringify(self.error));
    assert.equal(self.result.org_id, HERB);
    assert.ok(self.result.allies.includes(JIU), JSON.stringify(self.result.allies));
    assert.ok(self.result.enemies.includes("r1:org:wuxia_martial"), JSON.stringify(self.result.enemies));

    const page = await (await fetch(`${app.url}/org/${JIU}`)).text();
    assert.ok(page.includes(HERB), page);
    assert.ok(page.includes(TAI), page);
    assert.ok(page.includes("org_stance.ally"), page);
    assert.ok(page.includes("org_stance.enemy"), page);

    const people = await invoke("look", { section: "people" }, ally.code);
    assert.equal(people.ok, true, JSON.stringify(people.error));
    const shown = people.result.rows.find((row: Json) => row.id === MERCHANT);
    assert.equal(shown.org_id, JIU);
    assert.equal(shown.org_stance, "ally");

    const balance = app.services.balance();
    const def = await mustGetRow(app.db, "item", DEF);
    assert.equal(def.record, "definition");
    const listed = await itemPrice(app.db, balance, DEF);
    const buyOf = (kind: "ally" | "enemy" | "neutral"): number => {
      const factor = kind === "neutral" ? 10000 : numberAt(balance, kind === "ally" ? "economy.org_ally_buy_bp" : "economy.org_enemy_buy_bp");
      return floorRatio(tradePrice(balance, listed, "buy"), factor);
    };
    const sellOf = (kind: "ally" | "enemy" | "neutral"): number => {
      const factor = kind === "neutral" ? 10000 : numberAt(balance, kind === "ally" ? "economy.org_ally_sell_bp" : "economy.org_enemy_sell_bp");
      return floorRatio(tradePrice(balance, listed, "sell"), factor);
    };

    const stock = async (holder: string): Promise<string> => {
      let id = "";
      await app.db.tx(async (q) => {
        const w = new Writer(q, "r1", world.tick, world.rules_revision, false);
        id = await w.newId("item");
        await w.insert("item", {
          id, created_tick: world.tick, updated_tick: world.tick, record: "instance", def_id: DEF,
          holder: { kind: "char", id: holder }, state: "available", equipped: false, dura: 0, sockets: [], note: null,
        });
      });
      return id;
    };

    for (const [who, kind] of [[ally, "ally"], [enemy, "enemy"], [neutral, "neutral"]] as const) {
      const id = await stock(MERCHANT);
      const shop = await (await fetch(`${app.url}/v1/shops/${MERCHANT}`, { headers: { Authorization: `Bearer ${who.code}` } })).json() as Json;
      const offer = shop.items.find((row: Json) => row.item.id === id);
      assert.equal(offer.price, buyOf(kind), `${kind} shop`);
      const bought = await invoke("use", { op: "buy", item: id, npc: MERCHANT }, who.code);
      assert.equal(bought.ok, true, JSON.stringify(bought.error));
      assert.equal(bought.result.price, buyOf(kind), `${kind} buy`);
      const sold = await invoke("use", { op: "sell", item: id, npc: MERCHANT }, who.code);
      assert.equal(sold.ok, true, JSON.stringify(sold.error));
      assert.equal(sold.result.price, sellOf(kind), `${kind} sell`);
    }
    assert.ok(buyOf("ally") < buyOf("neutral") && buyOf("neutral") < buyOf("enemy"));
    assert.ok(sellOf("enemy") < sellOf("neutral") && sellOf("neutral") < sellOf("ally"));
  } finally {
    await app.close();
  }
});
