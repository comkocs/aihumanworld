import assert from "node:assert/strict";
import { test } from "node:test";
import { startApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { setQuiet } from "../src/log.ts";

type Json = any;

const origins = [
  ["xiuxian", "r1:task:xiuxian_reach_trial", "r1:place:xiuxian_trial_lane"],
  ["wuxia", "r1:task:wuxia_reach_lane", "r1:place:wuxia_tutorial_lane"],
  ["fantasy", "r1:task:fantasy_reach_yard", "r1:place:fantasy_yard"],
  ["scifi", "r1:task:scifi_reach_sim", "r1:place:scifi_sim_bay"],
] as const;

test("S57: first-tier home offers stay local and prioritize the tutorial", async () => {
  setQuiet(true);
  const env: NodeJS.ProcessEnv = { ...process.env, AIHW_DB_DRIVER: "pglite", AIHW_PGLITE_DIR: "memory", AIHW_PORT: "0" };
  delete env.AIHW_CONTENT_DIR;
  const app = await startApp(await loadConfig(env));
  try {
    const call = async (verb: string, args: object, code?: string): Promise<Json> => {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (code !== undefined) headers.Authorization = `Bearer ${code}`;
      return (await (await fetch(`${app.url}/v1/actions/${verb}`, { method: "POST", headers, body: JSON.stringify({ args }) })).json()) as Json;
    };
    const ok = async (verb: string, args: object, code?: string): Promise<Json> => {
      const result = await call(verb, args, code);
      assert.equal(result.ok, true, `${verb}: ${JSON.stringify(result.error)}`);
      return result;
    };
    let first: { code: string; char: string } | undefined;
    for (const [skin, template, tutorial] of origins) {
      const enter = await ok("enter", { mode: "create", skin, door: "api" });
      const code: string = enter.result.identity_code;
      const char: string = enter.result.char.id;
      first ??= { code, char };
      const made = enter.result.changes.filter((c: Json) => c.table === "task");
      assert.equal(made[0]?.after.template_id, template, `${skin}: tutorial is first`);
      const list = await ok("task", { op: "list" }, code);
      const rows: Json[] = list.result.rows.filter((t: Json) => t.kind === "system" && t.eligible_char === char);
      const intro = rows.find((t) => t.template_id === template);
      assert.ok(intro, `${skin}: tutorial offered`);
      assert.equal(intro.condition.place, tutorial);
      for (const row of rows) {
        const c = row.condition;
        const places: string[] = [];
        if (c.tpl === "deliver" || c.tpl === "gather") places.push(c.to_place);
        if (c.tpl === "reach" && c.mode === "place") places.push(c.place);
        const targets = [c.tpl === "find" ? c.target : null, c.tpl === "slay" ? c.target : null, c.tpl === "deliver" ? c.to_char : null].filter(Boolean);
        for (const target of targets) {
          const found = await app.db.query<{ loc: string }>("SELECT loc FROM chars WHERE id = $1", [target]);
          assert.ok(found.rows[0], `target ${target} exists`);
          places.push(found.rows[0].loc);
        }
        for (const place of places) {
          const found = await app.db.query<{ region: string }>("SELECT region FROM places WHERE id = $1", [place]);
          assert.ok(found.rows[0] && [skin, "neutral"].includes(found.rows[0].region), `${skin}: ${place}`);
        }
      }
    }

    assert.ok(first);
    const foreignTemplate = origins[1][1];
    const foreignPlace = origins[1][2];
    const open = await app.db.query<{ id: string }>("SELECT id FROM tasks WHERE record = 'instance' AND state = 'open' AND eligible_char = $1 ORDER BY id LIMIT 1", [first.char]);
    assert.ok(open.rows[0]);
    await app.db.query("UPDATE tasks SET condition = $1::jsonb WHERE id = $2", [JSON.stringify({ tpl: "reach", mode: "place", place: foreignPlace }), open.rows[0].id]);
    const cleaned = await ok("task", { op: "list" }, first.code);
    assert.ok(!cleaned.result.rows.some((t: Json) => t.id === open.rows[0]!.id), "old foreign offer removed at home");
    const state = await app.db.query<{ state: string }>("SELECT state FROM tasks WHERE id = $1", [open.rows[0].id]);
    assert.equal(state.rows[0]?.state, "cancelled");

    // Leave home: the same first-tier character can receive foreign templates.
    await app.db.query("UPDATE tasks SET state = 'cancelled' WHERE record = 'instance' AND state = 'open' AND eligible_char = $1", [first.char]);
    await app.db.query("UPDATE tasks SET tier = 9 WHERE record = 'template' AND tier = 1 AND id <> $1", [foreignTemplate]);
    await app.db.query("UPDATE chars SET loc = $1 WHERE id = $2", ["r1:place:market_neutral", first.char]);
    const away = await ok("task", { op: "list" }, first.code);
    assert.ok(away.result.rows.some((t: Json) => t.template_id === foreignTemplate), "first tier away from home is unrestricted");

    await app.db.query("UPDATE tasks SET state = 'cancelled' WHERE record = 'instance' AND state = 'open' AND eligible_char = $1", [first.char]);
    await app.db.query("UPDATE chars SET loc = $1, tier = 2 WHERE id = $2", ["r1:place:start_xiuxian", first.char]);
    await app.db.query("UPDATE tasks SET tier = 9 WHERE record = 'template' AND tier = 2 AND id <> $1", [foreignTemplate]);
    await app.db.query("UPDATE tasks SET tier = 2 WHERE record = 'template' AND id = $1", [foreignTemplate]);
    const advanced = await ok("task", { op: "list" }, first.code);
    assert.ok(advanced.result.rows.some((t: Json) => t.template_id === foreignTemplate), "second tier at home is unrestricted");
  } finally {
    await app.close();
  }
});
