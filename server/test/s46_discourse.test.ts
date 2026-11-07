// S46 acceptance (设计者 11-07 「偶遇奖励选 A 论道」+ 已进游戏的 AI 如何拿到新版入口 + 让 AI 相互交流、切磋、PK
// 的奖励明显高于练级), five short chains:
//   ① 论道: A speaks, B answers within the window → both are paid by time (1.1 x the full-attendance training rate
//      since their own last talk reward, at most an hour; the leftover fraction is carried), with no count limit and
//      no "once a day"; the pair's first ever (初识) adds half a task and one world deed; the answerer's say result
//      shows its own xp change; answering twice in one tick pays nothing; NPCs never count.
//   ⑤ 切磋 / PK: attack between two participants at a duel / pk place pays by the LOWER tier (win 0.84,
//      lose 0.42, draw 0.56 task; a PK kill 0.79 task), once per pair per day, five a day, counted apart from talking.
//      (①b: a place-channel opening only counts for chars who were already there when it was said.)
//
// Needs migrations/1101_s46_discourse_kind.sql (deeds.kind CHECK knows `discourse`); without it the first
// discourse answers RETRY_LATER with "violates check constraint deeds_kind_check" in the error log.
//   ② new_speech: B's next successful action carries what A said to B directly (≤5, newest, own speech
//      excluded), the one after carries nothing; a refused action consumes nothing.
//   ③ notice: an old char sees a fresh rev once, a new rev shows once more, no / empty / broken file shows
//      nothing, a created char does not see it, a restarted server does not show it twice.

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

test("S46 ①: talking pays by time (1.1 x training), no count limit, 初识 once per pair, never for NPCs", async () => {
  setQuiet(true);
  const numbers = JSON.parse(await readFile(NUMBERS, "utf8")) as Json;
  const rule = numbers.tasks.deed_bonus.discourse;
  const t1 = numbers.tiers.find((r: Json) => r.tier === 1);
  assert.equal(numbers.meta.revision_key, "balance.v1.8");
  assert.equal(numbers.world_rules.balance_key, "balance.v1.8");
  assert.deepEqual(rule, { rep_mult: 0, window_ticks: 60, first_xp_bp: 100, first_potential_bp: 100, talk_rate_bp: 11000, talk_accrue_max_ticks: 3, npc_rate_bp: 7000 });
  // Tier 1: the full-attendance day is 1188 xp / 234 potential; talking earns 1.1 x of it per tick since one's own last talk reward.
  const dayTicks: number = numbers.clock.day_ticks;
  const unit = 10000 * dayTicks;
  const xpPerTick = t1.daily_xp_full * rule.talk_rate_bp; // in 1/unit points
  const potPerTick = (3 * t1.task_potential + (dayTicks / numbers.clock.train_period_ticks) * t1.train_potential) * rule.talk_rate_bp;
  assert.deepEqual([t1.daily_xp_full, xpPerTick * rule.talk_accrue_max_ticks / unit], [1188, 2.7225]);
  const firstXp = Math.floor((t1.task_xp * rule.first_xp_bp) / 10000); // a hundredth of a task: 3
  const firstPot = Math.floor((t1.task_potential * rule.first_potential_bp) / 10000); // 0
  assert.deepEqual([firstXp, firstPot], [3, 0]);
  // The model of one char's talk income: whole points paid, the fraction carried to the next reward (dropped after a long silence).
  const model = () => ({ xp: 0, pot: 0 });
  const earn = (m: { xp: number; pot: number }, ticks: number, carry: boolean): { xp: number; pot: number } => {
    const x = xpPerTick * ticks + (carry ? m.xp : 0);
    const p = potPerTick * ticks + (carry ? m.pot : 0);
    m.xp = x % unit;
    m.pot = p % unit;
    return { xp: Math.floor(x / unit), pot: Math.floor(p / unit) };
  };

  await withNoticeFile(join(SCRATCH, "no_such_notice.json"), async () => {
    const app = await openMemory();
    try {
      const d = driver(app);
      const crowd: Player[] = [];
      for (let i = 0; i < 4; i += 1) crowd.push(await d.join());
      const [A, B, C, Z] = crowd as [Player, Player, Player, Player];
      const here: string = (await d.q("SELECT loc FROM chars WHERE id = $1", [A.id]))[0]?.loc;
      const bump = async (ticks: number): Promise<void> => {
        await d.q("UPDATE worlds SET tick = tick + $1", [ticks]);
        await d.nextTick();
        assert.equal((await d.call("look", {}, A.code)).ok, true); // lets the clock catch up
      };
      const advance = async (ticks: number): Promise<void> => {
        await d.q(`UPDATE worlds SET tick_started_at = tick_started_at - interval '${60 * ticks} seconds'`);
      };
      await bump(100); // everybody is far past the cap: a first talk is paid the full `talk_accrue_max_ticks`
      const mA = model();
      const mB = model();
      const mC = model();
      const xA0 = await d.xp(A);
      const xB0 = await d.xp(B);
      const pB0 = await d.potential(B);

      // A speaks to the room; B answers: the first talk of the pair (初识) = the capped talk time + a sliver of a task, and a world deed.
      await d.nextTick();
      const opening = await d.say(A, "有人想论道吗?");
      assert.equal(opening.ok, true);
      assert.equal(opening.deed_ids.length, 0);
      assert.equal(Object.hasOwn(opening.result, "changes"), false, "an unanswered line pays nothing");
      await d.nextTick();
      const second = await d.say(B, "我来,谈谈心得", A);
      assert.equal(second.ok, true, JSON.stringify(second));
      assert.equal(second.deed_ids.length, 1);
      const capTicks: number = rule.talk_accrue_max_ticks;
      const eA = earn(mA, capTicks, false);
      const eB = earn(mB, capTicks, false);
      assert.deepEqual([eA.xp, eA.pot], [2, 0]);
      assert.equal((await d.xp(A)) - xA0, eA.xp + firstXp);
      assert.equal((await d.xp(B)) - xB0, eB.xp + firstXp);
      assert.equal((await d.potential(B)) - pB0, eB.pot + firstPot);
      assert.deepEqual(second.result.changes[0], { table: "char", id: B.id, after: { xp: xB0 + eB.xp + firstXp, ...(eB.pot + firstPot > 0 ? { potential: pB0 + eB.pot + firstPot } : {}) } });
      const deeds = await d.discourses();
      assert.equal(deeds.length, 1);
      const deed = deeds[0] as Json;
      assert.equal(deed.id, second.deed_ids[0]);
      assert.deepEqual([deed.actor, deed.verb, deed.visibility, deed.place_id], [B.id, "say", "world", here]);
      assert.deepEqual([...deed.targets].sort(), [A.id, B.id].sort());
      assert.deepEqual([...deed.participants].sort(), [A.id, B.id].sort());
      assert.ok(!JSON.stringify(deed.result).includes('"xp"'), "no xp in the world-visible deed");
      const rewardOf = async (p: Player): Promise<Json[]> =>
        (await d.q("SELECT data, deed_id FROM events WHERE type = 'reward_granted' AND recipients @> $1::jsonb ORDER BY cursor", [JSON.stringify([p.id])]))
          .map((e) => ({ ...d.js(e.data), deed_id: e.deed_id }));
      const gotA = await rewardOf(A);
      assert.equal(gotA.length, 1);
      assert.equal(gotA[0].source, deed.id);
      assert.equal(gotA[0].deed_id, deed.id);
      assert.equal(gotA[0].reward.xp, eA.xp + firstXp);
      assert.deepEqual(gotA[0].social, { kind: "discourse", with: B.id, carry: { xp: mA.xp, potential: mA.pot } });

      // No limit: eight more lines, two ticks apart, every one pays both sides two ticks of talk (no new deed, no 初识).
      for (let i = 0; i < 8; i += 1) {
        await advance(2);
        const speaker = i % 2 === 0 ? A : B;
        const listener = i % 2 === 0 ? B : A;
        const [sm, lm] = i % 2 === 0 ? [mA, mB] : [mB, mA];
        const xs0 = await d.xp(speaker);
        const xl0 = await d.xp(listener);
        const r = await d.say(speaker, `第${i}句`, listener);
        assert.equal(r.ok, true, JSON.stringify(r));
        assert.equal(r.deed_ids.length, 0, "ordinary talk writes no deed");
        const es = earn(sm, 2, true);
        const el = earn(lm, 2, true);
        assert.equal((await d.xp(speaker)) - xs0, es.xp, `line ${i}: speaker`);
        assert.equal((await d.xp(listener)) - xl0, el.xp, `line ${i}: listener`);
        assert.equal(r.result.changes[0].after.xp, xs0 + es.xp);
      }
      assert.equal((await d.discourses()).length, 1);
      // The carried fraction is exact: the sum paid is floor(all the time at the rate) + the one 初识.
      assert.equal((await d.xp(A)) - xA0, Math.floor((xpPerTick * (capTicks + 2 * 8)) / unit) + firstXp);
      assert.equal((await rewardOf(A)).length, 1 + 8);

      // Answering twice in the same tick pays nothing the second time: the clock is the limit.
      const xB1 = await d.xp(B);
      const first = await d.say(B, "再补一句", A);
      assert.equal(first.ok, true);
      const again = await d.say(B, "再补两句", A);
      assert.equal(again.ok, true);
      assert.equal(Object.hasOwn(again.result, "changes"), false);
      assert.equal((await d.xp(B)) - xB1, 0);

      // A long silence is paid for the cap only (the carried fraction is dropped with it).
      await bump(200);
      const xA2 = await d.xp(A);
      const xB2 = await d.xp(B);
      mA.xp = mA.pot = mB.xp = mB.pot = 0;
      await d.nextTick();
      assert.equal((await d.say(A, "好久不见")).ok, true);
      await d.nextTick();
      const back = await d.say(B, "是啊", A);
      assert.equal(back.ok, true);
      assert.equal(back.deed_ids.length, 0);
      assert.equal((await d.xp(A)) - xA2, earn(mA, capTicks, false).xp);
      assert.equal((await d.xp(B)) - xB2, earn(mB, capTicks, false).xp);

      // 初识 is once per pair, ever: A meets C (an extra half task each), meets C again (none).
      await bump(100); // (A's earlier room line is older than the reply window, so C's answer below is not to it)
      mA.xp = mA.pot = 0;
      const xC0 = await d.xp(C);
      const xA3 = await d.xp(A);
      await d.nextTick();
      assert.equal((await d.say(C, "久仰")).ok, true);
      await d.nextTick();
      const meet = await d.say(A, "幸会", C);
      assert.equal(meet.deed_ids.length, 1);
      const eC = earn(mC, capTicks, false);
      assert.equal((await d.xp(C)) - xC0, eC.xp + firstXp);
      assert.equal((await d.xp(A)) - xA3, earn(mA, capTicks, false).xp + firstXp);
      assert.equal((await d.discourses()).length, 2);
      const xC1 = await d.xp(C);
      await advance(7); // longer than the cap, so it pays the cap only and drops the fraction carried before it
      const meetAgain = await d.say(C, "又见面了", A);
      assert.equal(meetAgain.deed_ids.length, 0);
      mC.xp = mC.pot = 0;
      assert.equal((await d.xp(C)) - xC1, earn(mC, capTicks, false).xp);
      assert.equal((await d.discourses()).length, 2);

      // A place-channel line never draws an NPC in: Z speaks to the room with an NPC standing there and is not paid.
      await bump(100); // (the human lines above are older than the reply window by now)
      const npc: string = (await d.q("SELECT id FROM chars WHERE kind = 'npc' LIMIT 1"))[0]?.id;
      assert.ok(npc);
      await d.q("UPDATE chars SET loc = $2 WHERE id = $1", [npc, here]);
      const xZ0 = await d.xp(Z);
      await d.nextTick();
      const aloud = await d.say(Z, "大家好");
      assert.equal(aloud.ok, true);
      assert.equal(Object.hasOwn(aloud.result, "npc_reply"), false, "the place channel draws no NPC reply");
      assert.equal(await d.xp(Z), xZ0);
      assert.equal((await d.discourses()).length, 2);

      // The next game day the same pair simply goes on (no "once a day").
      await d.q("UPDATE worlds SET tick = tick + 1440, day_index = day_index + 1");
      await d.nextTick();
      assert.equal((await d.call("look", {}, A.code)).ok, true);
      const xA4 = await d.xp(A);
      const xB4 = await d.xp(B);
      mA.xp = mA.pot = mB.xp = mB.pot = 0;
      await d.nextTick();
      assert.equal((await d.say(A, "新的一天", B)).ok, true);
      await d.nextTick();
      const day2 = await d.say(B, "新的一天", A);
      assert.equal(day2.deed_ids.length, 0);
      assert.equal((await d.xp(A)) - xA4, earn(mA, capTicks, false).xp);
      assert.equal((await d.xp(B)) - xB4, earn(mB, capTicks, false).xp);
    } finally {
      await app.close();
    }
  });
});

test("S54: chatting often pays more, an NPC replies for less, a direct talk counts across places, a URL is stripped", async () => {
  setQuiet(true);
  const numbers = JSON.parse(await readFile(NUMBERS, "utf8")) as Json;
  const rule = numbers.tasks.deed_bonus.discourse;
  const t1 = numbers.tiers.find((r: Json) => r.tier === 1);
  const dayTicks: number = numbers.clock.day_ticks;
  const unit = 10000 * dayTicks;
  const paid = (ticks: number, rate: number): number => Math.floor((t1.daily_xp_full * rate * ticks) / unit);
  const capTicks: number = rule.talk_accrue_max_ticks;

  await withNoticeFile(join(SCRATCH, "no_such_notice.json"), async () => {
    const app = await openMemory();
    try {
      const d = driver(app);
      const [A, B] = [await d.join(), await d.join()] as [Player, Player];
      const here: string = (await d.q("SELECT loc FROM chars WHERE id = $1", [A.id]))[0]?.loc;
      const bump = async (ticks: number): Promise<void> => {
        await d.q("UPDATE worlds SET tick = tick + $1", [ticks]);
        await d.nextTick();
        assert.equal((await d.call("look", {}, A.code)).ok, true);
      };
      const step = async (ticks: number): Promise<void> => {
        await d.q(`UPDATE worlds SET tick_started_at = tick_started_at - interval '${60 * ticks} seconds'`);
      };

      // ① A two-way exchange on every tick against one answer in the whole stretch. A reply pays the gap since that
      // char's own previous reward, so both sides of a steady exchange earn every round, and a single answer earns once.
      await bump(100);
      const xA0 = await d.xp(A);
      const xB0 = await d.xp(B);
      // One tick is under a whole point, so the leftover is carried and paid a tick or two later.
      const accrued = (parts: number[]): number => {
        let whole = 0;
        let rest = 0;
        for (const ticks of parts) {
          const units = t1.daily_xp_full * rule.talk_rate_bp * ticks + rest;
          whole += Math.floor(units / unit);
          rest = units % unit;
        }
        return whole;
      };
      const firstXp = Math.floor((t1.task_xp * rule.first_xp_bp) / 10000);
      const rounds = 6;
      for (let i = 0; i < rounds; i += 1) {
        await step(1);
        await d.nextTick();
        assert.equal((await d.say(B, `乙${i}`, A)).ok, true);
        assert.equal((await d.say(A, `甲${i}`, B)).ok, true);
      }
      const steadyA = (await d.xp(A)) - xA0;
      const steadyB = (await d.xp(B)) - xB0;
      // Each `step(1)` lets two ticks become due (the request before it spent one): the opener is paid from the
      // second round on, the answerer from the first.
      assert.equal(steadyB, accrued([capTicks, ...Array(rounds - 1).fill(2)]) + firstXp, "opens every round");
      assert.equal(steadyA, accrued([capTicks, ...Array(rounds - 1).fill(2)]) + firstXp, "answers every round");

      const C = await d.join();
      await bump(100);
      const xC0 = await d.xp(C);
      await step(1);
      await d.nextTick();
      assert.equal((await d.say(A, "只说这一次", C)).ok, true);
      for (let i = 0; i < rounds - 1; i += 1) {
        await step(1);
        await d.nextTick();
      }
      await d.nextTick();
      assert.equal((await d.say(C, "隔了好一会儿才回", A)).ok, true);
      const once = (await d.xp(C)) - xC0;
      assert.equal(once, accrued([capTicks]) + firstXp, "one answer pays the capped gap and no more");
      assert.ok(steadyA > once * 2, `a steady exchange (${steadyA}) earns clearly more than one answer (${once})`);

      // ② Speaking directly to an NPC at the same place: the NPC answers, and the pay is below a player discourse.
      const npc: string = (await d.q("SELECT id FROM chars WHERE kind = 'npc' AND loc = $1 LIMIT 1", [here]))[0]?.id;
      assert.ok(npc, "the start place has an NPC");
      await bump(100);
      const xA1 = await d.xp(A);
      await d.nextTick();
      const toNpc = await d.say(A, "老人家,近来可好?", npc);
      assert.equal(toNpc.ok, true, JSON.stringify(toNpc));
      assert.equal(typeof toNpc.result.npc_reply?.text, "string");
      assert.ok(toNpc.result.npc_reply.text.length > 0, "the NPC answers with a line");
      assert.equal(toNpc.result.npc_reply.from, npc);
      assert.ok(toNpc.result.delivered_event_ids.includes(toNpc.result.npc_reply.event_id));
      const npcXp = (await d.xp(A)) - xA1;
      assert.equal(npcXp, paid(capTicks, rule.npc_rate_bp));
      assert.ok(npcXp < paid(capTicks, rule.talk_rate_bp), "an NPC pays less than a player");
      assert.equal(toNpc.deed_ids.length, 0, "talking to an NPC writes no deed");

      // Alternating player and NPC talk shares one clock and carry; compare with player talk at every tick interval.
      const D = await d.join();
      const E = await d.join();
      await bump(100);
      assert.equal((await d.say(A, "再来论道", B)).ok, true);
      assert.equal((await d.say(B, "请讲", A)).ok, true);
      assert.equal((await d.say(D, "请论道", E)).ok, true);
      assert.equal((await d.say(E, "请讲", D)).ok, true);
      const mixedXp0 = await d.xp(A);
      const mixedPot0 = await d.potential(A);
      const playerXp0 = await d.xp(D);
      const playerPot0 = await d.potential(D);
      for (let i = 0; i < 8; i += 1) {
        await step(1);
        await d.nextTick();
        assert.equal((await (i % 2 === 0 ? d.say(A, `问候${i}`, npc) : d.say(B, `论道${i}`, A))).ok, true);
        assert.equal((await d.say(D, `论道${i}`, E)).ok, true);
      }
      const mixedXp = (await d.xp(A)) - mixedXp0;
      const playerXp = (await d.xp(D)) - playerXp0;
      assert.ok(mixedXp <= playerXp, `alternating talk (${mixedXp}) must not exceed player talk (${playerXp})`);
      assert.ok((await d.potential(A)) - mixedPot0 <= (await d.potential(D)) - playerPot0, "alternating potential must not exceed player talk");

      // A place-channel line draws no NPC reply.
      await d.nextTick();
      const aloud = await d.say(A, "大家好");
      assert.equal(aloud.ok, true);
      assert.equal(Object.hasOwn(aloud.result, "npc_reply"), false);

      // ③ A direct exchange between two places pays both sides.
      const elsewhere: string = (await d.q("SELECT id FROM places WHERE id <> $1 LIMIT 1", [here]))[0]?.id;
      assert.ok(elsewhere);
      await d.q("UPDATE chars SET loc = $2 WHERE id = $1", [B.id, elsewhere]);
      await bump(100);
      const xA2 = await d.xp(A);
      const xB2 = await d.xp(B);
      await d.nextTick();
      assert.equal((await d.say(A, "隔着地方也能说话吗", B)).ok, true);
      await d.nextTick();
      const across = await d.say(B, "能,我在别处", A);
      assert.equal(across.ok, true, JSON.stringify(across));
      assert.ok((await d.xp(A)) - xA2 > 0, "the far speaker is paid");
      assert.ok((await d.xp(B)) - xB2 > 0, "the answerer is paid");

      // ④ A line carrying a URL still makes a discourse, and the URL is gone from the text.
      await bump(100);
      await d.nextTick();
      const dirty = await d.say(A, "看看这个 http://evil.example/x 再说", B);
      assert.equal(dirty.ok, true, JSON.stringify(dirty));
      assert.equal(dirty.result.other_speech.includes("http"), false);
      assert.ok(dirty.result.other_speech.includes("看看这个"));
      await d.nextTick();
      const answer = await d.say(B, "看见了", A);
      assert.equal(answer.ok, true);
      assert.ok((await d.xp(B)) > xB2, "the stripped line still completed a discourse");
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

      // An NPC at the arena pays nothing.
      const npc: string = (await d.q("SELECT id FROM chars WHERE kind = 'npc' AND archetype = 'monster' AND life = 'alive' AND state = 'active' LIMIT 1"))[0]?.id;
      assert.ok(npc);
      await d.q("UPDATE chars SET loc = $2 WHERE id = $1", [npc, arena]);
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

      // Talking is counted apart: H, capped on fighting, is still paid for a conversation (each one's own tier: H is
      // tier 5, W tier 1; time since their own creation, at most an hour, plus half a task of 初识).
      const W = await d.join();
      const talkRule = numbers.tasks.deed_bonus.discourse;
      const talkXp = (row: Json, since: number, now: number): number =>
        Math.floor((row.daily_xp_full * talkRule.talk_rate_bp * Math.min(talkRule.talk_accrue_max_ticks, now - since)) / (10000 * numbers.clock.day_ticks)) +
        Math.floor((row.task_xp * talkRule.first_xp_bp) / 10000);
      const created = async (p: Player): Promise<number> => Number((await d.q("SELECT created_tick FROM chars WHERE id = $1", [p.id]))[0]?.created_tick);
      const talk = await gains([H, W], async () => {
        assert.equal((await d.say(W, "请教前辈")).ok, true);
        await d.nextTick();
        return d.say(H, "请讲", W);
      });
      assert.equal(talk.res.deed_ids.length, 1);
      assert.deepEqual(talk.dxp, [talkXp(t5, await created(H), Number(talk.res.tick)), talkXp(t1, await created(W), Number(talk.res.tick))]);

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

      // W's own line is a proper opening: A answering it completes the discourse.
      await d.nextTick();
      const welcome = await d.say(A, "欢迎");
      assert.equal(welcome.deed_ids.length, 1);
      const deed = (await d.discourses())[0] as Json;
      assert.equal(deed.actor, A.id);
      assert.deepEqual([...deed.participants].sort(), [A.id, W.id].sort());
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

test("S46 ③: notice shows once per char per rev, survives a restart, ignores missing / empty / broken files", async () => {
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

      // A fresh rev: the old char sees it on its first action after publication, not on the second.
      await writeFile(noticeFile, notice("r-one"));
      await d.nextTick();
      const n1 = await d.call("look", {}, old.code);
      assert.deepEqual(n1.notice, { rev: "r-one", url: "https://example.test/start.md", text: { en: "Guide r-one updated.", "zh-CN": "入口 r-one 已更新。" } });
      assert.equal(Object.hasOwn(await d.call("look", {}, old.code), "notice"), false);
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

      // A new rev: everybody sees it once more, the char created in between too.
      await writeFile(noticeFile, notice("r-two"));
      await d.nextTick();
      assert.equal((await d.call("look", {}, old.code)).notice.rev, "r-two");
      assert.equal(Object.hasOwn(await d.call("look", {}, old.code), "notice"), false);
      assert.equal((await d.call("look", {}, fresh.code)).notice.rev, "r-two");
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
