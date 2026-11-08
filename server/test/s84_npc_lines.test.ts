// S84: topic pools and same-tick rotation for direct NPC discourse.
import assert from "node:assert/strict";
import { test } from "node:test";
import { startApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { ARCHETYPES } from "../src/facts/enums.ts";
import { NPC_LINES, npcLine, npcTopic } from "../src/growth/npc_lines.ts";
import type { NpcTopic } from "../src/growth/npc_lines.ts";
import { setQuiet } from "../src/log.ts";

const topics: NpcTopic[] = ["growth", "task", "trade", "travel", "combat", "group", "chat"];
const examples: Record<NpcTopic, [string, string]> = {
  growth: ["怎么破境", "How do I train?"], task: ["有什么差事", "Any quests?"],
  trade: ["想做交易", "Can we trade?"], travel: ["要去哪", "Which road?"],
  combat: ["想去打怪", "Want to spar?"], group: ["加入门派", "Find a guild"],
  chat: ["今天你好", "Hello there"],
};

test("S84: every role has distinct bilingual topic pools and enough lines", () => {
  for (const role of [...ARCHETYPES, "plain"] as const) {
    for (const lang of ["zh", "en"] as const) {
      const all = topics.flatMap((topic) => [...NPC_LINES[role][topic][lang]]);
      assert.ok(new Set(all).size >= (role === "monster" ? 6 : 12), `${role} ${lang}`);
      for (const topic of topics) {
        const pool = NPC_LINES[role][topic][lang];
        assert.ok(new Set(pool).size >= 5, `${role} ${lang} ${topic}`);
        assert.equal(pool.length, new Set(pool).size, `${role} ${lang} ${topic} has no duplicates`);
      }
    }
  }
});

test("S84: Chinese and English topics select the matching role pool", () => {
  for (const topic of topics) {
    for (const [index, lang] of (["zh", "en"] as const).entries()) {
      const text = examples[topic][index] as string;
      assert.equal(npcTopic(text), topic, text);
      for (const role of [...ARCHETYPES, null]) {
        const actual = npcLine(role, lang, `topic-${topic}-${lang}-${role}`, "npc", text);
        assert.ok(NPC_LINES[role ?? "plain"][topic][lang].includes(actual), `${role} ${lang} ${topic}`);
      }
    }
  }
  assert.equal(npcTopic("a beautifully painted landscape"), "chat");
  assert.equal(npcTopic("修炼和任务"), "growth");
});

test("S84: five direct questions in one tick have different replies across topics", async () => {
  setQuiet(true);
  const config = await loadConfig({ ...process.env, AIHW_DB_DRIVER: "pglite", AIHW_PGLITE_DIR: "memory", AIHW_PORT: "0" });
  config.clock.enabled = false;
  const app = await startApp(config);
  try {
    const call = async (verb: string, args: object, code?: string): Promise<any> => {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (code !== undefined) headers.Authorization = `Bearer ${code}`;
      const response = await fetch(`${app.url}/v1/actions/${verb}`, { method: "POST", headers, body: JSON.stringify({ args }) });
      return response.json();
    };
    const entered = await call("enter", { mode: "create", skin: "xiuxian", door: "api" });
    assert.equal(entered.ok, true, JSON.stringify(entered));
    const player = entered.result.char.id as string;
    const code = entered.result.identity_code as string;
    const rows = await app.db.query<{ id: string; archetype: keyof typeof NPC_LINES }>(
      "SELECT n.id, n.archetype FROM chars n JOIN chars p ON p.loc = n.loc WHERE p.id = $1 AND n.kind = 'npc' AND n.life = 'alive' AND n.state IN ('active', 'draft') LIMIT 1", [player],
    );
    const npc = rows.rows[0];
    assert.ok(npc);
    const replies: string[] = [];
    const ticks = new Set<string>();
    // Reset only this test character's spent budget so all questions fit in one tick.
    const resetBudget = async (): Promise<void> => { await app.db.query("UPDATE chars SET ap_spent = 0 WHERE id = $1", [player]); };
    for (const topic of ["growth", "task", "trade", "travel", "combat"] as const) {
      await resetBudget();
      const reply = await call("say", { target: npc.id, text: examples[topic][0] }, code);
      assert.equal(reply.ok, true, JSON.stringify(reply));
      assert.equal(reply.result.npc_reply.from, npc.id);
      const text = reply.result.npc_reply.text as string;
      assert.ok(NPC_LINES[npc.archetype ?? "plain"][topic].zh.includes(text), topic);
      replies.push(text);
      ticks.add(reply.tick);
    }
    assert.equal(ticks.size, 1, "all questions happen in the same tick");
    assert.equal(new Set(replies).size, 5);
    // A fixed topic must rotate too, not merely differ because the questions changed.
    const fixed: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      await resetBudget();
      const reply = await call("say", { target: npc.id, text: "怎么破境" }, code);
      assert.equal(reply.ok, true, JSON.stringify(reply));
      ticks.add(reply.tick);
      fixed.push(reply.result.npc_reply.text);
    }
    assert.equal(ticks.size, 1);
    assert.equal(new Set(fixed).size, 5);
  } finally {
    await app.close();
  }
});
