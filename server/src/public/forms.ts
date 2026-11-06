// One minimal HTML form per action (产品文档 第八节 3). The identity code is a
// form field, posted in the body, never placed in the URL. A verb with several
// branches gets one form per branch, because a discriminator plus the other
// branch's fields would be rejected as unknown (动词表 §1). Only actions whose
// arguments are flat scalars are offered here — nested objects (events cursors,
// task paging, bounty condition, build, the give asset) stay on the JSON route.

import { CLASSES, DIRECTIONS, SKILL_BASES, SKINS, VERBS, type Verb } from "../facts/enums.ts";

export interface FormField {
  name: string;
  /** Shown next to the input; a neutral key, not a translated label. */
  label: string;
  kind: "text" | "select";
  options?: readonly string[];
  /** Blank value is dropped before dispatch (optional arguments). */
  optional?: boolean;
}

export interface WebForm {
  /** URL slug, unique. */
  slug: string;
  verb: Verb;
  title: string;
  /** Fixed discriminator fields, not shown as inputs. */
  fixed: Readonly<Record<string, string>>;
  fields: readonly FormField[];
  needsCode: boolean;
}

const CODE: FormField = { name: "code", label: "identity code (posted in the form, never in the URL)", kind: "text" };
const ITEM: FormField = { name: "item", label: "item id", kind: "text" };
const CHAR: FormField = { name: "target", label: "char id", kind: "text" };
const DIR: FormField = { name: "dir", label: "dir", kind: "select", options: DIRECTIONS };
const SKILL: FormField = { name: "skill", label: "skill", kind: "select", options: SKILL_BASES };

function form(
  slug: string,
  verb: Verb,
  title: string,
  fields: readonly FormField[],
  fixed: Readonly<Record<string, string>> = {},
  needsCode = true,
): WebForm {
  return { slug, verb, title, fixed, fields: needsCode ? [CODE, ...fields] : fields, needsCode };
}

const USE_FLAT: readonly [string, readonly FormField[]][] = [
  ["consume", [ITEM]],
  ["equip", [ITEM]],
  ["unequip", [ITEM]],
  ["buy", [ITEM, { name: "npc", label: "merchant char id (stock: GET /v1/shops/{npc})", kind: "text" }]],
  ["sell", [ITEM, { name: "npc", label: "merchant char id", kind: "text" }]],
  ["repair", [ITEM, { name: "npc", label: "repairer char id", kind: "text" }]],
  ["unlock", [ITEM, DIR]],
  ["unsocket", [ITEM, { name: "index", label: "socket index", kind: "text" }]],
  ["org_join", [{ name: "org", label: "org id", kind: "text" }]],
  ["org_leave", []],
  ["relation_end", [{ name: "bond", label: "bond id", kind: "text" }]],
  ["relation_accept", [{ name: "offer", label: "offer deed id", kind: "text" }]],
];

export const WEB_FORMS: readonly WebForm[] = [
  form("enter-create", "enter", "enter create", [
    { name: "skin", label: "skin", kind: "select", options: SKINS },
    { name: "class", label: "class (fantasy only, else leave empty)", kind: "select", options: ["", ...CLASSES], optional: true },
    { name: "model", label: "model (self-reported, optional)", kind: "text", optional: true },
  ], { mode: "create", door: "web" }, false),
  form("enter-resume", "enter", "enter resume", [
    { name: "skin", label: "skin (optional)", kind: "select", options: ["", ...SKINS], optional: true },
    { name: "model", label: "model (optional)", kind: "text", optional: true },
  ], { mode: "resume" }),
  form("look", "look", "look", [
    { name: "section", label: "section", kind: "select", options: ["place", "people", "items", "tasks", "deeds"] },
  ]),
  form("whoami", "whoami", "whoami", [
    { name: "section", label: "section", kind: "select", options: ["char", "items", "skills", "bonds", "tasks", "reputation", "wanted"] },
  ]),
  form("go", "go", "go", [DIR]),
  form("say", "say", "say", [
    { name: "text", label: "text", kind: "text" },
    { name: "target", label: "target char id (empty = this place)", kind: "text", optional: true },
  ]),
  form("take", "take", "take", [ITEM]),
  form("give-item", "give", "give item", [CHAR, { name: "asset.item", label: "item id", kind: "text" }], { "asset.kind": "item" }),
  form("attack", "attack", "attack", [CHAR]),
  form("train-start", "train", "train start", [SKILL], { mode: "start" }),
  form("train-stop", "train", "train stop", [], { mode: "stop" }),
  form("learn", "learn", "learn", [
    { name: "master", label: "master char id", kind: "text" },
    SKILL,
    { name: "payment", label: "payment", kind: "select", options: ["bond", "coin"] },
  ]),
  form("task-list", "task", "task list", [], { op: "list" }),
  form("task-accept", "task", "task accept", [{ name: "id", label: "task id", kind: "text" }], { op: "accept" }),
  form("task-submit", "task", "task submit", [{ name: "id", label: "task id", kind: "text" }], { op: "submit" }),
  form("task-abandon", "task", "task abandon", [{ name: "id", label: "task id", kind: "text" }], { op: "abandon" }),
  form("breakthrough", "breakthrough", "breakthrough", [
    { name: "mode", label: "mode", kind: "select", options: ["stage", "tier", "cycle"] },
    { name: "item", label: "assist item id (optional)", kind: "text", optional: true },
  ]),
  ...USE_FLAT.map(([op, fields]) => form(`use-${op}`, "use", `use ${op}`, fields, { op })),
];

const BY_SLUG = new Map<string, WebForm>(WEB_FORMS.map((f) => [f.slug, f]));

export function formBySlug(slug: string): WebForm | null {
  return BY_SLUG.get(slug) ?? null;
}

export function isVerbName(verb: string): verb is Verb {
  return (VERBS as readonly string[]).includes(verb);
}

export function formsOf(verb: Verb): readonly WebForm[] {
  return WEB_FORMS.filter((f) => f.verb === verb);
}

const INT_FIELDS = new Set(["index"]);

/**
 * Posted fields → the `{"args":…}` body dispatch expects.
 * `code` is the bearer, never an argument. Blank optional fields are omitted;
 * the literal `null` selects an explicit null. Dotted fixed keys
 * (`asset.kind`) build the one nested object the give verb needs.
 */
export function argsFromPost(spec: WebForm, posted: ReadonlyMap<string, string>): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const put = (key: string, value: unknown): void => {
    const dot = key.indexOf(".");
    if (dot < 0) {
      args[key] = value;
      return;
    }
    const parent = key.slice(0, dot);
    const child = key.slice(dot + 1);
    const obj = (args[parent] ?? {}) as Record<string, unknown>;
    obj[child] = value;
    args[parent] = obj;
  };
  for (const [key, value] of Object.entries(spec.fixed)) put(key, value);
  for (const f of spec.fields) {
    if (f.name === "code") continue;
    const raw = posted.get(f.name) ?? "";
    if (raw === "" && f.optional === true) continue;
    if (raw === "null") {
      put(f.name, null);
      continue;
    }
    put(f.name, INT_FIELDS.has(f.name) && /^[0-9]+$/.test(raw) ? Number(raw) : raw);
  }
  return args;
}
