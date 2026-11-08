import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { startApp } from "../src/app.ts";
import { loadConfig, SERVER_ROOT } from "../src/config.ts";
import { setQuiet } from "../src/log.ts";

test("S113: verb catalog exposes the product version", async () => {
  setQuiet(true);
  const config = await loadConfig({ ...process.env, AIHW_DB_DRIVER: "pglite", AIHW_PGLITE_DIR: "memory", AIHW_PORT: "0", AIHW_CONTENT_DIR: "null" });
  const app = await startApp(config);
  try {
    const response = await fetch(`${app.url}/v1/verbs`);
    assert.equal(response.status, 200);
    const catalog = await response.json() as { version: string };
    assert.equal(catalog.version, (await readFile(resolve(SERVER_ROOT, "../VERSION"), "utf8")).trim());
  } finally {
    await app.close();
  }
});
