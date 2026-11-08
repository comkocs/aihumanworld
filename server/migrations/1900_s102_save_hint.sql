-- S102: committed post-creation actions and the one-time private save reminder.
CREATE TABLE s102_save_hints (
  char_id text PRIMARY KEY REFERENCES chars (id),
  successful_actions integer NOT NULL CHECK (successful_actions BETWEEN 1 AND 15),
  shown boolean NOT NULL DEFAULT false
);
