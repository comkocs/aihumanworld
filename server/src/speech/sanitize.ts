// [S12 owns this file after S9] The single sanitiser for other players' words
// and self-reported labels (事实格式 §13). Every verb that delivers or stores such
// text must call this module; none may roll its own.
//
// Strips, and only strips:
//   - code: fenced blocks (unclosed fences run to the end), indented blocks,
//     inline code spans (an unclosed run of 3+ backticks runs to the end; an
//     unclosed run of 1-2 stays literal, as in Markdown);
//   - real URLs: scheme URLs (http://, ftp://, ...), mailto: / javascript: /
//     tel: / sms: / magnet: / data: URIs, Markdown links and images (the label
//     stays, the destination goes), autolinks, www. hosts, scheme-less domains
//     (a registered TLD, case-insensitive), e-mail addresses, bare
//     IPv4 addresses, localhost with port or path;
//   - invisible characters that would hide a URL or code fence from the above
//     (zero-width space / word joiner / BOM / soft hyphen, bidi overrides), and
//     control characters other than tab and newline.
// Ordinary dotted words and numbers survive: 3.5, e.g., i.e., U.S., v1.2.3,
// Node.js, Mr.Smith and 12:30. File names
// whose extension is also a ccTLD (README.md, main.rs, run.sh, tool.py) are kept
// unless followed by a path. Nothing is executed, moderated or rewritten otherwise.
// Not covered on purpose: obfuscated spellings (hxxp, "example dot com", [.]),
// full-width look-alikes, bare IPv6, bare non-ASCII domains (http://例子.中国 loses
// only its scheme part); the receiving agent reads other_speech as hearsay anyway.

// ---------- normalisation ----------

function normalize(s: string): string {
  return s
    .replace(/\r\n?|[\u0085\u2028\u2029]/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
    .replace(/[\u00AD\u180E\u200B\u2060\uFEFF\u202A-\u202E\u2066-\u2069]/g, "");
}

// ---------- code ----------

const FENCE_OPEN = /^ {0,3}(?:> ?)*(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(?:> ?)*(`{3,}|~{3,})[ \t]*$/;

/** Fenced blocks (to the end when unclosed) and indented blocks after a blank line / at the start. */
function stripBlocks(text: string): string {
  const out: string[] = [];
  let fence: { ch: string; len: number } | null = null;
  let prevBlank = true;
  for (const line of text.split("\n")) {
    if (fence !== null) {
      const c = FENCE_CLOSE.exec(line);
      const run = c?.[1];
      if (run !== undefined && run[0] === fence.ch && run.length >= fence.len) {
        fence = null;
        prevBlank = true;
      }
      continue;
    }
    const o = FENCE_OPEN.exec(line);
    const run = o?.[1];
    if (run !== undefined && (run[0] === "~" || !(o?.[2] ?? "").includes("`"))) {
      fence = { ch: run[0] as string, len: run.length };
      continue;
    }
    const content = line.replace(/^(?: {0,3}>[ \t]?)+/, "");
    if (prevBlank && /^(?: {4}|\t)/.test(content) && content.trim() !== "") continue;
    out.push(line);
    prevBlank = content.trim() === "";
  }
  return out.join("\n");
}

/** Closed spans are dropped with their backticks; an unclosed run of 3+ drops the rest of the text. */
function stripInlineCode(text: string): string {
  const parts = text.split(/(\n[ \t]*\n)/);
  let out = "";
  for (const part of parts) {
    if (/^\n[ \t]*\n$/.test(part)) {
      out += part;
      continue;
    }
    const r = stripSpans(part);
    out += r.text;
    if (r.toEnd) break;
  }
  return out;
}

function stripSpans(text: string): { text: string; toEnd: boolean } {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("`", i);
    if (open < 0) return { text: out + text.slice(i), toEnd: false };
    let k = open;
    while (text[k] === "`") k += 1;
    const n = k - open;
    let close = -1;
    let after = k;
    for (let p = k; ; ) {
      const a = text.indexOf("`", p);
      if (a < 0) break;
      let b = a;
      while (text[b] === "`") b += 1;
      if (b - a === n) {
        close = a;
        after = b;
        break;
      }
      p = b;
    }
    if (close >= 0) {
      out += text.slice(i, open);
      i = after;
    } else if (n >= 3) {
      return { text: out + text.slice(i, open), toEnd: true };
    } else {
      out += text.slice(i, k);
      i = k;
    }
  }
  return { text: out, toEnd: false };
}

// ---------- URLs ----------

const GTLD =
  "com net org edu gov mil int info biz name pro mobi asia travel jobs museum aero coop xxx dev page blog shop store site online tech cloud club live xyz top vip icu fun link click work world today life space website press news wiki art design studio agency team tools zone network systems solutions digital media email group company ltd inc llc city center academy download stream buzz cyou rest best example invalid onion localhost";
const CCTLD =
  "ac ad ae af ag ai al am ao aq ar as at au aw ax az ba bb bd be bf bg bh bi bj bm bn bo br bs bt bw by bz ca cd cf cg ch ci ck cl cm cn co cr cu cv cw cx cy cz de dj dk dm do dz ec ee eg er es et eu fi fj fk fm fo fr ga gd ge gf gg gh gi gl gm gn gp gq gr gs gt gu gw gy hk hm hn hr ht hu id ie il im in io iq ir is it je jm jo jp ke kg kh ki km kn kp kr kw ky kz la lb lc li lk lr ls lt lu lv ly ma mc me mg mh mk ml mm mn mo mp mq mr ms mt mu mv mw mx my mz na nc ne nf ng ni nl no np nr nu nz om pa pe pf pg ph pk pm pn pr ps pt pw qa re ro ru rw sa sb sc sd se sg si sk sl sm sn sr ss st su sv sx sy sz tc td tf tg th tj tk tl tm tn to tr tt tv tw tz ua ug uk us uy uz va vc ve vg vi vn vu wf ws ye yt za zm zw";
/** Also file extensions: counted as a domain only when a path follows. */
const WEAK_TLD = "md sh py rs pl cc so app";
const IDN_TLD = "中国 中國 公司 网络 网址 网站 在线 香港 台湾 台灣 新加坡 рф";

/** Match registered TLDs in any mixture of upper- and lowercase letters. */
function alt(words: string): string {
  const list = words.split(" ");
  return `(?:${list.map((word) => [...word].map((ch) => ch.toLowerCase() === ch.toUpperCase() ? ch : `[${ch.toLowerCase()}${ch.toUpperCase()}]`).join("")).join("|")})`;
}

const LABEL = "[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?";
const URLCH = "[\\w\\-.~:/?#\\[\\]@!$&'()*+,;=%]";
const AFTER_TLD = "(?![A-Za-z0-9_-]|\\.[A-Za-z0-9])";
const HOST = `(?:${LABEL}\\.){1,12}(?:${alt(`${GTLD} ${CCTLD} ${IDN_TLD}`)}|[xX][nN]--[A-Za-z0-9-]{2,59})`;
const HOST_WEAK = `(?:${LABEL}\\.){1,12}${alt(WEAK_TLD)}`;
const NOT_WORD_BEFORE = "(?<![A-Za-z0-9_-])";

const MD_LINK =
  /!?\[([^[\]\n]{0,300})\]\(\s*(?:<[^<>\n]{0,2000}>|(?:[^()\s]|\([^()\s]{0,500}\)){0,2000})(?:\s+(?:"[^"\n]{0,300}"|'[^'\n]{0,300}'|\([^()\n]{0,300}\)))?\s*\)/g;
const AUTOLINK = new RegExp(
  `<(?:[A-Za-z][A-Za-z0-9+.-]{0,31}://[^<>\\s]*|(?:mailto|tel|sms|javascript|vbscript|data|file|magnet|urn|geo):[^<>\\s]*|www\\d{0,3}\\.[^<>\\s]*|[^<>\\s@]{1,64}@[^<>\\s@]{1,255}\\.[A-Za-z]{2,}|${HOST}${AFTER_TLD}(?:[/?#][^<>\\s]*)?)>`,
  "g",
);
const SCHEME_URL = new RegExp(`\\b[A-Za-z][A-Za-z0-9+.-]{0,31}://${URLCH}*`, "g");
const OTHER_URI = new RegExp(`\\b(?:mailto|tel|sms|javascript|vbscript|magnet):${URLCH}+|\\bdata:(?:[\\w.+-]+/[\\w.+-]+)?[;,]${URLCH}*`, "gi");
const WWW = new RegExp(`\\bwww\\d{0,3}\\.[A-Za-z0-9-]{1,63}(?:\\.[A-Za-z0-9-]{1,63}){0,10}(?::\\d{1,5})?(?:[/?#]${URLCH}*)?`, "gi");
const BARE = new RegExp(
  `${NOT_WORD_BEFORE}(?://)?(?:[\\w.%+-]{1,64}@)?${HOST}${AFTER_TLD}(?::\\d{1,5})?(?:[/?#]${URLCH}*)?`,
  "g",
);
const BARE_WEAK = new RegExp(`${NOT_WORD_BEFORE}${HOST_WEAK}${AFTER_TLD}[/?#]${URLCH}+`, "g");
const IPV4 = new RegExp(
  `(?<![\\w.])(?:(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)(?!\\w|\\.\\d)(?::\\d{1,5})?(?:[/?#]${URLCH}*)?`,
  "g",
);
const LOCALHOST = new RegExp(`\\blocalhost(?::\\d{1,5}(?:[/?#]${URLCH}*)?|[/?#]${URLCH}+)`, "gi");

/** A match swallows trailing sentence punctuation / unbalanced closers; give those back. */
function cut(m: string): string {
  let round = 0;
  let square = 0;
  for (const c of m) {
    if (c === "(") round += 1;
    else if (c === ")") round -= 1;
    else if (c === "[") square += 1;
    else if (c === "]") square -= 1;
  }
  let end = m.length;
  for (;;) {
    const c = m[end - 1];
    if (c === undefined) break;
    if (".,;:!?'*".includes(c)) {
      end -= 1;
    } else if (c === ")" && round < 0) {
      round += 1;
      end -= 1;
    } else if (c === "]" && square < 0) {
      square += 1;
      end -= 1;
    } else {
      break;
    }
  }
  return m.slice(end);
}

function stripUrls(text: string): string {
  return text
    .replace(MD_LINK, "$1")
    .replace(AUTOLINK, "")
    .replace(SCHEME_URL, cut)
    .replace(OTHER_URI, cut)
    .replace(WWW, cut)
    .replace(BARE, cut)
    .replace(BARE_WEAK, cut)
    .replace(IPV4, cut)
    .replace(LOCALHOST, cut);
}

// ---------- entry points ----------

function pass(text: string): string {
  return stripUrls(stripInlineCode(stripBlocks(text)));
}

/**
 * Sanitised text for other_speech. An empty result is still a valid utterance.
 * Runs to a fixed point (at most three rounds) so that stripping one piece
 * cannot splice the neighbours into a new URL or fence.
 */
export function sanitizeText(input: string): string {
  let t = normalize(input);
  for (let i = 0; i < 3; i += 1) {
    const next = pass(t);
    if (next === t) break;
    t = next;
  }
  return t.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
}

/** Short display label (char.model): sanitised, single-line, ≤ maxChars code points; empty → null. */
export function sanitizeLabel(input: string | null, maxChars: number): string | null {
  if (input === null) return null;
  // A label never needs more than a few times its length of raw input; the cap keeps hostile input cheap.
  const raw = [...input].slice(0, Math.max(1024, maxChars * 8)).join("");
  const one = sanitizeText(raw).replace(/\s+/g, " ").trim();
  const cut = [...one].slice(0, maxChars).join("");
  return cut === "" ? null : cut;
}
