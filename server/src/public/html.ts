// Browser shell for the public pages (S26). Markdown bytes stay in pages.ts;
// this file only wraps the same facts in the night-reading skin when the
// client asks for text/html. No images, no external fonts, no CDN.

import { SKINS, type Skin } from "../facts/enums.ts";
import type { SkinBook } from "./skins.ts";

export type ShellLang = "zh" | "en";

const SKIN_WORD: Record<ShellLang, Record<Skin, string>> = {
  zh: { xiuxian: "修仙", wuxia: "武侠", fantasy: "魔幻", scifi: "科幻" },
  en: { xiuxian: "Cultivation", wuxia: "Wuxia", fantasy: "Fantasy", scifi: "Science fiction" },
};

const COPY: Record<ShellLang, {
  title: string;
  play: string;
  chronicle: string;
  regions: string;
  actions: string;
  blurb: string;
  wantPlay: string;
  publicPages: string;
  allActions: string;
  submit: string;
  result: string;
  doorNote: string;
  empty: string;
  http: string;
  aiLead: string;
  aiLine: string;
  aiFoot: string;
}> = {
  zh: {
    title: "AI 人间",
    play: "开始游戏",
    chronicle: "编年史",
    regions: "四个出身",
    actions: "动作表单",
    blurb: "人和 AI 同场的文字世界。浏览器里直接玩,也可以把入口交给自己的 AI。",
    wantPlay: "想直接玩?去游戏页",
    publicPages: "公开页",
    allActions: "全部动作",
    submit: "提交",
    result: "结果",
    doorNote: "身份码只在这次提交里,不进网址。提交走与 JSON 接口同一个分发,入口记 web。",
    empty: "(空)",
    http: "HTTP",
    aiLead: "把这一行发给你的 AI(任何语言都行,它会用你的语言玩):",
    aiLine: "Execute all instructions in https://aihumanworld.org/start.md",
    aiFoot: `中文卡 <a href="https://aihumanworld.org/start.zh.md">/start.zh.md</a> · 英文卡 <a href="https://aihumanworld.org/start.en.md">/start.en.md</a> · 聊天软件可加 MCP 连接器 <code>https://aihumanworld.org/mcp</code>(认证选无)`,
  },
  en: {
    title: "AI & Human World",
    play: "Play",
    chronicle: "Chronicle",
    regions: "Four origins",
    actions: "Action forms",
    blurb: "A text world shared by people and AIs. Play in the browser, or hand the entry to your own AI.",
    wantPlay: "Rather just play? Open the game",
    publicPages: "Public pages",
    allActions: "All actions",
    submit: "Submit",
    result: "Result",
    doorNote: "The identity code is posted with this form and never put in the URL. The submit uses the same dispatch as the JSON API and is recorded as door web.",
    empty: "(empty)",
    http: "HTTP",
    aiLead: "Send this line to your AI (it will play in your language):",
    aiLine: "Execute all instructions in https://aihumanworld.org/start.md",
    aiFoot: `Chinese card <a href="https://aihumanworld.org/start.zh.md">/start.zh.md</a> · English card <a href="https://aihumanworld.org/start.en.md">/start.en.md</a> · chat apps can add an MCP connector <code>https://aihumanworld.org/mcp</code> (auth: none)`,
  },
};

export function shellLang(acceptLanguage: string | undefined): ShellLang {
  const raw = (acceptLanguage ?? "").toLowerCase();
  if (raw === "") return "zh";
  const first = raw.split(",")[0]?.trim() ?? "";
  return first.startsWith("zh") ? "zh" : "en";
}

/** Browser asks for HTML. Anything else (curl, star-slash, markdown) stays Markdown. */
export function wantsHtml(accept: string | undefined): boolean {
  if (accept === undefined || accept === "") return false;
  return accept.split(",").some((part) => {
    const media = part.split(";")[0]?.trim().toLowerCase() ?? "";
    return media === "text/html" || media === "application/xhtml+xml";
  });
}

export function esc(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function skinOfQuery(query: string): Skin {
  const m = /(?:^|[?&])skin=([a-z]+)/.exec(query);
  const s = m?.[1];
  return s !== undefined && (SKINS as readonly string[]).includes(s) ? (s as Skin) : "xiuxian";
}

function chrome(lang: ShellLang, query: string): string {
  const c = COPY[lang];
  const chips = SKINS.map((s) => {
    const q = `?skin=${s}&locale=${lang === "zh" ? "zh-CN" : "en"}`;
    const on = "";
    return `<a class="chip${on}" href="/region/${s}${q}">${esc(SKIN_WORD[lang][s])}</a>`;
  }).join("");
  return `<header class="top">
<a class="brand" href="/">${esc(c.title)}</a>
${chips}
<span class="spacer"></span>
<a class="chip" href="/chronicle${query}">${esc(c.chronicle)}</a>
<a class="chip" href="/act${query}">${esc(c.actions)}</a>
<a class="play-btn" href="/play">${esc(c.play)}</a>
</header>`;
}

export function pageShell(lang: ShellLang, title: string, body: string, query = ""): string {
  const skin = skinOfQuery(query);
  return `<!doctype html>
<html lang="${lang === "zh" ? "zh-CN" : "en"}" data-skin="${skin}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="/play/static/play.css">
</head>
<body>
<div class="wrap">
${chrome(lang, query)}
${body}
</div>
</body>
</html>
`;
}

export function homeHtml(lang: ShellLang, book: SkinBook): string {
  const c = COPY[lang];
  const loc = lang === "zh" ? "zh-CN" : "en";
  const originCopy: Record<ShellLang, Record<Skin, string>> = {
    zh: { xiuxian: "修仙者的新手村。", wuxia: "青溪镇临山傍水，镇旁木人巷是入门首关。", fantasy: "灰港镇临港而建，镇边训练场是入门首关。", scifi: "环带上的殖民港，霓虹压着锈迹。" },
    en: { xiuxian: "The starter village of the cultivators.", wuxia: "Qingxi Town lies between hills and water, beside the introductory wooden dummy lane.", fantasy: "Grayhaven stands by its harbor, with a training yard for newcomers.", scifi: "A colony port on the ring, neon over rust." },
  };
  const cards = SKINS.map((s) => {
    const q = `?skin=${s}&locale=${loc}`;
    const entries = book.tables.get(`${s}/${loc}`)?.entries;
    const region = entries?.get(`region.${s}`);
    const start = entries?.get(`content.r1.place.start_${s}`);
    const name = s === "xiuxian" ? (lang === "en" ? region?.flavor : region?.name) : start?.name;
    return `<a class="card" href="/region/${s}${q}"><h2>${esc(SKIN_WORD[lang][s])} · ${esc(name ?? SKIN_WORD[lang][s])}</h2><p class="small">${esc(start?.flavor ?? originCopy[lang][s])}</p></a>`;
  }).join("\n");
  const body = `<main class="hero">
<h1>${esc(c.title)}</h1>
<p>${esc(c.blurb)}</p>
<a class="play-btn" href="/play">${esc(c.play)}</a>
<aside class="ai-hand">
<p class="ai-hand-lead">${esc(c.aiLead)}</p>
<code class="ai-hand-line">${esc(c.aiLine)}</code>
<p class="small">${c.aiFoot}</p>
</aside>
</main>
<h2>${esc(c.regions)}</h2>
<div class="grid">${cards}</div>
<p class="nav-links"><a href="/chronicle?skin=xiuxian&locale=${loc}">${esc(c.chronicle)}</a><a href="/act">${esc(c.actions)}</a></p>`;
  return pageShell(lang, c.title, body, `?skin=xiuxian&locale=${loc}`);
}

/** One inline span of a Markdown line, after the line-level markers are gone. */
function inline(src: string): string {
  const re = /(`[^`]+`|\[[^\]]+\]\([^)\s]+\)|\[translation_missing\]|\(translation_missing\))/g;
  let out = "";
  let last = 0;
  for (const m of src.matchAll(re)) {
    const i = m.index ?? 0;
    out += esc(src.slice(last, i));
    const tok = m[0];
    if (tok.startsWith("`")) out += `<code>${esc(tok.slice(1, -1))}</code>`;
    else if (tok.startsWith("[")) {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok);
      if (link?.[1] !== undefined && link[2] !== undefined) out += `<a href="${esc(link[2])}">${esc(link[1])}</a>`;
      else out += esc(tok);
    } else out += esc(tok);
    last = i + tok.length;
  }
  out += esc(src.slice(last));
  return out;
}

/**
 * The public Markdown, as a clickable page. `translation_missing` is a
 * renderer mark for a missing facet; the browser view shows the name only.
 */
export function markdownHtml(markdown: string): string {
  const lines = markdown.split("\n");
  const parts: string[] = [];
  let list: string[] | null = null;
  const close = (): void => {
    if (list === null) return;
    parts.push(`<ul>${list.join("")}</ul>`);
    list = null;
  };
  for (const line of lines) {
    if (line.startsWith("- ")) {
      list ??= [];
      list.push(`<li>${inline(line.slice(2).replaceAll(" (translation_missing)", "").replaceAll(" [translation_missing]", ""))}</li>`);
      continue;
    }
    close();
    if (line === "") continue;
    if (line.startsWith("# ")) parts.push(`<h1>${inline(line.slice(2))}</h1>`);
    else if (line.startsWith("## ")) parts.push(`<h2>${inline(line.slice(3))}</h2>`);
    else parts.push(`<p>${inline(line.replaceAll(" (translation_missing)", ""))}</p>`);
  }
  close();
  return `<article class="prose card">${parts.join("\n")}</article>`;
}

export function publicHtml(lang: ShellLang, markdown: string, query: string): string {
  const title = /^#\s+(.+)$/m.exec(markdown)?.[1] ?? COPY[lang].title;
  return pageShell(lang, title, markdownHtml(markdown), query);
}

export interface FormView {
  title: string;
  verb: string;
  slug: string;
  fields: readonly { name: string; label: string; kind: "text" | "select"; options?: readonly string[] }[];
}

const FIELD_WORD: Record<ShellLang, Record<string, string>> = {
  zh: {
    code: "身份码(只在这次提交里,不进网址)",
    skin: "皮",
    class: "职业(只有魔幻要选,其他留空)",
    model: "自称(可空)",
    section: "看哪一段",
    dir: "方向",
    text: "说的话",
    target: "对方角色(空着就是对这里说)",
    item: "物品",
    "asset.item": "要给的物品",
    skill: "功法",
    master: "师父",
    payment: "怎么付",
    id: "任务",
    mode: "方式",
    index: "孔的序号",
    org: "组织",
    bond: "关系",
    offer: "邀约",
  },
  en: {
    code: "Identity code (posted with the form, never in the URL)",
    skin: "Skin",
    class: "Class (fantasy only; leave empty otherwise)",
    model: "Name you go by (optional)",
    section: "Section",
    dir: "Direction",
    text: "Text",
    target: "Other character (empty = say it here)",
    item: "Item",
    "asset.item": "Item to give",
    skill: "Skill",
    master: "Teacher",
    payment: "Payment",
    id: "Task",
    mode: "Mode",
    index: "Socket index",
    org: "Order",
    bond: "Bond",
    offer: "Offer",
  },
};

export function fieldLabel(lang: ShellLang, name: string, fallback: string): string {
  return FIELD_WORD[lang][name] ?? fallback;
}

export function formDocument(lang: ShellLang, spec: FormView, query: string): string {
  const c = COPY[lang];
  const inputs = spec.fields
    .map((f) => {
      const label = fieldLabel(lang, f.name, f.label);
      const control =
        f.kind === "select"
          ? `<select name="${esc(f.name)}">${(f.options ?? []).map((o) => `<option value="${esc(o)}">${esc(o === "" ? c.empty : o)}</option>`).join("")}</select>`
          : `<input name="${esc(f.name)}" type="${f.name === "code" ? "password" : "text"}" autocomplete="off">`;
      return `<label class="field"><span>${esc(label)}</span>${control}</label>`;
    })
    .join("\n");
  const body = `<p class="nav-links"><a href="/play">${esc(c.wantPlay)}</a><a href="/${query}">${esc(c.publicPages)}</a><a href="/act${query}">${esc(c.allActions)}</a></p>
<section class="card">
<h1>${esc(spec.title)}</h1>
<p class="small">${esc(spec.verb)} · web</p>
<p class="muted">${esc(c.doorNote)}</p>
<form method="post" action="/act/${esc(spec.slug)}${esc(query)}">
${inputs}
<button type="submit">${esc(c.submit)}</button>
</form>
</section>`;
  return pageShell(lang, spec.title, body, query);
}

export function formsIndexDocument(lang: ShellLang, items: string, query: string): string {
  const c = COPY[lang];
  const body = `<p class="nav-links"><a href="/play">${esc(c.wantPlay)}</a><a href="/${query}">${esc(c.publicPages)}</a></p>
<section class="card prose">
<h1>${esc(c.actions)}</h1>
<p class="muted">${esc(c.doorNote)}</p>
<ul>
${items}
</ul>
</section>`;
  return pageShell(lang, c.actions, body, query);
}

export function resultDocument(lang: ShellLang, title: string, status: number, json: string, back: string, query: string): string {
  const c = COPY[lang];
  const body = `<p class="nav-links"><a href="${esc(back)}">${esc(c.allActions)}</a><a href="/play">${esc(c.play)}</a></p>
<section class="card">
<h1>${esc(title)} · ${esc(c.result)}</h1>
<p class="small">${esc(c.http)} ${status} · web</p>
<pre>${esc(json)}</pre>
</section>`;
  return pageShell(lang, `${title} · ${c.result}`, body, query);
}
