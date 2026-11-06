-- aihw.v1 S32: player handles and email continuation (设计者原话 2026-11-06).
--   chars.handle      public player short id, one uppercase letter + 5..7
--                     digits (A00001 … Z9999999), globally unique, never
--                     reused; only player chars carry one. Numbering comes
--                     from aihw_handle_seq; existing players are backfilled
--                     in creation order at startup (src/identity/handles.ts).
--   chars.email_hash  optional continuation token: sha256("aihw-email:" +
--                     normalized address), null = unbound; the raw address is
--                     never stored.
--   identities        one char may hold several valid codes (email resume
--                     issues a fresh one; cap 20, oldest retired in
--                     src/verbs/enter.ts), so char_id stops being unique.

ALTER TABLE chars ADD COLUMN handle text CHECK (handle ~ '^[A-Z][0-9]{5,7}$');
ALTER TABLE chars ADD COLUMN email_hash text CHECK (email_hash IS NULL OR email_hash ~ '^[0-9a-f]{64}$');
CREATE UNIQUE INDEX chars_handle ON chars (handle) WHERE handle IS NOT NULL;
CREATE INDEX chars_player_unhandled ON chars (created_tick) WHERE kind = 'player' AND handle IS NULL;

ALTER TABLE identities DROP CONSTRAINT IF EXISTS identities_char_id_key;
CREATE INDEX identities_char ON identities (char_id);

CREATE SEQUENCE aihw_handle_seq;
