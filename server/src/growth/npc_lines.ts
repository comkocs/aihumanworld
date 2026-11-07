// [S54 / S63] Short NPC replies: no LLM and no judgement of what was said.
// Each archetype shares its lines across the four skins; unknown archetypes use the plain lines.

import type { NpcArchetype } from "../facts/enums.ts";

const LINES: Record<NpcArchetype, { zh: string[]; en: string[] }> = {
  master: {
    zh: ["嗯,这话值得想想。", "别急,慢慢来。", "有意思,再琢磨琢磨。", "听着不错,你继续。"],
    en: ["Hm, that is worth thinking over.", "No rush. Take your time.", "Interesting. Let that settle a while.", "Sounds promising. Go on."],
  },
  merchant: {
    zh: ["哈哈,这话我爱听。", "来,坐下聊聊。", "你这么一说,我倒好奇了。", "有趣,再多说两句。"],
    en: ["Ha, now I like that!", "Come on, sit and chat.", "Now you have me curious.", "Interesting! Tell me more."],
  },
  repairer: {
    zh: ["嗯,得慢慢琢磨。", "别急,总能理顺。", "这事得仔细瞧瞧。", "有道理,一点点来。"],
    en: ["Hmm, that takes some thought.", "Easy does it; we will sort it out.", "That deserves a closer look.", "Fair point. One step at a time."],
  },
  guard: {
    zh: ["知道了,你多小心。", "嗯,我留意着。", "明白,有事再说。", "好,路上当心。"],
    en: ["Got it. Stay safe.", "Understood. I will keep watch.", "All right. Let me know if you need anything.", "Okay. Watch your step out there."],
  },
  patroller: {
    zh: ["路上还顺利吗?", "哦?你接着说。", "我刚走了一圈,你呢?", "有新鲜事?说来听听。"],
    en: ["How has the road been?", "Oh? Go on.", "Just made my rounds. How about you?", "Anything new out there?"],
  },
  quest_giver: {
    zh: ["有意思,我听着呢。", "嗯,然后呢?", "这倒新鲜,继续说。", "好啊,说说你的想法。"],
    en: ["Interesting. I am listening.", "And then what?", "That is new. Go on.", "Sure, tell me what you think."],
  },
  monster: {
    zh: ["……吼。", "呼……吼!", "唔……", "嗷!"],
    en: ["...grr.", "Hrr... growl!", "Rrr...", "Grr!"],
  },
  tutorial_opponent: {
    zh: ["好,咱们慢慢来。", "不错,再试试。", "别紧张,继续。", "有进步,就这样。"],
    en: ["Good, let us take it slow.", "Nice. Try again.", "Relax, keep going.", "Getting better. That is it."],
  },
};

const PLAIN = {
  zh: ["嗯,我听见了。", "是吗?继续说。", "好啊,我听着。", "有意思,再聊聊。"],
  en: ["Mm, I heard you.", "Really? Go on.", "Sure, I am listening.", "Interesting. Tell me more."],
};

/** Pick a stable line for this pair and tick, rotating on each successive tick. */
export function npcLine(archetype: NpcArchetype | null, lang: "zh" | "en", speaker: string, npc: string, tick: string): string {
  const row = (archetype === null ? PLAIN : LINES[archetype] ?? PLAIN)[lang];
  let hash = 2166136261;
  for (const ch of JSON.stringify([speaker, npc])) hash = Math.imul(hash ^ (ch.codePointAt(0) ?? 0), 16777619) >>> 0;
  const index = Number((BigInt(hash) + BigInt(tick)) % BigInt(row.length));
  return row[index] as string;
}
