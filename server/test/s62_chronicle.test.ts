// S62 (验收位 008): the chronicle grows from what players do.
// One chain: a xiuxian char walks to its tutorial place and beats the tutorial
// opponent → the chronicle names that char as the region's first through the gate;
// the same char walks out through the neutral market into another origin region's
// start place → the chronicle names the crossing; a second char of the same origin
// does neither again. Then a bounty posted with a one-line note (a URL in it) is
// read back, URL stripped, by another char's task list and by look.

import assert from "node:assert/strict";
import { test } from "node:test";
import { startApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { setQuiet } from "../src/log.ts";

type Json = any;

const LANE = "r1:place:xiuxian_trial_lane";
const WUXIA = "r1:place:start_wuxia";

test("S62: first gate, first crossing, bounty note readable by others", async () => {
  setQuiet(true);
  const config = await loadConfig({ ...process.env, AIHW_DB_DRIVER: "pglite", AIHW_PGLITE_DIR: "memory", AIHW_PORT: "0" });
  const app = await startApp(config);
  try {
    const db = app.db;
    const call = async (verb: string, args: object, code?: string): Promise<{ status: number; body: Json }> => {
      const headers: Record<string, string> = { "Content-Type": "application/json; charset=utf-8" };
      if (code !== undefined) headers.Authorization = `Bearer ${code}`;
      const res = await fetch(`${app.url}/v1/actions/${verb}`, { method: "POST", headers, body: JSON.stringify({ args }) });
      return { status: res.status, body: (await res.json()) as Json };
    };
    const ok = async (verb: string, args: object, code?: string): Promise<Json> => {
      const r = await call(verb, args, code);
      assert.equal(r.body.ok, true, `${verb} ${JSON.stringify(args)} → ${JSON.stringify(r.body.error)}`);
      return r.body;
    };
    const nextTick = async (): Promise<void> => {
      await db.query("UPDATE worlds SET tick_started_at = tick_started_at - interval '60 seconds'");
    };

    const a = await ok("enter", { mode: "create", skin: "xiuxian", door: "api" });
    const codeA: string = a.result.identity_code;
    const idA: string = a.result.char.id;

    // start_xiuxian → enroll hall → the tutorial lane (two exits, two ticks).
    await ok("go", { dir: "north" }, codeA);
    await nextTick();
    const lane = await ok("go", { dir: "north" }, codeA);
    assert.equal(lane.result.to, LANE);

    const foe = (
      await db.query<{ id: string }>(
        "SELECT id FROM chars WHERE archetype = 'tutorial_opponent' AND loc = $1 AND life = 'alive'",
        [LANE],
      )
    ).rows[0]?.id;
    assert.ok(foe !== undefined, "a tutorial opponent stands at the lane");
    await nextTick();
    const fight = await ok("attack", { target: foe }, codeA);
    assert.equal(fight.result.outcome, "win");

    const gates = await db.query<{ actor: string; n: string }>(
      "SELECT actor, count(*)::text AS n FROM deeds WHERE kind = 'first_gate' GROUP BY actor",
    );
    assert.equal(gates.rows.length, 1);
    assert.equal(gates.rows[0]?.actor, idA);

    // Out to the market, then east into the wuxia start place.
    await nextTick();
    await ok("go", { dir: "south" }, codeA);
    await nextTick();
    await ok("go", { dir: "south" }, codeA);
    await nextTick();
    await ok("go", { dir: "south" }, codeA);
    await nextTick();
    const cross = await ok("go", { dir: "east" }, codeA);
    assert.equal(cross.result.to, WUXIA);

    const crossings = await db.query<{ actor: string }>(
      "SELECT actor FROM deeds WHERE kind = 'first_crossing'",
    );
    assert.deepEqual(crossings.rows.map((r) => r.actor), [idA]);

    // A second char of the same origin repeats both and adds nothing.
    const b = await ok("enter", { mode: "create", skin: "xiuxian", door: "api" });
    const codeB: string = b.result.identity_code;
    await ok("go", { dir: "north" }, codeB);
    await nextTick();
    await ok("go", { dir: "north" }, codeB);
    await nextTick();
    await ok("attack", { target: foe }, codeB);
    await nextTick();
    await ok("go", { dir: "south" }, codeB);
    await nextTick();
    await ok("go", { dir: "south" }, codeB);
    await nextTick();
    await ok("go", { dir: "south" }, codeB);
    await nextTick();
    await ok("go", { dir: "east" }, codeB);
    const again = await db.query<{ gate: string; crossing: string }>(
      "SELECT count(*) FILTER (WHERE kind = 'first_gate')::text AS gate, count(*) FILTER (WHERE kind = 'first_crossing')::text AS crossing FROM deeds",
    );
    assert.equal(again.rows[0]?.gate, "1");
    assert.equal(again.rows[0]?.crossing, "1");

    const chronicle = await (await fetch(`${app.url}/chronicle`)).text();
    assert.match(chronicle, /deed\.first_gate/);
    assert.match(chronicle, /deed\.first_crossing/);
    assert.ok(chronicle.includes(idA));

    // A bounty with a note: the other char reads it from task list and from look, URL gone.
    const now = BigInt(String((await db.query<{ tick: string }>("SELECT tick::text AS tick FROM worlds")).rows[0]?.tick));
    await db.query("UPDATE chars SET coin = coin + 1 WHERE id = $1", [idA]);
    await nextTick();
    const posted = await ok(
      "bounty",
      {
        op: "post",
        condition: { tpl: "reach", mode: "place", place: WUXIA },
        reward: { coin: 1, items: [] },
        expires_tick: String(now + 120n),
        note: "木人巷见 http://evil.example/x",
      },
      codeA,
    );
    const bountyId: string = posted.result.task.id;
    assert.equal(posted.result.task.note, "木人巷见");
    assert.equal(posted.result.other_speech, "木人巷见");

    const board = await ok("task", { op: "list" }, codeB);
    const row = board.result.rows.find((t: Json) => t.id === bountyId);
    assert.ok(row !== undefined, "the bounty is on the other char's task list");
    assert.equal(row.note, "木人巷见");
    assert.equal(JSON.stringify(row).includes("http"), false);

    const looked = await ok("look", { section: "tasks" }, codeB);
    const seen = looked.result.rows.find((t: Json) => t.id === bountyId);
    assert.equal(seen?.note, "木人巷见");
  } finally {
    await app.close();
  }
});
