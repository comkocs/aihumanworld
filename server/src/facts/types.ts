// Fact row types of aihw.v1 — one type per logical table of docs/协议/事实格式_v1.md.
// Field names and nullability follow the protocol exactly; do not add fields here
// without a protocol revision.

import type {
  ApCostKey,
  Body,
  BondKind,
  CharClass,
  CharKind,
  CombatMode,
  Danger,
  DeedKind,
  DeedVerb,
  Direction,
  Door,
  Element,
  EventScope,
  IdentityState,
  ItemKind,
  Life,
  NpcArchetype,
  PlaceFeature,
  PlaceKind,
  PublicTable,
  Region,
  SkillBase,
  Skin,
  TaskKind,
  TaskState,
  TaskTpl,
  Visibility,
  WantedReason,
  WantedState,
} from "./enums.ts";

/** `<realm>:<type>:<local>` */
export type ID = string;
/** Decimal non-negative integer string (tick number). */
export type Tick = string;
/** Decimal non-negative integer string (sequence / cursor). */
export type Seq = string;
/** UTC RFC3339 timestamp. */
export type Time = string;
/** Normative key (标签词表). */
export type Key = string;
/** Non-negative safe integer. */
export type UInt = number;
/** Safe integer. */
export type Int = number;
/** 1..9 */
export type Tier = number;
/** 1..4 */
export type Stage = number;
/** 1..3 */
export type Grade = number;
/** `strike|guard|move|inner|org:<org_id>:<local>` */
export type SkillKey = string;

export interface CommonFields {
  id: ID;
  created_tick: Tick;
  updated_tick: Tick;
}

// ---------- shared objects (§2.1) ----------

export interface Holder {
  kind: "char" | "place" | "item" | "task";
  id: ID;
}

export interface Reward {
  coin: UInt;
  xp: UInt;
  potential: UInt;
  rep: UInt;
  items: ID[];
}

export interface RewardSpec {
  coin: UInt;
  xp: UInt;
  potential: UInt;
  rep: UInt;
  item_defs: ID[];
}

export interface Stats {
  vigor_max: UInt;
  power: UInt;
  guard: UInt;
  speed: UInt;
  cap_max: UInt;
}

export interface Modifiers {
  vigor: Int;
  power: Int;
  guard: Int;
  speed: Int;
}

export interface Cost {
  coin: UInt;
  potential: UInt;
  items: ID[];
}

export type Condition =
  | { tpl: "deliver"; item_def: ID; count: UInt; to_place: ID; to_char: ID | null }
  | { tpl: "find"; target: ID }
  | {
      tpl: "slay";
      target: ID | null;
      archetype: NpcArchetype | null;
      tier: Tier;
      count: UInt;
    }
  | { tpl: "gather"; item_def: ID; count: UInt; to_place: ID }
  | { tpl: "reach"; mode: "place"; place: ID }
  | { tpl: "reach"; mode: "tier"; tier: Tier; stage: Stage };

// ---------- world (§3.1) ----------

export interface WorldRules {
  tick_seconds: UInt | null;
  ap_per_tick: UInt | null;
  draft_expire_ticks: UInt | null;
  dormant_after_ticks: UInt | null;
  bury_after_ticks: UInt | null;
  revive_window_ticks: UInt | null;
  speech_ttl_ticks: UInt | null;
  page_size: UInt | null;
  text_max_chars: UInt | null;
  build_min_tier: Tier | null;
  bounty_open_max: UInt | null;
  active_task_max: UInt | null;
  socket_max: UInt | null;
  ap_costs: Partial<Record<ApCostKey, UInt | null>>;
  balance_key: Key | null;
}

export type SkinMap<T> = Record<Skin, T>;

export interface WorldRow extends CommonFields {
  realm: string;
  tick: Tick;
  event_head: Seq;
  deed_head: Seq;
  tick_started_at: Time;
  rules_revision: Key;
  rules: WorldRules;
  spawn_places: SkinMap<ID>;
  registry_orgs: SkinMap<ID>;
  day_index: UInt;
  week_index: UInt;
}

// ---------- identity (§3.2, server-private) ----------

export interface IdentityRow extends CommonFields {
  char_id: ID;
  code_hash: string;
  expires_tick: Tick | null;
}

// ---------- place (§4) ----------

export interface Exit {
  dir: Direction;
  to: ID;
  locked: boolean;
  key_def: ID | null;
  guard: ID | null;
}

export interface PlaceRow extends CommonFields {
  content_key: Key;
  region: Region;
  kind: PlaceKind;
  features: PlaceFeature[];
  tier: Tier;
  danger: Danger;
  combat: CombatMode;
  exits: Exit[];
  owner_org: ID | null;
  by: ID | null;
}

// ---------- item (§5) ----------

export type ItemEffect =
  | { kind: "none" }
  | { kind: "restore"; vigor: UInt }
  | { kind: "breakthrough"; bonus: UInt }
  | { kind: "learn"; skill: SkillKey; levels: UInt }
  | { kind: "unlock" }
  | { kind: "socket"; modifiers: Modifiers }
  | { kind: "map"; places: ID[] };

export interface ItemDefinitionRow extends CommonFields {
  record: "definition";
  content_key: Key;
  kind: ItemKind;
  tier: Tier;
  grade: Grade;
  element: Element;
  slots: UInt;
  cap: UInt;
  dura_max: UInt;
  modifiers: Modifiers;
  effect: ItemEffect;
  by: ID | null;
}

export interface ItemInstanceRow extends CommonFields {
  record: "instance";
  def_id: ID;
  holder: Holder;
  state: "available" | "consumed";
  equipped: boolean;
  dura: UInt;
  sockets: (ID | null)[];
}

export type ItemRow = ItemDefinitionRow | ItemInstanceRow;

// ---------- char (§6) ----------

export interface CharRow extends CommonFields {
  kind: CharKind;
  door: Door | null;
  /** S32 public player short id (players only, e.g. A00002); never reused. */
  handle: string | null;
  /** S32 continuation token: sha256("aihw-email:" + normalized address), null = unbound. */
  email_hash: string | null;
  model: string | null;
  skin: Skin;
  class: CharClass | null;
  origin_region: Skin;
  body: Body;
  archetype: NpcArchetype | null;
  tier: Tier;
  stage: Stage;
  xp: UInt;
  potential: UInt;
  vigor: UInt;
  coin: UInt;
  cycles: UInt;
  legacy: UInt;
  loc: ID;
  respawn_place: ID;
  life: Life;
  revive_tick: Tick | null;
  state: IdentityState;
  state_since: Tick;
  last_seen_tick: Tick;
  last_yield_tick: Tick;
  ap_tick: Tick;
  seen_at: Time;
  ap_spent: UInt;
  train_skill: SkillKey | null;
  day_index: UInt;
  system_tasks_today: UInt;
  known_places: ID[];
  patrol_route: ID[];
  patrol_index: UInt;
}

/** Fields of another char visible to observers (事实格式 §12). */
export const PUBLIC_CHAR_FIELDS = [
  "id",
  "handle",
  "kind",
  "door",
  "model",
  "skin",
  "class",
  "body",
  "archetype",
  "tier",
  "stage",
  "loc",
  "life",
  "state",
  "cycles",
] as const;
export type PublicChar = Pick<CharRow, (typeof PUBLIC_CHAR_FIELDS)[number]>;

// ---------- skill / bond (§7) ----------

export interface SkillDefinitionRow extends CommonFields {
  record: "definition";
  key: SkillKey;
  base: SkillBase;
  org_id: ID | null;
  tier: Tier;
}

export interface SkillLearnedRow extends CommonFields {
  record: "learned";
  char_id: ID;
  def_id: ID;
  level: UInt;
  cap: UInt;
}

export type SkillRow = SkillDefinitionRow | SkillLearnedRow;

export interface BondRow extends CommonFields {
  kind: BondKind;
  a: ID;
  b: ID;
  state: "active" | "ended";
  weight: Int;
  rank: UInt | null;
  since_tick: Tick;
  ended_tick: Tick | null;
}

// ---------- org / reputation / wanted (§8) ----------

export interface Rank {
  rank: UInt;
  key: Key;
  can_promote: boolean;
  can_expel: boolean;
}

export interface OrgGoal {
  week: UInt;
  kind: "system_tasks" | "deliver_items";
  target: UInt;
  progress: UInt;
  member_ids: ID[];
  reward_rep: UInt;
  settled: boolean;
}

export interface OrgRow extends CommonFields {
  content_key: Key;
  region: Region;
  hall: ID;
  registry: boolean;
  ranks: Rank[];
  skill_defs: ID[];
  treasury: UInt;
  goal: OrgGoal;
}

export interface ReputationRow extends CommonFields {
  char_id: ID;
  scope: "world" | "org";
  org_id: ID | null;
  value: Int;
}

export interface WantedRow extends CommonFields {
  char_id: ID;
  region: Region;
  reason: WantedReason;
  until_tick: Tick;
  state: WantedState;
  bounty_task: ID | null;
}

// ---------- task (§9) ----------

export interface TaskTemplateRow extends CommonFields {
  record: "template";
  content_key: Key;
  tpl: TaskTpl;
  tier: Tier;
  stage: Stage;
  condition: Condition;
  reward_spec: RewardSpec;
  duration_ticks: UInt;
  by: ID | null;
}

export interface TaskInstanceRow extends CommonFields {
  record: "instance";
  template_id: ID | null;
  kind: TaskKind;
  tpl: TaskTpl;
  issuer: { kind: "system" | "char" | "org"; id: ID };
  offer_place: ID;
  eligible_char: ID | null;
  issuer_tier: Tier | null;
  taker: ID | null;
  condition: Condition;
  reward: Reward;
  escrow: { coin: UInt; items: ID[] };
  state: TaskState;
  accepted_seq: Seq | null;
  progress: { count: UInt; evidence: ID[] };
  expires_tick: Tick;
}

export type TaskRow = TaskTemplateRow | TaskInstanceRow;

// ---------- deed (§10) ----------

export interface Proposal {
  kind: "mentor" | "ally";
  a: ID;
  b: ID;
  expires_tick: Tick;
}

export interface Change {
  table: PublicTable;
  id: ID;
  after: Record<string, unknown>;
}

export interface Combatant {
  char_id: ID;
  body: Body;
  tier: Tier;
  stage: Stage;
  xp: UInt;
  vigor: UInt;
  cycles: UInt;
  legacy: UInt;
  stats: Stats;
  skills: { key: SkillKey; base: SkillBase; level: UInt }[];
  equipment: { def_id: ID; dura: UInt; core_defs: ID[] }[];
  archetype: NpcArchetype | null;
}

export interface RollInputs {
  actor: Combatant;
  target: Combatant | null;
  mode: "pve" | "duel" | "pk" | "tier" | "cycle";
  assist_item: ID | null;
}

export interface Roll {
  seed: string;
  rule: Key;
  inputs: RollInputs;
  value: UInt;
}

export interface DeedResult {
  outcome: "success" | "failure";
  changes: Change[];
  roll: Roll | null;
  proposal: Proposal | null;
}

export interface DeedRow {
  id: ID;
  seq: Seq;
  tick: Tick;
  actor: ID | null;
  verb: DeedVerb;
  kind: DeedKind;
  targets: ID[];
  place_id: ID | null;
  result: DeedResult;
  visibility: Visibility;
  participants: ID[];
  rules_revision: Key;
}

// ---------- event (§11) ----------

export interface EventDataMap {
  identity_state: {
    char_id: ID;
    from: IdentityState | null;
    to: IdentityState;
    reason: "create" | "first_system_task" | "idle" | "expired" | "resume";
  };
  moved: { char_id: ID; from: ID; to: ID };
  speech: { speaker: ID; channel: "place" | "direct"; target: ID | null };
  item_changed: {
    item_id: ID;
    def_id: ID;
    reason:
      | "take"
      | "give"
      | "equip"
      | "unequip"
      | "consume"
      | "socket"
      | "unsocket"
      | "repair"
      | "buy"
      | "sell"
      | "reward"
      | "drop"
      | "escrow"
      | "refund";
    holder: Holder;
    state: "available" | "consumed";
  };
  skill_changed: { char_id: ID; skill: SkillKey; level: UInt; cap: UInt };
  task_changed: { task_id: ID; state: TaskState; taker: ID | null; progress: UInt };
  reward_granted: { char_id: ID; source: ID; reward: Reward };
  org_changed: { org_id: ID; goal: OrgGoal };
  relation_proposed: { offer: ID; proposal: Proposal };
  bond_changed: { bond: BondRow };
  reputation_changed: { reputation: ReputationRow };
  wanted_changed: { wanted: WantedRow };
  combat_resolved: {
    attacker: ID;
    target: ID;
    winner: ID | null;
    mode: "pve" | "duel" | "pk";
    outcome: "win" | "lose" | "draw";
    dead: ID[];
    deed_id: ID;
  };
  life_changed: { char_id: ID; from: Life; to: Life; place_id: ID; revive_tick: Tick | null };
  progressed: {
    char_id: ID;
    mode: "stage" | "tier" | "cycle";
    outcome: "success" | "failure";
    tier: Tier;
    stage: Stage;
    cycles: UInt;
    deed_id: ID;
  };
  built: { builder: ID; table: "place" | "item" | "task"; id: ID; content_key: Key };
  discovered: { char_id: ID; target: ID; first: boolean };
  tick_yield: { char_id: ID; xp: UInt; potential: UInt; skill: SkillKey | null; level: UInt | null };
  fact_changed: { changes: Change[] };
}

export type EventType = keyof EventDataMap;

export type EventRow = {
  [T in EventType]: {
    id: ID;
    cursor: Seq;
    tick: Tick;
    scope: EventScope;
    recipients: ID[];
    place_id: ID | null;
    type: T;
    deed_id: ID | null;
    data: EventDataMap[T];
  };
}[EventType];

/** Logical table name → row type. */
export interface RowMap {
  world: WorldRow;
  identity: IdentityRow;
  place: PlaceRow;
  item: ItemRow;
  char: CharRow;
  skill: SkillRow;
  bond: BondRow;
  org: OrgRow;
  reputation: ReputationRow;
  wanted: WantedRow;
  task: TaskRow;
  deed: DeedRow;
  event: EventRow;
}

export type FactTable = keyof RowMap;
