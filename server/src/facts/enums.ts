// Closed enumerations of aihw.v1 (docs/协议/标签词表_v1.md, 事实格式_v1.md, 动词表_v1.md).
// The same lists are repeated as CHECK constraints in migrations/0001_init.sql;
// changing either side requires a protocol revision plus a new migration.

export const REGIONS = ["xiuxian", "wuxia", "fantasy", "scifi", "neutral"] as const;
export type Region = (typeof REGIONS)[number];

export const SKINS = ["xiuxian", "wuxia", "fantasy", "scifi"] as const;
export type Skin = (typeof SKINS)[number];

export const CLASSES = ["warrior", "mage", "ranger", "priest"] as const;
export type CharClass = (typeof CLASSES)[number];

export const DOORS = ["api", "web"] as const;
export type Door = (typeof DOORS)[number];

export const CHAR_KINDS = ["player", "npc", "official"] as const;
export type CharKind = (typeof CHAR_KINDS)[number];

export const BODIES = ["humanoid", "beast", "undead", "construct", "spirit"] as const;
export type Body = (typeof BODIES)[number];

export const ARCHETYPES = [
  "master",
  "merchant",
  "repairer",
  "guard",
  "patroller",
  "quest_giver",
  "monster",
  "tutorial_opponent",
] as const;
export type NpcArchetype = (typeof ARCHETYPES)[number];

export const LIVES = ["alive", "dead"] as const;
export type Life = (typeof LIVES)[number];

export const IDENTITY_STATES = ["draft", "active", "dormant", "buried"] as const;
export type IdentityState = (typeof IDENTITY_STATES)[number];

export const PLACE_KINDS = [
  "settlement",
  "wilderness",
  "dungeon",
  "market",
  "hall",
  "gate",
  "shrine",
  "road",
  "water",
  "ruin",
  "arena",
] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];

export const PLACE_FEATURES = [
  "start",
  "tutorial",
  "trade",
  "repair",
  "training",
  "resource",
  "respawn",
  "portal",
  "build_anchor",
] as const;
export type PlaceFeature = (typeof PLACE_FEATURES)[number];

export const DANGERS = ["safe", "low", "medium", "high"] as const;
export type Danger = (typeof DANGERS)[number];

export const COMBATS = ["safe", "duel", "pk", "pve"] as const;
export type CombatMode = (typeof COMBATS)[number];

export const DIRECTIONS = [
  "north",
  "south",
  "east",
  "west",
  "northeast",
  "northwest",
  "southeast",
  "southwest",
  "up",
  "down",
  "in",
  "out",
  "portal",
] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const ITEM_KINDS = [
  "blade",
  "blunt",
  "ranged",
  "staff",
  "light_armor",
  "heavy_armor",
  "robe",
  "ring",
  "charm",
  "potion",
  "scroll",
  "ore",
  "herb",
  "core",
  "key",
  "map",
] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const ITEM_CATEGORY: Readonly<Record<ItemKind, ItemCategory>> = {
  blade: "weapon",
  blunt: "weapon",
  ranged: "weapon",
  staff: "weapon",
  light_armor: "armor",
  heavy_armor: "armor",
  robe: "armor",
  ring: "accessory",
  charm: "accessory",
  potion: "consumable",
  scroll: "consumable",
  ore: "material",
  herb: "material",
  core: "socketable",
  key: "utility",
  map: "utility",
};
export type ItemCategory =
  | "weapon"
  | "armor"
  | "accessory"
  | "consumable"
  | "material"
  | "socketable"
  | "utility";

export const ELEMENTS = ["none", "fire", "water", "wind", "earth", "void", "light", "dark"] as const;
export type Element = (typeof ELEMENTS)[number];

export const SKILL_BASES = ["strike", "guard", "move", "inner"] as const;
export type SkillBase = (typeof SKILL_BASES)[number];

export const BOND_KINDS = ["mentor", "ally", "enemy", "member"] as const;
export type BondKind = (typeof BOND_KINDS)[number];

export const TASK_TPLS = ["deliver", "find", "slay", "gather", "reach"] as const;
export type TaskTpl = (typeof TASK_TPLS)[number];

export const TASK_KINDS = ["system", "bounty", "org"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export const TASK_STATES = ["open", "accepted", "completed", "cancelled", "expired"] as const;
export type TaskState = (typeof TASK_STATES)[number];

export const WANTED_REASONS = ["attack_guard", "kill_player"] as const;
export type WantedReason = (typeof WANTED_REASONS)[number];

export const WANTED_STATES = ["active", "expired", "cleared"] as const;
export type WantedState = (typeof WANTED_STATES)[number];

export const DEED_KINDS = [
  "travel",
  "discover",
  "first_found",
  "first_clear",
  "first_kill",
  "combat_win",
  "combat_loss",
  "combat_draw",
  "duel_win",
  "bounty_done",
  "task_done",
  "task_accept",
  "task_release",
  "bounty_post",
  "org_join",
  "org_promote",
  "org_leave",
  "org_expel",
  "org_goal",
  "relation_offer",
  "relation_accept",
  "relation_end",
  "enmity",
  "wanted",
  "wanted_end",
  "death",
  "revive",
  "stage_up",
  "breakthrough",
  "ascend",
  "build",
  "take",
  "give",
  "use",
  "equip",
  "repair",
  "trade",
  "train",
  "learn",
  "identity",
] as const;
export type DeedKind = (typeof DEED_KINDS)[number];

/** The 16 HTTP verbs (动词表_v1 §1). */
export const VERBS = [
  "enter",
  "look",
  "events",
  "whoami",
  "go",
  "say",
  "take",
  "give",
  "use",
  "attack",
  "train",
  "learn",
  "task",
  "bounty",
  "build",
  "breakthrough",
] as const;
export type Verb = (typeof VERBS)[number];

/** deed.verb also accepts `clock` (engine-triggered, never an HTTP verb). */
export type DeedVerb = Verb | "clock";

export const VISIBILITIES = ["self", "place", "world"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const EVENT_SCOPES = VISIBILITIES;
export type EventScope = Visibility;

export const EVENT_TYPES = [
  "identity_state",
  "moved",
  "speech",
  "item_changed",
  "skill_changed",
  "task_changed",
  "reward_granted",
  "org_changed",
  "relation_proposed",
  "bond_changed",
  "reputation_changed",
  "wanted_changed",
  "combat_resolved",
  "life_changed",
  "progressed",
  "built",
  "discovered",
  "tick_yield",
  "fact_changed",
] as const;

/** Tables allowed in Change records (事实格式 §10). */
export const PUBLIC_TABLES = [
  "place",
  "item",
  "char",
  "skill",
  "bond",
  "org",
  "task",
  "reputation",
  "wanted",
] as const;
export type PublicTable = (typeof PUBLIC_TABLES)[number];

/** Full key set of world.rules.ap_costs (动词表 §2). */
export const AP_COST_KEYS = [
  "enter",
  "look",
  "events",
  "whoami",
  "go",
  "say",
  "take",
  "give",
  "use",
  "attack",
  "train",
  "learn",
  "task.list",
  "task.accept",
  "task.submit",
  "task.abandon",
  "bounty.post",
  "bounty.cancel",
  "build",
  "breakthrough",
] as const;
export type ApCostKey = (typeof AP_COST_KEYS)[number];

export function isOneOf<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === "string" && (list as readonly string[]).includes(v);
}
