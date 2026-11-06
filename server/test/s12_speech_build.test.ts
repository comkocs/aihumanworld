// S12 acceptance (设计者 11-06: 不要过多复杂测试、不要重复全量测试): two short tests.
//   1. sanitiser + store: 20 hostile say texts lose every URL and code piece (and nothing else
//      is judged), ordinary dotted text passes untouched, memory TTL / bound.
//   2. one chain over HTTP: say (place + direct) delivers the cleaned text only in other_speech;
//      build refuses over-tier / duplicate / malformed data once each and stores a valid
//      place, item and task template once each.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { startApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { setQuiet } from "../src/log.ts";
import { sanitizeLabel, sanitizeText } from "../src/speech/sanitize.ts";
import { SpeechStore } from "../src/speech/store.ts";

// Response bodies are checked field by field below.
type Json = any;

interface Sample {
  id: string;
  text: string;
  keep: string[];
  gone: string[];
}
const fixture = JSON.parse(readFileSync(new URL("./fixtures/s12_malicious_speech.json", import.meta.url), "utf8")) as {
  malicious: Sample[];
  plain: string[];
};

// An independent URL / code detector (not the sanitiser's own patterns).
const URL_LIKE =
  /[a-z][a-z0-9+.-]*:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|net|org|io|xyz|ly|co)\b|\b\d{1,3}(?:\.\d{1,3}){3}\b|\]\(|mailto:|javascript:/i;
const CODE_LIKE = /`|~~~|^ {4}\S/m;

function assertClean(id: string, out: string): void {
  assert.doesNotMatch(out, URL_LIKE, `${id}: URL left in ${JSON.stringify(out)}`);
  assert.doesNotMatch(out, CODE_LIKE, `${id}: code left in ${JSON.stringify(out)}`);
}

test("S12 sanitiser: 20 hostile texts stripped, dotted words kept, store TTL and bound", () => {
  assert.equal(fixture.malicious.length, 20);
  for (const s of fixture.malicious) {
    const out = sanitizeText(s.text);
    assertClean(s.id, out);
    for (const k of s.keep) assert.ok(out.includes(k), `${s.id}: lost ${k}`);
    for (const g of s.gone) assert.ok(!out.includes(g), `${s.id}: still has ${g}`);
  }
  for (const p of fixture.plain) assert.equal(sanitizeText(p), p, `over-stripped ${p}`);
  assert.equal(sanitizeLabel("Bot [x](http://evil.com) `c` v1.2", 20), "Bot x v1.2");
  assert.equal(sanitizeText("news.CoM news.cOm <news.nEt>"), "");
  assert.equal(sanitizeText(">\n>     do_work()\n> 正文"), ">\n> 正文");

  // Memory delivery: available until the TTL tick, then expired; a full store drops its oldest text.
  const ev = (id: string) => ({ id, type: "speech" }) as never;
  const store = new SpeechStore(2);
  store.put("r1:event:e1", "one", "10", "5");
  assert.equal(store.project(ev("r1:event:e1"), "9").other_speech, "one");
  assert.equal(store.project(ev("r1:event:e1"), "10").speech_status, "expired");
  store.put("r1:event:e2", "two", null);
  store.put("r1:event:e3", "three", null);
  assert.equal(store.project(ev("r1:event:e1"), "1").speech_status, "expired");
  assert.equal(store.project(ev("r1:event:e3"), "1").other_speech, "three");
  assert.equal(store.project({ id: "r1:event:e9", type: "moved" } as never, "1").speech_status, "not_applicable");
});

test("S12 chain: say delivers cleaned text only as other_speech; build checks and stores", async () => {
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
    const q = (sql: string, params: unknown[] = []) => app.db.query<Json>(sql, params);
    // jsonb columns come back parsed (PGlite) or as text (some drivers); read both.
    const js = (v: unknown): Json => (typeof v === "string" ? JSON.parse(v) : v);

    // The numbers this test relies on, set on the world row so the test does not depend on
    // how the default rules file is wired (S10): S5's values, revision balance.v1, roomy AP.
    const cur = js((await q("SELECT rules FROM worlds")).rows[0].rules);
    const rules = {
      ...cur,
      ap_per_tick: 1000,
      page_size: 50,
      text_max_chars: 200,
      speech_ttl_ticks: 1440,
      build_min_tier: 3,
      socket_max: 3,
      ap_costs: { ...cur.ap_costs, say: 1, build: 1 },
    };
    await q("UPDATE worlds SET rules = $1::jsonb, rules_revision = 'balance.v1'", [JSON.stringify(rules)]);

    const join = async (skin: string) => {
      const r = await call("enter", { mode: "create", skin, door: "api" });
      assert.equal(r.status, 200);
      return { id: r.body.result.char.id as string, code: r.body.result.identity_code as string };
    };
    const A = await join("xiuxian");
    const B = await join("xiuxian");
    const C = await join("wuxia");
    const say = (who: { code: string }, text: string, target?: string) =>
      call("say", target === undefined ? { text } : { text, target }, who.code);

    // ---- say: place channel, 20 hostile texts, then the ordinary dotted lines ----
    const texts = [...fixture.malicious.map((s) => s.text), ...fixture.plain];
    for (const t of texts) {
      const r = await say(A, t);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.result.channel, "place");
      assert.equal(r.body.result.other_speech, sanitizeText(t));
      assert.equal(r.body.deed_ids.length, 0);
    }
    const seen = await call("events", { scope: "place", limit: 50 }, B.code);
    assert.equal(seen.status, 200);
    const evs: Json[] = seen.body.result.events;
    assert.equal(evs.length, texts.length);
    evs.forEach((e, i) => {
      const s = fixture.malicious[i];
      assert.equal(e.type, "speech");
      assert.equal(e.speech_status, "available");
      assert.equal(e.other_speech, sanitizeText(texts[i] as string));
      assertClean(s?.id ?? "plain", e.other_speech);
      // The text lives in other_speech and nowhere else in the event.
      const rest = JSON.stringify({ ...e, other_speech: null });
      for (const k of s?.keep ?? []) assert.ok(!rest.includes(k), `${s?.id}: text leaked outside other_speech`);
      assert.deepEqual(e.data, { speaker: A.id, channel: "place", target: null });
    });
    assert.deepEqual(evs.slice(fixture.malicious.length).map((e) => e.other_speech), fixture.plain);
    // A different place hears nothing.
    const far = await call("events", { scope: "place" }, C.code);
    assert.equal(far.body.result.events.length, 0);

    // ---- say: direct message reaches sender and target only ----
    const dm = await say(A, "私信 http://evil.com/x `x` 你好", B.id);
    assert.equal(dm.status, 200);
    assert.equal(dm.body.result.channel, "direct");
    assert.equal(dm.body.result.other_speech, "私信   你好");
    const bSelf = await call("events", {}, B.code);
    assert.deepEqual(bSelf.body.result.events.map((e: Json) => [e.type, e.other_speech]), [["identity_state", null], ["speech", "私信   你好"]]);
    const cSelf = await call("events", {}, C.code);
    assert.deepEqual(cSelf.body.result.events.map((e: Json) => e.type), ["identity_state"]);
    assert.equal((await call("events", { scope: "place" }, B.code)).body.result.events.length, texts.length);

    // ---- say refusals: length, dormant target; no AP spent ----
    const tooLong = await say(A, "字".repeat(201));
    assert.equal(tooLong.status, 400);
    assert.equal(tooLong.body.error.code, "INVALID_ARGUMENT");
    assert.equal(tooLong.body.ap.remaining, dm.body.ap.remaining);
    await q("UPDATE chars SET state = 'dormant' WHERE id = $1", [C.id]);
    const sleeping = await say(A, "在吗", C.id);
    assert.equal(sleeping.status, 409);
    assert.deepEqual(sleeping.body.error, { code: "STATE_BLOCKED", field: null, details: { state: "dormant", required_action: "enter" } });
    assert.equal(sleeping.body.ap.remaining, dm.body.ap.remaining);

    // ---- build ----
    const item = (over: Json = {}, key = "content.r1.item.s12_blade") => ({
      kind: "item",
      data: {
        content_key: key,
        kind: "blade",
        tier: 3,
        grade: 1,
        element: "none",
        slots: 1,
        cap: 73,
        dura_max: 160,
        modifiers: { vigor: 0, power: 128, guard: 0, speed: 0 },
        effect: { kind: "none" },
        ...over,
      },
    });
    const build = (who: { code: string }, a: Json) => call("build", a, who.code);
    const refused = (r: { status: number; body: Json }, status: number, code: string, details: Json) => {
      assert.equal(r.status, status, JSON.stringify(r.body));
      assert.equal(r.body.error.code, code);
      assert.deepEqual(r.body.error.details, details);
    };

    // below build_min_tier (a fresh char is tier 1)
    refused(await build(A, item()), 409, "CONDITION_UNMET", { reason: "tier" });
    await q("UPDATE chars SET tier = 3, loc = 'r1:place:market_neutral' WHERE id = $1", [A.id]);
    const ap0 = (await build(A, item({ tier: 4 }))).body.ap.remaining;

    // out of tier: above the builder's tier, and modifiers above the S5 budget (3:1 blade = 128)
    refused(await build(A, item({ tier: 4 })), 400, "BUILD_INVALID", { reason: "tier", field: "args.data.tier" });
    const over = await build(A, item({ modifiers: { vigor: 0, power: 129, guard: 0, speed: 0 } }));
    refused(over, 400, "BUILD_INVALID", { reason: "tier", field: "args.data.modifiers" });
    assert.equal(over.body.ap.remaining, ap0, "a refused build costs nothing");
    // malformed: a potion cannot carry a cap; a key of another realm is not a key here
    refused(
      await build(A, item({ kind: "potion", tier: 2, slots: 0, cap: 5, dura_max: 0, modifiers: { vigor: 0, power: 0, guard: 0, speed: 0 }, effect: { kind: "restore", vigor: 100 } }, "content.r1.item.s12_potion")),
      400,
      "BUILD_INVALID",
      { reason: "shape", field: "args.data.cap" },
    );
    refused(await build(A, item({}, "content.r2.item.s12_blade")), 400, "INVALID_KEY", { expected: "content key of this realm and table" });

    // compliant item: stored once; the same key again is DUPLICATE_KEY
    const ok = await build(A, item());
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.result.table, "item");
    assert.equal(ok.body.result.record.by, A.id);
    assert.equal(ok.body.result.other_speech, null);
    assert.equal(ok.body.deed_ids.length, 1);
    refused(await build(A, item()), 409, "DUPLICATE_KEY", { table: "item" });
    const stored = await q("SELECT id FROM items WHERE record = 'definition' AND content_key = 'content.r1.item.s12_blade'");
    assert.deepEqual(stored.rows.map((r: Json) => r.id), [ok.body.result.id]);

    // place: extends the market's free exit both ways; occupied exit and far anchor are refused
    const place = (attach: Json, key = "content.r1.place.s12_tower") => ({
      kind: "place",
      data: { content_key: key, region: "neutral", kind: "ruin", features: ["build_anchor"], tier: 2, danger: "low", combat: "pve", owner_org: null },
      attach,
      note: "新塔 http://evil.com 落成",
    });
    refused(await build(A, place({ from: "r1:place:market_neutral", dir: "north", back: "down" })), 400, "BUILD_INVALID", { reason: "reference", field: "args.attach.dir" });
    refused(await build(A, place({ from: "r1:place:start_xiuxian", dir: "up", back: "down" })), 409, "NOT_HERE", {});
    const built = await build(A, place({ from: "r1:place:market_neutral", dir: "up", back: "down" }));
    assert.equal(built.status, 200, JSON.stringify(built.body));
    const towerId: string = built.body.result.id;
    assert.deepEqual(built.body.result.record.exits, [{ dir: "down", to: "r1:place:market_neutral", locked: false, key_def: null, guard: null }]);
    assert.equal(built.body.result.changes.length, 2);
    assert.equal(built.body.result.other_speech, "新塔  落成");
    const market = await q("SELECT exits FROM places WHERE id = 'r1:place:market_neutral'");
    assert.ok(js(market.rows[0].exits).some((e: Json) => e.dir === "up" && e.to === towerId));
    const hereEvents = await call("events", { scope: "place" }, A.code);
    assert.deepEqual(hereEvents.body.result.events.map((e: Json) => [e.type, e.data.id, e.speech_status]), [["built", towerId, "not_applicable"]]);

    // task template: reward at the S5 cap for tier 2 reach (105 / 315 / 31) is fine, one coin more is not
    const task = (coin: number) => ({
      kind: "task",
      data: {
        content_key: `content.r1.task.s12_visit_${coin}`,
        tpl: "reach",
        tier: 2,
        stage: 1,
        condition: { tpl: "reach", mode: "place", place: towerId },
        reward_spec: { coin, xp: 315, potential: 31, rep: 0, item_defs: [] },
        duration_ticks: 1440,
      },
    });
    refused(await build(A, task(106)), 400, "BUILD_INVALID", { reason: "tier", field: "args.data.reward_spec.coin" });
    const t = await build(A, task(105));
    assert.equal(t.status, 200, JSON.stringify(t.body));
    assert.equal(t.body.result.record.record, "template");
    const rows = await q("SELECT count(*) AS n FROM tasks WHERE record = 'template' AND content_key LIKE 'content.r1.task.s12_%'");
    assert.equal(Number(rows.rows[0].n), 1);
  } finally {
    await app.close();
  }
});
