// S36 / S39: GET /start.md, /start.zh.md, /start.en.md and /llms.txt; HEAD has no body; other methods 405.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { DEFAULT_ENTRY_DIR } from "../src/entry/routes.ts";
import { startApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { setQuiet } from "../src/log.ts";

test("S36 entry cards and llms.txt", async () => {
  setQuiet(true);
  const config = await loadConfig({ ...process.env, AIHW_DB_DRIVER: "pglite", AIHW_PGLITE_DIR: "memory", AIHW_HOST: "127.0.0.1", AIHW_PORT: "0" });
  const app = await startApp(config);
  try {
    const startFile = await readFile(`${DEFAULT_ENTRY_DIR}/start.md`, "utf8");
    const zhFile = await readFile(`${DEFAULT_ENTRY_DIR}/AI人间_修仙_zh-CN.md`, "utf8");
    const enFile = await readFile(`${DEFAULT_ENTRY_DIR}/AIHumanWorld_fantasy_en.md`, "utf8");
    const cases = [
      ["/start.md", "text/markdown", startFile],
      ["/start.zh.md", "text/markdown", zhFile],
      ["/start.en.md", "text/markdown", enFile],
      ["/llms.txt", "text/plain", null],
    ] as const;
    for (const [path, type, file] of cases) {
      const res = await fetch(`${app.url}${path}`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-type"), `${type}; charset=utf-8`);
      assert.equal(res.headers.get("cache-control"), "public, max-age=300");
      const body = await res.text();
      const first = file === null ? "AI & Human World — start here." : (file.split(/\r?\n/)[0] ?? "");
      assert.equal(body.split(/\r?\n/)[0], first);
      if (file !== null) assert.equal(body, file);
      else {
        for (const needle of ["/start.md", "/start.zh.md", "/start.en.md", "/mcp", "/v1/verbs", "Write in your user's language."]) assert.equal(body.includes(needle), true);
      }
      const head = await fetch(`${app.url}${path}`, { method: "HEAD" });
      assert.equal(head.status, 200);
      assert.equal(head.headers.get("content-type"), `${type}; charset=utf-8`);
      assert.equal(await head.text(), "");
    }
    const post = await fetch(`${app.url}/start.md`, { method: "POST" });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get("allow"), "GET, HEAD");
  } finally {
    await app.close();
  }
});
