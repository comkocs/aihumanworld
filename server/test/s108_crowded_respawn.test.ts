import assert from "node:assert/strict";
import { test } from "node:test";
import { startApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { insertRow, mustGetRow, selectRows, updateRow } from "../src/facts/store.ts";
import type { CharRow } from "../src/facts/types.ts";
import { setQuiet } from "../src/log.ts";

type Json = any;

test("S108b: monster respawn wait is apportioned among same-tier participants", async (t) => {
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
    const third = await enter();
    const world = await mustGetRow(app.db, "world", "r1:world:main");
    const base = await mustGetRow(app.db, "char", hunter.id);
    const place = "r1:place:xiuxian_landmark_ash_altar";
    const monster = (id: string): CharRow => ({
      ...base, id, kind: "npc", door: null, handle: null, email_hash: null, model: null,
      body: "beast", archetype: "monster", tier: 1, stage: 1, life: "alive", state: "active", vigor: 1,
      loc: place, respawn_place: place, patrol_route: [], patrol_index: 0, xp: 0, potential: 0,
    });
    await app.db.tx(async (q) => {
      const existing = await selectRows(q, "char", "loc = $1 AND tier = $2 AND archetype = 'monster' AND life = 'alive'", [place, 1]);
      for (const mob of existing) await updateRow(q, "char", mob.id, { life: "dead", vigor: 0, revive_tick: (BigInt(world.tick) + 30n).toString() }, world.tick);
      await insertRow(q, "char", monster("r1:char:s108_target"));
      for (const player of [hunter, other, third]) {
        await updateRow(q, "char", player.id, { loc: place, tier: 1, state: player === hunter ? "active" : "draft", life: "alive", last_seen_tick: world.tick, vigor: 1000000, ap_spent: 0 }, world.tick);
      }
      await updateRow(q, "world", world.id, { rules: { ...world.rules, ap_per_tick: 1000 } }, world.tick);
    });

    for (const [people, wait] of [[1, 30], [2, 15], [3, 10]] as const) {
      await t.test(`one monster and ${people} participant(s): +${wait} ticks`, async () => {
        await app.db.tx(async (q) => {
          await updateRow(q, "char", "r1:char:s108_target", { life: "alive", vigor: 1, revive_tick: null }, world.tick);
          await updateRow(q, "char", other.id, { state: people >= 2 ? "active" : "draft" }, world.tick);
          await updateRow(q, "char", third.id, { state: people >= 3 ? "active" : "draft" }, world.tick);
          await updateRow(q, "char", hunter.id, { vigor: 1000000, ap_spent: 0 }, world.tick);
        });
        const result = await invoke("attack", { target: "r1:char:s108_target" }, hunter.code);
        assert.equal(result.ok, true, JSON.stringify(result.error));
        assert.equal(result.result.outcome, "win");
        const dead = await mustGetRow(app.db, "char", "r1:char:s108_target");
        assert.equal(dead.life, "dead");
        assert.equal(dead.revive_tick, (BigInt(world.tick) + BigInt(wait)).toString());
      });
    }
  } finally {
    await app.close();
  }
});
