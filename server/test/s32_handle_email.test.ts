// The one S32 acceptance chain (设计者 11-06: 不要过多复杂测试、不要重复全量测试):
// backfill of existing players → create issues the next handle → public
// /v1/who/<handle> & /v1/online & /id/<handle> → email bind (hash only) →
// handle+email resume issues a fresh code while the old one stays valid →
// the three failures answer identically → export button present (static) →
// /v1/verbs carries the new enter arguments.

import assert from "node:assert/strict";
import { test } from "node:test";
import { startApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { hashEmail, normalizeEmail } from "../src/identity/email.ts";
import { backfillHandles } from "../src/identity/handles.ts";
import { setQuiet } from "../src/log.ts";

type Json = any;

test("S32 chain: handles, who/online/id pages, email bind, handle resume, uniform refusals", async () => {
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

    // --- backfill: two pre-existing (buried) players get handles in creation order ---
    const insertPlayer = (id: string, tick: number): Promise<unknown> =>
      app.db.query(
        `INSERT INTO chars (id, created_tick, updated_tick, kind, door, handle, email_hash, model, skin, origin_region,
           body, tier, stage, xp, potential, vigor, coin, cycles, legacy, loc, respawn_place, life, state, state_since,
           last_seen_tick, last_yield_tick, ap_tick, seen_at, ap_spent, day_index, system_tasks_today,
           known_places, patrol_route, patrol_index)
         VALUES ($1, $2::bigint, $2::bigint, 'player', 'api', NULL, NULL, NULL, 'xiuxian', 'xiuxian',
           'humanoid', 1, 1, 0, 0, 10, 0, 0, 0, 'r1:place:start_xiuxian', 'r1:place:start_xiuxian',
           'alive', 'buried', 0, 0, 0, 0, $3, 0, 0, 0, '["r1:place:start_xiuxian"]'::jsonb, '[]'::jsonb, 0)`,
        [id, String(tick), new Date().toISOString()],
      );
    await insertPlayer("r1:char:c90001", 1);
    await insertPlayer("r1:char:c90002", 2);
    assert.equal(await backfillHandles(app.db), 2);
    const handles = await app.db.query<{ handle: string }>("SELECT handle FROM chars WHERE id IN ('r1:char:c90001','r1:char:c90002') ORDER BY created_tick");
    assert.deepEqual(handles.rows.map((r) => r.handle), ["A00001", "A00002"]);

    // --- create issues the next handle ---
    const a = await call("enter", { mode: "create", skin: "xiuxian", door: "api" });
    assert.equal(a.status, 200);
    const codeA: string = a.body.result.identity_code;
    const me: string = a.body.result.char.id;
    assert.equal(a.body.result.char.handle, "A00003");
    assert.match(a.body.result.char.handle, /^[A-Z][0-9]{5,7}$/);

    // --- public who / online / id pages ---
    const who = await fetch(`${app.url}/v1/who/A00003`);
    assert.equal(who.status, 200);
    const whoBody = (await who.json()) as Json;
    assert.equal(whoBody.char_id, me);
    assert.equal(whoBody.online, true);
    assert.equal(whoBody.place_id, a.body.result.char.loc);
    assert.equal(whoBody.char.handle, "A00003");
    assert.equal(whoBody.char.email_hash, undefined);
    assert.equal((await fetch(`${app.url}/v1/who/A99999`)).status, 404);

    const online = (await (await fetch(`${app.url}/v1/online`)).json()) as Json;
    assert.ok(online.count <= 20);
    assert.equal(typeof online.total, "number");
    assert.ok(online.total >= online.count);
    const onlineHandles = online.online.map((o: Json) => o.handle);
    assert.ok(onlineHandles.includes("A00003"));
    assert.equal(onlineHandles.includes("A00001"), false); // buried legacy players are not online
    assert.equal(onlineHandles.includes("A00002"), false);

    const idPage = await fetch(`${app.url}/id/A00003`);
    assert.equal(idPage.status, 200);
    assert.match(idPage.headers.get("content-type") ?? "", /^text\/html/);
    assert.match(await idPage.text(), /A00003/);
    assert.equal((await fetch(`${app.url}/id/B00001`)).status, 404);

    // --- email bind: only the normalized hash is stored, never echoed ---
    const bind = await call("enter", { mode: "resume", email: "  User@Example.COM " }, codeA);
    assert.equal(bind.status, 200);
    assert.equal(bind.body.result.email_bound, true);
    assert.equal(bind.body.result.identity_code, null);
    const stored = await app.db.query<{ email_hash: string }>("SELECT email_hash FROM chars WHERE id = $1", [me]);
    assert.equal(stored.rows[0]?.email_hash, hashEmail(normalizeEmail("  User@Example.COM ")));
    assert.equal(JSON.stringify(bind.body).includes("User@Example"), false);

    // --- handle + email resume: fresh code once, old code stays valid ---
    const again = await call("enter", { mode: "resume", handle: "A00003", email: "user@example.com" });
    assert.equal(again.status, 200);
    assert.equal(again.body.result.created, false);
    assert.equal(again.body.result.char.id, me);
    assert.equal(again.body.result.email_bound, true);
    const fresh: string = again.body.result.identity_code;
    assert.match(fresh, /^AIHW-/);
    const codes = await app.db.query<{ n: string }>("SELECT count(*) AS n FROM identities WHERE char_id = $1", [me]);
    assert.equal(Number(codes.rows[0]?.n ?? 0), 2);
    assert.equal((await call("whoami", {}, codeA)).status, 200);
    assert.equal((await call("whoami", {}, fresh)).status, 200);

    // --- the three failures answer identically (no leak of bound-or-not) ---
    const noHandle = await call("enter", { mode: "resume", handle: "A99999", email: "user@example.com" });
    const wrongEmail = await call("enter", { mode: "resume", handle: "A00003", email: "wrong@example.com" });
    const unbound = await call("enter", { mode: "resume", handle: "A00001", email: "user@example.com" });
    for (const out of [noHandle, wrongEmail, unbound]) {
      assert.equal(out.status, 401);
      assert.equal(out.body.error.code, "AUTH_INVALID");
      assert.deepEqual(out.body.error.details, {});
    }

    // --- unbind, then handle resume is refused the same way ---
    const off = await call("enter", { mode: "resume", email: null }, codeA);
    assert.equal(off.status, 200);
    assert.equal(off.body.result.email_bound, false);
    const afterOff = await call("enter", { mode: "resume", handle: "A00003", email: "user@example.com" });
    assert.equal(afterOff.status, 401);
    assert.equal(afterOff.body.error.code, "AUTH_INVALID");

    // --- export button present (static) and the verb catalog carries the new args ---
    const js = await (await fetch(`${app.url}/play/static/play.js`)).text();
    assert.equal(js.includes("导出存档"), true);
    assert.equal(js.includes("AI人间存档"), true);
    const catalog = (await (await fetch(`${app.url}/v1/verbs`)).json()) as {
      verbs: { verb: string; branches: { selector: Record<string, unknown>; args: { properties: Record<string, unknown> } }[] }[];
    };
    const enter = catalog.verbs.find((v) => v.verb === "enter")!;
    const resume = enter.branches.find((b) => b.selector.mode === "resume")!;
    assert.ok(resume.args.properties.handle && resume.args.properties.email);
  } finally {
    await app.close();
  }
});
