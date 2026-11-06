// The one S23 acceptance chain: two chars → officials.json lists one → re-import
// on a fresh start → that char is official, the other stays player → who / online
// carry kind → official handle + email resume works → lifecycle does not clear
// the official char.

import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { startApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { identityPhase } from "../src/identity/lifecycle.ts";
import { importOfficialsFile } from "../src/identity/officials.ts";
import { mustGetRow } from "../src/facts/store.ts";
import { worldId } from "../src/facts/ids.ts";
import { Writer } from "../src/facts/writer.ts";
import { setQuiet } from "../src/log.ts";

type Json = any;

const CONFIG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "config");

async function boot(officialsFile: string) {
  const scratch = await mkdtemp(join(tmpdir(), "s23-"));
  const configPath = join(scratch, "server.json");
  const drop = () => rm(scratch, { recursive: true, force: true });
  await writeFile(
    configPath,
    JSON.stringify({
      realm: "r1",
      http: { host: "127.0.0.1", port: 0, body_max_bytes: 65536 },
      db: { driver: "pglite", pglite_dir: "memory", pool_max: 1 },
      rules_file: join(CONFIG_DIR, "rules.placeholder.json"),
      content_dir: null,
      clock: { max_catchup_ticks_per_tx: 8 },
    }),
  );
  const prev = process.env.AIHW_OFFICIALS_FILE;
  process.env.AIHW_OFFICIALS_FILE = officialsFile;
  try {
    const app = await startApp(await loadConfig({ AIHW_CONFIG: configPath, AIHW_PGLITE_DIR: "memory", AIHW_PORT: "0" }));
    await drop();
    return app;
  } catch (err) {
    await drop();
    throw err;
  } finally {
    if (prev === undefined) delete process.env.AIHW_OFFICIALS_FILE;
    else process.env.AIHW_OFFICIALS_FILE = prev;
  }
}

test("S23: import marks one official, who/online carry kind, resume works, lifecycle skips official", async () => {
  setQuiet(true);
  const dir = await mkdtemp(join(tmpdir(), "s23-off-"));
  const officials = join(dir, "officials.json");
  await writeFile(officials, JSON.stringify({ handles: [] }));
  // Fresh start with an empty list imports nothing; the listed handle is applied
  // by the same boot importer (importOfficialsFile) once the two chars exist.
  const app = await boot(officials);
  try {
    const call = async (verb: string, args: object, code?: string): Promise<{ status: number; body: Json }> => {
      const headers: Record<string, string> = { "Content-Type": "application/json; charset=utf-8" };
      if (code !== undefined) headers.Authorization = `Bearer ${code}`;
      const res = await fetch(`${app.url}/v1/actions/${verb}`, { method: "POST", headers, body: JSON.stringify({ args }) });
      return { status: res.status, body: (await res.json()) as Json };
    };
    const a = await call("enter", { mode: "create", skin: "xiuxian", door: "api" });
    const b = await call("enter", { mode: "create", skin: "wuxia", door: "api" });
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    const handleA: string = a.body.result.char.handle;
    const idA: string = a.body.result.char.id;
    const idB: string = b.body.result.char.id;
    const codeA: string = a.body.result.identity_code;

    await writeFile(officials, JSON.stringify({ handles: [handleA] }));
    const imported = await importOfficialsFile(app.db, officials);
    assert.equal(imported.changed, 1);
    // Idempotent: a second pass changes nothing.
    assert.equal((await importOfficialsFile(app.db, officials)).changed, 0);

    const kinds = await app.db.query<{ id: string; kind: string }>("SELECT id, kind FROM chars WHERE id = ANY($1::text[])", [[idA, idB]]);
    const byId = new Map(kinds.rows.map((r) => [r.id, r.kind]));
    assert.equal(byId.get(idA), "official");
    assert.equal(byId.get(idB), "player");

    const who = (await (await fetch(`${app.url}/v1/who/${handleA}`)).json()) as Json;
    assert.equal(who.kind, "official");
    assert.equal(who.char.kind, "official");
    const whoB = (await (await fetch(`${app.url}/v1/who/${b.body.result.char.handle}`)).json()) as Json;
    assert.equal(whoB.kind, "player");

    const online = (await (await fetch(`${app.url}/v1/online`)).json()) as Json;
    const rowA = online.online.find((o: Json) => o.char_id === idA);
    const rowB = online.online.find((o: Json) => o.char_id === idB);
    assert.equal(rowA.kind, "official");
    assert.equal(rowB.kind, "player");

    const idPage = await fetch(`${app.url}/id/${handleA}`);
    assert.equal(idPage.status, 200);
    assert.match(await idPage.text(), /官方居民/);

    const bound = await call("enter", { mode: "resume", email: "official@example.com" }, codeA);
    assert.equal(bound.status, 200);
    const again = await call("enter", { mode: "resume", handle: handleA, email: "official@example.com" });
    assert.equal(again.status, 200);
    assert.equal(again.body.result.char.id, idA);
    assert.match(again.body.result.identity_code, /^AIHW-/);

    // Lifecycle: jump far past draft TTL. The player draft is buried and its
    // credential cleared; the official draft is left alone.
    const wid = worldId("r1");
    const far = 1_000_000;
    await app.db.tx(async (q) => {
      await q.query("UPDATE worlds SET tick = $1::bigint, updated_tick = $1::bigint WHERE id = $2", [String(far), wid]);
      const world = await mustGetRow(q, "world", wid, { lock: true });
      const w = new Writer(q, "r1", world.tick, world.rules_revision, true);
      await identityPhase.run({
        q, w, world, rules: world.rules, balance: app.services.balance(),
        from_tick: String(far - 1), to_tick: String(far), now: new Date(),
      });
    });
    const after = await app.db.query<{ id: string; kind: string; state: string }>(
      "SELECT id, kind, state FROM chars WHERE id = ANY($1::text[])",
      [[idA, idB]],
    );
    const stateOf = new Map(after.rows.map((r) => [r.id, r]));
    assert.equal(stateOf.get(idA)?.kind, "official");
    assert.equal(stateOf.get(idA)?.state, "draft");
    assert.equal(stateOf.get(idB)?.state, "buried");
    const credA = await app.db.query("SELECT 1 FROM identities WHERE char_id = $1", [idA]);
    const credB = await app.db.query("SELECT 1 FROM identities WHERE char_id = $1", [idB]);
    assert.ok(credA.rows.length > 0);
    assert.equal(credB.rows.length, 0);

    // A handle not on the list is not flipped back, and an empty file changes nothing.
    await writeFile(officials, JSON.stringify({ handles: [] }));
    assert.equal((await importOfficialsFile(app.db, officials)).changed, 0);
    const still = await app.db.query<{ kind: string }>("SELECT kind FROM chars WHERE id = $1", [idA]);
    assert.equal(still.rows[0]?.kind, "official");
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
