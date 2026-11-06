// The one S13 acceptance chain (设计者 11-06: 不要过多复杂测试、不要重复全量测试):
// start → enter → GET place page (exits + present) → GET biography →
// no identity code and no code hash anywhere in the bodies → If-None-Match → 304 →
// web form POST of an implemented verb (look) succeeds with door web.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { startApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { hashCode, normalizeCode } from "../src/identity/code.ts";
import { setQuiet } from "../src/log.ts";

test("S13 chain: place page → biography → no code → 304 → web form look", async () => {
  setQuiet(true);
  const config = await loadConfig({ ...process.env, AIHW_DB_DRIVER: "pglite", AIHW_PGLITE_DIR: "memory", AIHW_PORT: "0" });
  const app = await startApp(config);
  try {
    const enter = await fetch(`${app.url}/v1/actions/enter`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ args: { mode: "create", skin: "xiuxian", door: "api" } }),
    });
    assert.equal(enter.status, 200);
    const created = (await enter.json()) as { ok: boolean; result: { identity_code: string; char: { id: string; loc: string } } };
    assert.equal(created.ok, true);
    const code = created.result.identity_code;
    const codeHash = hashCode(normalizeCode(code));
    const me = created.result.char;

    const place = await fetch(`${app.url}/place/${me.loc}`);
    assert.equal(place.status, 200);
    assert.match(place.headers.get("content-type") ?? "", /^text\/markdown/);
    const etag = place.headers.get("etag");
    assert.ok(etag !== null && etag.startsWith('"'));
    const placeBody = await place.text();
    assert.match(placeBody, new RegExp(me.loc.replaceAll("_", "\\_")));
    assert.match(placeBody, /south → `r1:place:market_neutral`/);
    assert.match(placeBody, new RegExp(`在场 Present[\\s\\S]*\`${me.id}\``));

    const bio = await fetch(`${app.url}/char/${me.id}?skin=xiuxian&locale=zh-CN`);
    assert.equal(bio.status, 200);
    const bioBody = await bio.text();
    assert.match(bioBody, new RegExp(`传记 Biography ${me.id.replaceAll(":", "\\:")}`));
    assert.match(bioBody, /修士 `person\.player`/);
    assert.match(bioBody, /skin: xiuxian\/zh-CN/);

    // The code and its hash appear in none of the public responses.
    const chronicle = await (await fetch(`${app.url}/chronicle`)).text();
    const region = await (await fetch(`${app.url}/region/xiuxian`)).text();
    for (const body of [placeBody, bioBody, chronicle, region]) {
      assert.equal(body.includes(code), false);
      assert.equal(body.includes(code.replaceAll("-", "")), false);
      assert.equal(body.includes(codeHash), false);
    }

    const again = await fetch(`${app.url}/place/${me.loc}`, { headers: { "If-None-Match": etag } });
    assert.equal(again.status, 304);
    assert.equal(await again.text(), "");

    const form = new URLSearchParams({ code, section: "place" });
    const posted = await fetch(`${app.url}/act/look`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    });
    assert.equal(posted.status, 200);
    const result = await posted.text();
    assert.match(result, /door web/);
    assert.match(result, /&quot;ok&quot;: true/);
    assert.match(result, new RegExp(me.loc.replaceAll("_", "\\_")));
    // The form result page echoes the verb result, never the code that was posted.
    assert.equal(result.includes(code), false);
    assert.equal(result.includes(createHash("sha256").update(code).digest("hex")), false);
  } finally {
    await app.close();
  }
});
