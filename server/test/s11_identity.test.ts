// The one S11 acceptance chain (设计者 11-06: 不要过多复杂测试、不要重复全量测试):
// code format & check digits → tampered digit refused → resume (right code /
// wrong code) → promotion after a completed system task → draft TTL cleared →
// active → dormant → buried → revive inside the window → IDENTITY_EXPIRED past
// the window → credential cleared. Lifecycles advance on fixed ticks by running
// the identity phase directly (values come from content/rules/numbers.v1.json).

import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { identityPhase } from "../src/identity/lifecycle.ts";
import { yieldPhase } from "../src/growth/clock.ts";
import { CROCKFORD, checkSymbols, normalizeCode } from "../src/identity/code.ts";
import { mustGetRow } from "../src/facts/store.ts";
import { worldId } from "../src/facts/ids.ts";
import { Writer } from "../src/facts/writer.ts";
import { startApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { setQuiet } from "../src/log.ts";

type Json = any;

test("S11 identity: code, resume, promotion, draft TTL, dormant, bury, revive, window", async () => {
  setQuiet(true);
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const numbers = JSON.parse(await readFile(join(repoRoot, "content", "rules", "numbers.v1.json"), "utf8")) as Json;
  const wr = numbers.world_rules;
  const DRAFT_TTL: number = wr.draft_expire_ticks;
  const DORMANT: number = wr.dormant_after_ticks;
  const BURY: number = wr.bury_after_ticks;
  const WINDOW: number = wr.revive_window_ticks;

  // Scratch config pointing straight at S5's numbers.v1.json (S10's loader
  // reads it natively), so the lifecycle slots are the real periods.
  const scratch = join(repoRoot, "_work", "临时");
  await mkdir(scratch, { recursive: true });
  const configName = `s11_config_${process.pid}.json`;
  await writeFile(
    join(scratch, configName),
    JSON.stringify({
      realm: "r1",
      http: { host: "127.0.0.1", port: 0, body_max_bytes: 65536 },
      db: { driver: "pglite", pglite_dir: "memory", pool_max: 1 },
      rules_file: "../../content/rules/numbers.v1.json",
      content_dir: null,
      clock: { max_catchup_ticks_per_tx: 8 },
    }),
  );

  const app = await startApp(await loadConfig({ AIHW_CONFIG: join(scratch, configName) }));
  try {
    const call = async (verb: string, args: object, code?: string): Promise<{ status: number; body: Json }> => {
      const headers: Record<string, string> = { "Content-Type": "application/json; charset=utf-8" };
      if (code !== undefined) headers.Authorization = `Bearer ${code}`;
      const res = await fetch(`${app.url}/v1/actions/${verb}`, { method: "POST", headers, body: JSON.stringify({ args }) });
      return { status: res.status, body: (await res.json()) as Json };
    };
    const wid = worldId("r1");
    const worldNow = async (): Promise<{ tick: number; started: string }> => {
      const r = await app.db.query<{ tick: string; tick_started_at: string }>("SELECT tick, tick_started_at FROM worlds WHERE id = $1", [wid]);
      return { tick: Number(r.rows[0]?.tick), started: r.rows[0]?.tick_started_at as string };
    };
    // Fixed-tick advance: jump the world to tick `to` and run the identity phase once.
    const T0 = (await worldNow()).tick;
    const baseMs = Date.parse((await worldNow()).started) - T0 * wr.tick_seconds * 1000;
    const advanceTo = async (to: number): Promise<void> => {
      await app.db.tx(async (q) => {
        await q.query("UPDATE worlds SET tick = $1::bigint, tick_started_at = $2, updated_tick = $1::bigint WHERE id = $3", [
          String(to),
          new Date(baseMs + to * wr.tick_seconds * 1000).toISOString(),
          wid,
        ]);
        const world = await mustGetRow(q, "world", wid, { lock: true });
        const w = new Writer(q, "r1", world.tick, world.rules_revision, true);
        await identityPhase.run({ q, w, world, rules: world.rules, balance: app.services.balance(), from_tick: String(to - 1), to_tick: String(to), now: new Date() });
      });
    };
    const charState = async (id: string): Promise<{ state: string; since: string }> => {
      const r = await app.db.query<{ state: string; state_since: string }>("SELECT state, state_since FROM chars WHERE id = $1", [id]);
      return { state: r.rows[0]?.state as string, since: r.rows[0]?.state_since as string };
    };
    const identityOf = async (charId: string): Promise<{ expires: string | null; hash: string }> => {
      const r = await app.db.query<{ expires_tick: string | null; code_hash: string }>(
        "SELECT expires_tick, code_hash FROM identities WHERE char_id = $1",
        [charId],
      );
      return { expires: r.rows[0]?.expires_tick ?? null, hash: r.rows[0]?.code_hash ?? "" };
    };

    // --- code format & check digits ---
    const a = await call("enter", { mode: "create", skin: "xiuxian", door: "api" });
    assert.equal(a.status, 200);
    const codeA: string = a.body.result.identity_code;
    assert.match(codeA, /^AIHW(-[0-9A-HJKMNP-TV-Z]{4}){5}-[0-9A-HJKMNP-TV-Z]{2}$/);
    const body = normalizeCode(codeA).slice(4, -2);
    const check = normalizeCode(codeA).slice(-2);
    assert.equal(checkSymbols(body), check);
    const firstDigit = body[0] ?? "";
    const tamperedDigit = CROCKFORD[(CROCKFORD.indexOf(firstDigit) + 1) % 32] ?? "";
    const tamperedBody = tamperedDigit + body.slice(1);
    assert.notEqual(checkSymbols(tamperedBody), check); // one changed body digit → different check
    const tamperedCode = `AIHW-${tamperedBody.slice(0, 4)}-${tamperedBody.slice(4, 8)}-${tamperedBody.slice(8, 12)}-${tamperedBody.slice(12, 16)}-${tamperedBody.slice(16)}-${check}`;
    const meA: string = a.body.result.char.id;
    assert.equal((await charState(meA)).state, "draft");

    // legal code passes; tampered single digit is refused.
    assert.equal((await call("whoami", {}, codeA)).status, 200);
    const bad = await call("whoami", {}, tamperedCode);
    assert.equal(bad.status, 401);
    assert.equal(bad.body.error.code, "AUTH_INVALID");

    // --- resume: right code returns the same char, wrong code refused ---
    const back = await call("enter", { mode: "resume" }, codeA);
    assert.equal(back.status, 200);
    assert.equal(back.body.result.created, false);
    assert.equal(back.body.result.identity_code, null);
    assert.equal(back.body.result.char.id, meA);
    const wrong = await call("enter", { mode: "resume" }, tamperedCode);
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body.error.code, "AUTH_INVALID");

    // --- promotion: a completed system task fact turns the draft active ---
    await app.db.query(
      `INSERT INTO tasks (id, created_tick, updated_tick, record, tpl, condition, content_key, tier, stage, reward_spec, duration_ticks)
       VALUES ('r1:task:s11tpl', 0, 0, 'template', 'reach', $1::jsonb, 'content.r1.task.s11_done', 1, 1, $2::jsonb, 1440)`,
      [JSON.stringify({ tpl: "reach", mode: "place", place: "r1:place:start_xiuxian" }), JSON.stringify({ coin: 0, xp: 0, potential: 0, rep: 0, item_defs: [] })],
    );
    await app.db.query(
      `INSERT INTO tasks (id, created_tick, updated_tick, record, template_id, kind, tpl, issuer, offer_place, taker, condition, reward, escrow, state, accepted_seq, progress, expires_tick)
       VALUES ('r1:task:s11done', 0, 0, 'instance', 'r1:task:s11tpl', 'system', 'reach', $1::jsonb, 'r1:place:start_xiuxian', $2, $3::jsonb, $4::jsonb, $5::jsonb, 'completed', 1, $6::jsonb, 999999999)`,
      [
        JSON.stringify({ kind: "system", id: wid }),
        meA,
        JSON.stringify({ tpl: "reach", mode: "place", place: "r1:place:start_xiuxian" }),
        JSON.stringify({ coin: 0, xp: 0, potential: 0, rep: 0, items: [] }),
        JSON.stringify({ coin: 0, items: [] }),
        JSON.stringify({ count: 1, evidence: [] }),
      ],
    );
    await advanceTo(T0 + 1);
    const promoted = await call("whoami", {}, codeA);
    assert.equal(promoted.status, 200);
    assert.equal(promoted.body.result.char.state, "active");

    // --- draft TTL: expired draft → buried, credential cleared, AUTH_INVALID ---
    const b = await call("enter", { mode: "create", skin: "wuxia", door: "api" });
    assert.equal(b.status, 200);
    const codeB: string = b.body.result.identity_code;
    const meB: string = b.body.result.char.id;
    const bTick = Number(b.body.result.char.created_tick);
    await advanceTo(bTick + DRAFT_TTL);
    assert.equal((await charState(meB)).state, "buried");
    assert.equal((await identityOf(meB)).hash, "");
    const bGone = await call("whoami", {}, codeB);
    assert.equal(bGone.status, 401);
    assert.equal(bGone.body.error.code, "AUTH_INVALID");

    // --- active → dormant (unseen since last access tick) ---
    const lastA = Number(promoted.body.result.char.last_seen_tick);
    await advanceTo(lastA + DORMANT);
    assert.equal((await charState(meA)).state, "dormant");
    await app.db.query("UPDATE chars SET train_skill = 'inner', last_yield_tick = 0 WHERE id = $1", [meA]);
    const awake = await call("enter", { mode: "resume" }, codeA);
    assert.equal(awake.status, 200);
    assert.equal(awake.body.result.char.last_yield_tick, String(lastA + DORMANT));
    assert.equal((await mustGetRow(app.db, "char", meA)).last_yield_tick, awake.body.result.char.last_yield_tick);
    await app.db.query("UPDATE chars SET state = 'dormant', last_seen_tick = $1::bigint WHERE id = $2", [String(lastA), meA]);

    // --- dormant → buried, revive window scheduled from the bury tick ---
    await advanceTo(lastA + BURY);
    assert.equal((await charState(meA)).state, "buried");
    assert.equal((await identityOf(meA)).expires, String(lastA + BURY + WINDOW));

    // --- IDENTITY_EXPIRED while the hash still exists but the window is past ---
    await app.db.query("UPDATE identities SET expires_tick = 1 WHERE char_id = $1", [meA]);
    const expired = await call("whoami", {}, codeA);
    assert.equal(expired.status, 410);
    assert.equal(expired.body.error.code, "IDENTITY_EXPIRED");
    assert.equal(expired.body.error.details.can_create, true);

    // --- revive inside the window: same code, dormant/buried → active ---
    await app.db.query("UPDATE identities SET expires_tick = $1::bigint WHERE char_id = $2", [String(lastA + BURY + WINDOW), meA]);
    const revive = await call("enter", { mode: "resume" }, codeA);
    assert.equal(revive.status, 200);
    assert.equal(revive.body.result.char.state, "active");
    assert.equal(revive.body.result.char.id, meA);
    assert.equal((await identityOf(meA)).expires, null); // countdown stopped
    assert.equal(revive.body.result.char.last_yield_tick, String(lastA + BURY));
    assert.equal((await mustGetRow(app.db, "char", meA)).last_yield_tick, revive.body.result.char.last_yield_tick);
    await app.db.tx(async (q) => {
      const world = await mustGetRow(q, "world", wid, { lock: true });
      const to = (BigInt(world.tick) + 1n).toString();
      const w = new Writer(q, "r1", to, world.rules_revision, true);
      await yieldPhase.run({ q, w, world, rules: world.rules, balance: app.services.balance(), from_tick: world.tick, to_tick: to, now: new Date() });
    });
    assert.equal((await mustGetRow(app.db, "char", meA)).xp, revive.body.result.char.xp);
    const ev = await call("events", {}, codeA);
    assert.equal(ev.body.result.events.some((e: Json) => e.type === "identity_state" && e.data.reason === "resume" && e.data.to === "active"), true);

    // --- past the window: credential row deleted, the code is dead ---
    await app.db.query("UPDATE chars SET last_seen_tick = $1::bigint WHERE id = $2", [String(lastA), meA]);
    await advanceTo(lastA + BURY);
    assert.equal((await charState(meA)).state, "buried");
    const buryTick = lastA + BURY;
    await advanceTo(buryTick + WINDOW);
    assert.equal((await identityOf(meA)).hash, "");
    const aGone = await call("whoami", {}, codeA);
    assert.equal(aGone.status, 401);
    assert.equal(aGone.body.error.code, "AUTH_INVALID");
  } finally {
    await app.close();
    await rm(join(scratch, configName), { force: true });
  }
});
