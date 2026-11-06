-- S25 private clock bookkeeping; no additional public facts or action verbs.
CREATE TABLE s25_org_clock (
  realm text PRIMARY KEY,
  through_seq aihw_seq NOT NULL
);
CREATE TABLE s25_org_roster (
  org_id aihw_ref PRIMARY KEY REFERENCES orgs (id),
  week aihw_uint NOT NULL
);
CREATE TABLE s25_org_task_credit (
  task_id aihw_ref PRIMARY KEY REFERENCES tasks (id),
  org_id aihw_ref NOT NULL REFERENCES orgs (id)
);
CREATE INDEX s25_task_done_seq ON deeds (seq) WHERE kind = 'task_done' AND verb = 'task';
CREATE INDEX s25_npc_due ON chars (revive_tick) WHERE kind = 'npc' AND life = 'dead';
CREATE TABLE s25_npc_clock (
  char_id aihw_ref PRIMARY KEY REFERENCES chars (id),
  patrol_tick aihw_seq NOT NULL,
  coin_tick aihw_seq NOT NULL
);
