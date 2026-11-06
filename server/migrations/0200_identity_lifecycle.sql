-- aihw.v1 identity lifecycle (S11), migration 0200.
-- Tick-phase scans of the identity state machine (src/identity/lifecycle.ts):
--   chars_lifecycle    player drafts (promotion candidates) and idle players
--                      drifting toward dormant / buried;
--   identities_expires credential rows whose revive window is running out.
CREATE INDEX chars_lifecycle ON chars (state, last_seen_tick)
  WHERE kind = 'player' AND state IN ('draft', 'active', 'dormant');
CREATE INDEX identities_expires ON identities (expires_tick)
  WHERE expires_tick IS NOT NULL;
