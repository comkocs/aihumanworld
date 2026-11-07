// The one S13 acceptance chain (设计者 11-06: 不要过多复杂测试、不要重复全量测试):
// start → enter → GET place page (exits + present) → GET biography →
// no identity code and no code hash anywhere in the bodies → If-None-Match → 304 →
// web form POST of an implemented verb (look) succeeds with door web.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { test } from "node:test";
import { startApp } from "../src/app.ts";
import { loadConfig, SERVER_ROOT } from "../src/config.ts";
import type { Queryable } from "../src/db/db.ts";
import { hashCode, normalizeCode } from "../src/identity/code.ts";
import { setQuiet } from "../src/log.ts";
import { renderPage } from "../src/public/pages.ts";
import { lexiconFor, loadSkins, neutralLexicon } from "../src/public/skins.ts";

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
    assert.doesNotMatch(bioBody, /origin(?:_region|\s)/);
    assert.doesNotMatch(bioBody, /(?:^|\s)coin(?:\s|:)/);

    // The code and its hash appear in none of the public responses.
    const chronicle = await (await fetch(`${app.url}/chronicle`)).text();
    const region = await (await fetch(`${app.url}/region/xiuxian`)).text();
    for (const body of [placeBody, bioBody, chronicle, region]) {
      assert.doesNotMatch(body, /translation_missing/);
      assert.equal(body.includes(code), false);
      assert.equal(body.includes(code.replaceAll("-", "")), false);
      assert.equal(body.includes(codeHash), false);
    }

    const again = await fetch(`${app.url}/place/${me.loc}`, { headers: { "If-None-Match": etag } });
    assert.equal(again.status, 304);
    assert.equal(await again.text(), "");

    const book = await loadSkins(join(SERVER_ROOT, "..", "content", "skins"));
    const neutralDb: Queryable = {
      exec: (sql) => app.db.exec(sql),
      async query<R>(sql: string, params?: readonly unknown[]) {
        const result = await app.db.query<R>(sql, params);
        if (sql.startsWith("SELECT * FROM chars WHERE id = $1")) {
          return { ...result, rows: result.rows.map((row) => ({ ...row, skin: "neutral", origin_region: "neutral" }) as R) };
        }
        return result;
      },
    };
    const neutralBio = await renderPage(neutralDb, { kind: "char", ref: me.id, lexicon: neutralLexicon(), birthBook: book });
    assert.ok(neutralBio !== null);
    assert.match(neutralBio.markdown, /skin: neutral/);
    assert.match(neutralBio.markdown, /player `person\.player`/);
    assert.doesNotMatch(neutralBio.markdown, /translation_missing/);
    const emptyBook = { tables: new Map(), localesOf: () => [] };
    for (const kind of ["char", "chronicle", "place"] as const) {
      const ref = kind === "char" ? me.id : kind === "place" ? me.loc : null;
      const doc = await renderPage(app.db, { kind, ref, lexicon: lexiconFor(emptyBook, "xiuxian", "zh-CN") });
      assert.ok(doc !== null);
      assert.doesNotMatch(doc.markdown, /translation_missing/);
    }
    const missingTableBook = { tables: new Map([["xiuxian/zh-CN", { skin: "xiuxian" as const, locale: "zh-CN", entries: new Map() }]]), localesOf: () => ["zh-CN"] };
    const missingFacet = await renderPage(app.db, { kind: "char", ref: me.id, lexicon: lexiconFor(missingTableBook, "xiuxian", "zh-CN") });
    assert.ok(missingFacet !== null);
    assert.match(missingFacet.markdown, /player `person\.player`/);
    assert.doesNotMatch(missingFacet.markdown, /translation_missing/);
    assert.match(chronicle, /skin: neutral/);
    assert.match(placeBody, /skin: neutral/);

    const skins = [
      { skin: "xiuxian", locale: "zh-CN", name: "修士", id: me.id },
      { skin: "wuxia", locale: "zh-CN", name: "江湖中人" },
      { skin: "fantasy", locale: "en", name: "Adventurer" },
      { skin: "scifi", locale: "en", name: "Operator" },
    ];
    for (const entry of skins) {
      let id = entry.id;
      if (id === undefined) {
        const entered = await fetch(`${app.url}/v1/actions/enter`, {
          method: "POST",
          headers: { "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify({ args: { mode: "create", skin: entry.skin, door: "api" } }),
        });
        assert.equal(entered.status, 200);
        const created = (await entered.json()) as { result: { char: { id: string } } };
        id = created.result.char.id;
      }
      for (const headers of [{ Accept: "text/markdown" }, { Accept: "text/html", "Accept-Language": "zh-CN" }]) {
        const response = await fetch(`${app.url}/char/${id}`, { headers });
        assert.equal(response.status, 200);
        const body = await response.text();
        assert.ok(body.includes(entry.name));
        assert.doesNotMatch(body, /translation_missing/);
      }
      const markdown = await (await fetch(`${app.url}/char/${id}`)).text();
      assert.ok(markdown.includes(`skin: ${entry.skin}/${entry.locale}`));
      assert.ok(markdown.includes(`${entry.name} \`person.player\``));
    }
    const override = await (await fetch(`${app.url}/char/${me.id}?skin=scifi`)).text();
    assert.match(override, /skin: scifi\/en/);
    assert.match(override, /Operator `person\.player`/);
    const missingLocale = await (await fetch(`${app.url}/char/${me.id}?skin=scifi&locale=xx`)).text();
    assert.match(missingLocale, /skin: neutral/);
    assert.match(missingLocale, /player `person\.player`/);
    assert.doesNotMatch(missingLocale, /translation_missing/);
    const missingEntry = await (await fetch(`${app.url}/place/${me.loc}?skin=xiuxian&locale=zh-CN`)).text();
    assert.doesNotMatch(missingEntry, /translation_missing/);

    const form = new URLSearchParams({ code, section: "place" });
    const posted = await fetch(`${app.url}/act/look`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    });
    assert.equal(posted.status, 200);
    const result = await posted.text();
    assert.match(result, /HTTP 200 · web/);
    assert.match(result, /&quot;ok&quot;: true/);
    assert.match(result, new RegExp(me.loc.replaceAll("_", "\\_")));
    // The form result page echoes the verb result, never the code that was posted.
    assert.equal(result.includes(code), false);
    assert.equal(result.includes(createHash("sha256").update(code).digest("hex")), false);
  } finally {
    await app.close();
  }
});
