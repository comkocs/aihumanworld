// S48 acceptance (设计者 01:2x-01:3x 当窗: 新手 5 分钟保护期; 高阶 PK 低阶被通缉(红名)并挂悬赏, 同阶与低阶主动发起 PK
// 也被通缉但时间短得多; 击杀红名者不受罚、得 N 倍悬赏), three chains in one in-memory world:
//   ① newbie window: a new char cannot be attacked by other participants for `newbie_protect_ticks`; NPCs go on.
//   ② red name: the INITIATOR who kills in a pk place is wanted + a system bounty is hung on them, for a time that
//      follows the tier relation (lower 2880 / peer 240 / higher 120 ticks); a higher tier killing a lower pays no PK
//      reward, the others do; the passive side killing the initiator is not wanted and is paid.
//   ③ hunting: killing a wanted char is never punished, whoever initiates and at whatever tier; the killer gets the
//      bounty coin and N times the PK value at the red name's tier, the wanted record ends, and the hunt is counted
//      apart from the five duel / pk rewards of the day.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { startApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { setQuiet } from "../src/log.ts";

type Json = any;
type Player = { id: string; code: string };

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const NUMBERS = join(repoRoot, "content", "rules", "numbers.v1.json");

test("S48: newbie window, red name by tier relation, hunting a red name", async () => {
  setQuiet(true);
  const numbers = JSON.parse(await readFile(NUMBERS, "utf8")) as Json;
  const tierRow = (t: number): Json => numbers.tiers.find((r: Json) => r.tier === t);
  const rule = numbers.tasks.deed_bonus.combat_social;
  const wantedRule = numbers.wanted;
  assert.equal(numbers.meta.revision_key, "balance.v1.7");
  assert.equal(numbers.combat.newbie_protect_ticks, 5);
  assert.deepEqual([wantedRule.kill_lower_ticks, wantedRule.kill_peer_ticks, wantedRule.kill_higher_ticks], [2880, 240, 120]);
  assert.deepEqual([rule.hunt_mult, rule.hunt_daily_max], [3, 5]);
  const pk = (tier: number): number => Math.floor((tierRow(tier).task_xp * rule.pk_win_bp) / 10000); // peer / lower-tier PK reward
  const hunt = (tier: number): number => Math.floor((tierRow(tier).task_xp * rule.pk_win_bp * rule.hunt_mult) / 10000); // N x at the red name's tier
  const huntPot = (tier: number): number => Math.floor((tierRow(tier).task_potential * rule.pk_win_bp * rule.hunt_mult) / 10000);
  const bounty = (tier: number): number => Math.floor((tierRow(tier).task_coin * wantedRule.bounty_coin_pct_of_task_coin) / 100);
  assert.deepEqual([pk(5), hunt(5), bounty(5)], [1185, 3555, 1000]);

  const config = await loadConfig({ ...process.env, AIHW_DB_DRIVER: "pglite", AIHW_PGLITE_DIR: "memory", AIHW_PORT: "0" });
  config.clock.enabled = false;
  process.env.AIHW_NOTICE_FILE = join(repoRoot, "_work", "临时", "S46", "no_such_notice.json");
  const app = await startApp(config);
  try {
    const call = async (verb: string, args: object, code?: string): Promise<Json> => {
      const headers: Record<string, string> = { "Content-Type": "application/json; charset=utf-8" };
      if (code !== undefined) headers.Authorization = `Bearer ${code}`;
      const res = await fetch(`${app.url}/v1/actions/${verb}`, { method: "POST", headers, body: JSON.stringify({ args }) });
      return (await res.json()) as Json;
    };
    const q = async (sql: string, params: unknown[] = []): Promise<Json[]> => (await app.db.query<Json>(sql, params)).rows;
    const js = (v: unknown): Json => (typeof v === "string" ? JSON.parse(v) : v);
    const advance = async (n: number): Promise<void> => {
      await app.db.query(`UPDATE worlds SET tick_started_at = tick_started_at - interval '${60 * n} seconds'`);
    };
    const num = async (sql: string, id: string): Promise<number> => Number((await q(sql, [id]))[0]?.v);
    const xp = (p: Player): Promise<number> => num("SELECT xp AS v FROM chars WHERE id = $1", p.id);
    const coin = (p: Player): Promise<number> => num("SELECT coin AS v FROM chars WHERE id = $1", p.id);
    const join = async (tier = 1, stage = 1): Promise<Player> => {
      const r = await call("enter", { mode: "create", skin: "xiuxian", door: "api" });
      assert.equal(r.ok, true, JSON.stringify(r));
      const p = { id: r.result.char.id as string, code: r.result.identity_code as string };
      if (tier !== 1 || stage !== 1) await q("UPDATE chars SET tier = $2, stage = $3 WHERE id = $1", [p.id, tier, stage]);
      return p;
    };
    // S53 ages a char out of the newbie window without moving the world clock (the red-name section below relies on that).
    const ageOut = (p: Player): Promise<unknown> => q("UPDATE chars SET created_tick = created_tick - 5 WHERE id = $1", [p.id]);
    const arena: string = await (async () => {
      const first = await join();
      return (await q("SELECT loc FROM chars WHERE id = $1", [first.id]))[0]?.loc as string;
    })();
    const vigorOf = (p: Player, v: number): Promise<unknown> => q("UPDATE chars SET vigor = $2, life = 'alive', revive_tick = NULL WHERE id = $1", [p.id, v]);
    const attack = async (a: Player, b: Player): Promise<Json> => {
      await advance(1);
      return call("attack", { target: b.id }, a.code);
    };
    const wantedOf = async (p: Player): Promise<Json[]> => q("SELECT * FROM wanted WHERE char_id = $1 ORDER BY id", [p.id]);
    const taskOf = async (id: string): Promise<Json> => {
      const t = (await q("SELECT * FROM tasks WHERE id = $1", [id]))[0] as Json;
      return { ...t, issuer: js(t.issuer), condition: js(t.condition), reward: js(t.reward), escrow: js(t.escrow) };
    };
    const socialKinds = async (p: Player): Promise<string[]> =>
      (await q("SELECT data FROM events WHERE type = 'reward_granted' AND recipients @> $1::jsonb ORDER BY cursor", [JSON.stringify([p.id])]))
        .map((e) => js(e.data).social?.kind)
        .filter((k) => k !== undefined && k !== "discourse");
    const deedsOf = async (kind: string): Promise<Json[]> => (await q("SELECT * FROM deeds WHERE kind = $1 ORDER BY seq", [kind])).map((d) => ({ ...d, targets: js(d.targets) }));
    const ownXpChange = (res: Json, p: Player): Json | undefined =>
      (res.result.changes as Json[]).find((c) => c.table === "char" && c.id === p.id && c.after.xp !== undefined);

    // ---------- ① newbie window ----------
    await q("UPDATE places SET combat = 'pk' WHERE id = $1", [arena]);
    const npc: string = (await q("SELECT id FROM chars WHERE kind = 'npc' AND archetype = 'tutorial_opponent' AND life = 'alive' AND state = 'active' LIMIT 1"))[0]?.id;
    assert.ok(npc);
    await q("UPDATE chars SET loc = $2 WHERE id = $1", [npc, arena]);
    const n1 = await join();
    const n2 = await join();
    const created = Number((await q("SELECT created_tick FROM chars WHERE id = $1", [n2.id]))[0]?.created_tick);
    const until = String(created + 5);
    const blocked = await call("attack", { target: n2.id }, n1.code);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error.code, "NOT_ALLOWED");
    assert.deepEqual(blocked.error.details, { reason: "newbie", until_tick: until });
    assert.equal((await q("SELECT count(*) AS n FROM deeds WHERE kind IN ('combat_win', 'combat_loss', 'combat_draw')"))[0]?.n, "0");
    await advance(4); // created + 4: still inside the window
    const still = await call("attack", { target: n2.id }, n1.code);
    assert.deepEqual(still.error?.details, { reason: "newbie", until_tick: until });
    assert.equal(Number(still.tick), created + 4);
    const vsNpc = await call("attack", { target: npc }, n1.code); // NPCs are not protected, and may be fought meanwhile
    assert.equal(vsNpc.ok, true, JSON.stringify(vsNpc));
    // S53: a newcomer attacking an NPC keeps its own protection; attacking another participant ends it that same tick.
    const mob: string = (await q("SELECT id FROM chars WHERE kind = 'npc' AND archetype = 'monster' AND life = 'alive' AND state = 'active' LIMIT 1"))[0]?.id;
    assert.ok(mob);
    await q("UPDATE chars SET loc = $2 WHERE id = $1", [mob, arena]);
    const n3 = await join();
    await advance(1); // n3 still has ticks of protection left; n1's window is already over
    const vsNpc2 = await call("attack", { target: mob }, n3.code);
    assert.equal(vsNpc2.ok, true, JSON.stringify(vsNpc2));
    const kept = await call("attack", { target: n3.id }, n1.code); // hitting an NPC does not drop the protection
    assert.equal(kept.ok, false);
    assert.equal(kept.error?.details?.reason, "newbie", JSON.stringify(kept));
    await advance(1);
    const struck = await call("attack", { target: n1.id }, n3.code); // n3 strikes a participant first: its protection ends now
    assert.equal(struck.ok, true, JSON.stringify(struck));
    const back = await call("attack", { target: n3.id }, n1.code); // n1 may answer inside what used to be n3's window
    assert.equal(back.ok, true, JSON.stringify(back));
    await advance(1); // created + 5: the window is over
    await vigorOf(n2, 1);
    const open = await call("attack", { target: n2.id }, n1.code);
    assert.equal(Number(open.tick), created + 7); // the S53 segment above advances two more ticks
    assert.equal(open.ok, true, JSON.stringify(open));

    // ---------- ② red name by tier relation ----------
    const H = await join(5); // high initiator
    const L = await join(1); // low victim
    const P = await join(5); // peer initiator
    const Q = await join(5); // peer victim
    const lo = await join(1, 4); // low initiator, strong for its tier
    const hi = await join(2, 1); // high victim, weakened
    const lo2 = await join(1, 4);
    const hi2 = await join(2, 1);
    const R = await join(2, 1); // a red name of tier 2 (made below), hunted by a lower tier
    const R0 = await join(1);
    const U5 = await join(5); // hunter, same tier as H
    const U5b = await join(5); // hunter, higher than the tier-1 red name
    const lo3 = await join(1, 4); // hunter, lower than the tier-2 red name
    const V = await join(5); // a fresh peer for the hunter's own pk reward
    for (const p of [H, L, P, Q, lo, hi, lo2, hi2, R, R0, U5, U5b, lo3, V]) await ageOut(p);

    // higher kills lower: 2880-tick red name, bounty, no PK reward
    await vigorOf(H, 1000000);
    await vigorOf(L, 1);
    const xH0 = await xp(H);
    const kill1 = await attack(H, L);
    assert.equal(kill1.ok, true, JSON.stringify(kill1));
    assert.equal(kill1.result.outcome, "win");
    assert.equal((await q("SELECT life FROM chars WHERE id = $1", [L.id]))[0]?.life, "dead");
    const wH = await wantedOf(H);
    assert.equal(wH.length, 1);
    assert.equal(wH[0].reason, "kill_player");
    assert.equal(wH[0].state, "active");
    assert.equal(wH[0].until_tick, String(Number(kill1.tick) + 2880));
    const taskH = await taskOf(wH[0].bounty_task);
    assert.deepEqual([taskH.kind, taskH.state, taskH.issuer.kind, taskH.tpl], ["bounty", "open", "system", "slay"]);
    assert.deepEqual([taskH.condition.target, taskH.condition.tier], [H.id, 5]);
    assert.deepEqual([taskH.escrow.coin, taskH.reward.coin, taskH.reward.xp], [bounty(5), bounty(5), hunt(5)]);
    assert.equal(taskH.expires_tick, wH[0].until_tick);
    assert.equal((await xp(H)) - xH0, 0, "a higher tier killing a lower one gets no PK reward");
    assert.deepEqual(await socialKinds(H), []);
    assert.equal((await wantedOf(L)).length, 0);
    assert.ok((kill1.result.changes as Json[]).some((c) => c.table === "wanted" && c.id === wH[0].id), "the attack result shows the wanted record");
    const wantedDeeds = (await deedsOf("wanted")).filter((d) => d.actor === H.id);
    assert.equal(wantedDeeds.length, 1);
    assert.equal(wantedDeeds[0].visibility, "world");
    const posts = (await deedsOf("bounty_post")).filter((d) => d.targets.includes(H.id));
    assert.equal(posts.length, 1);
    assert.deepEqual([posts[0].visibility, posts[0].actor], ["world", null]);

    // peers: 240-tick red name, bounty, and the PK reward
    await vigorOf(P, 1000000);
    await vigorOf(Q, 1);
    const xP0 = await xp(P);
    const kill2 = await attack(P, Q);
    assert.equal(kill2.ok, true, JSON.stringify(kill2));
    const wP = (await wantedOf(P))[0];
    assert.equal(wP.until_tick, String(Number(kill2.tick) + 240));
    assert.ok(wP.bounty_task !== null);
    assert.equal((await xp(P)) - xP0, pk(5));
    assert.deepEqual(await socialKinds(P), ["pk"]);
    assert.equal(ownXpChange(kill2, P)?.after.xp, await xp(P), "the attack result shows the reward");

    // lower kills higher (a tier-1 stage-4 char against a weakened tier-2 one; the roll decides, so retry): 120 ticks + PK reward
    let low: Json | null = null;
    for (let i = 0; i < 120 && low === null; i += 1) {
      await vigorOf(lo, 2300);
      await vigorOf(hi, 1);
      const r = await attack(lo, hi);
      assert.equal(r.ok, true, JSON.stringify(r));
      if (r.result.outcome === "win" && (await q("SELECT life FROM chars WHERE id = $1", [hi.id]))[0]?.life === "dead") low = r;
    }
    assert.ok(low !== null, "the tier-1 char won once");
    const wLo = (await wantedOf(lo))[0];
    assert.equal(wLo.until_tick, String(Number((low as Json).tick) + 120));
    assert.ok(wLo.bounty_task !== null);
    assert.equal(Number(wLo.until_tick) - Number((low as Json).tick) < Number(wP.until_tick) - Number(kill2.tick), true, "shorter than a peer's");
    assert.equal(await xp(lo), pk(1), "the lower-tier initiator is paid the PK reward on the lower tier");
    assert.deepEqual(await socialKinds(lo), ["pk"]);
    const taskLo = await taskOf(wLo.bounty_task);
    assert.deepEqual([taskLo.reward.xp, taskLo.escrow.coin], [hunt(1), bounty(1)]);

    // passive side kills the initiator: nobody is wanted, the passive side is paid on the lower tier
    await vigorOf(lo2, 1);
    await vigorOf(hi2, 400);
    const counter = await attack(lo2, hi2);
    assert.equal(counter.ok, true, JSON.stringify(counter));
    assert.equal(counter.result.outcome, "lose");
    assert.equal((await q("SELECT life FROM chars WHERE id = $1", [lo2.id]))[0]?.life, "dead");
    assert.equal((await wantedOf(lo2)).length + (await wantedOf(hi2)).length, 0, "a counter-kill is nobody's red name");
    assert.equal(await xp(hi2), pk(1));
    assert.deepEqual(await socialKinds(hi2), ["pk"]);

    // ---------- ③ hunting ----------
    // (a) a peer of the red name (tier 5 H) kills it: no red name for the hunter, 2.37 tasks of tier 5 + the bounty coin
    await vigorOf(H, 1);
    await vigorOf(U5, 1000000);
    const [xU0, cU0, pU0] = [await xp(U5), await coin(U5), await num("SELECT potential AS v FROM chars WHERE id = $1", U5.id)];
    const got = await attack(U5, H);
    assert.equal(got.ok, true, JSON.stringify(got));
    assert.equal((await q("SELECT life FROM chars WHERE id = $1", [H.id]))[0]?.life, "dead");
    assert.equal((await xp(U5)) - xU0, hunt(5));
    assert.equal((await num("SELECT potential AS v FROM chars WHERE id = $1", U5.id)) - pU0, huntPot(5));
    assert.equal((await coin(U5)) - cU0, bounty(5));
    assert.equal((await wantedOf(U5)).length, 0, "the hunter is not wanted");
    assert.equal((await wantedOf(H))[0].state, "cleared", "the red name ends with the kill");
    const doneH = await taskOf(wH[0].bounty_task);
    assert.deepEqual([doneH.state, doneH.taker, doneH.escrow.coin], ["completed", U5.id, 0]);
    assert.equal(ownXpChange(got, U5)?.after.xp, await xp(U5), "the attack result shows the reward");
    assert.ok((got.result.changes as Json[]).some((c) => c.table === "task" && c.id === wH[0].bounty_task));
    const done = (await deedsOf("bounty_done")).filter((d) => d.actor === U5.id);
    assert.equal(done.length, 1);
    assert.equal(done[0].visibility, "world");
    assert.ok(done[0].targets.includes(wH[0].bounty_task) && done[0].targets.includes(H.id));
    const ended = (await deedsOf("wanted_end")).filter((d) => d.targets.includes(wH[0].id));
    assert.equal(ended.length, 1);
    assert.equal(ended[0].visibility, "world");
    assert.deepEqual(await socialKinds(U5), ["hunt"]);
    // the hunt did not use up the five: the hunter still gets an ordinary PK reward (and is red-named for a peer kill)
    await vigorOf(V, 1);
    await vigorOf(U5, 1000000);
    const xU1 = await xp(U5);
    const peerKill = await attack(U5, V);
    assert.equal(peerKill.ok, true, JSON.stringify(peerKill));
    assert.equal((await xp(U5)) - xU1, pk(5));
    assert.deepEqual(await socialKinds(U5), ["hunt", "pk"]);

    // (b) a HIGHER tier than the red name kills it (the tier-1 red name `lo`, still inside its 120 ticks): not punished either
    await vigorOf(lo, 1);
    await vigorOf(U5b, 1000000);
    const xB0 = await xp(U5b);
    const cB0 = await coin(U5b);
    const gotLo = await attack(U5b, lo);
    assert.equal(gotLo.ok, true, JSON.stringify(gotLo));
    assert.equal((await q("SELECT life FROM chars WHERE id = $1", [lo.id]))[0]?.life, "dead");
    assert.equal((await xp(U5b)) - xB0, hunt(1), "paid on the red name's tier, not the hunter's");
    assert.equal((await coin(U5b)) - cB0, bounty(1));
    assert.equal((await wantedOf(U5b)).length, 0);
    assert.equal((await wantedOf(lo))[0].state, "cleared");

    // (c) a LOWER tier than the red name kills it (R, tier 2, killed a tier-1 char; lo3 is tier 1 stage 4): same
    await vigorOf(R, 1000000);
    await vigorOf(R0, 1);
    const makeRed = await attack(R, R0);
    assert.equal(makeRed.ok, true, JSON.stringify(makeRed));
    const wR = (await wantedOf(R))[0];
    assert.equal(wR.until_tick, String(Number(makeRed.tick) + 2880));
    let slain: Json | null = null;
    const [xC0, cC0] = [await xp(lo3), await coin(lo3)];
    for (let i = 0; i < 150 && slain === null; i += 1) {
      await vigorOf(lo3, 2300);
      await vigorOf(R, 200);
      const r = await attack(lo3, R);
      assert.equal(r.ok, true, JSON.stringify(r));
      if ((await q("SELECT life FROM chars WHERE id = $1", [R.id]))[0]?.life === "dead" && r.result.outcome === "win") slain = r;
    }
    assert.ok(slain !== null, "the lower-tier hunter won once");
    assert.equal((await xp(lo3)) - xC0, hunt(2));
    assert.equal((await coin(lo3)) - cC0, bounty(2));
    assert.equal((await wantedOf(lo3)).length, 0);
    assert.equal((await wantedOf(R))[0].state, "cleared");
    assert.deepEqual(await socialKinds(lo3), ["hunt"]);
  } finally {
    delete process.env.AIHW_NOTICE_FILE;
    await app.close();
  }
});

// S67 (设计者 15:2x): no safe zone, only the newbie window. Runs on the seed world alone — the content files are mid-edit
// by another ticket, and the seed's start places are combat = safe.
test("S67: past the window a safe place settles as pk; inside it the newcomer is refused", async () => {
  setQuiet(true);
  const config = await loadConfig({ ...process.env, AIHW_DB_DRIVER: "pglite", AIHW_PGLITE_DIR: "memory", AIHW_PORT: "0", AIHW_CONTENT_DIR: "null" });
  config.clock.enabled = false;
  const app = await startApp(config);
  try {
    const call = async (verb: string, args: object, code: string): Promise<Json> => {
      const res = await fetch(`${app.url}/v1/actions/${verb}`, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${code}` },
        body: JSON.stringify({ args }),
      });
      return (await res.json()) as Json;
    };
    const q = async (sql: string, params: unknown[] = []): Promise<Json[]> => (await app.db.query<Json>(sql, params)).rows;
    const join = async (): Promise<Player> => {
      const r = await call("enter", { mode: "create", skin: "xiuxian", door: "api" }, "");
      return { id: "", code: "" , ...(r.ok ? { id: r.result.char.id as string, code: r.result.identity_code as string } : {}) };
    };
    const a = await join();
    const b = await join();
    assert.ok(a.id !== "" && b.id !== "", "enter failed");
    const start: string = (await q("SELECT loc FROM chars WHERE id = $1", [a.id]))[0]?.loc;
    assert.equal((await q("SELECT combat FROM places WHERE id = $1", [start]))[0]?.combat, "safe");
    // created_tick is non-negative, so the window passes by moving the world clock, not the char.
    // The clock is rewound before the newcomer is created, so the attack on it does not spend the day's AP first.
    await app.db.query(`UPDATE worlds SET tick_started_at = tick_started_at - interval '360 seconds'`);
    await q("UPDATE chars SET vigor = 1000000 WHERE id = $1", [a.id]);
    await q("UPDATE chars SET vigor = 1 WHERE id = $1", [b.id]);
    const kill = await call("attack", { target: b.id }, a.code);
    assert.equal(kill.ok, true, JSON.stringify(kill));
    assert.equal(kill.result.outcome, "win");
    assert.equal((await q("SELECT life FROM chars WHERE id = $1", [b.id]))[0]?.life, "dead");
    const wanted = (await q("SELECT reason, until_tick FROM wanted WHERE char_id = $1", [a.id]))[0];
    assert.equal(wanted.reason, "kill_player");
    assert.equal(wanted.until_tick, String(Number(kill.tick) + 240));
    await app.db.query(`UPDATE worlds SET tick_started_at = now()`);
    await q("UPDATE chars SET ap_spent = 0, ap_tick = '0' WHERE id = $1", [a.id]);
    const fresh = await join();
    assert.ok(fresh.id !== "");
    const blocked = await call("attack", { target: fresh.id }, a.code);
    assert.equal(blocked.ok, false, JSON.stringify(blocked));
    assert.equal(blocked.error.code, "NOT_ALLOWED");
    assert.equal(blocked.error.details.reason, "newbie");
  } finally {
    await app.close();
  }
});
