// S79: an NPC with a lexicon entry content.<realm>.char.<local> shows that given
// name (with the type call beside it); one without keeps the type call alone.
// The same rule applies to every skin and locale. The play lexicon export
// already serves the skin file whole, so the entry is reachable from there.

import assert from "node:assert/strict";
import { test } from "node:test";
import { startApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { insertRow, mustGetRow } from "../src/facts/store.ts";
import type { CharRow } from "../src/facts/types.ts";
import { setQuiet } from "../src/log.ts";

const SLOPE = "r1:place:xiuxian_out_mist_slope";
const MIRE = "r1:place:fantasy_out_mire_edge";
const UNNAMED = "r1:char:s79_unnamed";

test("S79: given names on public place pages and in the lexicon export", async () => {
  setQuiet(true);
  const config = await loadConfig({ ...process.env, AIHW_DB_DRIVER: "pglite", AIHW_PGLITE_DIR: "memory", AIHW_PORT: "0" });
  config.clock.enabled = false;
  const app = await startApp(config);
  try {
    const zh = (await (await fetch(`${app.url}/play/lexicon/xiuxian/zh-CN.json`)).json()) as { entries: { key: string; name: string }[] };
    assert.equal(zh.entries.find((e) => e.key === "content.r1.char.s77_xiuxian_patrol")?.name, "雾岭巡行者");
    const en = (await (await fetch(`${app.url}/play/lexicon/fantasy/en.json`)).json()) as { entries: { key: string; name: string }[] };
    assert.equal(en.entries.find((e) => e.key === "content.r1.char.s77_fantasy_patrol")?.name, "Mire Edge Patrol");

    const slope = await (await fetch(`${app.url}/place/${SLOPE}?skin=xiuxian&locale=zh-CN`)).text();
    assert.match(slope, /雾岭巡行者\(巡山弟子 `npc\.patroller`\)/);
    const slopeEn = await (await fetch(`${app.url}/place/${SLOPE}?skin=xiuxian&locale=en`)).text();
    assert.match(slopeEn, /Mist Slope Patrol\(Mountain Patrol Disciple `npc\.patroller`\)/);

    const base = await mustGetRow(app.db, "char", "r1:char:s77_xiuxian_patrol");
    const unnamed: CharRow = {
      ...base, id: UNNAMED, archetype: "merchant", loc: SLOPE, respawn_place: SLOPE, patrol_route: [],
    };
    await insertRow(app.db, "char", unnamed);
    const withUnnamed = await (await fetch(`${app.url}/place/${SLOPE}?skin=xiuxian&locale=zh-CN`)).text();
    const plain = withUnnamed.split("\n").find((line) => line.includes(UNNAMED));
    assert.ok(plain, "the unnamed NPC is on the place page");
    assert.match(plain ?? "", /掌柜 `npc\.merchant`/);
    assert.doesNotMatch(plain ?? "", /掌柜\(掌柜/);

    const mire = await (await fetch(`${app.url}/place/${MIRE}?skin=fantasy&locale=en`)).text();
    assert.match(mire, /Mire Edge Patrol\(Patroller `npc\.patroller`\)/);
    assert.doesNotMatch(mire, /Mountain Patrol Disciple/);
  } finally {
    await app.close();
  }
});
