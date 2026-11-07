-- aihw.v1 S62: three region-first deeds, and the one line a player attaches to a bounty
-- or a built record, kept with the fact so other chars can read it.
--   deeds.kind  first_gate / first_build / first_crossing join the first_* group
--               (each needs a first_key; uniqueness stays on deeds.first_key).
--   note        nullable text on tasks / places / items. Only a player bounty
--               instance and a player-built place / item definition / task
--               template store one (sanitised, ≤ text_max_chars). System rows
--               and item instances stay null; the column is nullable, so no
--               existing row changes meaning.
ALTER TABLE deeds DROP CONSTRAINT deeds_kind_check;
ALTER TABLE deeds ADD CONSTRAINT deeds_kind_check CHECK (kind IN ('travel', 'discover', 'first_found', 'first_clear', 'first_kill', 'combat_win', 'combat_loss', 'combat_draw', 'duel_win', 'bounty_done', 'task_done', 'task_accept', 'task_release', 'bounty_post', 'org_join', 'org_promote', 'org_leave', 'org_expel', 'org_goal', 'relation_offer', 'relation_accept', 'relation_end', 'enmity', 'wanted', 'wanted_end', 'death', 'revive', 'stage_up', 'breakthrough', 'ascend', 'build', 'take', 'give', 'use', 'equip', 'repair', 'trade', 'train', 'learn', 'identity', 'discourse', 'first_gate', 'first_build', 'first_crossing'));
ALTER TABLE deeds DROP CONSTRAINT deeds_first_key;
ALTER TABLE deeds ADD CONSTRAINT deeds_first_key CHECK ((kind IN ('first_found', 'first_clear', 'first_kill', 'first_gate', 'first_build', 'first_crossing')) = (first_key IS NOT NULL));

ALTER TABLE tasks ADD COLUMN note text;
ALTER TABLE places ADD COLUMN note text;
ALTER TABLE items ADD COLUMN note text;
