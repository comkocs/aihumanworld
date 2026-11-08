// S46 / S54 regression: S92 removes speech rewards; combat, delivery and notices remain.

import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { startApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { setQuiet } from "../src/log.ts";

type Json = any;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const NUMBERS = join(repoRoot, "content", "rules", "numbers.v1.json");
const WORLD_DIR = join(repoRoot, "content", "world");
const SCRATCH = join(repoRoot, "_work", "临时", "S46");
const REALM = "r1";

type App = Awaited<ReturnType<typeof startApp>>;
interface Player {
  id: string;
  code: string;
}

function driver(app: App) {
  const call = async (verb: string, args: object, code?: string): Promise<Json> => {
    const headers: Record<string, string> = { "Content-Type": "application/json; charset=utf-8" };
    if (code !== undefined) headers.Authorization = `Bearer ${code}`;
    const res = await fetch(`${app.url}/v1/actions/${verb}`, { method: "POST", headers, body: JSON.stringify({ args }) });
    return (await res.json()) as Json;
  };
  const q = async (sql: string, params: unknown[] = []): Promise<Json[]> => (await app.db.query<Json>(sql, params)).rows;
  const js = (v: unknown): Json => (typeof v === "string" ? JSON.parse(v) : v);
  /** Makes one more tick due; the next request runs it. */
  const nextTick = async (): Promise<void> => {
    await app.db.query("UPDATE worlds SET tick_started_at = tick_started_at - interval '60 seconds'");
  };
  const join = async (skin = "xiuxian"): Promise<Player> => {
    const r = await call("enter", { mode: "create", skin, door: "api" });
    assert.equal(r.ok, true, JSON.stringify(r));
    return { id: r.result.char.id as string, code: r.result.identity_code as string };
  };
  const say = (who: Player, text: string, target?: Player | string): Promise<Json> =>
    call("say", target === undefined ? { text } : { text, target: typeof target === "string" ? target : target.id }, who.code);
  const xp = async (p: Player): Promise<number> => Number((await q("SELECT xp FROM chars WHERE id = $1", [p.id]))[0]?.xp);
  const potential = async (p: Player): Promise<number> => Number((await q("SELECT potential FROM chars WHERE id = $1", [p.id]))[0]?.potential);
  const discourses = async (): Promise<Json[]> => (await q("SELECT * FROM deeds WHERE kind = 'discourse' ORDER BY seq")).map((d) => ({ ...d, targets: js(d.targets), participants: js(d.participants) }));
  return { call, q, js, nextTick, join, say, xp, potential, discourses };
}

async function openMemory(): Promise<App> {
  const config = await loadConfig({ ...process.env, AIHW_DB_DRIVER: "pglite", AIHW_PGLITE_DIR: "memory", AIHW_PORT: "0" });
  config.clock.enabled = false;
  return startApp(config);
}

/** AIHW_NOTICE_FILE for the duration of one test; the repo's own notice stays out of the other chains. */
async function withNoticeFile<T>(file: string, body: () => Promise<T>): Promise<T> {
  const before = process.env.AIHW_NOTICE_FILE;
  process.env.AIHW_NOTICE_FILE = file;
  try {
    return await body();
  } finally {
    if (before === undefined) delete process.env.AIHW_NOTICE_FILE;
    else process.env.AIHW_NOTICE_FILE = before;
  }
}

test("S46 ① / S54: speech has no reward or 初识, while nearby NPC replies and distant speech survive", async () => {
  setQuiet(true);
  const numbers = JSON.parse(await readFile(NUMBERS, "utf8")) as Json;
  assert.equal(numbers.meta.revision_key, numbers.world_rules.balance_key);
  assert.deepEqual(numbers.tasks.deed_bonus.discourse, { rep_mult: 0, window_ticks: 60, first_xp_bp: 0, first_potential_bp: 0, talk_rate_bp: 0, talk_accrue_max_ticks: 3, npc_rate_bp: 0 });
  await withNoticeFile(join(SCRATCH, "no_such_notice.json"), async () => {
    const app = await openMemory();
    try {
      const d = driver(app);
      const A = await d.join();
      const B = await d.join();
      const base = [await d.xp(A), await d.xp(B), await d.potential(A), await d.potential(B)];
      for (let i = 0; i < 30; i += 1) {
        await d.nextTick();
        assert.equal((await d.say(A, `甲${i}`, B)).ok, true);
        assert.equal((await d.say(B, `乙${i}`, A)).ok, true);
      }
      const npc = (await d.q("SELECT id FROM chars WHERE kind = $1 AND loc = (SELECT loc FROM chars WHERE id = $2) LIMIT 1", ["npc", A.id]))[0]?.id;
      assert.ok(npc);
      await d.nextTick();
      const reply = await d.say(A, "老人家近来可好", npc);
      assert.equal(reply.ok, true);
      assert.equal(reply.result.npc_reply.from, npc);
      assert.ok(reply.result.npc_reply.text.length > 0);
      assert.equal(Object.hasOwn(reply.result, "changes"), false);
      const elsewhere = (await d.q("SELECT id FROM places WHERE id <> (SELECT loc FROM chars WHERE id = $1) LIMIT 1", [A.id]))[0]?.id;
      await d.q("UPDATE chars SET loc = $2 WHERE id = $1", [B.id, elsewhere]);
      await d.nextTick();
      const dirty = await d.say(A, "看看这个 http://evil.example/x 再说", B);
      assert.equal(dirty.ok, true);
      assert.equal(dirty.result.other_speech.includes("http"), false);
      assert.equal((await d.say(B, "看见了", A)).ok, true);
      assert.deepEqual([await d.xp(A), await d.xp(B), await d.potential(A), await d.potential(B)], base);
      assert.equal((await d.discourses()).length, 0);
    } finally {
      await app.close();
    }
  });
});

test("S46 ⑤: 切磋 / PK pay by the lower tier, once per pair per day, five a day, apart from talking", async () => {
  setQuiet(true);
  const numbers = JSON.parse(await readFile(NUMBERS, "utf8")) as Json;
  const rule = numbers.tasks.deed_bonus.combat_social;
  assert.deepEqual(rule, { duel_win_bp: 8400, duel_lose_bp: 4200, duel_draw_bp: 5600, pk_win_bp: 7900, daily_max: 5, hunt_mult: 3, hunt_daily_max: 5 });
  const t1 = numbers.tiers.find((r: Json) => r.tier === 1);
  const t5 = numbers.tiers.find((r: Json) => r.tier === 5);
  const of = (bp: number): { xp: number; pot: number } => ({ xp: Math.floor((t1.task_xp * bp) / 10000), pot: Math.floor((t1.task_potential * bp) / 10000) });
  const win = of(rule.duel_win_bp); // 252 / 25
  const lose = of(rule.duel_lose_bp); // 126 / 12
  const draw = of(rule.duel_draw_bp); // 168 / 16
  // PK kills below are between peers of tier 5 (a higher tier killing a lower one pays no PK reward, S48 test).
  const kill = { xp: Math.floor((t5.task_xp * rule.pk_win_bp) / 10000), pot: Math.floor((t5.task_potential * rule.pk_win_bp) / 10000) }; // 1185 / 118
  assert.deepEqual([win.xp, lose.xp, draw.xp, kill.xp], [252, 126, 168, 1185]);

  await withNoticeFile(join(SCRATCH, "no_such_notice.json"), async () => {
    const app = await openMemory();
    try {
      const d = driver(app);
      const first = await d.join();
      const arena: string = (await d.q("SELECT loc FROM chars WHERE id = $1", [first.id]))[0]?.loc;
      await d.q("UPDATE places SET combat = 'duel' WHERE id = $1", [arena]);
      // This chain is about rewards, not about the S48 newbie window (s48_redname.test.ts): fresh chars fight at once.
      app.services.balance().numbers.combat.newbie_protect_ticks = 0;
      const gains = async (who: Player[], act: () => Promise<Json>): Promise<{ res: Json; dxp: number[]; dpot: number[] }> => {
        const xs = await Promise.all(who.map((p) => d.xp(p)));
        const ps = await Promise.all(who.map((p) => d.potential(p)));
        await d.nextTick();
        const res = await act();
        return {
          res,
          dxp: await Promise.all(who.map(async (p, i) => (await d.xp(p)) - (xs[i] as number))),
          dpot: await Promise.all(who.map(async (p, i) => (await d.potential(p)) - (ps[i] as number))),
        };
      };
      const attack = (a: Player, b: Player): Promise<Json> => d.call("attack", { target: b.id }, a.code);
      const socialEvents = async (p: Player): Promise<Json[]> =>
        (await d.q("SELECT data FROM events WHERE type = 'reward_granted' AND recipients @> $1::jsonb ORDER BY cursor", [JSON.stringify([p.id])]))
          .map((e) => d.js(e.data))
          .filter((e) => e.social !== undefined && e.social.kind !== "discourse");

      // 切磋: fresh pairs until a win, a loss and a draw have each happened once (the roll is deterministic).
      const seen = new Map<string, { a: Player; b: Player; res: Json; dxp: number[]; dpot: number[] }>();
      for (let i = 0; i < 150 && seen.size < 3; i += 1) {
        const a = await d.join();
        const b = await d.join();
        const g = await gains([a, b], () => attack(a, b));
        assert.equal(g.res.ok, true, JSON.stringify(g.res));
        if (!seen.has(g.res.result.outcome)) seen.set(g.res.result.outcome, { a, b, ...g });
      }
      assert.deepEqual([...seen.keys()].sort(), ["draw", "lose", "win"]);
      const w = seen.get("win") as NonNullable<ReturnType<typeof seen.get>>;
      const l = seen.get("lose") as NonNullable<ReturnType<typeof seen.get>>;
      const dr = seen.get("draw") as NonNullable<ReturnType<typeof seen.get>>;
      assert.deepEqual([w.dxp, w.dpot], [[win.xp, lose.xp], [win.pot, lose.pot]], "attacker won: winner 0.84 task, loser 0.42");
      assert.deepEqual([l.dxp, l.dpot], [[lose.xp, win.xp], [lose.pot, win.pot]], "attacker lost");
      assert.deepEqual([dr.dxp, dr.dpot], [[draw.xp, draw.xp], [draw.pot, draw.pot]], "draw: 0.56 task each");
      // The attack result shows the attacker's own gain; the deed kinds are the existing combat ones.
      for (const [name, s, kindOf] of [["win", w, "duel_win"], ["lose", l, "combat_loss"], ["draw", dr, "combat_draw"]] as [string, typeof w, string][]) {
        const own = (s.res.result.changes as Json[]).filter((c) => c.table === "char" && c.id === s.a.id && c.after.xp !== undefined && c.after.potential !== undefined);
        assert.equal(own.length, 1, `${name}: the attack result carries the attacker's xp / potential change`);
        assert.equal(own[0].after.xp, (await d.xp(s.a)), `${name}: after.xp is the new balance`);
        assert.equal((await d.q("SELECT kind FROM deeds WHERE id = $1", [s.res.result.deed_id]))[0]?.kind, kindOf);
        const ev = await socialEvents(s.a);
        assert.equal(ev.length, 1);
        assert.deepEqual(ev[0].social, { kind: "duel", with: s.b.id });
        assert.equal(ev[0].reward.xp, s.dxp[0]);
        assert.equal(ev[0].source, s.res.result.deed_id);
        assert.equal((await socialEvents(s.b)).length, 1);
      }

      // The same pair on the same game day: fight again, nothing more is paid.
      const again = await gains([w.a, w.b], () => attack(w.a, w.b));
      assert.equal(again.res.ok, true, JSON.stringify(again.res));
      assert.deepEqual(again.dxp, [0, 0]);
      assert.equal(((again.res.result.changes as Json[]).filter((c) => c.table === "char" && c.after.xp !== undefined)).length, 0);
      assert.equal((await socialEvents(w.a)).length, 1);

      // An NPC at the arena pays nothing on the duel / pk path. S80 pays a monster kill of the killer's own
      // tier or higher, so this monster is set below the hunter's tier and the assertion stays about the duel path.
      const npc: string = (await d.q("SELECT id FROM chars WHERE kind = 'npc' AND archetype = 'monster' AND life = 'alive' AND state = 'active' LIMIT 1"))[0]?.id;
      assert.ok(npc);
      await d.q("UPDATE chars SET loc = $2, tier = 1 WHERE id = $1", [npc, arena]);
      const H = await d.join();
      const L = await d.join();
      await d.q("UPDATE chars SET tier = 5, stage = 1, vigor = 1000000 WHERE id = $1", [H.id]);
      const vsNpc = await gains([H], () => d.call("attack", { target: npc }, H.code));
      assert.equal(vsNpc.res.ok, true, JSON.stringify(vsNpc.res));
      assert.deepEqual(vsNpc.dxp, [0]);
      assert.equal((await socialEvents(H)).length, 0);

      // Lower-tier base: a tier-5 char against a tier-1 char is paid on tier 1 (252 / 126, not 1260 / 630).
      assert.ok(t5.task_xp * rule.duel_win_bp / 10000 > win.xp);
      await d.q("UPDATE chars SET vigor = 1000000 WHERE id = $1", [H.id]);
      const spar = await gains([H, L], () => attack(H, L));
      assert.equal(spar.res.result.outcome, "win");
      assert.deepEqual(spar.dxp, [win.xp, lose.xp]);
      assert.equal((await d.q("SELECT tier FROM chars WHERE id = $1", [H.id]))[0]?.tier, 5);

      // PK between peers (tier 5): only a kill pays, 0.79 task of the lower tier to the winner; the victim gets nothing extra.
      await d.q("UPDATE places SET combat = 'pk' WHERE id = $1", [arena]);
      const victims: Player[] = [];
      for (let i = 0; i < 5; i += 1) {
        const v = await d.join();
        await d.q("UPDATE chars SET tier = 5, stage = 1 WHERE id = $1", [v.id]);
        victims.push(v);
      }
      const strike = async (v: Player): Promise<{ res: Json; dxp: number[]; dpot: number[] }> => {
        await d.q("UPDATE chars SET vigor = 1000000 WHERE id = $1", [H.id]);
        await d.q("UPDATE chars SET vigor = 1, life = 'alive', revive_tick = NULL WHERE id = $1", [v.id]);
        return gains([H, v], () => attack(H, v));
      };
      const v1 = victims[0] as Player;
      const k1 = await strike(v1);
      assert.equal(k1.res.ok, true, JSON.stringify(k1.res));
      assert.equal((await d.q("SELECT life FROM chars WHERE id = $1", [v1.id]))[0]?.life, "dead");
      assert.equal(k1.dxp[0], kill.xp);
      assert.equal(k1.dpot[0], kill.pot);
      assert.ok((k1.dxp[1] as number) <= 0, "the victim's xp only goes down (death rule)");
      assert.equal((await socialEvents(v1)).length, 0);
      assert.deepEqual((await socialEvents(H)).at(-1)?.social, { kind: "pk", with: v1.id });
      // Same victim, same day: no second reward.
      const k1b = await strike(v1);
      assert.equal(k1b.res.ok, true, JSON.stringify(k1b.res));
      assert.equal(k1b.dxp[0], 0);
      // H has had 切磋 (1) + this kill (1); three more victims make five, the sixth is not paid.
      for (const v of victims.slice(1, 4)) assert.equal((await strike(v)).dxp[0], kill.xp);
      assert.equal((await socialEvents(H)).length, 5);
      const v5 = victims[4] as Player;
      const capped = await strike(v5);
      assert.equal(capped.res.ok, true, JSON.stringify(capped.res));
      assert.equal(capped.dxp[0], 0, "sixth 切磋 / PK reward of the day is not paid");
      assert.equal((await socialEvents(H)).length, 5);

      // Empty speech is allowed even after the combat allowance, but gives no growth.
      const W = await d.join();
      const talk = await gains([H, W], async () => {
        assert.equal((await d.say(W, "请教前辈")).ok, true);
        await d.nextTick();
        return d.say(H, "请讲", W);
      });
      assert.equal(talk.res.deed_ids.length, 0);
      assert.deepEqual(talk.dxp, [0, 0]);

      // The next game day: yesterday's victim pays again, and the daily count starts over.
      await d.q("UPDATE worlds SET tick = tick + 1440, day_index = day_index + 1");
      await d.nextTick();
      assert.equal((await d.call("look", {}, H.code)).ok, true); // let the clock catch up first: vigor regenerates over a day
      const nextDay = await strike(v1);
      assert.equal(nextDay.res.ok, true, JSON.stringify(nextDay.res));
      assert.equal(nextDay.dxp[0], kill.xp);
    } finally {
      await app.close();
    }
  });
});

test("S46 ①b: a char who arrived after the opening line was not there for it", async () => {
  setQuiet(true);
  await withNoticeFile(join(SCRATCH, "no_such_notice.json"), async () => {
    const app = await openMemory();
    try {
      const d = driver(app);
      const A = await d.join();
      const W = await d.join();
      const here: string = (await d.q("SELECT loc FROM chars WHERE id = $1", [A.id]))[0]?.loc;
      const out = await d.call("go", { dir: "south" }, W.code);
      assert.equal(out.ok, true, JSON.stringify(out));
      const exits = d.js((await d.q("SELECT exits FROM places WHERE id = $1", [out.result.to]))[0]?.exits) as Json[];
      const way = exits.find((e) => e.to === here);
      assert.ok(way, "the way back");

      await d.nextTick();
      assert.equal((await d.say(A, "有人在吗?")).ok, true);
      await d.nextTick();
      assert.equal((await d.call("go", { dir: way.dir }, W.code)).ok, true);
      await d.nextTick();
      const late = await d.say(W, "刚到,请多指教", A);
      assert.equal(late.ok, true);
      assert.equal(late.deed_ids.length, 0, "W was not here when A spoke to the room");
      assert.equal((await d.discourses()).length, 0);

      // A welcome remains ordinary speech, with no 初识 or cultivation.
      await d.nextTick();
      const welcome = await d.say(A, "欢迎");
      assert.equal(welcome.ok, true);
      assert.equal(welcome.deed_ids.length, 0);
      assert.equal((await d.discourses()).length, 0);
    } finally {
      await app.close();
    }
  });
});

test("S46 ②: new_speech carries what others said directly since the previous success, once", async () => {
  setQuiet(true);
  await withNoticeFile(join(SCRATCH, "no_such_notice.json"), async () => {
    const app = await openMemory();
    try {
      const d = driver(app);
      const A = await d.join();
      const B = await d.join();
      const E = await d.join(); // B talks to E, who never spoke to B first: no discourse in this chain
      const others = [await d.join(), await d.join(), await d.join(), await d.join(), await d.join(), await d.join()];
      const handleOf = async (p: Player): Promise<string> => (await d.q("SELECT handle FROM chars WHERE id = $1", [p.id]))[0]?.handle;

      await d.nextTick();
      const sent = await d.say(A, "ping-A", B);
      assert.equal(sent.ok, true);
      assert.equal(sent.new_speech, undefined, "nothing was said to A");
      const sentTick: string = sent.tick;

      // B's next successful action (any verb) carries it; the one after does not.
      await d.nextTick();
      const w1 = await d.call("whoami", {}, B.code);
      assert.equal(w1.ok, true);
      assert.equal(w1.new_speech.length, 1);
      assert.deepEqual(w1.new_speech[0], {
        from: A.id,
        from_handle: await handleOf(A),
        tick: sentTick,
        other_speech: "ping-A",
        speech_status: "available",
      });
      const w2 = await d.call("look", {}, B.code);
      assert.equal(w2.ok, true);
      assert.equal(Object.hasOwn(w2, "new_speech"), false);

      // Own speech is never echoed back; the addressee sees it.
      await d.nextTick();
      const back = await d.say(B, "pong-B", E);
      assert.equal(back.ok, true);
      assert.equal(Object.hasOwn(back, "new_speech"), false);
      const e1 = await d.call("look", {}, E.code);
      assert.deepEqual(e1.new_speech.map((s: Json) => [s.from, s.other_speech]), [[B.id, "pong-B"]]);
      assert.equal(Object.hasOwn(await d.call("look", {}, E.code), "new_speech"), false);
      assert.equal(Object.hasOwn(await d.call("look", {}, B.code), "new_speech"), false, "B never hears its own line");

      // A refused action stamps nothing: the sentence waits for the next success.
      await d.nextTick();
      assert.equal((await d.say(others[0] as Player, "hold-0", B)).ok, true);
      await d.nextTick();
      const refused = await d.call("say", { text: "字".repeat(201) }, B.code);
      assert.equal(refused.ok, false);
      assert.equal(Object.hasOwn(refused, "new_speech"), false);
      const w3 = await d.call("whoami", {}, B.code);
      assert.deepEqual(w3.new_speech.map((s: Json) => s.other_speech), ["hold-0"]);

      // More than five: the newest five, oldest first.
      await d.nextTick();
      for (let i = 0; i < others.length; i += 1) assert.equal((await d.say(others[i] as Player, `m-${i}`, B)).ok, true);
      await d.nextTick();
      const w4 = await d.call("whoami", {}, B.code);
      assert.equal(w4.new_speech.length, 5);
      assert.deepEqual(w4.new_speech.map((s: Json) => s.other_speech), ["m-1", "m-2", "m-3", "m-4", "m-5"]);
      assert.deepEqual(w4.new_speech.map((s: Json) => s.from), others.slice(1).map((p) => p.id));
      // Place-channel speech is not direct: it does not ride along.
      await d.nextTick();
      assert.equal((await d.say(A, "给大家的话")).ok, true);
      await d.nextTick();
      assert.equal(Object.hasOwn(await d.call("whoami", {}, B.code), "new_speech"), false);
    } finally {
      await app.close();
    }
  });
});

test("S46 ③: notice shows in bursts per char per rev, survives a restart, ignores missing / empty / broken files", async () => {
  setQuiet(true);
  const scratch = join(SCRATCH, `notice_${process.pid}`);
  await rm(scratch, { recursive: true, force: true });
  await mkdir(scratch, { recursive: true });
  const noticeFile = join(scratch, "notice.json");
  const notice = (rev: string): string =>
    JSON.stringify({ rev, url: "https://example.test/start.md", text: { en: `Guide ${rev} updated.`, "zh-CN": `入口 ${rev} 已更新。` } });
  const config = join(scratch, "server.json");
  await writeFile(
    config,
    JSON.stringify({
      realm: REALM,
      http: { host: "127.0.0.1", port: 0, body_max_bytes: 65536 },
      db: { driver: "pglite", pglite_dir: "db", pool_max: 1 },
      rules_file: NUMBERS,
      content_dir: WORLD_DIR,
      clock: { max_catchup_ticks_per_tx: 8 },
    }),
  );
  const open = async (): Promise<App> => {
    const c = await loadConfig({ AIHW_CONFIG: config });
    c.clock.enabled = false;
    return startApp(c);
  };

  await withNoticeFile(noticeFile, async () => {
    let app = await open();
    try {
      let d = driver(app);
      const old = await d.join();
      // No file: nothing.
      await d.nextTick();
      assert.equal(Object.hasOwn(await d.call("look", {}, old.code), "notice"), false);

      // A fresh rev: the old char sees five notices, then no more.
      await writeFile(noticeFile, notice("r-one"));
      await d.nextTick();
      const n1 = await d.call("look", {}, old.code);
      assert.deepEqual(n1.notice, { rev: "r-one", url: "https://example.test/start.md", text: { en: "Guide r-one updated.", "zh-CN": "入口 r-one 已更新。" } });
      for (let i = 0; i < 4; i += 1) assert.equal((await d.call("look", {}, old.code)).notice.rev, "r-one");
      assert.equal(Object.hasOwn(await d.call("whoami", {}, old.code), "notice"), false);

      // A char created after publication does not see it (create envelope, nor the actions after).
      await d.nextTick();
      const created = await d.call("enter", { mode: "create", skin: "wuxia", door: "api" });
      assert.equal(created.ok, true);
      assert.equal(Object.hasOwn(created, "notice"), false);
      const fresh: Player = { id: created.result.char.id, code: created.result.identity_code };
      await d.nextTick();
      assert.equal(Object.hasOwn(await d.call("look", {}, fresh.code), "notice"), false);

      // Empty and broken files: nothing for anybody.
      await writeFile(noticeFile, "");
      await d.nextTick();
      assert.equal(Object.hasOwn(await d.call("look", {}, old.code), "notice"), false);
      await writeFile(noticeFile, "{not json");
      await d.nextTick();
      assert.equal(Object.hasOwn(await d.call("look", {}, old.code), "notice"), false);
      await writeFile(noticeFile, JSON.stringify({ rev: "r-bad", url: "https://example.test/start.md" }));
      await d.nextTick();
      assert.equal(Object.hasOwn(await d.call("look", {}, old.code), "notice"), false);

      // A new rev starts another burst for both chars, including the one created in between.
      await writeFile(noticeFile, notice("r-two"));
      await d.nextTick();
      for (let i = 0; i < 5; i += 1) {
        assert.equal((await d.call("look", {}, old.code)).notice.rev, "r-two");
        assert.equal((await d.call("look", {}, fresh.code)).notice.rev, "r-two");
      }
      assert.equal(Object.hasOwn(await d.call("look", {}, old.code), "notice"), false);
      assert.equal(Object.hasOwn(await d.call("look", {}, fresh.code), "notice"), false);
      assert.equal((await d.q("SELECT count(*) AS n FROM notice_revs"))[0]?.n, "2");

      // Restart on the same database and file: nobody who already saw r-two sees it again.
      await d.nextTick();
      assert.equal(Object.hasOwn(await d.call("look", {}, old.code), "notice"), false);
      assert.equal(Object.hasOwn(await d.call("look", {}, fresh.code), "notice"), false);
      await app.close();
      app = await open();
      d = driver(app);
      await d.nextTick();
      assert.equal(Object.hasOwn(await d.call("look", {}, old.code), "notice"), false, "published tick survives the restart");
      assert.equal(Object.hasOwn(await d.call("look", {}, fresh.code), "notice"), false);
    } finally {
      await app.close();
      await rm(scratch, { recursive: true, force: true });
    }
  });
});
