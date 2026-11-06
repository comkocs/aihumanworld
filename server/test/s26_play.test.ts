// S26: one file, four original checks and two regressions (设计者 11-06: 不要过多复杂测试、不要重复全量测试).
// 1. GET / with Accept: text/html is HTML and links /play; without it the Markdown
//    is byte-for-byte the pre-change index.
// 2. GET /play and its static files are 200 and carry a CSP header.
// 3. POST /play/v1/enter creates a char whose door is web; /play/v1/look then
//    works with the Authorization header.
// 4. One public page's HTML view does not contain translation_missing.
// Regressions: DOM ids exist before boot; entry requests match the page's field reads.

import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { startApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { setQuiet } from "../src/log.ts";
import type { ItemDefinitionRow, ItemInstanceRow, PublicChar, SkillDefinitionRow, SkillLearnedRow, TaskInstanceRow } from "../src/facts/types.ts";
import type { Cursors, EventsResult } from "../src/verbs/events.ts";
import type { LookResult } from "../src/verbs/look.ts";
import type { OkEnvelope } from "../src/verbs/runner.ts";
import type { WhoamiResult } from "../src/verbs/whoami.ts";

const INDEX_MD = `# AI 人间 · 公开页

只读事实,不含身份码。选皮在网址上加 \`?skin=<皮>&locale=<语言>\`。

- [编年史](/chronicle)
- [区 xiuxian](/region/xiuxian)
- [区 wuxia](/region/wuxia)
- [区 fantasy](/region/fantasy)
- [区 scifi](/region/scifi)
- [区 neutral](/region/neutral)

## 皮 Skins

- xiuxian: en, zh-CN
- wuxia: en, zh-CN
- fantasy: en, zh-CN
- scifi: en, zh-CN
`;

test("S26: html door, play page, web enter, no translation_missing", async (t) => {
  setQuiet(true);
  const config = await loadConfig({ ...process.env, AIHW_DB_DRIVER: "pglite", AIHW_PGLITE_DIR: "memory", AIHW_PORT: "0" });
  const app = await startApp(config);
  try {
    const md = await fetch(`${app.url}/`);
    assert.equal(md.status, 200);
    assert.match(md.headers.get("content-type") ?? "", /^text\/markdown/);
    assert.equal(await md.text(), INDEX_MD);

    const home = await fetch(`${app.url}/`, { headers: { Accept: "text/html", "Accept-Language": "zh-CN" } });
    assert.equal(home.status, 200);
    assert.match(home.headers.get("content-type") ?? "", /^text\/html/);
    const homeBody = await home.text();
    assert.match(homeBody, /href="\/play"/);
    assert.match(homeBody, /https:\/\/aihumanworld\.org\/start\.md/);
    assert.match(homeBody, /https:\/\/aihumanworld\.org\/mcp/);

    const play = await fetch(`${app.url}/play`);
    assert.equal(play.status, 200);
    assert.match(play.headers.get("content-security-policy") ?? "", /default-src 'self'/);
    const js = await fetch(`${app.url}/play/static/play.js`);
    const css = await fetch(`${app.url}/play/static/play.css`);
    assert.equal(js.status, 200);
    assert.equal(css.status, 200);
    assert.match(js.headers.get("content-security-policy") ?? "", /default-src 'self'/);
    assert.match(css.headers.get("content-security-policy") ?? "", /default-src 'self'/);
    const playBody = await play.text();
    const playJs = await js.text();
    const verbsResponse = await fetch(`${app.url}/v1/verbs`);
    assert.equal(verbsResponse.status, 200);
    const catalog = await verbsResponse.json() as {
      verbs: { verb: string; branches: { selector: Record<string, unknown>; args: { properties: Record<string, object>; required: string[] }; ap_cost: number; purpose: string; common_errors: string[] }[] }[];
    };
    assert.equal(catalog.verbs.length, 16);
    assert.equal(new Set(catalog.verbs.map((entry) => entry.verb)).size, 16);
    const use = catalog.verbs.find((entry) => entry.verb === "use")!;
    assert.equal(use.branches.length, 16);
    const buy = use.branches.find((branch) => branch.selector.op === "buy")!;
    assert.deepEqual(buy.args.required, ["op", "item", "npc"]);
    assert.ok(buy.args.properties.item && buy.args.properties.npc);
    assert.equal(typeof buy.ap_cost, "number");
    assert.ok(buy.purpose.length > 0 && buy.common_errors.includes("NOT_HERE"));
    assert.deepEqual(await (await fetch(`${app.url}/v1/actions`)).json(), catalog);
    await t.test("S26: unknown event and task render safely", () => {
      const source = playJs.replace(/main\(\)\.catch\(showError\);\s*$/, "");
      assert.notEqual(source, playJs);
      for (const language of ["zh-CN", "en"]) {
        const context = { navigator: { language }, document: { getElementById: () => ({}) } };
        const result = runInNewContext(source + `\n[eventLine({ type: "r1:unknown:event", data: {} }), taskConditionLine({ tpl: "r1:unknown:task" }), taskConditionLine({ tpl: "reach", mode: "place", place: "r1:place:unknown" })]`, context) as string[];
        for (const line of result) {
          assert.ok(line.length > 0);
          assert.doesNotMatch(line, /r1:|unknown:event|unknown:task/);
        }
        assert.equal(result[0], language === "en" ? "Something happened" : "发生了一件事");
        assert.equal(result[1], language === "en" ? "Complete the task objective" : "完成差事要求");
      }
    });
    await t.test("S47: people lists show 短号 · 标识", () => {
      const source = playJs.replace(/main\(\)\.catch\(showError\);\s*$/, "");
      const probe = `
        [
          charName({ kind: "player", door: "api", handle: "A00003", model: "grok-4.7" }),
          charName({ kind: "player", door: "api", handle: "A00004", model: null }),
          charName({ kind: "player", door: "web", handle: "A00005", model: "grok-4.7" }),
          charName({ kind: "official", door: "api", handle: "A00006", model: "grok-4.7" }),
          charName({ kind: "npc", archetype: "merchant" }),
        ]`;
      for (const language of ["zh-CN", "en"]) {
        const context = { navigator: { language }, document: { getElementById: () => ({}) } };
        const result = runInNewContext(source + "\n" + probe, context) as string[];
        const expected = language === "zh-CN"
          ? ["A00003 · grok-4.7", "A00004 · 未报模型", "A00005 · 网页", "A00006 · grok-4.7 · 官方居民"]
          : ["A00003 · grok-4.7", "A00004 · no model given", "A00005 · web", "A00006 · grok-4.7 · Official resident"];
        for (let i = 0; i < expected.length; i += 1) assert.equal(result[i], expected[i]);
        const npcName = result[4] ?? "";
        assert.equal(npcName.includes("A000"), false);
      }
    });
    await t.test("S26: every literal DOM lookup exists before it is read", () => {
      const ids = new Set([...playBody.matchAll(/\bid=["']([^"']+)["']/g)].map((m) => m[1]));
      const lookups = [...playJs.matchAll(/(?:\$|document\.getElementById)\(\s*["']([^"']+)["']\s*\)/g)];
      assert.ok(lookups.length > 0);
      for (const match of lookups) assert.ok(ids.has(match[1]), `missing initial DOM id: ${match[1]}`);
      for (const html of [homeBody, playBody]) {
        assert.doesNotMatch(html, /\bstyle\s*=/i);
        assert.doesNotMatch(html, /<script\b(?![^>]*\bsrc\s*=)[^>]*>/i);
      }
      assert.match(homeBody, /青冥洲/);
      assert.doesNotMatch(homeBody, /xiuxian · en, zh-CN/);
    });

    const enter = await fetch(`${app.url}/play/v1/enter`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ args: { mode: "create", skin: "xiuxian", door: "web" } }),
    });
    assert.equal(enter.status, 200);
    const created = (await enter.json()) as {
      ok: boolean;
      result: { identity_code: string; char: { id: string; door: string; loc: string } };
    };
    assert.equal(created.ok, true);
    assert.equal(created.result.char.door, "web");

    await t.test("S26: entry requests expose every field the page reads", async () => {
      const fields = (row: object, keys: readonly string[]): void => {
        for (const key of keys) assert.ok(Object.hasOwn(row, key), `missing response field: ${key}`);
      };
      const action = async <R>(verb: string, args: object): Promise<OkEnvelope & { result: R }> => {
        const response = await fetch(`${app.url}/play/v1/${verb}`, {
          method: "POST",
          headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${created.result.identity_code}` },
          body: JSON.stringify({ args }),
        });
        assert.equal(response.status, 200, `${verb} request failed`);
        const out = await response.json() as OkEnvelope & { result: R };
        assert.equal(out.ok, true);
        assert.match(out.tick, /^\d+$/);
        assert.equal(typeof out.ap.remaining, "number");
        assert.equal(typeof out.ap.per_tick, "number");
        return out;
      };
      const paged = (result: { rows: unknown[]; page: object; has_more: boolean }): void => {
        assert.ok(Array.isArray(result.rows));
        fields(result.page, ["after", "through"]);
        assert.equal(typeof result.has_more, "boolean");
      };
      const charFields = ["id", "model", "skin", "kind", "archetype", "tier", "stage", "loc", "life", "state", "door", "coin", "vigor", "xp", "potential", "train_skill"];
      const who = await action<WhoamiResult>("whoami", { section: "char" });
      fields(who.result.char, charFields);
      assert.ok(who.result.derived);
      paged(who.result);

      const definitionResponse = await fetch(`${app.url}/play/definitions`);
      assert.equal(definitionResponse.status, 200);
      const definitions = await definitionResponse.json() as { items: ItemDefinitionRow[]; skills: SkillDefinitionRow[]; places: { id: string; content_key: string }[] };
      assert.ok(definitions.items.length > 0 && definitions.skills.length > 0);
      assert.ok(definitions.places.some((row) => row.id === created.result.char.loc && typeof row.content_key === "string"));
      // B01: the public catalog GET /v1/defs (no auth) carries the same body as the web alias.
      const publicDefs = await fetch(`${app.url}/v1/defs`);
      assert.equal(publicDefs.status, 200);
      assert.match(publicDefs.headers.get("content-type") ?? "", /^application\/json/);
      assert.deepEqual(await publicDefs.json(), definitions);
      // R08: slugs with an underscore are reachable.
      for (const slug of ["use-org_join", "use-org_leave", "use-relation_end", "use-relation_accept", "use-buy", "use-sell", "use-repair"]) {
        assert.equal((await fetch(`${app.url}/act/${slug}`)).status, 200, `GET /act/${slug}`);
      }
      for (const item of definitions.items) {
        fields(item, ["id", "content_key", "kind", "tier", "effect"]);
        assert.equal(item.record, "definition");
        fields(item.effect, ["kind"]);
      }
      for (const skill of definitions.skills) {
        fields(skill, ["id", "key", "base"]);
        assert.equal(skill.record, "definition");
      }
      const place = await action<LookResult>("look", { section: "place" });
      assert.equal(place.result.place.id, created.result.char.loc);
      const visible = place.result as LookResult & { people: PublicChar[]; items: ItemInstanceRow[]; people_total: number };
      assert.ok(Array.isArray(visible.people) && Array.isArray(visible.items));
      // S44: web look caps players and official residents at 20, keeps every NPC, and reports people_total.
      const loc = created.result.char.loc;
      const npc = await app.db.query<{ id: string }>("SELECT id FROM chars WHERE kind = 'npc' AND state <> 'buried' ORDER BY id LIMIT 1");
      assert.ok(npc.rows[0] !== undefined, "seed has an NPC");
      await app.db.query("UPDATE chars SET loc = $1 WHERE id = $2", [loc, npc.rows[0]?.id]);
      const baseLook = await action<LookResult & { people_total: number }>("look", { section: "place" });
      const baseTotal = (baseLook.result as { people_total: number }).people_total;
      for (let i = 0; i < 25; i += 1) {
        const id = `r1:char:s44${String(i).padStart(2, "0")}`;
        await app.db.query(
          `INSERT INTO chars (id, created_tick, updated_tick, kind, door, handle, email_hash, model, skin, origin_region,
             body, tier, stage, xp, potential, vigor, coin, cycles, legacy, loc, respawn_place, life, state, state_since,
             last_seen_tick, last_yield_tick, ap_tick, seen_at, ap_spent, day_index, system_tasks_today,
             known_places, patrol_route, patrol_index)
           VALUES ($1, 1, 1, 'player', 'web', NULL, NULL, NULL, 'xiuxian', 'xiuxian',
             'humanoid', 1, 1, 0, 0, 10, 0, 0, 0, $2, $2,
             'alive', 'active', 0, 0, 0, 0, $3, 0, 0, 0, '[]'::jsonb, '[]'::jsonb, 0)`,
          [id, loc, new Date().toISOString()],
        );
      }
      const crowded = await action<LookResult & { people: PublicChar[]; people_total: number }>("look", { section: "place" });
      const shown = crowded.result.people;
      const residents = shown.filter((c) => c.kind === "player" || c.kind === "official");
      assert.ok(residents.length <= 20);
      assert.ok(shown.some((c) => c.id === npc.rows[0]?.id));
      const npcHere = await app.db.query<{ id: string }>("SELECT id FROM chars WHERE kind = 'npc' AND loc = $1 AND state <> 'buried'", [loc]);
      assert.equal(shown.filter((c) => c.kind === "npc").length, npcHere.rows.length);
      for (const row of npcHere.rows) assert.ok(shown.some((c) => c.id === row.id));
      assert.equal(crowded.result.people_total, baseTotal + 25);
      fields(place.result.place, ["id", "content_key", "region", "kind", "tier", "danger", "combat", "features", "exits"]);
      assert.ok(Array.isArray(place.result.place.features));
      for (const exit of place.result.place.exits) fields(exit, ["dir", "locked", "to"]);
      paged(place.result);
      for (const section of ["people", "items"] as const) {
        const seen = await action<LookResult>("look", { section, limit: null, page: { after: null, through: null } });
        paged(seen.result);
        for (const row of seen.result.rows) {
          if (section === "people") fields(row as PublicChar, charFields.slice(0, 11));
          else {
            fields(row as ItemInstanceRow, ["id", "def_id", "state"]);
            assert.ok(definitions.items.some((def) => def.id === (row as ItemInstanceRow).def_id));
          }
        }
      }
      for (const filter of ["available", "accepted"] as const) {
        const tasks = await action<{ rows: TaskInstanceRow[]; page: object; has_more: boolean }>("task", { op: "list", filter, limit: null, page: { after: null, through: null } });
        paged(tasks.result);
        if (filter === "available") assert.ok(tasks.result.rows.length > 0);
        for (const task of tasks.result.rows) {
          fields(task, ["id", "tpl", "kind", "condition", "reward"]);
          fields(task.reward, ["coin"]);
        }
      }
      for (const section of ["items", "skills"] as const) {
        const own = await action<WhoamiResult>("whoami", { section, limit: null, page: { after: null, through: null } });
        paged(own.result);
        fields(own.result.char, charFields);
        assert.ok(own.result.derived);
        for (const row of own.result.rows) {
          if (section === "items") {
            fields(row as ItemInstanceRow, ["id", "def_id", "state", "equipped"]);
            assert.ok(definitions.items.some((def) => def.id === (row as ItemInstanceRow).def_id));
          } else {
            fields(row as SkillLearnedRow, ["def_id", "level", "cap"]);
            assert.ok(definitions.skills.some((def) => def.id === (row as SkillLearnedRow).def_id));
          }
        }
      }
      let cursors: Cursors = { self: "0", place: { place_id: who.result.char.loc, after: "0" }, world: "0" };
      for (const scope of ["place", "self", "world"] as const) {
        const events = await action<EventsResult>("events", { scope, cursors, limit: null });
        fields(events.result, ["events", "cursors", "has_more"]);
        assert.ok(Array.isArray(events.result.events));
        assert.equal(typeof events.result.has_more, "boolean");
        cursors = events.result.cursors;
        fields(cursors, ["self", "place", "world"]);
        fields(cursors.place, ["place_id", "after"]);
        for (const event of events.result.events) {
          fields(event, ["id", "cursor", "scope", "type", "data", "other_speech", "speech_status"]);
          assert.match(event.cursor, /^\d+$/);
          assert.equal(typeof event.data, "object");
        }
      }
    });

    const page = await fetch(`${app.url}/region/xiuxian`, { headers: { Accept: "text/html" } });
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type") ?? "", /^text\/html/);
    const html = await page.text();
    assert.equal(html.includes("translation_missing"), false);
  } finally {
    await app.close();
  }
});
