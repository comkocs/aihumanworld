// The one S14 acceptance chain: initialize → 16 tools → enter create →
// code argument whoami → Bearer look → bad code → notification 202 → GET 405.

import assert from "node:assert/strict";
import { test } from "node:test";
import { startApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { setQuiet } from "../src/log.ts";

type Json = any;

test("S14 chain: stateless MCP, catalog, shared actions, credentials and HTTP methods", async () => {
  setQuiet(true);
  const config = await loadConfig({ ...process.env, AIHW_DB_DRIVER: "pglite", AIHW_PGLITE_DIR: "memory", AIHW_HOST: "127.0.0.1", AIHW_PORT: "0" });
  const app = await startApp(config);
  try {
    let nextId = 0;
    const rpc = async (method: string, params: object, bearer?: string): Promise<Json> => {
      const id = ++nextId;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (bearer !== undefined) headers.Authorization = `Bearer ${bearer}`;
      const res = await fetch(`${app.url}/mcp`, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type") ?? "", /^application\/json/);
      assert.equal(res.headers.has("mcp-session-id"), false);
      const body = await res.json() as Json;
      assert.equal(body.jsonrpc, "2.0");
      assert.equal(body.id, id);
      assert.equal(body.error, undefined);
      return body.result;
    };
    const envelope = (value: Json): Json => {
      assert.equal(value.content.length, 1);
      assert.equal(value.content[0].type, "text");
      // Do not print a credential-bearing creation response if this check fails.
      assert.equal(value.content[0].text === JSON.stringify(value.structuredContent), true, "content must be the compact action envelope");
      assert.equal(value.structuredContent.protocol, "aihw.v1");
      return value.structuredContent;
    };

    const init = await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "s14-test", version: "1" } });
    assert.equal(init.protocolVersion, "2025-11-25");
    assert.deepEqual(init.capabilities, { tools: { listChanged: false } });
    assert.equal(init.serverInfo.name, "aihumanworld");
    assert.equal(typeof init.serverInfo.version, "string");
    assert.ok([...init.instructions].length <= 300);

    const listed = await rpc("tools/list", {});
    const catalog = await (await fetch(`${app.url}/v1/verbs`)).json() as Json;
    assert.equal(listed.tools.length, 16);
    assert.deepEqual(listed.tools.map((tool: Json) => tool.name), catalog.verbs.map((verb: Json) => verb.verb));
    for (const tool of listed.tools) {
      const source = catalog.verbs.find((verb: Json) => verb.verb === tool.name);
      assert.equal(tool.description, source.summary);
      assert.equal(tool.inputSchema.type, "object");
      assert.equal(tool.inputSchema.properties.code.type, "string");
      assert.equal(tool.inputSchema.required?.includes("code") ?? false, false);
      assert.equal(tool.inputSchema.oneOf, undefined);
      for (const branch of source.branches) {
        for (const field of Object.keys(branch.args.properties)) assert.ok(Object.hasOwn(tool.inputSchema.properties, field));
        for (const [field, selector] of Object.entries(branch.selector)) assert.ok(tool.inputSchema.properties[field].enum.includes(selector));
      }
    }
    const enterSchema = listed.tools.find((tool: Json) => tool.name === "enter").inputSchema;
    assert.match(enterSchema.properties.handle.description, /mode=resume/);

    const entered = await rpc("tools/call", { name: "enter", arguments: { mode: "create", skin: "xiuxian", door: "api" } });
    const created = envelope(entered);
    assert.equal(created.ok, true);
    assert.equal(entered.isError ?? false, false);
    assert.equal(created.rules_revision, init.serverInfo.version);
    assert.equal(created.result.char.door, "api");
    const code: string = created.result.identity_code;
    assert.equal(typeof code === "string" && /^AIHW-/.test(code), true, "enter must issue an identity code");
    const me: string = created.result.char.id;

    const who = await rpc("tools/call", { name: "whoami", arguments: { code } });
    const identity = envelope(who);
    assert.equal(identity.ok, true);
    assert.equal(identity.result.char.id, me);
    assert.equal(who.isError ?? false, false);
    assert.equal(JSON.stringify(who).includes(code), false, "credentials must not be echoed");

    // A conflicting code argument proves that the Bearer header takes priority.
    const look = await rpc("tools/call", { name: "look", arguments: { section: "place", code: "invalid-code" } }, code);
    const scene = envelope(look);
    assert.equal(scene.ok, true);
    assert.equal(scene.result.place.id, created.result.char.loc);
    assert.equal(look.isError ?? false, false);
    assert.equal(JSON.stringify(look).includes(code), false, "credentials must not be echoed");

    const bad = await rpc("tools/call", { name: "whoami", arguments: { code: "invalid-code" } });
    const refusal = envelope(bad);
    assert.equal(bad.isError, true);
    assert.equal(refusal.ok, false);
    assert.equal(refusal.error.code, "AUTH_INVALID");
    assert.deepEqual(refusal.error.details, {});
    assert.equal(JSON.stringify(bad).includes("invalid-code"), false);

    const notice = await fetch(`${app.url}/mcp`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    assert.equal(notice.status, 202);
    assert.equal(await notice.text(), "");
    assert.equal(notice.headers.has("mcp-session-id"), false);

    const get = await fetch(`${app.url}/mcp`);
    assert.equal(get.status, 405);
    assert.equal(get.headers.get("allow"), "POST");
    assert.equal(get.headers.has("mcp-session-id"), false);
    await get.arrayBuffer();
  } finally {
    await app.close();
  }
});
