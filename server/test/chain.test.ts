// The one S9 acceptance chain (设计者 11-06: 不要过多复杂测试、不要重复全量测试):
// start (PGlite in memory) → enter create → whoami → look → events (self + counts)
// → budget refusal (unit, since these four verbs cost 0). All 16 verbs are
// implemented, so the chain no longer probes NOT_IMPLEMENTED.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { startApp } from "../src/app.ts";
import { trySpend } from "../src/clock/budget.ts";
import { loadConfig } from "../src/config.ts";
import { setQuiet } from "../src/log.ts";

// Response bodies are checked field by field below.
type Json = any;

test("S9 chain: enter → whoami → look → events → budget", async () => {
  setQuiet(true);
  const config = await loadConfig({ ...process.env, AIHW_DB_DRIVER: "pglite", AIHW_PGLITE_DIR: "memory", AIHW_PORT: "0" });
  const app = await startApp(config);
  try {
    const call = async (verb: string, args: object, code?: string): Promise<{ status: number; body: Json }> => {
      const headers: Record<string, string> = { "Content-Type": "application/json; charset=utf-8" };
      if (code !== undefined) headers.Authorization = `Bearer ${code}`;
      const res = await fetch(`${app.url}/v1/actions/${verb}`, { method: "POST", headers, body: JSON.stringify({ args }) });
      return { status: res.status, body: (await res.json()) as Json };
    };

    // enter create: A7-format code shown once, draft char at the xiuxian start place.
    const enter = await call("enter", { mode: "create", skin: "xiuxian", door: "api" });
    assert.equal(enter.status, 200);
    assert.equal(enter.body.ok, true);
    assert.equal(enter.body.protocol, "aihw.v1");
    const code: string = enter.body.result.identity_code;
    assert.match(code, /^AIHW(-[0-9A-HJKMNP-TV-Z]{4}){5}-[0-9A-HJKMNP-TV-Z]{2}$/);
    const me = enter.body.result.char;
    assert.equal(me.state, "draft");
    assert.equal(me.loc, "r1:place:start_xiuxian");
    assert.equal(enter.body.ap.remaining, 3);
    // Only SHA-256 of the normalised code is stored; the code itself nowhere.
    const stored = await app.db.query<{ code_hash: string }>("SELECT code_hash FROM identities WHERE char_id = $1", [me.id]);
    assert.equal(stored.rows[0]?.code_hash, createHash("sha256").update(code.replaceAll("-", "")).digest("hex"));

    // whoami: own row, derived stats, four base skills and the registry membership.
    const who = await call("whoami", {}, code);
    assert.equal(who.status, 200);
    assert.equal(who.body.result.char.id, me.id);
    assert.equal(typeof who.body.result.derived.vigor_max, "number");
    assert.equal(who.body.result.counts.skills, 4);
    assert.equal(who.body.result.counts.bonds, 1);

    // look: the start place with its exit to the neutral market.
    const look = await call("look", {}, code);
    assert.equal(look.status, 200);
    assert.equal(look.body.result.place.id, "r1:place:start_xiuxian");
    assert.deepEqual(
      look.body.result.place.exits.map((e: Json) => [e.dir, e.to]),
      [["south", "r1:place:market_neutral"]],
    );
    assert.equal(look.body.result.counts.people, 1);

    // events: default self layer, with place / world counts alongside.
    const ev = await call("events", {}, code);
    assert.equal(ev.status, 200);
    const r = ev.body.result;
    assert.equal(r.scope, "self");
    assert.deepEqual(
      r.events.map((e: Json) => [e.type, e.data.to, e.speech_status]),
      [["identity_state", "draft", "not_applicable"]],
    );
    assert.deepEqual(r.counts, { self: 1, place: 0, world: 0 });
    assert.equal(r.next_cursor, r.through);
    assert.deepEqual(r.cursors.place, { place_id: me.loc, after: "0" });
    assert.equal(r.has_more, false);

    // Budget: a cost beyond the remaining points of the tick is refused.
    const first = trySpend({ ap_tick: "7", ap_spent: 0 }, "7", 3, 2);
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.view.remaining, 1);
    assert.deepEqual(trySpend(first.state, "7", 3, 2), { ok: false, remaining: 1, required: 2, next_tick: "8" });
    assert.equal(trySpend(first.state, "8", 3, 2).ok, true);
  } finally {
    await app.close();
  }
});
