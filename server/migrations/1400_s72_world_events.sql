-- S72: scheduled world events (beast tide / secret realm). One row per occurrence,
-- keyed by the tick it opened, so a restart replays the same schedule and never
-- re-announces a window it already opened. The spawned rows of a beast tide are
-- the char ids it added; a secret realm stores the exit it unbarred
-- ({place_id, dir}) so the close can put the lock back.
CREATE TABLE s72_world_events (
  open_tick   bigint PRIMARY KEY CHECK (open_tick >= 0),
  close_tick  bigint NOT NULL CHECK (close_tick > open_tick),
  kind        text NOT NULL CHECK (kind IN ('beast_tide', 'secret_realm')),
  place_id    text NOT NULL REFERENCES places (id),
  tier        smallint NOT NULL CHECK (tier BETWEEN 1 AND 9),
  state       text NOT NULL CHECK (state IN ('open', 'closed')),
  spawned     jsonb NOT NULL CHECK (jsonb_typeof(spawned) = 'array')
);
CREATE INDEX s72_world_events_open ON s72_world_events (close_tick) WHERE state = 'open';

-- world_event joins the chronicle: a world-visible deed for the opening and the
-- closing of each window (actor null, verb clock).
ALTER TABLE deeds DROP CONSTRAINT deeds_kind_check;
ALTER TABLE deeds ADD CONSTRAINT deeds_kind_check CHECK (kind IN ('travel', 'discover', 'first_found', 'first_clear', 'first_kill', 'combat_win', 'combat_loss', 'combat_draw', 'duel_win', 'bounty_done', 'task_done', 'task_accept', 'task_release', 'bounty_post', 'org_join', 'org_promote', 'org_leave', 'org_expel', 'org_goal', 'relation_offer', 'relation_accept', 'relation_end', 'enmity', 'wanted', 'wanted_end', 'death', 'revive', 'stage_up', 'breakthrough', 'ascend', 'build', 'take', 'give', 'use', 'equip', 'repair', 'trade', 'train', 'learn', 'identity', 'discourse', 'first_gate', 'first_build', 'first_crossing', 'org_create', 'first_org', 'world_event'));

-- world_event is the one event type the whole realm reads the announcement from.
ALTER TABLE events DROP CONSTRAINT events_type_check;
ALTER TABLE events ADD CONSTRAINT events_type_check CHECK (type IN ('identity_state', 'moved', 'speech', 'item_changed', 'skill_changed', 'task_changed', 'reward_granted', 'org_changed', 'relation_proposed', 'bond_changed', 'reputation_changed', 'wanted_changed', 'combat_resolved', 'life_changed', 'progressed', 'built', 'discovered', 'tick_yield', 'fact_changed', 'world_event'));
