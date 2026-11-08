import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { startApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { setQuiet } from "../src/log.ts";
import { SAVE_HINT } from "../src/verbs/save_hint.ts";

type Json = any;

test("S102: one private save hint after both thresholds, including across restart", async () => {
  setQuiet(true);
  const parent = resolve("../_work/builder");
  await mkdir(parent, { recursive: true });
  const scratch = await mkdtemp(join(parent, "s102-"));
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
    const a = await call("enter", { mode: "create", skin: "xiuxian", door: "api" });
    const b = await call("enter", { mode: "create", skin: "xiuxian", door: "api" });
    const c = await call("enter", { mode: "create", skin: "xiuxian", door: "api" });
    const d = await call("enter", { mode: "create", skin: "xiuxian", door: "api" });
    assert.equal(a.save_hint, undefined);
    assert.equal(b.save_hint, undefined);
    const code: string = a.result.identity_code;
    const boundCode: string = b.result.identity_code;
    const email = "s102@example.test";
    const bind = await call("enter", { mode: "resume", email }, boundCode);
    assert.equal(bind.result.email_bound, true);
    assert.equal(bind.save_hint, undefined);
    for (let i = 0; i < 15; i += 1) {
      const early = await call("whoami", {}, code);
      assert.equal(early.save_hint, undefined, "elapsed ticks also required");
    }
    await app.db.query("UPDATE worlds SET tick = 20, tick_started_at = now()");
    for (let i = 0; i < 16; i += 1) {
      assert.equal((await call("whoami", {}, boundCode)).save_hint, undefined, "bound email suppresses reminder");
    }
    const otherCode: string = c.result.identity_code;
    for (let i = 0; i < 14; i += 1) {
      assert.equal((await call("whoami", {}, otherCode)).save_hint, undefined, "15 successful actions required");
    }
    assert.deepEqual((await call("whoami", {}, otherCode)).save_hint, SAVE_HINT, "15th successful action carries hint");
    assert.equal((await call("whoami", {}, otherCode)).save_hint, undefined);
    const lateBindCode: string = d.result.identity_code;
    for (let i = 0; i < 14; i += 1) assert.equal((await call("whoami", {}, lateBindCode)).save_hint, undefined);
    assert.equal((await call("enter", { mode: "resume", email }, lateBindCode)).save_hint, undefined, "binding at threshold suppresses hint");
    assert.equal((await call("whoami", {}, lateBindCode)).save_hint, undefined);
    const res = await fetch(`${app.url}/mcp`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "whoami", arguments: { code } } }) });
    const mcp = await res.json() as Json;
    assert.equal(mcp.result.structuredContent.ok, true);
    assert.deepEqual(mcp.result.structuredContent.save_hint, SAVE_HINT);
    assert.equal(mcp.result.content[0].text, JSON.stringify(mcp.result.structuredContent));
    assert.equal((await call("whoami", {}, code)).save_hint, undefined);
    await app.close();
    app = await startApp(config);
    assert.equal((await call("whoami", {}, code)).save_hint, undefined, "shown marker survives restart");
    assert.equal((await call("whoami", {}, otherCode)).save_hint, undefined);
    assert.equal((await call("whoami", {}, boundCode)).save_hint, undefined);
    const resumed = await call("enter", { mode: "resume", handle: b.result.char.handle, email });
    assert.equal(resumed.result.email_bound, true);
    assert.equal(resumed.save_hint, undefined);
  } finally {
    await app?.close();
    await rm(scratch, { recursive: true, force: true });
  }
});
