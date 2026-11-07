// S64: a first-tier player founds an organization and another joins it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { startApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { mustGetRow, updateRow } from "../src/facts/store.ts";
import { setQuiet } from "../src/log.ts";
import { cellNumber } from "../src/orgs/numbers.ts";

type Json = any;

test("S64 player organization, membership, names and first founding", async () => {
  setQuiet(true);
  const config = await loadConfig({ ...process.env, AIHW_DB_DRIVER: "pglite", AIHW_PGLITE_DIR: "memory", AIHW_PORT: "0" });
  config.clock.enabled = false;
  const app = await startApp(config);
  try {
    const invoke = async (verb: string, args: object, bearer: string | null = null): Promise<Json> =>
      (await app.dispatch({ verb, body: { args }, bearer, door: "api" })).body;
    const enter = async (): Promise<{ id: string; code: string }> => {
      const body = await invoke("enter", { mode: "create", skin: "xiuxian", door: "api" });
      assert.equal(body.ok, true);
      return { id: body.result.char.id, code: body.result.identity_code };
    };
    const founder = await enter();
    const recruit = await enter();
    const later = await enter();
    const world = await mustGetRow(app.db, "world", "r1:world:main");
    await updateRow(app.db, "world", world.id, { rules: { ...world.rules, ap_per_tick: 100 } }, world.tick);
    const fee = cellNumber(app.services.balance(), "tier_prices", { tier: 1 }, "org_join_fee") * 2;
    // New characters start without coins; fund the action to isolate the founding fee.
    for (const player of [founder, recruit, later]) await updateRow(app.db, "char", player.id, { coin: fee * 2 }, world.tick);
    const before = await mustGetRow(app.db, "char", founder.id);
    assert.equal(before.tier, 1);
    const made = await invoke("use", { op: "org_create", name: "青云 https://example.com 门" }, founder.code);
    assert.equal(made.ok, true, JSON.stringify(made.error));
    assert.equal(made.result.fee, fee);
    const orgId: string = made.result.org;
    const org = await mustGetRow(app.db, "org", orgId);
    assert.equal(org.player_name, "青云 门");
    assert.equal(org.hall, before.loc);
    assert.equal((await mustGetRow(app.db, "char", founder.id)).coin, before.coin - fee);
    const self = await invoke("whoami", { section: "bonds" }, founder.code);
    const member = self.result.rows.find((row: Json) => row.kind === "member");
    assert.equal(member.b, orgId);
    assert.equal(member.rank, Math.max(...org.ranks.map((rank) => rank.rank)));
    assert.equal(member.org_name, org.player_name);
    const joined = await invoke("use", { op: "org_join", org: orgId }, recruit.code);
    assert.equal(joined.ok, true, JSON.stringify(joined.error));
    const recruitSelf = await invoke("whoami", { section: "bonds" }, recruit.code);
    assert.equal(recruitSelf.result.rows.find((row: Json) => row.kind === "member").b, orgId);
    const refused = await invoke("use", { op: "org_create", name: "另一门" }, recruit.code);
    assert.equal(refused.error.code, "NOT_ALLOWED");
    const second = await invoke("use", { op: "org_create", name: "后来者" }, later.code);
    assert.equal(second.ok, true, JSON.stringify(second.error));
    const deeds = await app.db.query<{ kind: string; actor: string; visibility: string }>(
      "SELECT kind, actor, visibility FROM deeds WHERE kind IN ('org_create', 'first_org') ORDER BY seq",
    );
    assert.deepEqual(deeds.rows.map((d) => d.kind), ["org_create", "first_org", "org_create"]);
    assert.ok(deeds.rows.every((d) => d.visibility === "world"));
    assert.equal(deeds.rows[1]?.actor, founder.id);
    const chronicle = await (await fetch(`${app.url}/chronicle`)).text();
    assert.match(chronicle, /deed\.org_create/);
    assert.match(chronicle, /deed\.first_org/);
    assert.ok(chronicle.includes(org.player_name!));
    const biography = await (await fetch(`${app.url}/char/${founder.id}`)).text();
    assert.ok(biography.includes(org.player_name!));
  } finally {
    await app.close();
  }
});
