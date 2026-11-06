// The one S16b acceptance chain (设计者 11-06: no extra or repeated full-suite tests):
// a temp content dir holding only neutral.json and wuxia.json → boot import
// passes → the wuxia origin region has the §17 E place shape, all eight NPC
// archetypes, the named orgs with their skills → start_wuxia reaches every
// wuxia place and market_neutral → both wuxia translation tables cover every
// content key of the two files.

import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { startApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { setQuiet } from "../src/log.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ARCHETYPES = ["guard", "master", "merchant", "monster", "patroller", "quest_giver", "repairer", "tutorial_opponent"];

test("S16b wuxia: origin content, connectivity, translations", async () => {
  setQuiet(true);
  const scratch = join(REPO, "_work", "临时", `s16b_wuxia_${process.pid}`);
  await mkdir(scratch, { recursive: true });
  try {
    for (const file of ["neutral.json", "wuxia.json"]) {
      await writeFile(join(scratch, file), await readFile(join(REPO, "content", "world", file)));
    }
    const config = await loadConfig({
      ...process.env,
      AIHW_DB_DRIVER: "pglite",
      AIHW_PGLITE_DIR: "memory",
      AIHW_PORT: "0",
      AIHW_CONTENT_DIR: scratch,
    });
    assert.equal(config.content_dir, scratch);
    const app = await startApp(config);
    try {
      const places = await app.db.query<{ id: string; content_key: string; kind: string; combat: string; danger: string; features: string[] }>(
        "SELECT id, content_key, kind, combat, danger, features FROM places WHERE region = 'wuxia'",
      );
      const wild = places.rows.filter((p) => p.id !== "r1:place:start_wuxia" && p.kind !== "hall");
      assert.ok(wild.length >= 6 && wild.length <= 10, `wild places ${wild.length}`);
      assert.equal(places.rows.filter((p) => p.kind === "hall").length, 3);
      assert.ok(places.rows.some((p) => p.features.includes("tutorial")));
      assert.ok(places.rows.filter((p) => p.combat === "pk" && p.danger === "high").length >= 1);

      const arch = await app.db.query<{ archetype: string }>(
        "SELECT DISTINCT archetype FROM chars WHERE kind = 'npc' AND origin_region = 'wuxia' ORDER BY archetype",
      );
      assert.deepEqual(arch.rows.map((r) => r.archetype), ARCHETYPES);
      const masters = await app.db.query<{ tier: number }>(
        "SELECT tier FROM chars WHERE archetype = 'master' AND origin_region = 'wuxia' AND loc <> 'r1:place:camp_neutral' ORDER BY tier",
      );
      assert.deepEqual(masters.rows.map((r) => r.tier), [1, 2, 3]);
      const tutorial = await app.db.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM chars WHERE archetype = 'tutorial_opponent' AND loc = 'r1:place:wuxia_tutorial_lane'",
      );
      assert.equal(tutorial.rows[0]?.n, "1");

      const orgs = await app.db.query<{ content_key: string; n: number }>(
        "SELECT content_key, jsonb_array_length(skill_defs) AS n FROM orgs WHERE region = 'wuxia' ORDER BY content_key",
      );
      assert.deepEqual(
        orgs.rows.map((r) => r.content_key),
        ["content.r1.org.registry_wuxia", "content.r1.org.wuxia_escort", "content.r1.org.wuxia_herb", "content.r1.org.wuxia_martial"],
      );
      for (const r of orgs.rows) assert.ok(r.n >= 2 && r.n <= 3, `${r.content_key} skills ${r.n}`);

      const all = await app.db.query<{ id: string; exits: { to: string }[] }>("SELECT id, exits FROM places");
      const graph = new Map(all.rows.map((r) => [r.id, r.exits.map((e) => e.to)]));
      const seen = new Set<string>(["r1:place:start_wuxia"]);
      const queue = [...seen];
      while (queue.length > 0) {
        const id = queue.shift()!;
        for (const next of graph.get(id) ?? []) {
          if (!seen.has(next)) {
            seen.add(next);
            queue.push(next);
          }
        }
      }
      for (const p of places.rows) assert.ok(seen.has(p.id), `${p.id} unreachable`);
      assert.ok(seen.has("r1:place:market_neutral"), "market_neutral unreachable");

      const contentKeys = new Set<string>();
      for (const file of ["neutral.json", "wuxia.json"]) {
        const doc = JSON.parse(await readFile(join(scratch, file), "utf8")) as Record<string, { local: string }[]>;
        for (const section of ["places", "items", "tasks", "orgs"]) {
          for (const row of doc[section] ?? []) contentKeys.add(`content.r1.${section.replace(/s$/, "")}.${row.local}`);
        }
      }
      contentKeys.add("content.r1.place.market_neutral");
      contentKeys.add("content.r1.place.start_wuxia");
      contentKeys.add("content.r1.org.registry_wuxia");
      for (const locale of ["zh-CN", "en"]) {
        const table = JSON.parse(await readFile(join(REPO, "content", "skins", "wuxia", `${locale}.json`), "utf8")) as {
          entries: { key: string }[];
        };
        const named = new Set(table.entries.map((e) => e.key));
        const missing = [...contentKeys].filter((k) => !named.has(k));
        assert.deepEqual(missing, [], `${locale} missing ${missing.length}`);
      }
      const zh = JSON.parse(await readFile(join(REPO, "content", "skins", "wuxia", "zh-CN.json"), "utf8")) as { entries: { key: string }[] };
      const en = JSON.parse(await readFile(join(REPO, "content", "skins", "wuxia", "en.json"), "utf8")) as { entries: { key: string }[] };
      assert.deepEqual(zh.entries.map((e) => e.key).sort(), en.entries.map((e) => e.key).sort());
    } finally {
      await app.close();
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
