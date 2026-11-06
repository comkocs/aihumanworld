// Validators for shared request objects (事实格式 §2.1, §4, §5, §9; 动词表 §2).
// Each is annotated with the fact type so the compiler keeps them in step.

import {
  ARCHETYPES,
  CLASSES,
  COMBATS,
  DANGERS,
  DIRECTIONS,
  DOORS,
  ELEMENTS,
  ITEM_KINDS,
  PLACE_FEATURES,
  PLACE_KINDS,
  REGIONS,
  SKILL_BASES,
  SKINS,
} from "../facts/enums.ts";
import type { Condition, ItemEffect, Modifiers, RewardSpec } from "../facts/types.ts";
import {
  arr,
  bad,
  described,
  id,
  int,
  lit,
  nullable,
  obj,
  oneOf,
  opt,
  posUint,
  refine,
  schemaOf,
  seq,
  stage,
  str,
  tier,
  uint,
  union,
  type V,
} from "./validate.ts";

export const direction = oneOf(DIRECTIONS, "direction");
export const skin = oneOf(SKINS, "skin");
export const region = oneOf(REGIONS, "region");
export const charClass = oneOf(CLASSES, "class");
export const door = oneOf(DOORS, "door");
export const archetype = oneOf(ARCHETYPES, "npc archetype");

const HANDLE_RE = /^[A-Z][0-9]{5,7}$/;
/** Player short id (S32): one uppercase letter + 5..7 digits, e.g. A00002. */
export const handle: V<string> = described(
  (x, p) => (typeof x === "string" && HANDLE_RE.test(x) ? x : bad(p, "handle: uppercase letter + 5..7 digits")),
  { type: "string", pattern: HANDLE_RE.source, description: "player handle" });

const EMAIL_RE = /^[^@\s]+@[^@\s]+$/;
/** Loose address shape only (S32): an email is an identity token, never verified by mail.
 * Surrounding whitespace is fine here — normalization (trim + lower) is the server's job. */
export const email: V<string> = described(
  (x, p) => {
    if (typeof x !== "string") return bad(p, "email address");
    const t = x.trim();
    if (t.length < 3 || t.length > 254 || !EMAIL_RE.test(t)) return bad(p, "email address");
    return x;
  },
  { type: "string", pattern: EMAIL_RE.source, minLength: 3, maxLength: 254, description: "email address" });
export const placeKind = oneOf(PLACE_KINDS, "place kind");
export const placeFeature = oneOf(PLACE_FEATURES, "place feature");
export const danger = oneOf(DANGERS, "danger");
export const combat = oneOf(COMBATS, "combat mode");
export const itemKind = oneOf(ITEM_KINDS, "item kind");
export const element = oneOf(ELEMENTS, "element");

const BASES = new Set<string>(SKILL_BASES);
const ORG_SKILL_RE = /^org:[a-z][a-z0-9_]*:org:[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$/;
export const skillKey: V<string> = described((x, p) =>
  typeof x === "string" && (BASES.has(x) || ORG_SKILL_RE.test(x)) ? x : bad(p, "skill key"),
{ type: "string", pattern: `^(?:${SKILL_BASES.join("|")}|${ORG_SKILL_RE.source.slice(1, -1)})$`, description: "base skill or org skill key" });

export const charId = id("char");
export const placeId = id("place");
export const itemId = id("item");
export const taskId = id("task");
export const orgId = id("org");
export const bondId = id("bond");
export const deedId = id("deed");

/** Shared list paging (动词表 §2). */
export const page = obj({
  after: opt(nullable(id("char", "item", "task", "deed", "skill", "bond", "reputation", "wanted")), null),
  through: opt(nullable(seq), null),
});
export const PAGE_DEFAULT = { after: null, through: null } as const;

/** `limit` absent → null (handler substitutes world.rules.page_size). */
export const limit = opt(nullable(posUint), null);

export const modifiers: V<Modifiers> = obj({ vigor: int, power: int, guard: int, speed: int });

export const itemEffect: V<ItemEffect> = union("kind", {
  none: {},
  restore: { vigor: uint },
  breakthrough: { bonus: uint },
  learn: { skill: skillKey, levels: uint },
  unlock: {},
  socket: { modifiers },
  map: { places: arr(placeId, { unique: true }) },
});

const reachCondition = union("mode", {
  place: { tpl: lit("reach"), place: placeId },
  tier: { tpl: lit("reach"), tier, stage },
});

const nonReachCondition = union("tpl", {
  deliver: { item_def: itemId, count: posUint, to_place: placeId, to_char: nullable(charId) },
  find: { target: charId },
  slay: {
    target: nullable(charId),
    archetype: nullable(archetype),
    tier,
    count: posUint,
  },
  gather: { item_def: itemId, count: posUint, to_place: placeId },
});

/** The five task conditions (事实格式 §9.1). */
export const condition: V<Condition> = described((x, p) => {
  if (typeof x === "object" && x !== null && (x as { tpl?: unknown }).tpl === "reach") {
    return reachCondition(x, p);
  }
  const c = nonReachCondition(x, p);
  if (c.tpl === "slay" && (c.target === null) === (c.archetype === null)) {
    return bad(p, "slay condition with exactly one of target/archetype");
  }
  return c;
}, { anyOf: [schemaOf(reachCondition), schemaOf(nonReachCondition)], description: "slay requires exactly one non-null target/archetype" });

export const rewardSpec: V<RewardSpec> = obj({
  coin: uint,
  xp: uint,
  potential: uint,
  rep: uint,
  item_defs: arr(itemId),
});

/** Features as a set in ASCII order (标签词表 §2.2). */
export const features = refine(
  arr(placeFeature, { unique: true }),
  (fs) => fs.every((f, i) => i === 0 || (fs[i - 1] as string) < f),
  "place features in ASCII order without duplicates",
);

export const freeText = str();
