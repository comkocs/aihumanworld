import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { startApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { setQuiet } from "../src/log.ts";

type Json = any;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("S81: authenticated envelopes carry the current guide revision and a bounded notice burst", async () => {
  setQuiet(true);
  const parent = join(root, "_work", "builder");
  await mkdir(parent, { recursive: true });
  const scratch = await mkdtemp(join(parent, "s81-"));
  const file = join(scratch, "notice.json");
  const before = process.env.AIHW_NOTICE_FILE;
  process.env.AIHW_NOTICE_FILE = file;
  let app: Awaited<ReturnType<typeof startApp>> | undefined;
  try {
    const config = await loadConfig({ ...process.env, AIHW_DB_DRIVER: "pglite", AIHW_PGLITE_DIR: "memory", AIHW_PORT: "0" });
    config.clock.enabled = false;
    app = await startApp(config);
    const running = app;
    const call = async (verb: string, args: object, code?: string): Promise<Json> => {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (code !== undefined) headers.Authorization = `Bearer ${code}`;
      const response = await fetch(`${running.url}/v1/actions/${verb}`, { method: "POST", headers, body: JSON.stringify({ args }) });
      return response.json();
    };
    const nextTick = async (): Promise<void> => {
      await running.db.query("UPDATE worlds SET tick_started_at = tick_started_at - interval '60 seconds'");
    };
    const publish = async (rev: string): Promise<void> => {
      await writeFile(file, JSON.stringify({ rev, url: "https://example.test/start.md", text: { en: `Guide ${rev}` } }));
    };
    const absent = (result: Json): void => {
      assert.equal(result.ok, true);
      assert.equal(Object.hasOwn(result, "guide_rev"), false);
      assert.equal(Object.hasOwn(result, "notice"), false);
    };

    const created = await call("enter", { mode: "create", skin: "xiuxian", door: "api" });
    assert.equal(created.ok, true);
    const code: string = created.result.identity_code;
    absent(await call("look", {}, code));
    await nextTick();
    await publish("s81-one");

    const first = await call("look", {}, code);
    assert.equal(first.ok, true);
    assert.equal(first.guide_rev, "s81-one");
    assert.deepEqual(first.notice, { rev: "s81-one", url: "https://example.test/start.md", text: { en: "Guide s81-one" } });
    const rejected = await call("look", {}, "invalid-code");
    assert.equal(rejected.ok, false);
    assert.equal(Object.hasOwn(rejected, "guide_rev"), false);
    assert.equal(Object.hasOwn(rejected, "notice"), false);

    await nextTick();
    for (let i = 0; i < 3; i += 1) {
      const result = await call("look", {}, code);
      assert.equal(result.ok, true);
      assert.equal(result.guide_rev, "s81-one");
      assert.equal(result.notice.rev, "s81-one");
    }
    const response = await fetch(`${running.url}/mcp`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "whoami", arguments: { code } } }),
    });
    const mcp = await response.json() as Json;
    const fifth = mcp.result.structuredContent;
    assert.equal(fifth.ok, true);
    assert.equal(fifth.guide_rev, "s81-one");
    assert.equal(fifth.notice.rev, "s81-one");
    assert.equal(mcp.result.content[0].text, JSON.stringify(fifth));
    for (let i = 0; i < 2; i += 1) {
      const result = await call("look", {}, code);
      assert.equal(result.ok, true);
      assert.equal(result.guide_rev, "s81-one");
      assert.equal(Object.hasOwn(result, "notice"), false);
    }

    await rm(file);
    absent(await call("look", {}, code));
    await writeFile(file, "{broken");
    absent(await call("look", {}, code));
    await writeFile(file, JSON.stringify({ rev: "bad", url: "x" }));
    absent(await call("look", {}, code));

    await nextTick();
    await publish("s81-two");
    for (let i = 0; i < 6; i += 1) {
      const result = await call("look", {}, code);
      assert.equal(result.ok, true);
      assert.equal(result.guide_rev, "s81-two");
      if (i < 5) assert.equal(result.notice.rev, "s81-two");
      else assert.equal(Object.hasOwn(result, "notice"), false);
    }
  } finally {
    if (app !== undefined) await app.close();
    if (before === undefined) delete process.env.AIHW_NOTICE_FILE;
    else process.env.AIHW_NOTICE_FILE = before;
    await rm(scratch, { recursive: true, force: true });
  }
});
