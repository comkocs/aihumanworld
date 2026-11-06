-- aihw.v1 fact store, migration 0001 (S9).
-- Thirteen logical tables of docs/协议/事实格式_v1.md, one physical table each
-- (plural names; `char` is a PostgreSQL type name). Physical helpers:
--   event_inbox        self-layer recipient index of events
--   deeds.first_key    uniqueness helper for first_found / first_clear / first_kill
--   aihw_local_<type>  sequences that allocate never-reused ID locals
-- Same SQL runs on PostgreSQL (production) and PGlite (local dev / tests).
-- Only PostgreSQL >= 14 features are used.

CREATE DOMAIN aihw_uint AS bigint CHECK (VALUE >= 0 AND VALUE <= 9007199254740991);
CREATE DOMAIN aihw_int AS bigint CHECK (VALUE >= -9007199254740991 AND VALUE <= 9007199254740991);
CREATE DOMAIN aihw_seq AS bigint CHECK (VALUE >= 0);
CREATE DOMAIN aihw_tier AS smallint CHECK (VALUE BETWEEN 1 AND 9);
CREATE DOMAIN aihw_stage AS smallint CHECK (VALUE BETWEEN 1 AND 4);
CREATE DOMAIN aihw_grade AS smallint CHECK (VALUE BETWEEN 1 AND 3);
CREATE DOMAIN aihw_region AS text CHECK (VALUE IN ('xiuxian', 'wuxia', 'fantasy', 'scifi', 'neutral'));
CREATE DOMAIN aihw_skin AS text CHECK (VALUE IN ('xiuxian', 'wuxia', 'fantasy', 'scifi'));
CREATE DOMAIN aihw_key AS text CHECK (VALUE ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$');
CREATE DOMAIN aihw_ref AS text CHECK (VALUE ~ '^[a-z][a-z0-9_]*:[a-z]+:[a-z][a-z0-9_]*$');

-- ---------- place ----------
CREATE TABLE places (
  id            text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9_]*:place:[a-z][a-z0-9_]*$'),
  created_tick  aihw_seq NOT NULL,
  updated_tick  aihw_seq NOT NULL,
  content_key   aihw_key NOT NULL UNIQUE CHECK (content_key ~ '^content\.[a-z][a-z0-9_]*\.place\.[a-z0-9_]+$'),
  region        aihw_region NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('settlement', 'wilderness', 'dungeon', 'market', 'hall', 'gate', 'shrine', 'road', 'water', 'ruin', 'arena')),
  features      jsonb NOT NULL CHECK (jsonb_typeof(features) = 'array'),
  tier          aihw_tier NOT NULL,
  danger        text NOT NULL CHECK (danger IN ('safe', 'low', 'medium', 'high')),
  combat        text NOT NULL CHECK (combat IN ('safe', 'duel', 'pk', 'pve')),
  exits         jsonb NOT NULL CHECK (jsonb_typeof(exits) = 'array'),
  owner_org     aihw_ref,
  by            aihw_ref
);

-- ---------- org ----------
CREATE TABLE orgs (
  id            text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9_]*:org:[a-z][a-z0-9_]*$'),
  created_tick  aihw_seq NOT NULL,
  updated_tick  aihw_seq NOT NULL,
  content_key   aihw_key NOT NULL UNIQUE CHECK (content_key ~ '^content\.[a-z][a-z0-9_]*\.org\.[a-z0-9_]+$'),
  region        aihw_region NOT NULL,
  hall          aihw_ref NOT NULL REFERENCES places (id),
  registry      boolean NOT NULL,
  ranks         jsonb NOT NULL CHECK (jsonb_typeof(ranks) = 'array' AND jsonb_array_length(ranks) > 0),
  skill_defs    jsonb NOT NULL CHECK (jsonb_typeof(skill_defs) = 'array'),
  treasury      aihw_uint NOT NULL,
  goal          jsonb NOT NULL CHECK (jsonb_typeof(goal) = 'object')
);

ALTER TABLE places ADD CONSTRAINT places_owner_org_fk FOREIGN KEY (owner_org) REFERENCES orgs (id);

-- ---------- char ----------
CREATE TABLE chars (
  id                  text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9_]*:char:[a-z][a-z0-9_]*$'),
  created_tick        aihw_seq NOT NULL,
  updated_tick        aihw_seq NOT NULL,
  kind                text NOT NULL CHECK (kind IN ('player', 'npc', 'official')),
  door                text CHECK (door IN ('api', 'web')),
  model               text,
  skin                aihw_skin NOT NULL,
  class               text CHECK (class IN ('warrior', 'mage', 'ranger', 'priest')),
  origin_region       aihw_skin NOT NULL,
  body                text NOT NULL CHECK (body IN ('humanoid', 'beast', 'undead', 'construct', 'spirit')),
  archetype           text CHECK (archetype IN ('master', 'merchant', 'repairer', 'guard', 'patroller', 'quest_giver', 'monster', 'tutorial_opponent')),
  tier                aihw_tier NOT NULL,
  stage               aihw_stage NOT NULL,
  xp                  aihw_uint NOT NULL,
  potential           aihw_uint NOT NULL,
  vigor               aihw_uint NOT NULL,
  coin                aihw_uint NOT NULL,
  cycles              aihw_uint NOT NULL,
  legacy              aihw_uint NOT NULL,
  loc                 aihw_ref NOT NULL REFERENCES places (id),
  respawn_place       aihw_ref NOT NULL REFERENCES places (id),
  life                text NOT NULL CHECK (life IN ('alive', 'dead')),
  revive_tick         aihw_seq,
  state               text NOT NULL CHECK (state IN ('draft', 'active', 'dormant', 'buried')),
  state_since         aihw_seq NOT NULL,
  last_seen_tick      aihw_seq NOT NULL,
  last_yield_tick     aihw_seq NOT NULL,
  ap_tick             aihw_seq NOT NULL,
  seen_at             timestamptz NOT NULL,
  ap_spent            aihw_uint NOT NULL,
  train_skill         text,
  day_index           aihw_uint NOT NULL,
  system_tasks_today  aihw_uint NOT NULL,
  known_places        jsonb NOT NULL CHECK (jsonb_typeof(known_places) = 'array'),
  patrol_route        jsonb NOT NULL CHECK (jsonb_typeof(patrol_route) = 'array'),
  patrol_index        aihw_uint NOT NULL,
  CONSTRAINT chars_door_npc CHECK ((kind = 'npc') = (door IS NULL)),
  CONSTRAINT chars_class_fantasy CHECK (class IS NULL OR skin = 'fantasy'),
  CONSTRAINT chars_archetype_npc CHECK ((kind = 'npc') = (archetype IS NOT NULL)),
  CONSTRAINT chars_dead_revive CHECK (life = 'alive' OR revive_tick IS NOT NULL),
  CONSTRAINT chars_patrol_npc CHECK (kind = 'npc' OR (patrol_route = '[]'::jsonb AND patrol_index = 0))
);
CREATE INDEX chars_loc ON chars (loc);

ALTER TABLE places ADD CONSTRAINT places_by_fk FOREIGN KEY (by) REFERENCES chars (id);

-- ---------- identity (server-private credential) ----------
CREATE TABLE identities (
  id            text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9_]*:identity:[a-z][a-z0-9_]*$'),
  created_tick  aihw_seq NOT NULL,
  updated_tick  aihw_seq NOT NULL,
  char_id       aihw_ref NOT NULL UNIQUE REFERENCES chars (id),
  code_hash     text NOT NULL UNIQUE CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  expires_tick  aihw_seq
);

-- ---------- item (definition / instance) ----------
CREATE TABLE items (
  id            text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9_]*:item:[a-z][a-z0-9_]*$'),
  created_tick  aihw_seq NOT NULL,
  updated_tick  aihw_seq NOT NULL,
  record        text NOT NULL CHECK (record IN ('definition', 'instance')),
  -- definition branch
  content_key   aihw_key CHECK (content_key ~ '^content\.[a-z][a-z0-9_]*\.item\.[a-z0-9_]+$'),
  kind          text CHECK (kind IN ('blade', 'blunt', 'ranged', 'staff', 'light_armor', 'heavy_armor', 'robe', 'ring', 'charm', 'potion', 'scroll', 'ore', 'herb', 'core', 'key', 'map')),
  tier          aihw_tier,
  grade         aihw_grade,
  element       text CHECK (element IN ('none', 'fire', 'water', 'wind', 'earth', 'void', 'light', 'dark')),
  slots         aihw_uint,
  cap           aihw_uint,
  dura_max      aihw_uint,
  modifiers     jsonb,
  effect        jsonb,
  by            aihw_ref REFERENCES chars (id),
  -- instance branch
  def_id        aihw_ref REFERENCES items (id),
  holder        jsonb,
  state         text CHECK (state IN ('available', 'consumed')),
  equipped      boolean,
  dura          aihw_uint,
  sockets       jsonb,
  CONSTRAINT items_branch CHECK (CASE record
    WHEN 'definition' THEN
      content_key IS NOT NULL AND kind IS NOT NULL AND tier IS NOT NULL AND grade IS NOT NULL
      AND element IS NOT NULL AND slots IS NOT NULL AND cap IS NOT NULL AND dura_max IS NOT NULL
      AND modifiers IS NOT NULL AND effect IS NOT NULL
      AND def_id IS NULL AND holder IS NULL AND state IS NULL AND equipped IS NULL AND dura IS NULL AND sockets IS NULL
    ELSE
      def_id IS NOT NULL AND holder IS NOT NULL AND state IS NOT NULL AND equipped IS NOT NULL
      AND dura IS NOT NULL AND sockets IS NOT NULL AND jsonb_typeof(sockets) = 'array'
      AND content_key IS NULL AND kind IS NULL AND tier IS NULL AND grade IS NULL AND element IS NULL
      AND slots IS NULL AND cap IS NULL AND dura_max IS NULL AND modifiers IS NULL AND effect IS NULL AND by IS NULL
  END)
);
CREATE UNIQUE INDEX items_definition_content_key ON items (content_key) WHERE record = 'definition';
CREATE INDEX items_instance_holder ON items ((holder ->> 'kind'), (holder ->> 'id')) WHERE record = 'instance';
CREATE INDEX items_instance_def ON items (def_id) WHERE record = 'instance';

-- ---------- skill (definition / learned) ----------
CREATE TABLE skills (
  id            text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9_]*:skill:[a-z][a-z0-9_]*$'),
  created_tick  aihw_seq NOT NULL,
  updated_tick  aihw_seq NOT NULL,
  record        text NOT NULL CHECK (record IN ('definition', 'learned')),
  -- definition branch
  key           text CHECK (key IN ('strike', 'guard', 'move', 'inner') OR key ~ '^org:[a-z][a-z0-9_]*:org:[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$'),
  base          text CHECK (base IN ('strike', 'guard', 'move', 'inner')),
  org_id        aihw_ref REFERENCES orgs (id),
  tier          aihw_tier,
  -- learned branch
  char_id       aihw_ref REFERENCES chars (id),
  def_id        aihw_ref REFERENCES skills (id),
  level         aihw_uint,
  cap           aihw_uint,
  CONSTRAINT skills_branch CHECK (CASE record
    WHEN 'definition' THEN
      key IS NOT NULL AND base IS NOT NULL AND tier IS NOT NULL
      AND (key IN ('strike', 'guard', 'move', 'inner')) = (org_id IS NULL)
      AND (key NOT IN ('strike', 'guard', 'move', 'inner') OR base = key)
      AND char_id IS NULL AND def_id IS NULL AND level IS NULL AND cap IS NULL
    ELSE
      char_id IS NOT NULL AND def_id IS NOT NULL AND level IS NOT NULL AND cap IS NOT NULL AND level <= cap
      AND key IS NULL AND base IS NULL AND org_id IS NULL AND tier IS NULL
  END)
);
CREATE UNIQUE INDEX skills_definition_key ON skills (key) WHERE record = 'definition';
CREATE UNIQUE INDEX skills_learned_pair ON skills (char_id, def_id) WHERE record = 'learned';

-- ---------- bond ----------
CREATE TABLE bonds (
  id            text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9_]*:bond:[a-z][a-z0-9_]*$'),
  created_tick  aihw_seq NOT NULL,
  updated_tick  aihw_seq NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('mentor', 'ally', 'enemy', 'member')),
  a             aihw_ref NOT NULL REFERENCES chars (id),
  b             aihw_ref NOT NULL,
  state         text NOT NULL CHECK (state IN ('active', 'ended')),
  weight        aihw_int NOT NULL,
  rank          aihw_uint,
  since_tick    aihw_seq NOT NULL,
  ended_tick    aihw_seq,
  CONSTRAINT bonds_b_type CHECK ((kind = 'member') = (b ~ '^[a-z][a-z0-9_]*:org:')),
  CONSTRAINT bonds_b_char CHECK (kind = 'member' OR b ~ '^[a-z][a-z0-9_]*:char:'),
  CONSTRAINT bonds_rank_member CHECK ((kind = 'member') = (rank IS NOT NULL)),
  CONSTRAINT bonds_ended CHECK ((state = 'active') = (ended_tick IS NULL)),
  CONSTRAINT bonds_not_self CHECK (a <> b),
  CONSTRAINT bonds_ally_order CHECK (kind <> 'ally' OR a COLLATE "C" < b COLLATE "C")
);
CREATE UNIQUE INDEX bonds_active_pair ON bonds (kind, a, b) WHERE state = 'active';
CREATE UNIQUE INDEX bonds_one_active_member ON bonds (a) WHERE kind = 'member' AND state = 'active';
CREATE INDEX bonds_b ON bonds (b);

-- ---------- reputation ----------
CREATE TABLE reputations (
  id            text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9_]*:reputation:[a-z][a-z0-9_]*$'),
  created_tick  aihw_seq NOT NULL,
  updated_tick  aihw_seq NOT NULL,
  char_id       aihw_ref NOT NULL REFERENCES chars (id),
  scope         text NOT NULL CHECK (scope IN ('world', 'org')),
  org_id        aihw_ref REFERENCES orgs (id),
  value         aihw_int NOT NULL,
  CONSTRAINT reputations_scope_org CHECK ((scope = 'org') = (org_id IS NOT NULL))
);
CREATE UNIQUE INDEX reputations_key ON reputations (char_id, scope, COALESCE(org_id::text, ''));

-- ---------- task (template / instance) ----------
CREATE TABLE tasks (
  id              text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9_]*:task:[a-z][a-z0-9_]*$'),
  created_tick    aihw_seq NOT NULL,
  updated_tick    aihw_seq NOT NULL,
  record          text NOT NULL CHECK (record IN ('template', 'instance')),
  tpl             text NOT NULL CHECK (tpl IN ('deliver', 'find', 'slay', 'gather', 'reach')),
  condition       jsonb NOT NULL CHECK (jsonb_typeof(condition) = 'object'),
  -- template branch
  content_key     aihw_key CHECK (content_key ~ '^content\.[a-z][a-z0-9_]*\.task\.[a-z0-9_]+$'),
  tier            aihw_tier,
  stage           aihw_stage,
  reward_spec     jsonb,
  duration_ticks  aihw_uint,
  by              aihw_ref REFERENCES chars (id),
  -- instance branch
  template_id     aihw_ref REFERENCES tasks (id),
  kind            text CHECK (kind IN ('system', 'bounty', 'org')),
  issuer          jsonb,
  offer_place     aihw_ref REFERENCES places (id),
  eligible_char   aihw_ref REFERENCES chars (id),
  issuer_tier     aihw_tier,
  taker           aihw_ref REFERENCES chars (id),
  reward          jsonb,
  escrow          jsonb,
  state           text CHECK (state IN ('open', 'accepted', 'completed', 'cancelled', 'expired')),
  accepted_seq    aihw_seq,
  progress        jsonb,
  expires_tick    aihw_seq,
  CONSTRAINT tasks_condition_tpl CHECK (condition ->> 'tpl' = tpl),
  CONSTRAINT tasks_branch CHECK (CASE record
    WHEN 'template' THEN
      content_key IS NOT NULL AND tier IS NOT NULL AND stage IS NOT NULL AND reward_spec IS NOT NULL
      AND duration_ticks IS NOT NULL
      AND template_id IS NULL AND kind IS NULL AND issuer IS NULL AND offer_place IS NULL
      AND eligible_char IS NULL AND issuer_tier IS NULL AND taker IS NULL AND reward IS NULL
      AND escrow IS NULL AND state IS NULL AND accepted_seq IS NULL AND progress IS NULL AND expires_tick IS NULL
    ELSE
      kind IS NOT NULL AND issuer IS NOT NULL AND offer_place IS NOT NULL AND reward IS NOT NULL
      AND escrow IS NOT NULL AND state IS NOT NULL AND progress IS NOT NULL AND expires_tick IS NOT NULL
      AND (kind <> 'system' OR template_id IS NOT NULL)
      AND content_key IS NULL AND tier IS NULL AND stage IS NULL AND reward_spec IS NULL
      AND duration_ticks IS NULL AND by IS NULL
  END)
);
CREATE UNIQUE INDEX tasks_template_content_key ON tasks (content_key) WHERE record = 'template';
CREATE INDEX tasks_instance_offer ON tasks (offer_place, state) WHERE record = 'instance';
CREATE INDEX tasks_instance_taker ON tasks (taker) WHERE record = 'instance' AND taker IS NOT NULL;
CREATE INDEX tasks_instance_expiry ON tasks (expires_tick) WHERE record = 'instance' AND state IN ('open', 'accepted');

-- ---------- wanted ----------
CREATE TABLE wanted (
  id            text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9_]*:wanted:[a-z][a-z0-9_]*$'),
  created_tick  aihw_seq NOT NULL,
  updated_tick  aihw_seq NOT NULL,
  char_id       aihw_ref NOT NULL REFERENCES chars (id),
  region        aihw_region NOT NULL,
  reason        text NOT NULL CHECK (reason IN ('attack_guard', 'kill_player')),
  until_tick    aihw_seq NOT NULL,
  state         text NOT NULL CHECK (state IN ('active', 'expired', 'cleared')),
  bounty_task   aihw_ref REFERENCES tasks (id)
);
CREATE UNIQUE INDEX wanted_one_active ON wanted (char_id, region, reason) WHERE state = 'active';
CREATE INDEX wanted_active_until ON wanted (until_tick) WHERE state = 'active';

-- ---------- deed (append-only chronicle) ----------
CREATE TABLE deeds (
  id              text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9_]*:deed:[a-z][a-z0-9_]*$'),
  seq             aihw_seq NOT NULL UNIQUE,
  tick            aihw_seq NOT NULL,
  actor           aihw_ref REFERENCES chars (id),
  verb            text NOT NULL CHECK (verb IN ('enter', 'look', 'events', 'whoami', 'go', 'say', 'take', 'give', 'use', 'attack', 'train', 'learn', 'task', 'bounty', 'build', 'breakthrough', 'clock')),
  kind            text NOT NULL CHECK (kind IN ('travel', 'discover', 'first_found', 'first_clear', 'first_kill', 'combat_win', 'combat_loss', 'combat_draw', 'duel_win', 'bounty_done', 'task_done', 'task_accept', 'task_release', 'bounty_post', 'org_join', 'org_promote', 'org_leave', 'org_expel', 'org_goal', 'relation_offer', 'relation_accept', 'relation_end', 'enmity', 'wanted', 'wanted_end', 'death', 'revive', 'stage_up', 'breakthrough', 'ascend', 'build', 'take', 'give', 'use', 'equip', 'repair', 'trade', 'train', 'learn', 'identity')),
  targets         jsonb NOT NULL CHECK (jsonb_typeof(targets) = 'array'),
  place_id        aihw_ref REFERENCES places (id),
  result          jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  visibility      text NOT NULL CHECK (visibility IN ('self', 'place', 'world')),
  participants    jsonb NOT NULL CHECK (jsonb_typeof(participants) = 'array'),
  rules_revision  aihw_key NOT NULL,
  first_key       text UNIQUE,
  CONSTRAINT deeds_first_key CHECK ((kind IN ('first_found', 'first_clear', 'first_kill')) = (first_key IS NOT NULL))
);
CREATE INDEX deeds_place ON deeds (place_id, seq) WHERE place_id IS NOT NULL;
CREATE INDEX deeds_world ON deeds (seq) WHERE visibility = 'world';
CREATE INDEX deeds_participants ON deeds USING gin (participants jsonb_path_ops);

-- ---------- event (three-layer projection) ----------
CREATE TABLE events (
  id          text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9_]*:event:[a-z][a-z0-9_]*$'),
  cursor      aihw_seq NOT NULL UNIQUE,
  tick        aihw_seq NOT NULL,
  scope       text NOT NULL CHECK (scope IN ('self', 'place', 'world')),
  recipients  jsonb NOT NULL CHECK (jsonb_typeof(recipients) = 'array'),
  place_id    aihw_ref REFERENCES places (id),
  type        text NOT NULL CHECK (type IN ('identity_state', 'moved', 'speech', 'item_changed', 'skill_changed', 'task_changed', 'reward_granted', 'org_changed', 'relation_proposed', 'bond_changed', 'reputation_changed', 'wanted_changed', 'combat_resolved', 'life_changed', 'progressed', 'built', 'discovered', 'tick_yield', 'fact_changed')),
  deed_id     aihw_ref REFERENCES deeds (id),
  data        jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  CONSTRAINT events_place_scope CHECK ((scope = 'place') = (place_id IS NOT NULL)),
  CONSTRAINT events_self_recipients CHECK ((scope = 'self') = (recipients <> '[]'::jsonb))
);
CREATE INDEX events_place ON events (place_id, cursor) WHERE scope = 'place';
CREATE INDEX events_world ON events (cursor) WHERE scope = 'world';

CREATE TABLE event_inbox (
  char_id  aihw_ref NOT NULL REFERENCES chars (id),
  cursor   aihw_seq NOT NULL REFERENCES events (cursor),
  PRIMARY KEY (char_id, cursor)
);

-- ---------- world (one row per realm) ----------
CREATE TABLE worlds (
  id               text PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9_]*:world:[a-z][a-z0-9_]*$'),
  created_tick     aihw_seq NOT NULL,
  updated_tick     aihw_seq NOT NULL,
  realm            text NOT NULL UNIQUE CHECK (realm ~ '^[a-z][a-z0-9_]*$'),
  tick             aihw_seq NOT NULL,
  event_head       aihw_seq NOT NULL,
  deed_head        aihw_seq NOT NULL,
  tick_started_at  timestamptz NOT NULL,
  rules_revision   aihw_key NOT NULL,
  rules            jsonb NOT NULL CHECK (jsonb_typeof(rules) = 'object'),
  spawn_places     jsonb NOT NULL CHECK (jsonb_typeof(spawn_places) = 'object'),
  registry_orgs    jsonb NOT NULL CHECK (jsonb_typeof(registry_orgs) = 'object'),
  day_index        aihw_uint NOT NULL,
  week_index       aihw_uint NOT NULL,
  CONSTRAINT worlds_realm_prefix CHECK (left(id, length(realm) + 1) = realm || ':')
);

-- ---------- ID local allocators (never reused, rollback gaps are fine) ----------
CREATE SEQUENCE aihw_local_place;
CREATE SEQUENCE aihw_local_item;
CREATE SEQUENCE aihw_local_char;
CREATE SEQUENCE aihw_local_skill;
CREATE SEQUENCE aihw_local_bond;
CREATE SEQUENCE aihw_local_org;
CREATE SEQUENCE aihw_local_reputation;
CREATE SEQUENCE aihw_local_wanted;
CREATE SEQUENCE aihw_local_task;
CREATE SEQUENCE aihw_local_identity;
