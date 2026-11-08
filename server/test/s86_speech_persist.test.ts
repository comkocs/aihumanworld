// S86: committed speech survives a restart; expiry and rollback keep their boundaries.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { startApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import type { Db } from "../src/db/db.ts";
import { setQuiet } from "../src/log.ts";
import { dispatch } from "../src/verbs/runner.ts";

type Json = any;

test("S86 speech survives restart, expires, and a rolled-back say leaves no text", async () => {
  setQuiet(true);
  const parent = resolve("../_work/builder");
  await mkdir(parent, { recursive: true });
  const scratch = await mkdtemp(join(parent, "s86-"));
  const config = await loadConfig({ ...process.env, AIHW_DB_DRIVER: "pglite", AIHW_PGLITE_DIR: "memory", AIHW_PORT: "0" });
  config.db.pglite_dir = join(scratch, "db");
  config.clock.enabled = false;
  let app: Awaited<ReturnType<typeof startApp>> | undefined;
  try {
    app = await startApp(config);
    const call = async (verb: string, args: object, bearer: string | null = null): Promise<Json> => {
      const out = await app!.dispatch({ verb, body: { args }, bearer, door: "api" });
      assert.equal(out.status, 200, JSON.stringify(out.body));
      return out.body;
    };
    const joinPlayer = async () => {
      const result = (await call("enter", { mode: "create", skin: "xiuxian", door: "api" })).result;
      return { id: result.char.id as string, code: result.identity_code as string };
    };
    const a = await joinPlayer();
    const b = await joinPlayer();
    const text = "离线时留下的原文";
    const sent = await call("say", { target: a.id, text }, b.code);
    const eventId = sent.result.delivered_event_ids[0] as string;
    const saved = await app.db.query<{ text: string; expires_tick: string }>("SELECT text, expires_tick FROM speech_texts WHERE event_id = $1", [eventId]);
    assert.equal(saved.rows[0]?.text, text);
    assert.equal(BigInt(saved.rows[0]!.expires_tick) - BigInt(sent.tick), 1440n);

    await app.close();
    app = await startApp(config);
    const first = await call("events", {}, a.code);
    const event = first.result.events.find((e: Json) => e.id === eventId);
    assert.equal(event.other_speech, text);
    assert.equal(event.speech_status, "available");
    assert.ok(first.new_speech?.some((e: Json) => e.other_speech === text && e.speech_status === "available"));

    // Force an error after the entire say handler has returned but before COMMIT.
    let rolledBackId: string | undefined;
    const current = app;
    const failingDb: Db = {
      ...current.db,
      tx: (fn) => current.services.speech.transaction(current.db, async (q) => {
        await fn(q);
        rolledBackId = (await q.query<{ event_id: string }>("SELECT event_id FROM speech_texts WHERE text = $1", ["回滚正文"])).rows[0]?.event_id;
        throw new Error("injected rollback after say");
      }),
    };
    const failed = await dispatch({ db: failingDb, realm: config.realm, clock: current.clock, services: current.services }, {
      verb: "say", body: { args: { target: a.id, text: "回滚正文" } }, bearer: b.code, door: "api",
    });
    assert.equal(failed.status, 503);
    assert.ok(rolledBackId);
    assert.equal((await current.db.query("SELECT event_id FROM speech_texts WHERE event_id = $1", [rolledBackId])).rows.length, 0);
    assert.equal((await current.db.query("SELECT id FROM events WHERE id = $1", [rolledBackId])).rows.length, 0);
    assert.equal(current.services.speech.project({ id: rolledBackId, type: "speech" } as never, sent.tick).speech_status, "expired");

    // A reply emitted inside the same transaction is visible in that response too.
    const npc = (await current.db.query<{ id: string }>("SELECT id FROM chars WHERE kind = 'npc' AND state = 'active' AND loc = (SELECT loc FROM chars WHERE id = $1) LIMIT 1", [b.id])).rows[0];
    assert.ok(npc);
    const withNpc = await call("say", { target: npc.id, text: "你好" }, b.code);
    assert.ok(withNpc.result.npc_reply);
    assert.ok(withNpc.new_speech?.some((e: Json) => e.from === npc.id && e.other_speech === withNpc.result.npc_reply.text && e.speech_status === "available"));

    await current.db.query("UPDATE worlds SET tick = $1::bigint, tick_started_at = now()", [saved.rows[0]!.expires_tick]);
    const expired = await call("events", {}, a.code);
    const expiredEvent = expired.result.events.find((e: Json) => e.id === eventId);
    assert.equal(expiredEvent.other_speech, null);
    assert.equal(expiredEvent.speech_status, "expired");
    await current.close();
    app = await startApp(config);
    assert.equal((await app.db.query("SELECT event_id FROM speech_texts WHERE event_id = $1", [eventId])).rows.length, 0);
  } finally {
    await app?.close();
    await rm(scratch, { recursive: true, force: true });
  }
});
