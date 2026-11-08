// [S84] Short topic-aware NPC replies, without an LLM or judgement of the speaker.
// Each role has its own leads; topic endings and the plain fallback work across all skins.

import type { NpcArchetype } from "../facts/enums.ts";

type Lang = "zh" | "en";
export type NpcTopic = "growth" | "task" | "trade" | "travel" | "combat" | "group" | "chat";
type Bilingual = Record<Lang, readonly string[]>;
type TopicLines = Record<NpcTopic, Bilingual>;
type Leads = Record<Exclude<NpcTopic, "chat">, Record<Lang, string>>;

// The first matching topic wins; English words use boundaries to avoid matching inside other words.
const TOPICS: readonly [Exclude<NpcTopic, "chat">, RegExp][] = [
  ["growth", /修炼|练功|修为|破境|突破|境界|\b(?:train|training|cultivat(?:e|ion)|breakthrough|level(?:ing)?)\b/iu],
  ["task", /差事|任务|委托|\b(?:task|quest|errand|mission)s?\b/iu],
  ["trade", /买|卖|交易|换东西|买卖|\b(?:buy|sell|trade|trading|shop|market|barter)\b/iu],
  ["travel", /去哪|哪里|怎么走|道路|路线|路上|\b(?:where|road|route|travel|direction|directions|way)\b/iu],
  ["combat", /打怪|杀怪|斩杀|切磋|战斗|打架|\b(?:fight|fighting|combat|spar|sparring|monster|monsters|hunt|hunting)\b/iu],
  ["group", /组织|门派|帮派|结伴|队伍|\b(?:group|guild|clan|faction|party|team)\b/iu],
];

export function npcTopic(text: string): NpcTopic {
  return TOPICS.find(([, pattern]) => pattern.test(text))?.[0] ?? "chat";
}

const ENDINGS: Record<Exclude<NpcTopic, "chat">, Bilingual> = {
  growth: {
    zh: ["先把基础打好。", "稳稳走下去。", "别忘了歇一歇。", "慢慢积累就好。", "按自己的步子来。"],
    en: ["Build a solid foundation.", "Keep a steady pace.", "Remember to take a breather.", "Little by little adds up.", "Go at your own pace."],
  },
  task: {
    zh: ["先看看要做什么。", "做之前看清要求。", "办完记得回去交。", "有空就去瞧瞧。", "挑合适的再接。"],
    en: ["See what needs doing first.", "Check the details before starting.", "Remember to turn it in when done.", "Take a look when you have time.", "Pick one that suits you."],
  },
  trade: {
    zh: ["先看看有什么。", "合适再换也不迟。", "多问问总没错。", "看清再做决定。", "好东西可以拿来换。"],
    en: ["See what is on offer first.", "Trade when the deal suits you.", "It never hurts to ask around.", "Look carefully before deciding.", "Good things can be traded."],
  },
  travel: {
    zh: ["先看看附近的路。", "走之前认清方向。", "路上留点神。", "不妨四处看看。", "慢慢走也好。"],
    en: ["Check the nearby paths first.", "Get your bearings before you go.", "Keep your eyes open on the road.", "Have a look around.", "There is no rush to leave."],
  },
  combat: {
    zh: ["先看清对手。", "别忘了照顾自己。", "稳住再出手。", "量力而行。", "打完歇一歇。"],
    en: ["Take a good look at your opponent.", "Remember to look after yourself.", "Stay steady before you strike.", "Know your limits.", "Take a breather afterward."],
  },
  group: {
    zh: ["找人聊聊看。", "合得来就一起走。", "有事可以商量。", "结伴也挺好。", "先问问大家的想法。"],
    en: ["Try talking to someone.", "Stick together if you get along.", "You can always talk things over.", "Company can be nice.", "Ask what everyone thinks first."],
  },
};

const LEADS: Record<Exclude<NpcArchetype, "monster"> | "plain", Leads> = {
  master: {
    growth: { zh: "修行这事，", en: "On training: " }, task: { zh: "说到差事，", en: "As for tasks: " },
    trade: { zh: "买卖之道，", en: "As for trade: " }, travel: { zh: "出门在外，", en: "When traveling: " },
    combat: { zh: "与人交手，", en: "In a fight: " }, group: { zh: "与人结伴，", en: "When joining others: " },
  },
  merchant: {
    growth: { zh: "练功啊，", en: "Training, eh? " }, task: { zh: "说起差事，", en: "A task, eh? " },
    trade: { zh: "做买卖嘛，", en: "In business: " }, travel: { zh: "想出门啊，", en: "Heading out? " },
    combat: { zh: "要打架啊，", en: "Looking for a fight? " }, group: { zh: "想找伙伴啊，", en: "Looking for company? " },
  },
  repairer: {
    growth: { zh: "练功跟修东西一样，", en: "Training is like repairs: " }, task: { zh: "办差事嘛，", en: "For a job: " },
    trade: { zh: "要换东西啊，", en: "Trading things? " }, travel: { zh: "要赶路的话，", en: "Before a journey: " },
    combat: { zh: "动手之前，", en: "Before a fight: " }, group: { zh: "跟人搭伙，", en: "Working together: " },
  },
  guard: {
    growth: { zh: "练功可别大意，", en: "Keep training carefully: " }, task: { zh: "差事要紧，", en: "About that task: " },
    trade: { zh: "交易的时候，", en: "When trading: " }, travel: { zh: "要走远路，", en: "If you are heading out: " },
    combat: { zh: "真要动手，", en: "If there is a fight: " }, group: { zh: "和伙伴同行，", en: "With your companions: " },
  },
  patroller: {
    growth: { zh: "巡路也讲究功夫，", en: "Even patrol takes practice: " }, task: { zh: "这趟差事，", en: "For that errand: " },
    trade: { zh: "路上做买卖，", en: "Trading on the road? " }, travel: { zh: "我常在外走动，", en: "I walk these roads: " },
    combat: { zh: "路上碰到对手，", en: "If trouble finds you: " }, group: { zh: "路上有人作伴，", en: "Traveling with others? " },
  },
  quest_giver: {
    growth: { zh: "功夫要紧，", en: "About your training: " }, task: { zh: "这差事啊，", en: "About that job: " },
    trade: { zh: "说到交易，", en: "On trading: " }, travel: { zh: "差事之外想走走，", en: "Want to travel? " },
    combat: { zh: "遇到对手的话，", en: "If you face an opponent: " }, group: { zh: "想找人帮忙，", en: "Looking for help? " },
  },
  tutorial_opponent: {
    growth: { zh: "想练得更好，", en: "Want to improve? " }, task: { zh: "说到任务，", en: "About your quest: " },
    trade: { zh: "交易嘛，", en: "About trading: " }, travel: { zh: "想出去走走，", en: "Want to explore? " },
    combat: { zh: "切磋的时候，", en: "When we spar: " }, group: { zh: "想找人同行，", en: "Want a companion? " },
  },
  plain: {
    growth: { zh: "说起修炼，", en: "About training: " }, task: { zh: "说起任务，", en: "About tasks: " },
    trade: { zh: "说起买卖，", en: "About trade: " }, travel: { zh: "说起赶路，", en: "About the road: " },
    combat: { zh: "说起打斗，", en: "About fighting: " }, group: { zh: "说起结伴，", en: "About companions: " },
  },
};

const CHAT: Record<Exclude<NpcArchetype, "monster"> | "plain", Bilingual> = {
  master: {
    zh: ["嗯，值得想想。", "别急，慢慢来。", "有意思，再琢磨琢磨。", "你继续说。", "说得有趣。", "这倒新鲜。", "你怎么看？", "我在听呢。", "也有这个道理。", "不妨多想想。", "今天过得如何？", "坐下慢慢聊。"],
    en: ["That is worth a thought.", "No rush, take your time.", "Interesting, let it settle.", "Please go on.", "An interesting thought.", "That is new to me.", "What do you think?", "I am listening.", "There is some sense in that.", "Give it some thought.", "How is your day?", "Sit and talk a while."],
  },
  merchant: {
    zh: ["哈哈，这话有趣。", "来，坐下聊聊。", "你说得我好奇了。", "再多说两句。", "今天可还顺心？", "哟，来了啊。", "我正闲着呢。", "这倒是新鲜事。", "你见过什么趣事？", "好久没这么聊了。", "慢点说，我听着。", "哈哈，接着讲。"],
    en: ["Ha, that is interesting!", "Come sit and chat.", "Now I am curious.", "Tell me a little more.", "Having a good day?", "Oh, hello there!", "I have a moment to spare.", "That is something new.", "Seen anything interesting?", "Nice to chat for a change.", "Go on, I am listening.", "Ha! What happened next?"],
  },
  repairer: {
    zh: ["嗯，得慢慢琢磨。", "别急，总能理顺。", "这事值得细瞧。", "一点点来。", "你接着说。", "手里的活不急。", "这话有点意思。", "容我想想。", "你今天忙吗？", "慢慢说，我听得见。", "原来是这样。", "我倒想听听后续。"],
    en: ["That takes some thought.", "Easy, we will sort it out.", "That deserves a closer look.", "One step at a time.", "Go on, please.", "My work can wait a moment.", "That is an interesting thought.", "Let me think about that.", "Busy today?", "Take your time, I can hear you.", "So that is how it is.", "I would like to hear the rest."],
  },
  guard: {
    zh: ["知道了，多小心。", "嗯，我留意着。", "明白，有事再说。", "好，路上当心。", "今天还平静。", "我在这儿守着。", "你接着讲。", "听见了。", "一切还好吧？", "这事我记住了。", "多谢你告诉我。", "嗯，我听着呢。"],
    en: ["Got it, stay safe.", "I will keep watch.", "All right, let me know.", "Watch your step out there.", "Quiet day so far.", "I am keeping an eye out.", "Go ahead, tell me.", "I hear you.", "Everything all right?", "I will remember that.", "Thanks for telling me.", "Yes, I am listening."],
  },
  patroller: {
    zh: ["路上还顺利吗？", "哦？你接着说。", "我刚走了一圈。", "有新鲜事吗？", "今天风景不错。", "又见面了。", "这附近挺安静。", "我正好歇会儿。", "你从哪儿来？", "说来听听。", "这话有趣。", "回头我再看看。"],
    en: ["How has the road been?", "Oh? Go on.", "I just made my rounds.", "Anything new out there?", "Nice view today.", "Good to see you again.", "It is quiet around here.", "Time for a short break.", "Where have you been?", "Tell me about it.", "That is interesting.", "I will look again later."],
  },
  quest_giver: {
    zh: ["有意思，我听着呢。", "嗯，然后呢？", "这倒新鲜。", "说说你的想法。", "今天过得怎么样？", "你来了啊。", "这事值得聊聊。", "我正好有空。", "继续，我没走神。", "原来如此。", "你还有什么见闻？", "慢慢讲，不着急。"],
    en: ["Interesting, I am listening.", "And then what?", "That is new to me.", "Tell me what you think.", "How has your day been?", "Good to see you.", "That is worth a chat.", "I have a moment.", "Go on, I am paying attention.", "Oh, I see.", "What else have you seen?", "Take your time telling me."],
  },
  tutorial_opponent: {
    zh: ["好，咱们慢慢来。", "不错，再说说。", "别紧张，我听着。", "你说得有意思。", "今天精神不错啊。", "咱们又见面了。", "哈哈，是吗？", "我正好有空。", "你有什么新发现？", "这倒没想到。", "说吧，我在听。", "聊完再忙也不迟。"],
    en: ["Good, let us take it slow.", "Nice, tell me more.", "Relax, I am listening.", "That is interesting.", "You seem lively today.", "We meet again.", "Ha, really?", "I have a moment to spare.", "Discovered anything new?", "I did not expect that.", "Go on, I am listening.", "The rest can wait for a chat."],
  },
  plain: {
    zh: ["嗯，我听见了。", "是吗？继续说。", "好啊，我听着。", "有意思，再聊聊。", "今天还好吗？", "原来如此。", "你怎么看？", "说来听听。", "这倒新鲜。", "我正好有空。", "慢慢说，不着急。", "很高兴见到你。"],
    en: ["Mm, I heard you.", "Really? Go on.", "Sure, I am listening.", "Interesting, tell me more.", "How is your day?", "Oh, I see.", "What do you think?", "Tell me about it.", "That is new to me.", "I have a moment.", "Take your time.", "Good to see you."],
  },
};

const MONSTER: TopicLines = {
  growth: { zh: ["呜……呼。", "嗷呜！", "呼噜……", "呜嗷。", "唔……吼。", "嗷……呼！"], en: ["Hrr... huff.", "Awoo!", "Rumble...", "Hrr-aw.", "Mmm... growl.", "Aw... huff!" ] },
  task: { zh: ["吼？", "嗷！", "呜……", "咕噜！", "呼哧。", "吼呜！"], en: ["Grr?", "Rawr!", "Hrr...", "Rumble!", "Huff.", "Growl-aw!" ] },
  trade: { zh: ["嗅嗅……吼。", "呼噜？", "呜嗷！", "嗷……嗅。", "哼哧。", "吼哼！"], en: ["Sniff... grr.", "Rumble?", "Hrr-aw!", "Aw... sniff.", "Snort.", "Grr-huff!" ] },
  travel: { zh: ["嗷……", "呼！", "吼……呜。", "哼哧！", "嗷嗷。", "呜？"], en: ["Awoo...", "Huff!", "Grr... hrr.", "Snort!", "Aw-aw.", "Hrr?" ] },
  combat: { zh: ["吼！", "嗷呜呜！", "咆哮！", "呼哧呼哧。", "嗷吼！", "呜……嗷！"], en: ["Grr!", "Awooo!", "Roar!", "Huff, huff.", "Rawr-grr!", "Hrr... rawr!" ] },
  group: { zh: ["呜呜……", "嗷呜？", "呼噜呼噜。", "吼……吼。", "呜嗷呜。", "哼……呜。"], en: ["Hrr-hrr...", "Awoo?", "Rumble, rumble.", "Grr... grr.", "Hrr-aw-hrr.", "Huff... hrr." ] },
  chat: { zh: ["……吼。", "呼……吼！", "唔……", "嗷！", "呼噜。", "呜呜？"], en: ["...grr.", "Hrr... growl!", "Rrr...", "Grrr!", "Rumble.", "Hrr-hrr?" ] },
};

function makeLines(role: Exclude<NpcArchetype, "monster"> | "plain"): TopicLines {
  const lines = { chat: CHAT[role] } as TopicLines;
  for (const topic of Object.keys(ENDINGS) as Exclude<NpcTopic, "chat">[]) {
    lines[topic] = {
      zh: ENDINGS[topic].zh.map((end) => LEADS[role][topic].zh + end),
      en: ENDINGS[topic].en.map((end) => LEADS[role][topic].en + end),
    };
  }
  return lines;
}

export const NPC_LINES: Record<NpcArchetype | "plain", TopicLines> = {
  master: makeLines("master"), merchant: makeLines("merchant"), repairer: makeLines("repairer"),
  guard: makeLines("guard"), patroller: makeLines("patroller"), quest_giver: makeLines("quest_giver"),
  monster: MONSTER, tutorial_opponent: makeLines("tutorial_opponent"), plain: makeLines("plain"),
};

// Process-local LRU: one counter and the last four replies per pair, capped to bound memory.
// Restart or eviction forgets the history. Five distinct candidates per topic guarantee the next
// reply differs from the previous four even when the topic or language changes.
const PAIR_LIMIT = 10000;
const pairs = new Map<string, { next: number; recent: string[] }>();

export function npcLine(archetype: NpcArchetype | null, lang: Lang, speaker: string, npc: string, spokenText: string): string {
  const key = JSON.stringify([speaker, npc]);
  const state = pairs.get(key) ?? { next: 0, recent: [] };
  const pool = (archetype === null ? NPC_LINES.plain : NPC_LINES[archetype] ?? NPC_LINES.plain)[npcTopic(spokenText)][lang];
  let index = state.next % pool.length;
  while (state.recent.includes(pool[index] as string)) index = (index + 1) % pool.length;
  const line = pool[index] as string;
  state.next = (index + 1) % pool.length;
  state.recent.push(line);
  if (state.recent.length > 4) state.recent.shift();
  pairs.delete(key);
  pairs.set(key, state);
  if (pairs.size > PAIR_LIMIT) pairs.delete(pairs.keys().next().value as string);
  return line;
}
