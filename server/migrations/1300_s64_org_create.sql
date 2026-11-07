-- S64: player-named organizations and world-visible founding deeds.
ALTER TABLE orgs ADD COLUMN player_name text;

ALTER TABLE deeds DROP CONSTRAINT deeds_kind_check;
ALTER TABLE deeds ADD CONSTRAINT deeds_kind_check CHECK (kind IN ('travel', 'discover', 'first_found', 'first_clear', 'first_kill', 'combat_win', 'combat_loss', 'combat_draw', 'duel_win', 'bounty_done', 'task_done', 'task_accept', 'task_release', 'bounty_post', 'org_join', 'org_promote', 'org_leave', 'org_expel', 'org_goal', 'relation_offer', 'relation_accept', 'relation_end', 'enmity', 'wanted', 'wanted_end', 'death', 'revive', 'stage_up', 'breakthrough', 'ascend', 'build', 'take', 'give', 'use', 'equip', 'repair', 'trade', 'train', 'learn', 'identity', 'discourse', 'first_gate', 'first_build', 'first_crossing', 'org_create', 'first_org'));
ALTER TABLE deeds DROP CONSTRAINT deeds_first_key;
ALTER TABLE deeds ADD CONSTRAINT deeds_first_key CHECK ((kind IN ('first_found', 'first_clear', 'first_kill', 'first_gate', 'first_build', 'first_crossing', 'first_org')) = (first_key IS NOT NULL));
