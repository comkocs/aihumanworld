// [S54] The one line an NPC answers with when a player speaks to it directly.
// Fixed text, no LLM and no judgement of what was said: the design (11-07 12:45) is that any words count
// as 论道, so the reply never depends on the speaker's text. One line per archetype, in the two languages
// the four skins use; an archetype not listed here, or none, gets the plain line.

import type { NpcArchetype } from "../facts/enums.ts";

const LINES: Record<NpcArchetype, { zh: string; en: string }> = {
  master: { zh: "嗯,你说得有几分道理,且慢慢悟吧。", en: "Hm. There is something in what you say. Sit with it a while." },
  merchant: { zh: "这话我爱听,来来,坐下慢慢说。", en: "Now that is talk I like. Come, sit and tell me more." },
  repairer: { zh: "说得在理,凡事都得慢慢打磨。", en: "Fair words. Everything worth keeping takes a slow hand." },
  guard: { zh: "知道了,路上小心,有事再来找我。", en: "Noted. Watch yourself on the road, and come back if you need me." },
  patroller: { zh: "路上见闻不少吧,跟我说说。", en: "You must have seen plenty on the road. Tell me." },
  quest_giver: { zh: "有意思,你接着说,我听着。", en: "Interesting. Go on, I am listening." },
  monster: { zh: "……吼。", en: "...grr." },
  tutorial_opponent: { zh: "好,就当练手,你继续说。", en: "Good. Call it practice, and keep talking." },
};

const PLAIN = { zh: "嗯,我听见了。", en: "Mm. I heard you." };

/** The NPC's answer, in the language of the place the speaker is standing in. */
export function npcLine(archetype: NpcArchetype | null, lang: "zh" | "en"): string {
  const row = archetype === null ? PLAIN : LINES[archetype];
  return row[lang];
}
