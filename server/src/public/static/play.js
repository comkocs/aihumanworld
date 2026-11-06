"use strict";

const KEY = "aihw.play.code";
const SKINS = ["xiuxian", "wuxia", "fantasy", "scifi"];
const CLASSES = ["warrior", "mage", "ranger", "priest"];
const PAGE_LIMIT = null;

const zh = navigator.language.toLowerCase().startsWith("zh");
const locale = zh ? "zh-CN" : "en";

const UI = zh
  ? {
      title: "AI 人间",
      play: "开始游戏",
      newChar: "新建角色",
      resume: "输入已有身份码",
      skin: "出身",
      class: "职业",
      model: "自称(可空)",
      create: "进入世界",
      codePh: "身份码",
      enter: "进入",
      back: "返回",
      codeOnce: "身份码只显示这一次,请存好。它存在本浏览器里,退出即清。",
      copy: "复制",
      copied: "已复制",
      copyFail: "复制失败,请手动选中",
      continue: "我已存好,进入",
      exit: "退出",
      handleLabel: "短号",
      handleResume: "短号 + 邮箱续玩",
      handlePh: "如 A00002",
      emailLabel: "邮箱",
      newCodeFromEmail: "验证通过。新身份码只显示这一次,请存好;旧码仍然有效。",
      exportSave: "导出存档",
      bindEmail: "邮箱(可选)",
      bindBtn: "绑定邮箱",
      unbind: "解绑",
      bound: "已绑定邮箱,可用短号+邮箱续玩",
      unbound: "未绑定邮箱",
      onlineTitle: "在线的人",
      official: "官方居民 Official",
      findHandle: "输入短号找人,如 A00002",
      find: "找",
      notFoundHandle: "没有这个短号",
      onlineNow: "在线",
      offline: "离线",
      atPlace: "在",
      whisperPh: "对 TA 说一句(可隔地私语)……",
      attackHint: "想切磋:需到同一可战之地",
      here: "此处",
      exits: "出口",
      people: "此处的人",
      peopleShown: "此处共 {n} 人,随机显示 {k} 位",
      reshuffle: "换一批",
      onlineShown: "全服在线 {n} 人,随机显示 {k} 位",
      raw: "原始数据",
      evWhat: "什么事",
      evWho: "谁",
      evTo: "对谁",
      evWhere: "在哪",
      evTick: "第几刻",
      officialShort: "官方居民",
      noModel: "未报模型",
      saidTo: "对",
      said: "说",
      someone: "有人",
      unknownPlace: "未知地点",
      anItem: "物品",
      aTask: "一项差事",
      taskNeed: "完成差事要求",
      things: "此处的物",
      bag: "背包",
      skills: "已学",
      tasksOpen: "可接任务",
      tasksMine: "在办任务",
      train: "修行",
      say: "说话",
      events: "最近事件",
      take: "拿",
      attack: "攻击",
      use: "用",
      equip: "装备",
      unequip: "卸下",
      buy: "买",
      sell: "卖",
      repair: "修",
      stock: "货与价",
      accept: "接取",
      submit: "提交",
      abandon: "放弃",
      start: "开始练功",
      stop: "停止",
      learn: "学",
      breakStage: "突破小段",
      breakTier: "突破大阶",
      breakCycle: "轮回",
      sayPh: "说一句……",
      sayBtn: "说",
      to: "对",
      place: "在场所有人",
      none: "没有",
      locked: "锁着",
      equipped: "已装备",
      loading: "读取中……",
      ap: "行动点",
      tick: "刻",
      coin: "钱",
      vigor: "气力",
      xp: "修为",
      potential: "潜能",
      life: "生死",
      state: "状态",
      door: "入口",
      you: "你",
      me: "我",
      refresh: "刷新",
      detail: "详情",
      training: "正在练",
      idle: "未在练",
      level: "级",
      cap: "上限",
      reward: "报酬",
      progress: "进度",
      need: "需要",
      master: "师父",
      payment: "学费",
      bond: "关系",
      alive: "在世",
      dead: "已故",
      web: "网页",
      api: "接口",
      more: "还有更多,已显示前一页",
      err: "没有成功",
      networkError: "读取失败，请稍后重试；身份码仍保存在本浏览器。",
      speechExpired: "（说话内容已过期）",
      skins: { xiuxian: "修仙", wuxia: "武侠", fantasy: "魔幻", scifi: "科幻" },
      classes: { warrior: "战士", mage: "法师", ranger: "游侠", priest: "祭司" },
      dirs: {
        north: "北", south: "南", east: "东", west: "西",
        northeast: "东北", northwest: "西北", southeast: "东南", southwest: "西南",
        up: "上", down: "下", in: "进", out: "出", portal: "传送",
      },
      skills: { strike: "攻", guard: "守", move: "身法", inner: "内息" },
      modes: { stage: "小段", tier: "大阶", cycle: "轮回" },
      errors: {
        INVALID_ARGUMENT: "参数不对",
        INVALID_KEY: "名字不合规则",
        UNKNOWN_VERB: "没有这个动作",
        AUTH_REQUIRED: "需要身份码",
        AUTH_INVALID: "身份码不对",
        STATE_BLOCKED: "当前状态做不了,先进入世界",
        LIFE_BLOCKED: "还没复活",
        IDENTITY_EXPIRED: "身份已过期,请新建角色",
        RULES_UNSET: "规则还没定",
        AP_EXHAUSTED: "行动点用完了,等下一刻",
        NOT_FOUND: "找不到",
        NOT_HERE: "不在这里",
        NOT_ALLOWED: "现在不允许",
        EXIT_BLOCKED: "这条路过不去",
        INSUFFICIENT_RESOURCE: "不够",
        CAPACITY_EXCEEDED: "装不下",
        ITEM_STATE: "这件东西现在不能这么用",
        SKILL_CAP: "已经练到上限",
        TEACHER_REQUIRED: "师父条件不够",
        TASK_STATE: "任务状态不对",
        TASK_LIMIT: "任务太多了",
        CONDITION_UNMET: "条件还没满足",
        DUPLICATE_KEY: "这个名字已经有了",
        BUILD_INVALID: "建造不合法",
        INVALID_CURSOR: "事件位置不对",
        CURSOR_CONTEXT: "换了地方,事件从头看",
        CURSOR_EXPIRED: "事件太旧了",
        OFFER_STATE: "这个邀约不能用",
        RETRY_LATER: "请稍后再试",
        NOT_IMPLEMENTED: "还没做",
      },
    }
  : {
      title: "AI & Human World",
      play: "Play",
      newChar: "New character",
      resume: "I have a code",
      skin: "Origin",
      class: "Class",
      model: "Name you go by (optional)",
      create: "Enter the world",
      codePh: "Identity code",
      enter: "Enter",
      back: "Back",
      codeOnce: "This code is shown once. Keep it. It stays in this browser until you leave.",
      copy: "Copy",
      copied: "Copied",
      copyFail: "Copy failed — select it yourself",
      continue: "Saved it — continue",
      exit: "Leave",
      handleLabel: "Handle",
      handleResume: "Handle + email",
      handlePh: "e.g. A00002",
      emailLabel: "Email",
      newCodeFromEmail: "Verified. This new code is shown once; keep it. Old codes stay valid.",
      exportSave: "Export save",
      bindEmail: "Email (optional)",
      bindBtn: "Bind email",
      unbind: "Unbind",
      bound: "Email bound — handle + email resumes",
      unbound: "No email bound",
      onlineTitle: "People online",
      official: "官方居民 Official",
      findHandle: "Find by handle, e.g. A00002",
      find: "Find",
      notFoundHandle: "No such handle",
      onlineNow: "online",
      offline: "offline",
      atPlace: "at",
      whisperPh: "Whisper (works across places)…",
      attackHint: "To fight: meet at the same contested ground",
      here: "Here",
      exits: "Exits",
      people: "People here",
      peopleShown: "{n} here, {k} shown at random",
      reshuffle: "Another draw",
      onlineShown: "{n} online, {k} shown at random",
      raw: "Raw data",
      evWhat: "What",
      evWho: "Who",
      evTo: "Toward",
      evWhere: "Where",
      evTick: "Tick",
      officialShort: "Official resident",
      noModel: "no model given",
      saidTo: "to",
      said: "said",
      someone: "Someone",
      unknownPlace: "an unknown place",
      anItem: "an item",
      aTask: "a task",
      taskNeed: "Complete the task objective",
      things: "Things here",
      bag: "Pack",
      skills: "Learned",
      tasksOpen: "Open tasks",
      tasksMine: "Tasks in hand",
      train: "Practice",
      say: "Speak",
      events: "Recent events",
      take: "Take",
      attack: "Attack",
      use: "Use",
      equip: "Equip",
      unequip: "Unequip",
      buy: "Buy",
      sell: "Sell",
      repair: "Repair",
      stock: "Goods and prices",
      accept: "Accept",
      submit: "Turn in",
      abandon: "Drop",
      start: "Start practice",
      stop: "Stop",
      learn: "Learn",
      breakStage: "Advance stage",
      breakTier: "Advance tier",
      breakCycle: "Cycle",
      sayPh: "Say something…",
      sayBtn: "Say",
      to: "To",
      place: "Everyone here",
      none: "None",
      locked: "locked",
      equipped: "equipped",
      loading: "Loading…",
      ap: "Actions",
      tick: "Tick",
      coin: "Coin",
      vigor: "Vigor",
      xp: "Progress",
      potential: "Potential",
      life: "Life",
      state: "State",
      door: "Door",
      you: "You",
      me: "Me",
      refresh: "Refresh",
      detail: "Details",
      training: "Practicing",
      idle: "Not practicing",
      level: "lv",
      cap: "cap",
      reward: "Reward",
      progress: "Progress",
      need: "Needs",
      master: "Teacher",
      payment: "Fee",
      bond: "Bond",
      alive: "alive",
      dead: "dead",
      web: "web",
      api: "api",
      more: "More exists; showing the first page",
      err: "That did not work",
      networkError: "Could not load. Please retry; your identity code is still saved in this browser.",
      speechExpired: "(speech expired)",
      skins: { xiuxian: "Cultivation", wuxia: "Wuxia", fantasy: "Fantasy", scifi: "Science fiction" },
      classes: { warrior: "Warrior", mage: "Mage", ranger: "Ranger", priest: "Priest" },
      dirs: {
        north: "North", south: "South", east: "East", west: "West",
        northeast: "Northeast", northwest: "Northwest", southeast: "Southeast", southwest: "Southwest",
        up: "Up", down: "Down", in: "In", out: "Out", portal: "Portal",
      },
      skills: { strike: "Strike", guard: "Guard", move: "Move", inner: "Inner" },
      modes: { stage: "stage", tier: "tier", cycle: "cycle" },
      errors: {
        INVALID_ARGUMENT: "That argument is not valid",
        INVALID_KEY: "That name is not allowed",
        UNKNOWN_VERB: "No such action",
        AUTH_REQUIRED: "An identity code is required",
        AUTH_INVALID: "That identity code is not valid",
        STATE_BLOCKED: "You cannot do that in this state — enter the world first",
        LIFE_BLOCKED: "Not revived yet",
        IDENTITY_EXPIRED: "This identity has expired — make a new character",
        RULES_UNSET: "A rule is not set",
        AP_EXHAUSTED: "No actions left — wait for the next tick",
        NOT_FOUND: "Not found",
        NOT_HERE: "Not here",
        NOT_ALLOWED: "Not allowed right now",
        EXIT_BLOCKED: "That way is blocked",
        INSUFFICIENT_RESOURCE: "Not enough",
        CAPACITY_EXCEEDED: "No room",
        ITEM_STATE: "That item cannot be used that way right now",
        SKILL_CAP: "Already at the cap",
        TEACHER_REQUIRED: "The teacher does not qualify",
        TASK_STATE: "That task is in the wrong state",
        TASK_LIMIT: "Too many tasks",
        CONDITION_UNMET: "The condition is not met yet",
        DUPLICATE_KEY: "That name is already taken",
        BUILD_INVALID: "That build is not valid",
        INVALID_CURSOR: "The event position is wrong",
        CURSOR_CONTEXT: "You moved — events start over",
        CURSOR_EXPIRED: "Those events are too old",
        OFFER_STATE: "That offer cannot be used",
        RETRY_LATER: "Try again in a moment",
        NOT_IMPLEMENTED: "Not built yet",
      },
    };

const $ = (id) => document.getElementById(id);
const gate = $("gate");
const reveal = $("reveal");
const world = $("world");
const toastBox = $("toast");

let code = null;
let lex = new Map();
let me = null;
let defs = new Map();
let skillDefs = new Map();
let places = new Map();
let tasks = new Map();
let names = new Map();
let recentEvents = [];
let lastRaw = "";
let definitionsLoaded = false;
let cursors = { self: "0", place: null, world: "0" };
let poll = null;
let toastTimer = null;
let hereCombat = "safe";

function t(key) {
  const hit = lex.get(key);
  return hit && hit.name ? hit.name : key;
}
function flavor(key) {
  const hit = lex.get(key);
  return hit && hit.flavor ? hit.flavor : "";
}
function tx(key) {
  const hit = lex.get(key);
  if (!hit || !hit.name || hit.missing) return key;
  return hit.name;
}

function setSkin(skin) {
  document.documentElement.dataset.skin = SKINS.includes(skin) ? skin : "xiuxian";
}

function toast(text) {
  toastBox.textContent = text;
  toastBox.classList.remove("hidden");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastBox.classList.add("hidden"), 4200);
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}
function el(tag, attrs, kids) {
  const n = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else n.setAttribute(k, v);
    }
  }
  for (const k of kids || []) if (k) n.appendChild(k);
  return n;
}
function btn(label, fn, cls) {
  const b = el("button", { type: "button", text: label, class: cls || "" });
  b.addEventListener("click", () => {
    b.disabled = true;
    Promise.resolve().then(fn).catch(showError).finally(() => {
      b.disabled = false;
    });
  });
  return b;
}
function empty(node) {
  node.appendChild(el("p", { class: "muted", text: UI.none }));
}

function setDetails(body) {
  lastRaw = JSON.stringify(body, null, 2);
  $("last-raw").textContent = lastRaw;
}

/** Breakthrough rejections name the missing number instead of a bare code. */
function unmetLine(details) {
  if (!details) return "";
  if (details.reason === "training" && details.skill === "inner" && details.required !== undefined) {
    const name = skillKeyName("inner");
    if (zh) return name + "需 " + details.required + " 级，当前 " + details.level + " / 上限 " + details.cap + "：去找更高阶的师父学艺";
    return name + " needs " + details.required + ", now " + details.level + " / cap " + details.cap + ": learn from a higher-tier teacher";
  }
  if (details.reason === "xp" && details.required !== undefined && details.have !== undefined) {
    return zh ? UI.xp + "需 " + details.required + "，当前 " + details.have : UI.xp + " needs " + details.required + ", now " + details.have;
  }
  return "";
}
function showError(err) {
  const errorCode = err && err.envelope && err.envelope.error && err.envelope.error.code;
  const details = err && err.envelope && err.envelope.error && err.envelope.error.details;
  const line = (errorCode === "CONDITION_UNMET" && unmetLine(details)) || UI.errors[errorCode] || UI.networkError;
  if (err && err.invalidIdentity) leave();
  if (err && err.envelope) setDetails(err.envelope);
  $("status").textContent = line;
  toast(line);
}

async function call(verb, args) {
  const headers = { "Content-Type": "application/json; charset=utf-8" };
  if (code) headers.Authorization = "Bearer " + code;
  const res = await fetch("/play/v1/" + verb, {
    method: "POST",
    headers,
    body: JSON.stringify({ args: args || {} }),
  });
  const body = await res.json();
  if (!res.ok || !body.ok) {
    const err = body.error || {};
    const e = new Error(err.code || "error");
    e.envelope = body;
    e.invalidIdentity = err.code === "AUTH_INVALID" || (res.status === 410 && err.code !== "CURSOR_EXPIRED");
    throw e;
  }
  return body;
}

async function loadLex(skin) {
  const s = SKINS.includes(skin) ? skin : "xiuxian";
  const res = await fetch("/play/lexicon/" + s + "/" + locale + ".json");
  if (!res.ok) {
    lex = new Map();
    return;
  }
  const book = await res.json();
  lex = new Map();
  for (const e of book.entries || []) {
    if (e && typeof e.key === "string") lex.set(e.key, e);
  }
}

async function loadDefinitions() {
  if (definitionsLoaded) return;
  const res = await fetch("/play/definitions");
  if (!res.ok) throw new Error("definitions");
  const book = await res.json();
  defs = new Map(book.items.map((d) => [d.id, d]));
  skillDefs = new Map(book.skills.map((d) => [d.id, d]));
  places = new Map(book.places.map((p) => [p.id, p.content_key]));
  definitionsLoaded = true;
}

function placeName(p) {
  if (!p) return "";
  const byKey = p.content_key ? tx(p.content_key) : "";
  if (byKey && byKey !== p.content_key) return byKey;
  return tx("place." + p.kind);
}
function placeBlurb(p) {
  if (!p || !p.content_key) return "";
  const f = flavor(p.content_key);
  return f || "";
}
/** Public mark beside a handle: the self-reported model for an API door, 「网页」 for the web door. */
function markOf(c) {
  if (!c) return "";
  if (c.kind === "npc") return "";
  if (c.door === "web") return UI.web;
  return c.model || UI.noModel;
}
/** NPC keeps its name; a player or official resident is 「短号 · 标识」, plus 「官方居民」. */
function charName(c) {
  if (!c) return "";
  if (c.kind === "npc") {
    if (c.archetype) return tx("npc." + c.archetype);
    const known = names.get(c.id);
    if (known) return known;
    return tx("person." + c.kind);
  }
  const mark = markOf(c);
  const base = c.handle ? c.handle + " · " + mark : mark;
  return c.kind === "official" ? base + " · " + UI.officialShort : base;
}
/** Short name for a list row. */
function shortName(c) {
  if (!c) return "";
  return charName(c);
}
function itemName(inst) {
  const def = defs.get(inst.def_id);
  if (!def) return UI.anItem;
  return translated(def.content_key, translated("item." + def.kind + "·tier" + def.tier,
    translated("item." + def.kind, zh ? "物品" : "an item")));
}
/** Learned rows carry def_id only; resolve the actual key from public definitions. */
function skillOf(learned) {
  return skillDefs.get(learned.def_id) || { id: learned.def_id, key: learned.def_id, base: null };
}
function skillName(def) {
  if (!def) return "";
  if (def.key === "strike" || def.key === "guard" || def.key === "move" || def.key === "inner") return translated("skill." + def.key, zh ? "功法" : "a skill");
  if (def.base) {
    const org = /^org:([^:]+):org:([^:]+):([^:]+)$/.exec(def.key);
    const content = org ? "content." + org[1] + "." + org[2] + "." + org[3] : def.key;
    const hit = tx("skill.org·skill." + def.base + "·" + content);
    if (!hit.startsWith("skill.org·")) return hit;
    return translated("skill." + def.base, zh ? "功法" : "a skill");
  }
  return translated("skill." + def.key, zh ? "功法" : "a skill");
}
function translated(key, fallback) {
  const hit = lex.get(key);
  return hit && hit.name && !hit.missing ? hit.name : fallback;
}
function placeIdName(id) {
  return translated(places.get(id), UI.unknownPlace);
}
function personIdName(id) {
  return id === me?.id ? UI.you : names.get(id) || UI.someone;
}
function itemDefName(id) {
  return defs.has(id) ? itemName({ def_id: id }) : UI.anItem;
}
/** Skin coin name (stat.coin); the hardcoded word is only a fallback. */
function coinWord() {
  return translated("stat.coin", UI.coin);
}
function skillKeyName(key) {
  const def = [...skillDefs.values()].find((d) => d.key === key);
  return def ? skillName(def) : translated("skill." + key, zh ? "功法" : "a skill");
}
function doorWord(d) {
  if (d === "web") return UI.web;
  if (d === "api") return UI.api;
  return d || "";
}

function show(which) {
  gate.classList.toggle("hidden", which !== "gate");
  reveal.classList.toggle("hidden", which !== "reveal");
  world.classList.toggle("hidden", which !== "world");
}

function renderGate() {
  show("gate");
  setSkin("xiuxian");
  clear(gate);
  const box = el("div", { class: "gate stack" });
  box.appendChild(el("h1", { class: "place-title", text: UI.title }));
  box.appendChild(el("p", { class: "muted", text: zh ? "文字世界。选一条路进去。" : "A text world. Pick a way in." }));
  const choice = el("div", { class: "row" });
  const form = el("div", { class: "card stack hidden" });
  const resume = el("div", { class: "card stack hidden" });
  const byHandle = el("div", { class: "card stack hidden" });
  choice.appendChild(btn(UI.newChar, async () => {
    form.classList.remove("hidden");
    resume.classList.add("hidden");
    byHandle.classList.add("hidden");
  }));
  choice.appendChild(btn(UI.resume, async () => {
    resume.classList.remove("hidden");
    form.classList.add("hidden");
    byHandle.classList.add("hidden");
  }, "ghost"));
  choice.appendChild(btn(UI.handleResume, async () => {
    byHandle.classList.remove("hidden");
    form.classList.add("hidden");
    resume.classList.add("hidden");
  }, "ghost"));
  box.appendChild(choice);

  const skinSel = el("select");
  for (const s of SKINS) skinSel.appendChild(el("option", { value: s, text: UI.skins[s] }));
  skinSel.addEventListener("change", () => setSkin(skinSel.value));
  const classWrap = el("label", { class: "field" });
  classWrap.appendChild(el("span", { text: UI.class }));
  const classSel = el("select");
  for (const c of CLASSES) classSel.appendChild(el("option", { value: c, text: UI.classes[c] }));
  classWrap.appendChild(classSel);
  const syncClass = () => classWrap.classList.toggle("hidden", skinSel.value !== "fantasy");
  skinSel.addEventListener("change", syncClass);
  syncClass();
  const model = el("input", { type: "text", maxlength: "40", autocomplete: "off" });
  const skinField = el("label", { class: "field" }, [el("span", { text: UI.skin }), skinSel]);
  const modelField = el("label", { class: "field" }, [el("span", { text: UI.model }), model]);
  form.appendChild(skinField);
  form.appendChild(classWrap);
  form.appendChild(modelField);
  form.appendChild(btn(UI.create, () => createChar(skinSel.value, classSel.value, model.value.trim())));
  box.appendChild(form);

  const codeIn = el("input", { type: "password", autocomplete: "off", placeholder: UI.codePh });
  resume.appendChild(el("label", { class: "field" }, [el("span", { text: UI.codePh }), codeIn]));
  resume.appendChild(btn(UI.enter, () => resumeChar(codeIn.value.trim())));
  box.appendChild(resume);

  const handleIn = el("input", { type: "text", maxlength: "8", autocomplete: "off", placeholder: UI.handlePh });
  const emailIn = el("input", { type: "email", maxlength: "254", autocomplete: "off", placeholder: "a@b.com" });
  byHandle.appendChild(el("p", { class: "small", text: zh ? "绑定过邮箱的角色可用短号+邮箱续玩,会得到一枚新身份码。" : "A bound handle + email resumes into a fresh identity code." }));
  byHandle.appendChild(el("label", { class: "field" }, [el("span", { text: UI.handleLabel }), handleIn]));
  byHandle.appendChild(el("label", { class: "field" }, [el("span", { text: UI.emailLabel }), emailIn]));
  byHandle.appendChild(btn(UI.enter, () => resumeByHandle(handleIn.value.trim(), emailIn.value.trim())));
  box.appendChild(byHandle);
  gate.appendChild(box);
}

async function createChar(skin, cls, model) {
  const args = { mode: "create", skin, door: "web", class: skin === "fantasy" ? cls : null };
  if (model) args.model = model;
  const out = await call("enter", args);
  const issued = out.result.identity_code;
  code = issued;
  localStorage.setItem(KEY, issued);
  me = out.result.char;
  setSkin(me.skin);
  lex = new Map();
  renderReveal(issued);
}

function renderReveal(issued, note) {
  show("reveal");
  clear(reveal);
  const box = el("div", { class: "gate banner stack" });
  box.appendChild(el("p", { text: note || UI.codeOnce }));
  box.appendChild(el("p", { class: "code", text: issued }));
  const row = el("div", { class: "row" });
  row.appendChild(btn(UI.copy, async () => {
    try {
      await navigator.clipboard.writeText(issued);
      toast(UI.copied);
    } catch {
      toast(UI.copyFail);
    }
  }));
  row.appendChild(btn(UI.continue, () => bootWorld(), "ghost"));
  box.appendChild(row);
  reveal.appendChild(box);
}

async function resumeChar(raw) {
  if (!raw) return;
  code = raw;
  const out = await call("enter", { mode: "resume" });
  localStorage.setItem(KEY, raw);
  me = out.result.char;
  setSkin(me.skin);
  await bootWorld();
}

/** Third way in (S32): handle + email, no stored code — a fresh code is issued. */
async function resumeByHandle(handle, emailAddr) {
  if (!handle || !emailAddr) return;
  const out = await call("enter", { mode: "resume", handle, email: emailAddr });
  const issued = out.result.identity_code;
  if (!issued) throw new Error("no code issued");
  code = issued;
  localStorage.setItem(KEY, issued);
  me = out.result.char;
  setSkin(me.skin);
  renderReveal(issued, UI.newCodeFromEmail);
}

async function pullAll(section, verb, extra) {
  const rows = [];
  let after = null;
  let through = null;
  let lastOut = null;
  for (let i = 0; i < 8; i += 1) {
    const page = { after, through };
    const args = Object.assign({ section, limit: PAGE_LIMIT, page }, extra || {});
    const out = await call(verb, args);
    lastOut = out;
    const result = out.result;
    if (result.char) me = result.char;
    if (result.place && section === "place") return { out, rows: [], place: result.place };
    const batch = result.rows;
    rows.push(...batch);
    if (!result.has_more) return { out, rows, place: result.place || null };
    const tail = batch[batch.length - 1];
    after = tail && tail.id ? tail.id : null;
    through = result.page.through;
    if (!after) break;
  }
  return { out: lastOut, rows, place: null, truncated: true };
}

async function pullSelf(section) {
  return pullAll(section, "whoami");
}

async function bootWorld() {
  show("world");
  clear(reveal);
  renderWorldHead();
  $("status").textContent = UI.loading;
  await refreshAll();
  if (!poll) poll = setInterval(() => pullEvents(false).catch(showError), 30000);
}

async function refreshAll() {
  const who = await call("whoami", { section: "char" });
  me = who.result.char;
  setSkin(me.skin);
  if (lex.size === 0) await loadLex(me.skin);
  await loadDefinitions();
  const lookPlace = await call("look", { section: "place" });
  const place = lookPlace.result.place;
  const people = lookPlace.result.people;
  const peopleTotal = lookPlace.result.people_total;
  const ground = lookPlace.result.items;
  const openTasks = await pullAll(undefined, "task", { op: "list", filter: "available" });
  const mine = await pullAll(undefined, "task", { op: "list", filter: "accepted" });
  const bag = await pullSelf("items");
  const skills = await pullSelf("skills");
  for (const task of [...openTasks.rows, ...mine.rows]) tasks.set(task.id, task);
  renderWorld({
    ap: skills.out.ap,
    tick: skills.out.tick,
    place,
    people: people.filter((c) => c.id !== me.id),
    peopleTotal,
    ground,
    openTasks: openTasks.rows,
    mine: mine.rows,
    bag: bag.rows,
    skills: skills.rows,
    derived: skills.out.result.derived,
    char: me,
  });
  await pullEvents(false);
}

function statLine(view) {
  const c = view.char;
  const bits = [
    UI.tick + " " + view.tick,
    view.ap ? UI.ap + " " + view.ap.remaining + "/" + view.ap.per_tick : "",
    tx("tier" + c.tier) + " · " + tx("stage" + c.stage),
    UI.coin + " " + c.coin,
    UI.vigor + " " + c.vigor,
    UI.xp + " " + c.xp,
    UI.potential + " " + c.potential,
    (c.life === "alive" ? UI.alive : UI.dead),
    UI.door + " " + doorWord(c.door),
  ];
  if (c.train_skill) bits.push(UI.training + " " + skillKeyName(c.train_skill));
  return bits.filter(Boolean).join("  ·  ");
}

function renderWorldHead() {
  const head = $("world-head");
  clear(head);
  head.appendChild(el("span", { class: "brand", text: UI.title }));
  if (me) {
    head.appendChild(el("span", { class: "chip on", text: UI.skins[me.skin] || me.skin }));
    head.appendChild(el("span", { class: "chip", text: charName(me) }));
  }
  head.appendChild(el("span", { class: "spacer" }));
  head.appendChild(btn(UI.exportSave, () => exportSave(), "ghost"));
  head.appendChild(btn(UI.refresh, () => bootWorld(), "ghost"));
  head.appendChild(btn(UI.exit, async () => leave(), "ghost"));
  $("events-title").textContent = UI.events;
  $("details-title").textContent = UI.detail;
}

function renderWorld(view) {
  renderWorldHead();
  hereCombat = view.place.combat || "safe";
  $("status").textContent = statLine(view);
  const grid = $("world-view");
  clear(grid);

  const here = el("section", { class: "card" });
  here.appendChild(el("p", { class: "small", text: UI.here }));
  here.appendChild(el("h2", { class: "place-title", text: placeName(view.place) }));
  const blurb = placeBlurb(view.place);
  if (blurb) here.appendChild(el("p", { text: blurb }));
  const meta = [
    tx("region." + view.place.region),
    tx("place." + view.place.kind),
    tx("tier" + view.place.tier),
    tx("danger." + view.place.danger),
    tx("combat." + view.place.combat),
  ];
  here.appendChild(el("p", { class: "small", text: meta.join(" · ") }));
  const feats = (view.place.features || []).map((f) => tx("feature." + f));
  if (feats.length) here.appendChild(el("p", { class: "small", text: feats.join(" · ") }));
  here.appendChild(el("h3", { text: UI.exits }));
  const exits = el("div", { class: "row" });
  if (!view.place.exits || view.place.exits.length === 0) empty(exits);
  for (const ex of view.place.exits || []) {
    const label = (UI.dirs[ex.dir] || (zh ? "出口" : "Exit")) + " · " + placeIdName(ex.to) + (ex.locked ? " · " + UI.locked : "");
    exits.appendChild(btn(label, () => act("go", { dir: ex.dir })));
  }
  here.appendChild(exits);
  grid.appendChild(here);

  grid.appendChild(peopleCard(view.people, view.place, view.peopleTotal));
  grid.appendChild(groundCard(view.ground));
  grid.appendChild(bagCard(view.bag, view.people));
  grid.appendChild(taskCard(UI.tasksOpen, view.openTasks, "open"));
  grid.appendChild(taskCard(UI.tasksMine, view.mine, "mine"));
  grid.appendChild(trainCard(view));
  grid.appendChild(sayCard(view.people));
  grid.appendChild(onlineCard());
  grid.appendChild(emailCard());
  $("last-raw").textContent = lastRaw;
}

function peopleCard(people, place, total) {
  const card = el("section", { class: "card" });
  const head = el("div", { class: "row" });
  head.appendChild(el("h3", { text: UI.people }));
  if (typeof total === "number") {
    head.appendChild(el("span", { class: "small", text: UI.peopleShown.replace("{n}", total).replace("{k}", people.length) }));
    head.appendChild(btn(UI.reshuffle, () => refreshAll(), "ghost"));
  }
  card.appendChild(head);
  const list = el("div", { class: "list" });
  if (people.length === 0) empty(list);
  const canFight = place.combat === "duel" || place.combat === "pk" || place.combat === "pve";
  for (const c of people) {
    names.set(c.id, shortName(c));
    const row = el("div", { class: "item" });
    const label = shortName(c) + " · " + tx("tier" + c.tier) + " " + tx("stage" + c.stage);
    row.appendChild(el("span", { text: label }));
    const actions = el("span", { class: "row" });
    const actionable = c.life === "alive" && (c.state === "active" || c.state === "draft");
    if (canFight && actionable && (place.combat !== "pve" || c.kind === "npc")) {
      actions.appendChild(btn(UI.attack, () => act("attack", { target: c.id }), "danger"));
    }
    if (c.tier > me.tier && actionable) {
      actions.appendChild(btn(UI.learn, () => learnFrom(c.id), "ghost"));
    }
    row.appendChild(actions);
    list.appendChild(row);
    if (c.kind === "npc" && c.archetype === "merchant" && c.life === "alive" && c.state === "active") {
      const goods = el("div", { class: "stack hidden" });
      actions.appendChild(btn(UI.buy, async () => {
        const response = await fetch("/v1/shops/" + encodeURIComponent(c.id));
        const shop = await response.json();
        if (!response.ok) {
          const error = new Error("shop");
          error.envelope = shop;
          throw error;
        }
        clear(goods);
        goods.classList.remove("hidden");
        goods.appendChild(el("p", { class: "small", text: UI.stock }));
        if (shop.items.length === 0) empty(goods);
        // Same definition at the same price is one line; buying still takes one instance.
        const groups = [];
        for (const offer of shop.items) {
          const group = groups.find((g) => g.def === offer.item.def_id && g.price === offer.price);
          if (group) group.offers.push(offer);
          else groups.push({ def: offer.item.def_id, price: offer.price, offers: [offer] });
        }
        for (const group of groups) {
          const offer = group.offers[0];
          const count = group.offers.length > 1 ? " ×" + group.offers.length : "";
          const item = el("div", { class: "item" });
          item.appendChild(el("span", { text: itemName(offer.item) + count + " · " + coinWord() + " " + offer.price }));
          item.appendChild(btn(UI.buy, () => act("use", { op: "buy", item: offer.item.id, npc: c.id })));
          goods.appendChild(item);
        }
      }));
      list.appendChild(goods);
    }
  }
  card.appendChild(list);
  return card;
}

function groundCard(items) {
  const card = el("section", { class: "card" });
  card.appendChild(el("h3", { text: UI.things }));
  const list = el("div", { class: "list" });
  if (items.length === 0) empty(list);
  for (const it of items) {
    const row = el("div", { class: "item" });
    row.appendChild(el("span", { text: itemName(it) }));
    if (it.state === "available") row.appendChild(btn(UI.take, () => act("take", { item: it.id })));
    list.appendChild(row);
  }
  card.appendChild(list);
  return card;
}

const WEAR = ["blade", "blunt", "ranged", "staff", "light_armor", "heavy_armor", "robe", "ring", "charm"];
function itemKindOf(inst) {
  const def = defs.get(inst.def_id);
  return def ? def.kind : null;
}

function bagCard(items, people) {
  const services = people.filter((c) => c.kind === "npc" && c.life === "alive" && c.state === "active");
  const merchant = services.find((c) => c.archetype === "merchant");
  const repairer = services.find((c) => c.archetype === "repairer");
  const card = el("section", { class: "card" });
  card.appendChild(el("h3", { text: UI.bag }));
  const list = el("div", { class: "list" });
  if (items.length === 0) empty(list);
  for (const it of items) {
    if (it.state === "consumed") continue;
    const kind = itemKindOf(it);
    const row = el("div", { class: "item" });
    const name = itemName(it) + (it.equipped ? " · " + UI.equipped : "");
    row.appendChild(el("span", { text: name }));
    const actions = el("span", { class: "row" });
    if (it.equipped) actions.appendChild(btn(UI.unequip, () => act("use", { op: "unequip", item: it.id }), "ghost"));
    else if (kind && WEAR.includes(kind)) actions.appendChild(btn(UI.equip, () => act("use", { op: "equip", item: it.id })));
    const def = defs.get(it.def_id);
    if (!it.equipped && def && ["restore", "learn", "map"].includes(def.effect.kind)) {
      actions.appendChild(btn(UI.use, () => act("use", { op: "consume", item: it.id })));
    }
    if (it.state === "available" && !it.equipped && merchant) {
      actions.appendChild(btn(UI.sell, () => act("use", { op: "sell", item: it.id, npc: merchant.id }), "ghost"));
    }
    if (it.state === "available" && def && WEAR.includes(kind) && def.dura_max > 0 && it.dura < def.dura_max && repairer) {
      actions.appendChild(btn(UI.repair, () => act("use", { op: "repair", item: it.id, npc: repairer.id }), "ghost"));
    }
    row.appendChild(actions);
    list.appendChild(row);
  }
  card.appendChild(list);
  return card;
}

function taskConditionLine(condition) {
  const c = condition || {};
  const count = Number.isFinite(c.count) ? c.count : 1;
  if (c.tpl === "reach" && c.mode === "place") return zh ? "抵达 " + placeIdName(c.place) : "Reach " + placeIdName(c.place);
  if (c.tpl === "reach" && c.mode === "tier") {
    const tier = translated("tier" + c.tier, zh ? "指定境界" : "the required tier");
    const stage = translated("stage" + c.stage, zh ? "指定阶段" : "the required stage");
    return zh ? "达到 " + tier + " " + stage : "Reach " + tier + " " + stage;
  }
  if (c.tpl === "find") {
    const target = places.has(c.target) ? placeIdName(c.target) : defs.has(c.target) ? itemDefName(c.target) : personIdName(c.target);
    return zh ? "寻找 " + target : "Find " + target;
  }
  if (c.tpl === "slay") {
    const target = c.archetype ? translated("npc." + c.archetype, zh ? "敌人" : "enemies") : personIdName(c.target);
    return zh ? "诛除 " + count + " 只 " + target : "Defeat " + count + " " + target;
  }
  if (c.tpl === "deliver" || c.tpl === "gather") {
    const item = itemDefName(c.item_def);
    const destination = placeIdName(c.to_place);
    if (zh) return (c.tpl === "gather" ? "收集 " : "送 ") + count + " 份 " + item + " 到 " + destination;
    return (c.tpl === "gather" ? "Gather " : "Deliver ") + count + " " + item + " to " + destination;
  }
  return UI.taskNeed;
}

function taskCard(title, rows, mode) {
  const card = el("section", { class: "card" });
  card.appendChild(el("h3", { text: title }));
  const list = el("div", { class: "list" });
  if (rows.length === 0) empty(list);
  for (const task of rows) {
    const row = el("div", { class: "item" });
    const condition = task.condition || {};
    const turnInPlace = condition.tpl === "deliver" || condition.tpl === "gather" ? condition.to_place : task.offer_place;
    const elsewhere = mode === "open" && task.offer_place !== me?.loc;
    const text = taskConditionLine(condition) + (zh ? " · 回" + placeIdName(turnInPlace) + "交" : " · Turn in at " + placeIdName(turnInPlace)) +
      (elsewhere ? (zh ? " · 在" + placeIdName(task.offer_place) + "接" : " · Accept at " + placeIdName(task.offer_place)) : "") +
      (task.reward ? " · " + UI.reward + " " + task.reward.coin + (zh ? " 币" : " coin") : "");
    const block = el("div");
    block.appendChild(el("span", { text }));
    block.appendChild(taskDetail(task));
    row.appendChild(block);
    if (mode === "open") {
      const accept = btn(UI.accept, () => act("task", { op: "accept", id: task.id }));
      accept.disabled = elsewhere;
      row.appendChild(accept);
    } else {
      const actions = el("span", { class: "row" });
      actions.appendChild(btn(UI.submit, () => act("task", { op: "submit", id: task.id })));
      actions.appendChild(btn(UI.abandon, () => act("task", { op: "abandon", id: task.id }), "warn"));
      row.appendChild(actions);
    }
    list.appendChild(row);
  }
  card.appendChild(list);
  return card;
}

function trainCard(view) {
  const card = el("section", { class: "card" });
  card.appendChild(el("h3", { text: UI.train }));
  const list = el("div", { class: "list" });
  const learned = view.skills || [];
  if (learned.length === 0) empty(list);
  for (const s of learned) {
    const def = skillOf(s);
    const row = el("div", { class: "item" });
    const name = skillName(def) + " · " + UI.level + " " + s.level + "/" + s.cap;
    row.appendChild(el("span", { text: name }));
    if (skillDefs.has(s.def_id)) {
      const on = view.char.train_skill === def.key;
      row.appendChild(btn(on ? UI.stop : UI.start, () => act("train", on ? { mode: "stop" } : { mode: "start", skill: def.key }), on ? "warn" : ""));
    }
    list.appendChild(row);
  }
  const breaks = el("div", { class: "row" });
  breaks.appendChild(btn(UI.breakStage, () => act("breakthrough", { mode: "stage", item: null }), "ghost"));
  breaks.appendChild(btn(UI.breakTier, () => act("breakthrough", { mode: "tier", item: null }), "ghost"));
  breaks.appendChild(btn(UI.breakCycle, () => act("breakthrough", { mode: "cycle", item: null }), "ghost"));
  card.appendChild(list);
  card.appendChild(breaks);
  return card;
}

function learnFrom(masterId) {
  return act("learn", { master: masterId, skill: "strike", payment: "coin" });
}

function sayCard(people) {
  const card = el("section", { class: "card" });
  card.appendChild(el("h3", { text: UI.say }));
  const input = el("textarea", { maxlength: "200", placeholder: UI.sayPh });
  const sel = el("select");
  sel.appendChild(el("option", { value: "", text: UI.place }));
  for (const c of people) {
    if (c.kind === "player" || c.kind === "npc" || c.kind === "official") {
      sel.appendChild(el("option", { value: c.id, text: charName(c) }));
    }
  }
  card.appendChild(input);
  const row = el("div", { class: "row" });
  row.appendChild(el("span", { class: "small", text: UI.to }));
  row.appendChild(sel);
  row.appendChild(btn(UI.sayBtn, async () => {
    const text = input.value.trim();
    if (!text) return;
    const target = sel.value || null;
    await act("say", { text, target });
    input.value = "";
  }));
  card.appendChild(row);
  return card;
}

/** One-line save export (S32): handle + code, stays in this browser only. */
function saveLine() {
  if (zh) return `AI人间存档｜短号 ${me.handle}｜身份码 ${code}（勿外传）｜续玩:把这行交给你的 AI,或在 aihumanworld.org/play 输入`;
  return `AI Human World save | handle ${me.handle} | code ${code} (keep private) | resume: hand this line to your AI, or enter it at aihumanworld.org/play`;
}

async function exportSave() {
  if (!me || !code) return;
  try {
    await navigator.clipboard.writeText(saveLine());
    toast(UI.copied);
  } catch {
    toast(UI.copyFail);
    setDetails({ save: saveLine() });
  }
}

/** Direct message row: say with a target works across places (S32). */
function whisperRow(charId) {
  const wrap = el("div", { class: "stack" });
  const row = el("div", { class: "row" });
  const input = el("input", { type: "text", maxlength: "200", placeholder: UI.whisperPh });
  row.appendChild(input);
  row.appendChild(btn(UI.sayBtn, async () => {
    const text = input.value.trim();
    if (!text) return;
    await act("say", { text, target: charId });
    input.value = "";
  }));
  wrap.appendChild(row);
  return wrap;
}

async function loadOnlineList(list, note) {
  clear(list);
  const res = await fetch("/v1/online");
  if (!res.ok) {
    list.appendChild(el("p", { class: "muted", text: UI.err }));
    return;
  }
  const body = await res.json();
  if (note) note.textContent = UI.onlineShown.replace("{n}", body.total ?? body.count ?? 0).replace("{k}", body.count ?? 0);
  const rows = (body.online || []).filter((o) => o.char_id !== me?.id);
  if (rows.length === 0) {
    empty(list);
    return;
  }
  for (const o of rows) {
    const shown = charName({ handle: o.handle, kind: o.kind, door: o.door, model: o.model });
    names.set(o.char_id, shown);
    const row = el("div", { class: "item stack" });
    const label = `${shown} · ${tx("tier" + o.tier)} ${tx("stage" + o.stage)} · ${UI.skins[o.skin] || o.skin} · ${tx("region." + o.region)}`;
    row.appendChild(el("span", { text: label }));
    row.appendChild(whisperRow(o.char_id));
    list.appendChild(row);
  }
}

/** Lookup by handle (S32): public /v1/who, then whisper / attack when allowed. */
async function showWho(handle, box) {
  clear(box);
  if (!/^[A-Z][0-9]{5,7}$/.test(handle)) {
    box.appendChild(el("p", { class: "muted", text: UI.findHandle }));
    return;
  }
  const res = await fetch("/v1/who/" + handle);
  const body = await res.json();
  if (!res.ok) {
    box.appendChild(el("p", { class: "muted", text: UI.notFoundHandle }));
    return;
  }
  const c = body.char || {};
  const who = { handle: body.handle, kind: body.kind || c.kind, door: c.door, model: c.model };
  const line = [
    charName(who),
    body.online ? UI.onlineNow : UI.offline,
    body.online ? UI.atPlace + " " + placeIdName(body.place_id) : "",
    tx("tier" + c.tier) + " " + tx("stage" + c.stage),
    UI.skins[c.skin] || "",
  ].filter(Boolean).join(" · ");
  box.appendChild(el("p", { class: "small", text: line }));
  if (c.id === me?.id) return;
  const actionable = body.online && (c.state === "active" || c.state === "draft") && c.life === "alive";
  if (actionable) box.appendChild(whisperRow(c.id));
  const canFight = body.online && body.place_id === me?.loc && (hereCombat === "duel" || hereCombat === "pk");
  if (canFight && actionable) box.appendChild(btn(UI.attack, () => act("attack", { target: c.id }), "danger"));
  else box.appendChild(el("p", { class: "muted", text: UI.attackHint }));
}

function onlineCard() {
  const card = el("section", { class: "card" });
  const head = el("div", { class: "row" });
  head.appendChild(el("h3", { text: UI.onlineTitle }));
  const note = el("span", { class: "small", text: "" });
  head.appendChild(note);
  card.appendChild(head);
  const top = el("div", { class: "row" });
  const findIn = el("input", { type: "text", maxlength: "8", placeholder: UI.findHandle });
  const list = el("div", { class: "list" });
  const found = el("div", { class: "stack" });
  top.appendChild(findIn);
  top.appendChild(btn(UI.find, () => showWho(findIn.value.trim(), found)));
  top.appendChild(btn(UI.reshuffle, () => loadOnlineList(list, note), "ghost"));
  card.appendChild(top);
  card.appendChild(list);
  card.appendChild(found);
  loadOnlineList(list, note).catch(showError);
  return card;
}

/** Optional email binding (S32): bind / rebind / unbind while signed in. */
function emailCard() {
  const card = el("section", { class: "card" });
  card.appendChild(el("h3", { text: UI.bindEmail }));
  card.appendChild(el("p", { class: "small", text: me?.email_hash ? UI.bound : UI.unbound }));
  const row = el("div", { class: "row" });
  const input = el("input", { type: "email", maxlength: "254", placeholder: "a@b.com" });
  row.appendChild(input);
  row.appendChild(btn(UI.bindBtn, async () => {
    const v = input.value.trim();
    const out = await call("enter", { mode: "resume", email: v === "" ? null : v });
    toast(out.result.email_bound ? UI.bound : UI.unbound);
    await refreshAll();
  }));
  row.appendChild(btn(UI.unbind, async () => {
    await call("enter", { mode: "resume", email: null });
    toast(UI.unbound);
    await refreshAll();
  }, "ghost"));
  card.appendChild(row);
  return card;
}

function rewardLine(reward) {
  const r = reward || {};
  const parts = [];
  for (const [field, label] of [["xp", UI.xp], ["potential", UI.potential], ["rep", zh ? "声望" : "reputation"], ["coin", UI.coin]]) {
    if (typeof r[field] === "number" && r[field] !== 0) parts.push(label + " +" + r[field]);
  }
  if (Array.isArray(r.items) && r.items.length) parts.push(zh ? "获得物品" : "items received");
  return parts.join(zh ? "，" : ", ");
}

function eventLine(ev, reward) {
  const d = ev.data || {};
  const who = personIdName(d.char_id);
  if (ev.type === "speech") {
    const said = ev.other_speech || (ev.speech_status === "expired" ? UI.speechExpired : "");
    const speaker = personIdName(d.speaker);
    if (d.channel === "direct" && d.target) {
      const to = personIdName(d.target);
      const head = d.speaker === me?.id
        ? (zh ? UI.you + UI.saidTo + to + UI.said : UI.you + " " + UI.saidTo + " " + to)
        : (zh ? speaker + UI.saidTo + UI.you + UI.said : speaker + " " + UI.saidTo + " " + UI.you);
      return said ? head + (zh ? ":" : ": ") + said : head;
    }
    return speaker + (said ? (zh ? ":" : ": ") + said : (zh ? "说了话" : " spoke"));
  }
  if (ev.type === "moved") return zh ? who + "来到" + placeIdName(d.to) : who + " arrived at " + placeIdName(d.to);
  if (ev.type === "discovered") {
    const bonus = rewardLine(reward);
    return (zh ? (d.first ? "首次探得" : "探得") + placeIdName(d.target) : (d.first ? "First discovery: " : "Discovered ") + placeIdName(d.target)) + (bonus ? ": " + bonus : "");
  }
  if (ev.type === "task_changed") {
    const task = tasks.get(d.task_id);
    const objective = task ? taskConditionLine(task.condition) : UI.aTask;
    const words = zh ? { open: "出现差事", accepted: "接下差事", completed: "完成差事", cancelled: "放弃差事", expired: "差事已过期" } :
      { open: "Task available", accepted: "Accepted task", completed: "Completed task", cancelled: "Dropped task", expired: "Task expired" };
    return (words[d.state] || (zh ? "差事有了变化" : "A task changed")) + ": " + objective;
  }
  if (ev.type === "item_changed") {
    const words = zh ? { take: "拿起", give: "交出", equip: "装备", unequip: "卸下", consume: "使用", socket: "镶嵌", unsocket: "取下", repair: "修理", buy: "买入", sell: "卖出", reward: "获得", drop: "放下", escrow: "托管", refund: "取回" } :
      { take: "Took", give: "Gave", equip: "Equipped", unequip: "Unequipped", consume: "Used", socket: "Socketed", unsocket: "Unsocketed", repair: "Repaired", buy: "Bought", sell: "Sold", reward: "Received", drop: "Dropped", escrow: "Held in escrow", refund: "Recovered" };
    return (words[d.reason] || (zh ? "物品有了变化" : "An item changed")) + " " + itemDefName(d.def_id);
  }
  if (ev.type === "identity_state") {
    const words = zh ? { create: "角色已创建", first_system_task: "正式踏入世界", idle: "暂时离开了世界", expired: "身份已过期", resume: "重新进入世界" } :
      { create: "Character created", first_system_task: "Entered the world", idle: "Stepped away from the world", expired: "Identity expired", resume: "Returned to the world" };
    return words[d.reason] || (zh ? "身份状态有了变化" : "Identity status changed");
  }
  if (ev.type === "skill_changed") return (zh ? "功法有了进展: " : "Skill improved: ") + skillKeyName(d.skill) + (typeof d.level === "number" ? " · " + UI.level + " " + d.level : "");
  if (ev.type === "reward_granted") return (zh ? "获得报酬" : "Received a reward") + (rewardLine(d.reward) ? ": " + rewardLine(d.reward) : "");
  if (ev.type === "reputation_changed") return zh ? "声望有了变化" : "Reputation changed";
  if (ev.type === "org_changed") return zh ? "组织有了变化" : "An organization changed";
  if (ev.type === "relation_proposed") return zh ? "有人发出了结交邀约" : "Someone proposed a relationship";
  if (ev.type === "bond_changed") return zh ? "关系有了变化" : "A relationship changed";
  if (ev.type === "wanted_changed") return zh ? "悬赏状态有了变化" : "A wanted status changed";
  if (ev.type === "combat_resolved") return zh ? (d.outcome === "win" ? "战斗获胜" : d.outcome === "lose" ? "战斗失利" : "战斗结束") : (d.outcome === "win" ? "Combat won" : d.outcome === "lose" ? "Combat lost" : "Combat ended");
  if (ev.type === "life_changed") return zh ? (d.to === "dead" ? who + "已故" : who + "复生了") : (d.to === "dead" ? who + " died" : who + " revived");
  if (ev.type === "progressed") return zh ? (d.outcome === "success" ? "突破成功" : "突破未成") : (d.outcome === "success" ? "Advancement succeeded" : "Advancement failed");
  if (ev.type === "built") return (zh ? "建造完成: " : "Built: ") + translated(d.content_key, zh ? "新的事物" : "something new");
  if (ev.type === "tick_yield") return (zh ? "修行有了收获" : "Practice yielded progress") + (rewardLine(d) ? ": " + rewardLine(d) : "");
  if (ev.type === "fact_changed") {
    const change = (d.changes || []).find((c) => c.table === "char" && c.id === me?.id && c.after && Object.hasOwn(c.after, "train_skill"));
    if (change) return change.after.train_skill ? (zh ? "开始修炼" : "Started practicing ") + skillKeyName(change.after.train_skill) : (zh ? "停止修炼" : "Stopped practicing");
    return zh ? "世界发生了变化" : "The world changed";
  }
  return zh ? "发生了一件事" : "Something happened";
}

const EVENT_WORDS = zh ? {
  speech: "说话", moved: "移动", discovered: "探得地点", task_changed: "差事变化",
  item_changed: "物品变化", identity_state: "身份变化", skill_changed: "功法进展",
  reward_granted: "获得报酬", reputation_changed: "声望变化", org_changed: "组织变化",
  relation_proposed: "结交邀约", bond_changed: "关系变化", wanted_changed: "悬赏变化",
  combat_resolved: "战斗", life_changed: "生死变化", progressed: "突破", built: "建造",
  tick_yield: "修行收获", fact_changed: "世界变化",
} : {
  speech: "Speech", moved: "Movement", discovered: "Discovery", task_changed: "Task change",
  item_changed: "Item change", identity_state: "Identity change", skill_changed: "Skill progress",
  reward_granted: "Reward", reputation_changed: "Reputation change", org_changed: "Organization change",
  relation_proposed: "A proposal", bond_changed: "Relationship change", wanted_changed: "Wanted change",
  combat_resolved: "Combat", life_changed: "Life change", progressed: "Advancement", built: "Building",
  tick_yield: "Practice yield", fact_changed: "World change",
};

function eventFacts(ev) {
  const d = ev.data || {};
  const ids = [d.char_id, d.speaker, d.attacker].filter((id) => typeof id === "string");
  const toward = [d.target, d.to_char].filter((id) => typeof id === "string");
  if (d.channel === "direct" && typeof d.target === "string") toward.push(d.target);
  const where = d.place_id || d.to || (ev.scope === "place" ? me?.loc : null);
  return {
    what: EVENT_WORDS[ev.type] || ev.type,
    who: [...new Set(ids)].map(personIdName).join(zh ? "、" : ", "),
    toward: [...new Set(toward)].map(personIdName).join(zh ? "、" : ", "),
    where: typeof where === "string" ? placeIdName(where) : "",
    tick: typeof ev.tick === "string" ? ev.tick : "",
  };
}

function readableBlock(pairs) {
  const box = el("div", { class: "stack" });
  for (const [label, value] of pairs) {
    if (!value) continue;
    box.appendChild(el("p", { class: "small", text: label + (zh ? ":" : ": ") + value }));
  }
  return box;
}

function rawFold(value) {
  const raw = el("details", { class: "raw" });
  raw.appendChild(el("summary", { text: UI.raw }));
  raw.appendChild(el("pre", { text: JSON.stringify(value, null, 2) }));
  return raw;
}

function eventDetail(ev) {
  const f = eventFacts(ev);
  const details = el("details", { class: "raw" });
  details.appendChild(el("summary", { text: UI.detail }));
  details.appendChild(readableBlock([
    [UI.evWhat, f.what], [UI.evWho, f.who], [UI.evTo, f.toward], [UI.evWhere, f.where], [UI.evTick, f.tick],
  ]));
  details.appendChild(rawFold(ev));
  return details;
}

function taskDetail(task) {
  const details = el("details", { class: "raw" });
  details.appendChild(el("summary", { text: UI.detail }));
  details.appendChild(readableBlock([
    [UI.evWhat, taskConditionLine(task.condition)],
    [UI.evWhere, placeIdName(task.offer_place)],
    [UI.reward, task.reward ? task.reward.coin + (zh ? " 币" : " coin") : ""],
  ]));
  details.appendChild(rawFold(task));
  return details;
}

async function pullEvents(reset) {
  if (!me || !code) return;
  let changed = false;
  if (reset || !cursors.place || cursors.place.place_id !== me.loc) {
    cursors.place = { place_id: me.loc, after: "0" };
    const kept = recentEvents.filter((ev) => ev.scope !== "place");
    changed = kept.length !== recentEvents.length;
    recentEvents = kept;
  }
  const box = $("events");
  const scopes = ["place", "self", "world"];
  const lines = [];
  for (const scope of scopes) {
    try {
      for (let i = 0; i < 8; i += 1) {
        const out = await call("events", { scope, cursors, limit: PAGE_LIMIT });
        cursors = out.result.cursors;
        lines.push(...out.result.events);
        if (!out.result.has_more) break;
      }
    } catch (err) {
      const env = err && err.envelope;
      if (env && env.error && env.error.code === "CURSOR_CONTEXT") {
        me.loc = env.error.details.place_id;
        cursors.place = { place_id: me.loc, after: env.error.details.resume_cursor };
      } else if (env && env.error && env.error.code === "CURSOR_EXPIRED") {
        const d = env.error.details;
        if (d.scope === "place") cursors.place = { place_id: me.loc, after: d.resume_cursor };
        else cursors[d.scope] = d.resume_cursor;
      } else {
        showError(err);
        if (err && err.invalidIdentity) return;
      }
    }
  }
  const known = new Set(recentEvents.map((ev) => ev.id));
  if (lines.some((ev) => !known.has(ev.id))) changed = true;
  if (!changed && box.childNodes.length) return;
  lines.push(...recentEvents);
  lines.sort((a, b) => (BigInt(a.cursor) < BigInt(b.cursor) ? 1 : BigInt(a.cursor) > BigInt(b.cursor) ? -1 : 0));
  const seen = new Set();
  recentEvents = lines.filter((ev) => {
    if (seen.has(ev.id)) return false;
    seen.add(ev.id);
    return true;
  }).slice(0, 60);
  const discoveries = recentEvents.filter((ev) => ev.type === "discovered" && ev.data?.first && ev.deed_id && typeof ev.tick === "string");
  const rewards = new Map();
  const mergedRewards = new Set();
  for (const reward of recentEvents) {
    if (reward.type !== "reward_granted" || !reward.deed_id || reward.data?.source !== reward.deed_id) continue;
    const discovery = discoveries.find((ev) => ev.deed_id === reward.deed_id && ev.tick === reward.tick && ev.data.char_id === reward.data.char_id);
    if (discovery) {
      rewards.set(discovery.id, reward.data.reward);
      mergedRewards.add(reward.id);
    }
  }
  const displayed = new Set();
  clear(box);
  for (const ev of recentEvents) {
    if (mergedRewards.has(ev.id)) continue;
    const duplicateKey = ev.type === "moved" ? "moved:" + ev.deed_id : ev.type === "discovered" ? "discovered:" + ev.data.char_id + ":" + ev.data.target : null;
    if (duplicateKey && displayed.has(duplicateKey)) continue;
    if (duplicateKey) displayed.add(duplicateKey);
    const row = el("div", { class: "item" });
    row.appendChild(el("span", { text: eventLine(ev, rewards.get(ev.id)) }));
    row.appendChild(eventDetail(ev));
    box.appendChild(row);
    if (box.childNodes.length >= 12) break;
  }
  if (box.childNodes.length === 0) empty(box);
}

async function act(verb, args) {
  const out = await call(verb, args);
  setDetails(out);
  await refreshAll();
  const note = (verb === "attack" || verb === "use" || verb === "breakthrough") ? out.result.outcome : "";
  if (note === "success" || note === "win") toast(zh ? "成了" : "Done");
  else if (note === "failure" || note === "lose") toast(zh ? "没成" : "Not this time");
}

function leave() {
  localStorage.removeItem(KEY);
  code = null;
  me = null;
  lex = new Map();
  defs = new Map();
  skillDefs = new Map();
  places = new Map();
  tasks = new Map();
  names = new Map();
  definitionsLoaded = false;
  recentEvents = [];
  lastRaw = "";
  $("last-raw").textContent = "";
  clear($("world-head"));
  clear($("world-view"));
  clear($("events"));
  clear(reveal);
  cursors = { self: "0", place: null, world: "0" };
  if (poll) {
    clearInterval(poll);
    poll = null;
  }
  renderGate();
}

async function main() {
  document.title = UI.title;
  renderGate();
  const saved = localStorage.getItem(KEY);
  if (saved) await resumeChar(saved);
}

main().catch(showError);
