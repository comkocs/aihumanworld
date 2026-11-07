// S41 numbers calibration (设计者 11-07 00:1x「现在做校准」), two short chains:
//
// ① 个人首达与世界首例: budgets are computed from the real numbers file and
//   content/world (+ the five seeded places); live walks check personal arrival rewards,
//   world-first uniqueness, and the lower of character and destination tiers.
// ② 换规则演练:a persistent world booted on the old numbers (balance.v1, bonuses ×1/×2/×3)
//   is restarted on the current numbers; world.rules_revision follows, nothing errors,
//   the old char / deeds stay as they were and the next first-find pays the new rate.

import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { startApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { worldId } from "../src/facts/ids.ts";
import { mustGetRow } from "../src/facts/store.ts";
import { Writer } from "../src/facts/writer.ts";
import { yieldPhase } from "../src/growth/clock.ts";
import { setQuiet } from "../src/log.ts";
import { bonusReward } from "../src/tasks/common.ts";
import { taskNumbers, tierNumbers } from "../src/tasks/numbers.ts";

type Json = any;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const NUMBERS = join(repoRoot, "content", "rules", "numbers.v1.json");
const WORLD_DIR = join(repoRoot, "content", "world");
/** Places the seed writes before any content: market_neutral and one start place per skin (all tier 1). */
const SEED_TIER1_PLACES = 5;
const REALM = "r1";

const bp = (base: number, rate: number): number => Math.floor((base * rate) / 10000);

interface Budget {
  /** Σ first_found xp over every place in the world, any tier (a char that walks everywhere). */
  foundAll: number;
  /** Σ first_clear xp over the tier-1 task templates. */
  clearTier1: number;
  /** Σ first_kill xp over the distinct tier-1 (body, archetype, stage) kill keys. */
  killTier1: number;
}

async function budgets(numbers: Json): Promise<Budget> {
  const tierXp = new Map<number, number>((numbers.tiers as Json[]).map((r) => [r.tier as number, r.task_xp as number]));
  const xpOf = (tier: number): number => tierXp.get(tier) ?? assert.fail(`tiers row ${tier}`);
  const rule = numbers.tasks.deed_bonus;
  let foundAll = SEED_TIER1_PLACES * bp(xpOf(1), rule.first_found.xp_bp);
  let clearTier1 = 0;
  const killKeys = new Set<string>();
  for (const realm of ["neutral", "xiuxian", "wuxia", "fantasy", "scifi"]) {
    const file = JSON.parse(await readFile(join(WORLD_DIR, `${realm}.json`), "utf8")) as Json;
    for (const p of (file.places ?? []) as Json[]) foundAll += bp(xpOf(p.tier), rule.first_found.xp_bp);
    for (const t of (file.tasks ?? []) as Json[]) if (t.tier === 1) clearTier1 += bp(xpOf(1), rule.first_clear.xp_bp);
    for (const c of (file.chars ?? []) as Json[]) if (c.tier === 1) killKeys.add(`${c.body}/${c.archetype}/${c.stage}`);
  }
  return { foundAll, clearTier1, killTier1: killKeys.size * bp(xpOf(1), rule.first_kill.xp_bp) };
}

test("S41 ①: personal first arrivals use the lower character or destination tier", async () => {
  setQuiet(true);
  const numbers = JSON.parse(await readFile(NUMBERS, "utf8")) as Json;
  const tier1 = (numbers.tiers as Json[]).find((r) => r.tier === 1);
  const tier9 = (numbers.tiers as Json[]).find((r) => r.tier === 9);
  assert.ok(tier1 && tier9);
  const day = tier1.daily_xp_full as number; // 一阶满勤一天
  const taskXp1 = tier1.task_xp as number;

  // Revision: bumped, and the two copies of the key agree (loadRulesBundle refuses a mismatch).
  assert.equal(numbers.meta.revision_key, "balance.v1.8");
  assert.equal(numbers.world_rules.balance_key, numbers.meta.revision_key);

  const rule = numbers.tasks.deed_bonus;
  const b = await budgets(numbers);
  assert.ok(b.foundAll > day, "personal arrival rewards are no longer bounded by the old world-first budget");
  assert.ok(b.clearTier1 <= day, `first_clear over tier-1 templates ${b.clearTier1} ≤ ${day}`);
  assert.ok(b.killTier1 <= day, `first_kill over tier-1 kill keys ${b.killTier1} ≤ ${day}`);

  const config = await loadConfig({ ...process.env, AIHW_DB_DRIVER: "pglite", AIHW_PGLITE_DIR: "memory", AIHW_PORT: "0" });
  config.clock.enabled = false;
  const app = await startApp(config);
  try {
    assert.equal((await mustGetRow(app.db, "world", worldId(REALM))).rules_revision, "balance.v1.8");
    // The engine's own reward function agrees with the budget arithmetic above.
    const n = taskNumbers(app.services.balance());
    assert.equal(bonusReward(n.bonus.first_found, tierNumbers(n, 9)).xp, bp(tier9.task_xp, rule.first_found.xp_bp));
    assert.equal(bonusReward(n.bonus.first_clear, tierNumbers(n, 1)).xp, bp(taskXp1, rule.first_clear.xp_bp));
    assert.equal(app.services.balance().numbers.tasks.deed_bonus.first_kill.xp_bp, rule.first_kill.xp_bp);

    const call = async (verb: string, args: object, code?: string): Promise<Json> => {
      const headers: Record<string, string> = { "Content-Type": "application/json; charset=utf-8" };
      if (code !== undefined) headers.Authorization = `Bearer ${code}`;
      const res = await fetch(`${app.url}/v1/actions/${verb}`, { method: "POST", headers, body: JSON.stringify({ args }) });
      return (await res.json()) as Json;
    };
    const nextTick = async (): Promise<void> => {
      await app.db.query("UPDATE worlds SET tick_started_at = tick_started_at - interval '60 seconds'");
    };
    const xpOf = async (id: string): Promise<number> => Number((await app.db.query<{ xp: unknown }>("SELECT xp FROM chars WHERE id = $1", [id])).rows[0]?.xp);

    await nextTick();
    const entered = await call("enter", { mode: "create", skin: "xiuxian", door: "api" });
    assert.equal(entered.ok, true);
    const code: string = entered.result.identity_code;
    const me: string = entered.result.char.id;
    assert.equal(entered.result.char.tier, 1);

    // Tier-1 place, first to arrive: floor(300 × first_found.xp_bp / 10000).
    const x0 = await xpOf(me);
    await nextTick();
    const toMarket = await call("go", { dir: "south" }, code);
    assert.equal(toMarket.ok, true);
    assert.equal(toMarket.result.to, "r1:place:market_neutral");
    assert.equal((await xpOf(me)) - x0, bp(taskXp1, rule.first_found.xp_bp));

    // A second character earns the same personal arrival reward at the same place.
    await nextTick();
    const entered2 = await call("enter", { mode: "create", skin: "xiuxian", door: "api" });
    assert.equal(entered2.ok, true);
    const me2: string = entered2.result.char.id;
    const code2: string = entered2.result.identity_code;
    const before2 = await xpOf(me2);
    // A map may reveal a place before any visit; knowing it must not consume the arrival reward.
    await app.db.query("UPDATE chars SET known_places = known_places || $2::jsonb WHERE id = $1", [me2, JSON.stringify(["r1:place:market_neutral"])]);
    await nextTick();
    assert.equal((await call("go", { dir: "south" }, code2)).ok, true);
    assert.equal((await xpOf(me2)) - before2, bp(taskXp1, rule.first_found.xp_bp));
    const worldFirsts = await app.db.query("SELECT id FROM deeds WHERE first_key = $1", ["first_found:r1:place:market_neutral"]);
    assert.equal(worldFirsts.rows.length, 1);
    await nextTick();
    assert.equal((await call("go", { dir: "north" }, code2)).ok, true);
    assert.equal((await xpOf(me2)) - before2, bp(taskXp1, rule.first_found.xp_bp), "birthplace is already visited");
    await nextTick();
    assert.equal((await call("go", { dir: "south" }, code2)).ok, true);
    assert.equal((await xpOf(me2)) - before2, bp(taskXp1, rule.first_found.xp_bp), "returning pays nothing");

    // Tier-1 character arriving at a tier-9 place is capped at tier 1.
    await app.db.query("UPDATE chars SET loc = 'r1:place:wild_t8' WHERE id = $1", [me]);
    const x1 = await xpOf(me);
    await nextTick();
    const toNine = await call("go", { dir: "north" }, code);
    assert.equal(toNine.ok, true);
    assert.equal(toNine.result.to, "r1:place:wild_t9");
    const gained = (await xpOf(me)) - x1;
    assert.equal(gained, bp(taskXp1, rule.first_found.xp_bp));

    // Taken once: leaving and coming back pays nothing.
    await nextTick();
    assert.equal((await call("go", { dir: "south" }, code)).ok, true);
    const x2 = await xpOf(me);
    await nextTick();
    assert.equal((await call("go", { dir: "north" }, code)).ok, true);
    assert.equal(await xpOf(me), x2);

    // Looking at an unvisited location does not turn sight into an arrival.
    await app.db.query("UPDATE chars SET loc = 'r1:place:wild_t7' WHERE id = $1", [me2]);
    const beforeLook = await xpOf(me2);
    await nextTick();
    assert.equal((await call("look", {}, code2)).ok, true);
    assert.equal(await xpOf(me2), beforeLook);
    assert.equal((await app.db.query("SELECT id FROM deeds WHERE first_key = $1", ["first_found:r1:place:wild_t7"])).rows.length, 0);

    const reviveAtSeven = async (): Promise<void> => {
      await app.db.query("UPDATE chars SET loc = 'r1:place:market_neutral', respawn_place = 'r1:place:wild_t7', life = 'dead', revive_tick = 0, growth_due_tick = 0 WHERE id = $1", [me2]);
      await app.db.tx(async (q) => {
        const world = await mustGetRow(q, "world", worldId(REALM), { lock: true });
        const w = new Writer(q, REALM, world.tick, world.rules_revision, true);
        await yieldPhase.run({ q, w, world, rules: world.rules, balance: app.services.balance(), from_tick: world.tick, to_tick: world.tick, now: new Date() });
      });
    };
    await reviveAtSeven();
    assert.equal((await xpOf(me2)) - beforeLook, bp(taskXp1, rule.first_found.xp_bp), "revival pays at the lower tier");
    assert.equal((await app.db.query("SELECT id FROM deeds WHERE first_key = $1", ["first_found:r1:place:wild_t7"])).rows.length, 1);
    const afterRevive = await xpOf(me2);
    await reviveAtSeven();
    assert.equal(await xpOf(me2), afterRevive, "repeated revival pays nothing");
    await nextTick();
    assert.equal((await call("go", { dir: "north" }, code2)).ok, true);
    const afterNine = await xpOf(me2);
    await nextTick();
    assert.equal((await call("go", { dir: "south" }, code2)).ok, true);
    assert.equal(await xpOf(me2), afterNine, "walking back after revival pays nothing");

    // A higher-tier character at a tier-1 destination is capped by the destination.
    await app.db.query("UPDATE chars SET tier = 9, loc = 'r1:place:market_neutral' WHERE id = $1", [me]);
    const beforeLow = await xpOf(me);
    await nextTick();
    assert.equal((await call("go", { dir: "south" }, code)).ok, true);
    assert.equal((await xpOf(me)) - beforeLow, bp(taskXp1, rule.first_found.xp_bp));
  } finally {
    await app.close();
  }
});

test("S41 ②: a world booted on balance.v1 restarts on the new numbers; revision follows, data stays", async () => {
  setQuiet(true);
  const numbers = JSON.parse(await readFile(NUMBERS, "utf8")) as Json;
  const oldKey = "balance.v1";
  const newKey: string = numbers.meta.revision_key;
  assert.notEqual(newKey, oldKey);
  const taskXp1: number = numbers.tiers.find((r: Json) => r.tier === 1).task_xp;
  const newRate: number = numbers.tasks.deed_bonus.first_found.xp_bp;

  // The old numbers: this file with the S41 bonus rates and the revision key put back.
  const old = JSON.parse(JSON.stringify(numbers)) as Json;
  old.meta.revision_key = oldKey;
  old.world_rules.balance_key = oldKey;
  old.tasks.deed_bonus = {
    first_found: { xp_bp: 10000, potential_bp: 10000, rep_mult: 1 },
    first_kill: { xp_bp: 20000, potential_bp: 20000, rep_mult: 2 },
    first_clear: { xp_bp: 30000, potential_bp: 30000, rep_mult: 3 },
  };

  const scratch = join(repoRoot, "_work", "临时", "S41", `rehearsal_${process.pid}`);
  await rm(scratch, { recursive: true, force: true });
  await mkdir(scratch, { recursive: true });
  const write = async (name: string, rulesFile: string): Promise<string> => {
    const file = join(scratch, name);
    await writeFile(
      file,
      JSON.stringify({
        realm: REALM,
        http: { host: "127.0.0.1", port: 0, body_max_bytes: 65536 },
        db: { driver: "pglite", pglite_dir: "db", pool_max: 1 },
        rules_file: rulesFile,
        content_dir: WORLD_DIR,
        clock: { max_catchup_ticks_per_tx: 8 },
      }),
    );
    return file;
  };
  await writeFile(join(scratch, "numbers_old.json"), JSON.stringify(old));
  const oldConfig = await write("server_old.json", "numbers_old.json");
  const newConfig = await write("server_new.json", NUMBERS);

  const open = async (configFile: string) => {
    const config = await loadConfig({ AIHW_CONFIG: configFile });
    config.clock.enabled = false;
    return startApp(config);
  };
  const callOn = (app: Awaited<ReturnType<typeof open>>) => async (verb: string, args: object, code?: string): Promise<Json> => {
    const headers: Record<string, string> = { "Content-Type": "application/json; charset=utf-8" };
    if (code !== undefined) headers.Authorization = `Bearer ${code}`;
    const res = await fetch(`${app.url}/v1/actions/${verb}`, { method: "POST", headers, body: JSON.stringify({ args }) });
    return (await res.json()) as Json;
  };
  const advance = async (app: Awaited<ReturnType<typeof open>>): Promise<void> => {
    await app.db.query("UPDATE worlds SET tick_started_at = tick_started_at - interval '60 seconds'");
  };

  try {
    // ---- boot 1 on the old numbers: a char first-finds the market at the old rate ----
    let charId = "";
    let code = "";
    let before: Json = null;
    {
      const app = await open(oldConfig);
      try {
        const call = callOn(app);
        assert.equal((await mustGetRow(app.db, "world", worldId(REALM))).rules_revision, oldKey);
        await advance(app);
        const entered = await call("enter", { mode: "create", skin: "xiuxian", door: "api" });
        assert.equal(entered.ok, true);
        charId = entered.result.char.id;
        code = entered.result.identity_code;
        await advance(app);
        assert.equal((await call("go", { dir: "south" }, code)).ok, true);
        before = await mustGetRow(app.db, "char", charId);
        assert.equal(before.xp, bp(taskXp1, 10000), "old rate: a full tier-1 task for the first find");
      } finally {
        await app.close();
      }
    }

    // ---- boot 2 on the new numbers, same database directory ----
    const app = await open(newConfig);
    try {
      const call = callOn(app);
      const world = await mustGetRow(app.db, "world", worldId(REALM));
      assert.equal(world.rules_revision, newKey);
      assert.equal((world.rules as Json).balance_key, newKey);
      // The old char is exactly as it was left.
      assert.deepEqual(await mustGetRow(app.db, "char", charId), before);
      const revisions = (await app.db.query<{ rules_revision: string }>("SELECT DISTINCT rules_revision FROM deeds")).rows.map((r) => r.rules_revision);
      assert.ok(revisions.includes(oldKey), "deeds written before the restart keep the old revision");
      // The same code still works, and the next first find pays the new rate.
      await advance(app);
      const whoami = await call("whoami", {}, code);
      assert.equal(whoami.ok, true);
      assert.equal(whoami.rules_revision, newKey);
      await advance(app);
      const went = await call("go", { dir: "south" }, code);
      assert.equal(went.ok, true);
      assert.equal(went.result.to, "r1:place:start_fantasy");
      const after = await mustGetRow(app.db, "char", charId);
      assert.equal(after.xp - before.xp, bp(taskXp1, newRate), "new rate on the first find after the restart");
      assert.ok((await app.db.query<{ rules_revision: string }>("SELECT DISTINCT rules_revision FROM deeds")).rows.some((r) => r.rules_revision === newKey));
    } finally {
      await app.close();
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
