// The one S16b acceptance chain (设计者 11-06: no extra or full-suite tests):
// a temp content dir holding only neutral.json and scifi.json → boot imports
// both → the scifi origin has 1 start + 1 hall + 6..10 wilds + 1 tutorial,
// all eight NPC archetypes, and each new org has 2..3 skills → start_scifi
// reaches every scifi place and market_neutral → both skin tables name every
// content_key in the two files.

import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { startApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { ARCHETYPES } from "../src/facts/enums.ts";
import { setQuiet } from "../src/log.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("S16b scifi: origin import, connectivity, translations", async () => {
  setQuiet(true);
  const scratch = join(REPO, "_work", "临时", `s16b_scifi_${process.pid}`);
  await mkdir(scratch, { recursive: true });
  try {
    await copyFile(join(REPO, "content/world/neutral.json"), join(scratch, "neutral.json"));
    await copyFile(join(REPO, "content/world/scifi.json"), join(scratch, "scifi.json"));

    const config = await loadConfig({
      ...process.env,
      AIHW_DB_DRIVER: "pglite",
      AIHW_PGLITE_DIR: "memory",
      AIHW_PORT: "0",
      AIHW_CONTENT_DIR: scratch,
    });
    const app = await startApp(config);
    try {
      // Origin places: the seed start plus this file, inside the §17 E shape.
      const places = await app.db.query<{ id: string; kind: string; combat: string; features: string[] }>(
        "SELECT id, kind, combat, features FROM places WHERE region = 'scifi'",
      );
      const wilds = places.rows.filter((p) => p.id !== "r1:place:start_scifi" && p.kind !== "hall" && !p.features.includes("tutorial"));
      assert.equal(places.rows.filter((p) => p.id === "r1:place:start_scifi").length, 1);
      assert.equal(places.rows.filter((p) => p.kind === "hall").length, 1);
      assert.ok(wilds.length >= 6 && wilds.length <= 10, `wilds ${wilds.length}`);
      assert.equal(places.rows.filter((p) => p.features.includes("tutorial")).length, 1);
      assert.ok(places.rows.filter((p) => p.combat === "pk").length >= 1);

      // Eight archetypes, the tutorial opponent standing in the tutorial place.
      const npcs = await app.db.query<{ archetype: string; loc: string }>(
        "SELECT archetype, loc FROM chars WHERE kind = 'npc' AND origin_region = 'scifi' AND id LIKE 'r1:char:scifi_%'",
      );
      assert.deepEqual([...new Set(npcs.rows.map((r) => r.archetype))].sort(), [...ARCHETYPES].sort());
      assert.equal(npcs.rows.find((r) => r.archetype === "tutorial_opponent")?.loc, "r1:place:scifi_sim_bay");

      // The three named orgs, each with 2..3 skills; the seed registry is not rebuilt.
      const orgs = await app.db.query<{ local: string; n: string; registry: boolean }>(
        "SELECT split_part(id, ':', 3) AS local, jsonb_array_length(skill_defs)::text AS n, registry FROM orgs WHERE region = 'scifi' ORDER BY local",
      );
      assert.deepEqual(
        orgs.rows.map((r) => r.local),
        ["registry_scifi", "scifi_salvage", "scifi_survey", "scifi_trade"],
      );
      for (const r of orgs.rows.filter((o) => o.local !== "registry_scifi")) {
        const n = Number(r.n);
        assert.equal(r.registry, false);
        assert.ok(n >= 2 && n <= 3, `${r.local} skills ${n}`);
      }

      // Connectivity: from the scifi start, every scifi place and the neutral market.
      const all = await app.db.query<{ id: string; exits: { to: string }[] }>("SELECT id, exits FROM places");
      const graph = new Map(all.rows.map((r) => [r.id, r.exits.map((e) => e.to)]));
      const seen = new Set<string>(["r1:place:start_scifi"]);
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
      assert.ok(seen.has("r1:place:market_neutral"));

      // Both skin tables cover every content_key written in the two imported files.
      // The seed's other three origin places and registries are not in either file.
      const needed = new Set<string>();
      for (const file of ["neutral.json", "scifi.json"]) {
        const data = JSON.parse(await readFile(join(scratch, file), "utf8")) as Record<string, { local?: string }[]>;
        for (const section of ["places", "items", "tasks", "orgs"] as const) {
          const type = section === "places" ? "place" : section === "orgs" ? "org" : section === "items" ? "item" : "task";
          for (const row of data[section] ?? []) if (row.local !== undefined) needed.add(`content.r1.${type}.${row.local}`);
        }
      }
      needed.add("content.r1.place.market_neutral");
      for (const locale of ["zh-CN", "en"]) {
        const table = JSON.parse(await readFile(join(REPO, "content/skins/scifi", `${locale}.json`), "utf8")) as {
          entries: { key: string }[];
        };
        const have = new Set(table.entries.map((e) => e.key));
        const missing = [...needed].filter((k) => !have.has(k));
        assert.deepEqual(missing, [], `${locale} missing ${missing.length}`);
      }
    } finally {
      await app.close();
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
