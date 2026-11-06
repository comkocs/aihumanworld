// The one S16a acceptance chain (设计者 11-06: no complex or duplicated tests):
// start (boot imports only neutral.json, copied into a temp content dir as in
// test/s16b_*) → neutral place count 30..50
// → 81 equipment definitions (3 kinds × 9 tiers × 3 grades) → 9 monster tiers
// → 5 task templates per tier → market_neutral reaches all four start places
// over the exit graph → importing again inserts nothing → orgs / org skills from
// a temp file (new org owning its hall, skills added to a registry org) → again
// inserts nothing.

import assert from "node:assert/strict";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { startApp } from "../src/app.ts";
import { importWorldContent } from "../src/content/index.ts";
import { loadConfig } from "../src/config.ts";
import { SKINS } from "../src/facts/enums.ts";
import { mustGetRow } from "../src/facts/store.ts";
import { loadRulesBundle } from "../src/growth/rules_source.ts";
import { setQuiet } from "../src/log.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("S16a content: neutral import, connectivity, idempotence", async () => {
  setQuiet(true);
  // Neutral content only: the four origin files (S16b) stay out of this world.
  const contentDir = join(REPO, "_work", "临时", `s16a_content_${process.pid}`);
  await mkdir(contentDir, { recursive: true });
  await copyFile(join(REPO, "content/world/neutral.json"), join(contentDir, "neutral.json"));
  const config = await loadConfig({ ...process.env, AIHW_DB_DRIVER: "pglite", AIHW_PGLITE_DIR: "memory", AIHW_PORT: "0", AIHW_CONTENT_DIR: contentDir });
  const app = await startApp(config);
  try {
    // Neutral places: seed market + imported set, inside the 30..50 band.
    const places = await app.db.query<{ id: string; exits: { to: string }[] }>("SELECT id, exits FROM places WHERE region = 'neutral'");
    assert.ok(places.rows.length >= 30 && places.rows.length <= 50, `neutral places ${places.rows.length}`);

    // Equipment: 3 kinds × 9 tiers × 3 grades = 81 distinct definitions.
    const equip = await app.db.query<{ n: string; u: string }>(
      "SELECT count(*)::text AS n, count(DISTINCT (kind, tier, grade))::text AS u FROM items WHERE record = 'definition' AND kind IN ('blade', 'light_armor', 'ring')",
    );
    assert.equal(equip.rows[0]?.n, "81");
    assert.equal(equip.rows[0]?.u, "81");

    // Monsters: one per tier 1..9 (9 档).
    const monsters = await app.db.query<{ tier: number }>("SELECT tier FROM chars WHERE kind = 'npc' AND archetype = 'monster' ORDER BY tier");
    assert.deepEqual(monsters.rows.map((r) => r.tier), [1, 2, 3, 4, 5, 6, 7, 8, 9]);

    // Task templates: 5 tpls × 9 tiers; masters t2..t9 with skills at the hard cap.
    const tpls = await app.db.query<{ tpl: string; n: string }>(
      "SELECT tpl, count(*)::text AS n FROM tasks WHERE record = 'template' GROUP BY tpl ORDER BY tpl",
    );
    assert.deepEqual(tpls.rows, [
      { tpl: "deliver", n: "9" },
      { tpl: "find", n: "9" },
      { tpl: "gather", n: "9" },
      { tpl: "reach", n: "9" },
      { tpl: "slay", n: "9" },
    ]);
    const masters = await app.db.query<{ tier: number }>("SELECT tier FROM chars WHERE archetype = 'master' ORDER BY tier");
    assert.deepEqual(masters.rows.map((r) => r.tier), [2, 3, 4, 5, 6, 7, 8, 9]);
    const skills = await app.db.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM skills WHERE record = 'learned' AND char_id IN (SELECT id FROM chars WHERE archetype = 'master')",
    );
    assert.equal(skills.rows[0]?.n, "32"); // 8 masters × 4 base skills

    // Connectivity: BFS over all exits from the seed market reaches every start place.
    const all = await app.db.query<{ id: string; exits: { to: string }[] }>("SELECT id, exits FROM places");
    const graph = new Map(all.rows.map((r) => [r.id, r.exits.map((e) => e.to)]));
    const seen = new Set<string>(["r1:place:market_neutral"]);
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
    for (const skin of SKINS) assert.ok(seen.has(`r1:place:start_${skin}`), `start_${skin} unreachable`);

    // Idempotence: importing the same files again inserts nothing.
    const bundle = await loadRulesBundle(config.config_dir, config.rules_file);
    const again = await importWorldContent(app.db, config.realm, bundle, contentDir);
    assert.equal(again.inserted.place + again.inserted.item + again.inserted.task + again.inserted.char + again.inserted.skill + again.inserted.exit, 0);

    // Orgs + org skills (minimal temp file, neutral.json untouched): a new org whose
    // hall it owns, and two org skills added to the seed's registry org (not rebuilt).
    const scratch = join(REPO, "_work", "临时", `s16a_orgs_${process.pid}`);
    await mkdir(scratch, { recursive: true });
    try {
      const member = { rank: 0, key: "org_rank.member", can_promote: false, can_expel: false };
      await writeFile(
        join(scratch, "orgs.json"),
        JSON.stringify({
          schema: "aihw.content.v1",
          places: [{ local: "s16a_sect_hall", region: "xiuxian", kind: "hall", features: [], tier: 1, danger: "safe", combat: "safe", owner_org: "org:s16a_sect", exits: [] }],
          orgs: [
            { local: "s16a_sect", region: "xiuxian", hall: "place:s16a_sect_hall", ranks: [member, { rank: 1, key: "org_rank.elder", can_promote: true, can_expel: true }] },
            { local: "registry_xiuxian", region: "xiuxian", hall: "place:start_xiuxian", ranks: [member] },
          ],
          org_skills: [
            { org: "org:s16a_sect", local: "sword", base: "strike", tier: 1 },
            { org: "org:s16a_sect", local: "step", base: "move", tier: 2 },
            { org: "org:registry_xiuxian", local: "breath", base: "inner", tier: 1 },
            { org: "org:registry_xiuxian", local: "palm", base: "strike", tier: 1 },
          ],
        }),
      );
      const first = await importWorldContent(app.db, config.realm, bundle, scratch);
      assert.deepEqual([first.inserted.org, first.skipped.org, first.inserted.skill, first.inserted.place], [1, 1, 4, 1]);
      const sect = await mustGetRow(app.db, "org", "r1:org:s16a_sect");
      assert.deepEqual([sect.content_key, sect.registry, sect.hall, sect.treasury], ["content.r1.org.s16a_sect", false, "r1:place:s16a_sect_hall", 0]);
      assert.deepEqual(sect.skill_defs, ["r1:skill:org_s16a_sect_sword", "r1:skill:org_s16a_sect_step"]);
      assert.deepEqual([sect.goal.kind, sect.goal.target, sect.goal.progress, sect.goal.settled], ["system_tasks", bundle.balance.org_goal.target, 0, false]);
      assert.equal((await mustGetRow(app.db, "place", "r1:place:s16a_sect_hall")).owner_org, sect.id);
      const sword = await mustGetRow(app.db, "skill", "r1:skill:org_s16a_sect_sword");
      assert.ok(sword.record === "definition");
      assert.deepEqual([sword.key, sword.base, sword.org_id, sword.tier], ["org:r1:org:s16a_sect:sword", "strike", sect.id, 1]);
      const registry = await mustGetRow(app.db, "org", "r1:org:registry_xiuxian");
      assert.deepEqual([registry.registry, registry.ranks.length, registry.skill_defs.length], [true, 1, 2]);
      // Idempotent: the same file again inserts nothing and changes nothing.
      const second = await importWorldContent(app.db, config.realm, bundle, scratch);
      assert.deepEqual([second.inserted.org, second.inserted.skill, second.inserted.place, second.skipped.org, second.skipped.skill], [0, 0, 0, 2, 4]);
      assert.deepEqual(await mustGetRow(app.db, "org", "r1:org:s16a_sect"), sect);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  } finally {
    try {
      await app.close();
    } finally {
      await rm(contentDir, { recursive: true, force: true });
    }
  }
});
