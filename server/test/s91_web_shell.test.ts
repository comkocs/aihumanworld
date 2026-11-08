// S91：只验网页改动面；七类 HTML 分流、原 Markdown、只读投影与旧壳退路。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { startApp } from "../src/app.ts";
import { loadConfig, SERVER_ROOT } from "../src/config.ts";
import { setQuiet } from "../src/log.ts";
import { pageBlocks } from "../src/public/html.ts";
import { indexDoc, renderPage, resolveSkin, type PageKind } from "../src/public/pages.ts";
import { loadSkins } from "../src/public/skins.ts";

test("S91：Vue 壳、原 Markdown、公开只读数据与回退", async () => {
  setQuiet(true);
  const config = await loadConfig({ ...process.env, AIHW_DB_DRIVER: "pglite", AIHW_PGLITE_DIR: "memory", AIHW_PORT: "0" });
  config.clock.enabled = false;
  const previous = process.env.AIHW_WEB_LEGACY;
  delete process.env.AIHW_WEB_LEGACY;
  const app = await startApp(config);
  try {
    const book = await loadSkins(join(SERVER_ROOT, "..", "content", "skins"));
    const chosen = resolveSkin(book, new URLSearchParams("skin=xiuxian&locale=zh-CN"));
    const npc = (await app.db.query<{ id: string }>("SELECT id FROM chars WHERE kind = 'npc' ORDER BY id LIMIT 1")).rows[0]!.id;
    const entered = await fetch(app.url + "/v1/actions/enter", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ args: { mode: "create", skin: "xiuxian", door: "api" } }),
    });
    const char = ((await entered.json()) as { result: { char: { id: string; handle: string } } }).result.char;
    const org = (await app.db.query<{ id: string }>("SELECT id FROM orgs ORDER BY id LIMIT 1")).rows[0]!.id;
    for (const [seq, visibility] of [[900001, "world"], [900002, "self"]] as const) {
      await app.db.query(`INSERT INTO deeds (id, seq, tick, actor, verb, kind, targets, place_id, result, visibility, participants, rules_revision, first_key)
        VALUES ($1, $2, $2, $3, 'attack', 'first_kill', $4::jsonb, $5, $6::jsonb, $7, $8::jsonb, 'v1', $9)`,
      [`r1:deed:s91_${seq}`, seq, char.id, JSON.stringify([npc]), "r1:place:start_xiuxian", JSON.stringify({ outcome: "success" }), visibility, JSON.stringify([char.id]), `s91_${seq}`]);
    }
    const worldEvents = [
      { kind: "beast_tide", phase: "open" }, { kind: "beast_tide", phase: "close" },
      { kind: "secret_realm", phase: "open" }, { kind: "secret_realm", phase: "close" },
    ] as const;
    for (const [i, event] of worldEvents.entries()) {
      const seq = 900003 + i;
      await app.db.query(`INSERT INTO deeds (id, seq, tick, actor, verb, kind, targets, place_id, result, visibility, participants, rules_revision, first_key)
        VALUES ($1, $2, $2, NULL, 'clock', 'world_event', $3::jsonb, $4, $5::jsonb, 'world', '[]'::jsonb, 'v1', NULL)`,
      [`r1:deed:s91_${seq}`, seq, JSON.stringify(["r1:place:start_xiuxian"]), "r1:place:start_xiuxian", JSON.stringify({ outcome: "success", world_event: { ...event, tier: 1 }, changes: [] })]);
    }
    const pages: { path: string; kind: PageKind; ref: string | null }[] = [
      { path: "/chronicle", kind: "chronicle", ref: null },
      { path: "/region/xiuxian", kind: "region", ref: "xiuxian" },
      { path: "/place/r1:place:start_xiuxian", kind: "place", ref: "r1:place:start_xiuxian" },
      { path: `/char/${char.id}`, kind: "char", ref: char.id },
      { path: `/org/${org}`, kind: "org", ref: org },
    ];
    const get = (path: string, accept: string) => fetch(app.url + path, { headers: { Accept: accept, "Accept-Language": "zh-CN" } });
    const shell = await readFile(join(SERVER_ROOT, "src/public/web-dist/index.html"), "utf8");
    for (const path of ["/", ...pages.map(p => p.path), "/play"]) {
      const html = await get(path + chosen.query, "text/html");
      assert.equal(html.status, 200, path);
      assert.match(html.headers.get("content-type") ?? "", /^text\/html/);
      assert.equal(await html.text(), shell, path);
    }
    const homeMd = await get("/" + chosen.query, "text/markdown");
    assert.equal(await homeMd.text(), indexDoc(book, chosen.query).markdown);
    for (const p of pages) {
      const expected = await renderPage(app.db, { kind: p.kind, ref: p.ref, lexicon: chosen.lexicon });
      assert.ok(expected);
      const markdown = await get(p.path + chosen.query, "text/markdown");
      assert.match(markdown.headers.get("content-type") ?? "", /^text\/markdown/);
      assert.equal(await markdown.text(), expected.markdown, p.path);
      const data = await get(`/v1/page${chosen.query}&path=${encodeURIComponent(p.path)}`, "application/json");
      assert.equal(data.status, 200, p.path);
      assert.match(data.headers.get("content-type") ?? "", /^application\/json/);
      const projected = await data.json() as {
        deeds: Record<string, { tick: string; kind: string; actor: string | null; targets: string[]; place: string; result?: { world_event: { kind: string; phase: string } } }>;
        deedNames: Record<string, { handle?: string; content_key?: string }>;
        [key: string]: unknown;
      };
      const { deeds, deedNames, ...original } = projected;
      assert.deepEqual(original, { kind: p.kind, ...pageBlocks(expected.markdown), query: chosen.query });
      if (["chronicle", "place", "char"].includes(p.kind)) {
        assert.deepEqual(deeds["r1:deed:s91_900001"], { tick: "900001", kind: "first_kill", actor: char.id, targets: [npc], place: "r1:place:start_xiuxian" });
        assert.equal(deedNames[char.id]?.handle, char.handle);
        assert.ok(deedNames[npc]);
        assert.equal(deedNames["r1:place:start_xiuxian"]?.content_key, "content.r1.place.start_xiuxian");
        assert.equal(deeds["r1:deed:s91_900002"], undefined);
        if (p.kind !== "char") for (const [i, event] of worldEvents.entries()) {
          const seq = 900003 + i;
          assert.deepEqual(deeds[`r1:deed:s91_${seq}`], {
            tick: String(seq), kind: "world_event", actor: null, targets: ["r1:place:start_xiuxian"],
            place: "r1:place:start_xiuxian", result: { world_event: event },
          });
        }
      } else assert.deepEqual(deeds, {});
    }
    const assets = [...shell.matchAll(/(?:src|href)="(\/web\/assets\/[^\"]+)"/g)].map(m => m[1]!);
    assert.equal(assets.length, 2);
    for (const path of assets) {
      const response = await get(path, "*/*");
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") ?? "", path.endsWith(".css") ? /^text\/css/ : /^text\/javascript/);
      assert.ok((await response.text()).length > 0);
    }
    // play.js 保留原文；Vue 在挂载固定 DOM 后才装载它。
    const playJs = await (await get("/play/static/play.js", "*/*")).text();
    const playComponent = await readFile(join(SERVER_ROOT, "../web/src/PlayView.vue"), "utf8");
    const ids = new Set([...playComponent.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
    for (const lookup of playJs.matchAll(/(?:\$|document\.getElementById)\(\s*["']([^"']+)["']\s*\)/g)) {
      assert.ok(ids.has(lookup[1]), `Vue 挂载前缺少节点：${lookup[1]}`);
    }
    const playMarkdown = await (await get("/play", "text/markdown")).text();
    assert.match(playMarkdown, /id="gate"/);
    assert.match(playMarkdown, /\/play\/static\/play\.js/);
    for (const path of ["/v1/online", "/v1/defs"]) {
      assert.deepEqual(await (await get(path, "text/html")).json(), await (await get(path, "application/json")).json());
    }
    process.env.AIHW_WEB_LEGACY = "1";
    const legacy = await (await get("/", "text/html")).text();
    assert.match(legacy, /href="\/play"/);
    assert.doesNotMatch(legacy, /id="app"/);
    assert.equal(await (await get("/play", "text/html")).text(), playMarkdown);
  } finally {
    if (previous === undefined) delete process.env.AIHW_WEB_LEGACY;
    else process.env.AIHW_WEB_LEGACY = previous;
    await app.close();
  }
});
