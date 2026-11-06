// The one S16b acceptance chain (设计者 11-06: no complex or duplicated tests):
// a temp content dir holding only neutral.json and fantasy.json (content_dir
// points at it, no other skin file is read) → boot imports both → the fantasy
// origin matches 产品文档 §17 E (start village + org halls + 6..10 wild places
// + one sure-win first challenge), the eight NPC archetypes are all present,
// the named orgs and their skills are in → start_fantasy reaches every fantasy
// place and market_neutral over the exit graph → both translation tables cover
// every content_key in the two files.

import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { startApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { setQuiet } from "../src/log.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ARCHETYPES = ["master", "merchant", "repairer", "guard", "quest_giver", "patroller", "monster", "tutorial_opponent"];

test("S16b fantasy: origin import, connectivity, translations", async () => {
  setQuiet(true);
  const scratch = join(REPO, "_work", "临时", `s16b_fantasy_${process.pid}`);
  await mkdir(scratch, { recursive: true });
  await copyFile(join(REPO, "content/world/neutral.json"), join(scratch, "neutral.json"));
  await copyFile(join(REPO, "content/world/fantasy.json"), join(scratch, "fantasy.json"));
  try {
    const config = await loadConfig({ ...process.env, AIHW_DB_DRIVER: "pglite", AIHW_PGLITE_DIR: "memory", AIHW_PORT: "0", AIHW_CONTENT_DIR: scratch });
    const app = await startApp(config);
    try {
      // §17 E: 1 start village (seed) + org halls + 6..10 wild places + 1 first challenge.
      const places = await app.db.query<{ content_key: string; kind: string; combat: string; features: string[] }>(
        "SELECT content_key, kind, combat, features FROM places WHERE region = 'fantasy' ORDER BY content_key",
      );
      const keys = places.rows.map((r) => r.content_key);
      assert.ok(keys.includes("content.r1.place.start_fantasy"), "seed start village missing");
      const halls = places.rows.filter((r) => r.kind === "hall");
      assert.ok(halls.length >= 1 && halls.length <= 3, `org halls ${halls.length}`);
      const wild = places.rows.filter((r) => r.kind !== "settlement" && r.kind !== "hall");
      assert.ok(wild.length >= 7 && wild.length <= 11, `wild places incl. first challenge ${wild.length}`);
      const pk = wild.filter((r) => r.combat === "pk");
      assert.ok(pk.length >= 1 && pk.length <= 2, `pk places ${pk.length}`);
      const tutorial = places.rows.filter((r) => r.features.includes("tutorial"));
      assert.equal(tutorial.length, 1, "exactly one first-challenge place");

      // Eight archetypes, one each, all standing in the fantasy region.
      const chars = await app.db.query<{ archetype: string; loc: string }>(
        "SELECT archetype, loc FROM chars WHERE id LIKE 'r1:char:fantasy_%' ORDER BY archetype",
      );
      assert.deepEqual(chars.rows.map((r) => r.archetype).sort(), [...ARCHETYPES].sort());
      const locRegion = await app.db.query<{ id: string }>("SELECT id FROM places WHERE region = 'fantasy'");
      const fantasyPlaces = new Set(locRegion.rows.map((r) => r.id));
      for (const c of chars.rows) assert.ok(fantasyPlaces.has(c.loc), `${c.archetype} stands outside the region`);
      const tutorialNpc = await app.db.query<{ loc: string }>(
        "SELECT loc FROM chars WHERE archetype = 'tutorial_opponent' AND id LIKE 'r1:char:fantasy_%'",
      );
      assert.equal(tutorialNpc.rows[0]?.loc, "r1:place:fantasy_yard");

      // The three named orgs, each with its hall in the region and 2..3 skills.
      const orgs = await app.db.query<{ content_key: string; hall: string; skill_defs: string[] }>(
        "SELECT content_key, hall, skill_defs FROM orgs WHERE content_key LIKE 'content.r1.org.fantasy_%' ORDER BY content_key",
      );
      assert.deepEqual(orgs.rows.map((r) => r.content_key), [
        "content.r1.org.fantasy_conclave",
        "content.r1.org.fantasy_watch",
        "content.r1.org.fantasy_wayfarers",
      ]);
      for (const o of orgs.rows) {
        assert.ok(fantasyPlaces.has(o.hall), `${o.content_key} hall outside the region`);
        const n = o.skill_defs.length;
        assert.ok(n >= 2 && n <= 3, `${o.content_key} has ${n} skills`);
      }
      const skills = await app.db.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM skills WHERE record = 'definition' AND key LIKE 'org:r1:org:fantasy_%'",
      );
      assert.equal(skills.rows[0]?.n, "7");

      // Connectivity: BFS from the seed start reaches every fantasy place and the neutral market.
      const all = await app.db.query<{ id: string; exits: { to: string }[] }>("SELECT id, exits FROM places");
      const graph = new Map(all.rows.map((r) => [r.id, r.exits.map((e) => e.to)]));
      const seen = new Set<string>(["r1:place:start_fantasy"]);
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
      for (const id of fantasyPlaces) assert.ok(seen.has(id), `${id} unreachable from start_fantasy`);
      assert.ok(seen.has("r1:place:market_neutral"), "market_neutral unreachable from start_fantasy");

      // Both translation tables cover every content_key of the two imported files.
      const contentKeys = new Set<string>();
      for (const file of ["neutral.json", "fantasy.json"]) {
        const data = JSON.parse(await readFile(join(scratch, file), "utf8")) as Record<string, { local?: string }[]>;
        for (const section of ["places", "items", "tasks", "orgs"]) {
          const type = section === "orgs" ? "org" : section.slice(0, -1);
          for (const row of data[section] ?? []) if (row.local) contentKeys.add(`content.r1.${type}.${row.local}`);
        }
      }
      contentKeys.add("content.r1.place.market_neutral");
      contentKeys.add("content.r1.place.start_fantasy");
      contentKeys.add("content.r1.org.registry_fantasy");
      for (const locale of ["zh-CN", "en"]) {
        const table = JSON.parse(await readFile(join(REPO, "content/skins/fantasy", `${locale}.json`), "utf8")) as {
          entries: { key: string }[];
        };
        const translated = new Set(table.entries.map((e) => e.key));
        const missing = [...contentKeys].filter((k) => !translated.has(k));
        assert.deepEqual(missing, [], `${locale} missing ${missing.length}`);
      }
    } finally {
      await app.close();
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
