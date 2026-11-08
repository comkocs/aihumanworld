-- S88: persistent tide pressure / next destination, plus one immutable weekly result.
ALTER TABLE s72_world_events ADD COLUMN resolution jsonb
  CHECK (resolution IS NULL OR jsonb_typeof(resolution) = 'object');

CREATE TABLE s88_tide_state (
  realm text PRIMARY KEY,
  next_place_id aihw_ref REFERENCES places (id),
  pressured_regions jsonb NOT NULL CHECK (jsonb_typeof(pressured_regions) = 'array'),
  reward_bp integer NOT NULL CHECK (reward_bp BETWEEN 0 AND 10000),
  updated_tick aihw_seq NOT NULL
);

CREATE TABLE s88_weekly_results (
  realm text NOT NULL,
  week aihw_uint NOT NULL,
  rankings jsonb NOT NULL CHECK (jsonb_typeof(rankings) = 'array'),
  settled_tick aihw_seq NOT NULL,
  deed_id aihw_ref REFERENCES deeds (id),
  PRIMARY KEY (realm, week)
);
CREATE INDEX s88_weekly_deeds ON deeds (tick, seq)
  WHERE kind IN ('bounty_done', 'stage_up', 'breakthrough', 'ascend', 'world_event');
CREATE INDEX s88_tide_combat ON events (tick, cursor)
  WHERE type = 'combat_resolved' AND scope = 'place';
