-- S86: sanitised speech text shares the event's transaction and expires by tick.
CREATE TABLE speech_texts (
  event_id text PRIMARY KEY REFERENCES events (id) ON DELETE CASCADE,
  text text NOT NULL,
  expires_tick aihw_seq NOT NULL
);
CREATE INDEX speech_texts_expiry ON speech_texts (expires_tick);
