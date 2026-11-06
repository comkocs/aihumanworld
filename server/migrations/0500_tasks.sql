-- aihw.v1 task system (S24), migration 0500. Indexes only, no new facts.
--   tasks_instance_personal      personal system offers of a char (supply, list)
--   tasks_instance_char_issuer   open bounties of an issuer (bounty_open_max)
--   tasks_template_tier          template pick by tier / stage (supply)
--   deeds_actor_kind_seq         a char's combat deeds after acceptance (slay)
--   chars_buried                 buried chars whose tasks the expiry phase releases
CREATE INDEX tasks_instance_personal ON tasks (eligible_char, state)
  WHERE record = 'instance' AND eligible_char IS NOT NULL;
CREATE INDEX tasks_instance_char_issuer ON tasks ((issuer ->> 'id'), state)
  WHERE record = 'instance' AND issuer ->> 'kind' = 'char';
CREATE INDEX tasks_template_tier ON tasks (tier, stage)
  WHERE record = 'template';
CREATE INDEX deeds_actor_kind_seq ON deeds (actor, kind, seq)
  WHERE actor IS NOT NULL;
CREATE INDEX chars_buried ON chars (id)
  WHERE state = 'buried';
