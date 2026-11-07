// The one S16b acceptance chain (设计者 11-06: no extra or duplicated full tests):
// a temp content dir holding only neutral.json and xiuxian.json → boot import
// passes → xiuxian place counts per 产品文档 §17 E, eight archetypes, orgs and
// their skills present → start_xiuxian reaches every xiuxian place and
// market_neutral → both translation files cover every content_key of the two
// content files.

import assert from "node:assert/strict";
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { startApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { mustGetRow } from "../src/facts/store.ts";
import { setQuiet } from "../src/log.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REALM = "r1";

test("S16b xiuxian: origin region import, connectivity, translations", async () => {
  setQuiet(true);
  const scratch = join(ROOT, "_work", "临时", `s16b_xiuxian_${process.pid}`);
  await mkdir(scratch, { recursive: true });
  await cp(join(ROOT, "content/world/neutral.json"), join(scratch, "neutral.json"));
  await cp(join(ROOT, "content/world/xiuxian.json"), join(scratch, "xiuxian.json"));
  try {
    const config = await loadConfig({ ...process.env, AIHW_DB_DRIVER: "pglite", AIHW_PGLITE_DIR: "memory", AIHW_PORT: "0", AIHW_CONTENT_DIR: scratch });
    const app = await startApp(config);
    try {
      // §17 E: 1 starter village (seed) + 1 org hall + 6..10 wilderness + 1 tutorial lane.
      const places = await app.db.query<{ id: string; kind: string; features: string[]; combat: string; danger: string; owner_org: string | null }>(
        "SELECT id, kind, features, combat, danger, owner_org FROM places WHERE region = 'xiuxian' ORDER BY id",
      );
      const ids = places.rows.map((r) => r.id);
      assert.ok(ids.includes(`${REALM}:place:start_xiuxian`), "starter village missing");
      // 野外地点: everything outside the starter village, the org halls and the tutorial lane.
      const wild = places.rows.filter((r) => r.kind !== "hall" && r.id !== `${REALM}:place:start_xiuxian` && !r.features.includes("tutorial"));
      // S59 added an 8-place outer ring (tiers 2..9) beyond the §17 E starter band.
      assert.ok(wild.length >= 6 && wild.length <= 18, `field places ${wild.length}`);
      const tutorial = places.rows.filter((r) => r.features.includes("tutorial"));
      assert.equal(tutorial.length, 1);
      const halls = places.rows.filter((r) => r.owner_org !== null && r.kind === "hall");
      assert.ok(halls.length >= 1, "org hall missing");
      const pk = places.rows.filter((r) => r.combat === "pk");
      assert.ok(pk.length >= 1 && pk.length <= 2 && pk.every((r) => r.danger === "high" || r.danger === "medium"), "pk places");

      // Eight archetypes, masters covering tiers 1..3.
      const chars = await app.db.query<{ archetype: string; tier: number; loc: string }>(
        "SELECT archetype, tier, loc FROM chars WHERE origin_region = 'xiuxian' AND loc IN (SELECT id FROM places WHERE region = 'xiuxian') ORDER BY archetype, tier",
      );
      const archetypes = [...new Set(chars.rows.map((r) => r.archetype))].sort();
      assert.deepEqual(archetypes, ["guard", "master", "merchant", "monster", "patroller", "quest_giver", "repairer", "tutorial_opponent"]);
      const masterTiers = chars.rows.filter((r) => r.archetype === "master").map((r) => r.tier).sort();
      // S68 added a tier-6 master at the elixir court, the sigil tower and the registry hall.
      assert.deepEqual(masterTiers, [1, 2, 3, 6, 6, 6]);
      assert.equal(chars.rows.find((r) => r.archetype === "tutorial_opponent")?.loc, `${REALM}:place:xiuxian_trial_lane`);

      // Three named orgs plus the seed registry, each with 2..3 org skills.
      const orgs = await app.db.query<{ id: string; content_key: string; hall: string; skill_defs: string[]; registry: boolean }>(
        "SELECT id, content_key, hall, skill_defs, registry FROM orgs WHERE region = 'xiuxian' ORDER BY id",
      );
      assert.deepEqual(orgs.rows.map((r) => r.content_key).sort(), [
        `content.${REALM}.org.registry_xiuxian`,
        `content.${REALM}.org.xiuxian_jiuhuan`,
        `content.${REALM}.org.xiuxian_taihua`,
        `content.${REALM}.org.xiuxian_yunzhuan`,
      ]);
      for (const org of orgs.rows) {
        assert.ok(org.skill_defs.length >= 2 && org.skill_defs.length <= 3, `${org.id} skills ${org.skill_defs.length}`);
        const hall = await mustGetRow(app.db, "place", org.hall);
        assert.equal(hall.region, "xiuxian");
      }
      assert.equal(orgs.rows.filter((r) => r.registry).length, 1);

      // Connectivity: BFS from the starter village reaches every xiuxian place and the neutral market.
      const all = await app.db.query<{ id: string; exits: { to: string }[] }>("SELECT id, exits FROM places");
      const graph = new Map(all.rows.map((r) => [r.id, r.exits.map((e) => e.to)]));
      const seen = new Set<string>([`${REALM}:place:start_xiuxian`]);
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
      for (const id of ids) assert.ok(seen.has(id), `${id} unreachable`);
      assert.ok(seen.has(`${REALM}:place:market_neutral`), "market_neutral unreachable");

      // Both translation files cover every content_key of the two imported files.
      const contentKeys = new Set<string>();
      for (const file of ["neutral.json", "xiuxian.json"]) {
        const doc = JSON.parse(await readFile(join(scratch, file), "utf8")) as {
          places?: { local: string }[];
          items?: { local: string }[];
          tasks?: { local: string }[];
          orgs?: { local: string }[];
        };
        for (const section of ["place", "item", "task", "org"] as const) {
          const rows = doc[`${section}s` as "places"] ?? [];
          for (const row of rows) contentKeys.add(`content.${REALM}.${section}.${row.local}`);
        }
      }
      contentKeys.add(`content.${REALM}.place.start_xiuxian`);
      contentKeys.add(`content.${REALM}.place.market_neutral`);
      contentKeys.add(`content.${REALM}.org.registry_xiuxian`);
      const zh = JSON.parse(await readFile(join(ROOT, "content/skins/xiuxian/zh-CN.json"), "utf8")) as { entries: { key: string }[] };
      const en = JSON.parse(await readFile(join(ROOT, "content/skins/xiuxian/en.json"), "utf8")) as { entries: { key: string }[] };
      const zhKeys = new Set(zh.entries.map((e) => e.key));
      const enKeys = new Set(en.entries.map((e) => e.key));
      assert.equal(zhKeys.size, enKeys.size);
      for (const k of zhKeys) assert.ok(enKeys.has(k), `en missing ${k}`);
      const missing = [...contentKeys].filter((k) => !zhKeys.has(k));
      assert.deepEqual(missing, []);
    } finally {
      await app.close();
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
