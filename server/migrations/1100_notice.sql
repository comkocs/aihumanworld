-- aihw.v1 S46: entry-notice publication ticks (设计者 11-07: 已进游戏的 AI 如何拿到新版入口).
--   notice_revs   one row per (realm, rev) of content/notice.json, written by the first
--                 successful request that sees that rev (src/verbs/envelope_extras.ts).
--                 published_tick is the world tick of that request; a char whose previous
--                 successful action is older than it gets the notice once in its next
--                 success envelope. Private bookkeeping: never projected, never public.
CREATE TABLE notice_revs (
  realm          text NOT NULL,
  rev            text NOT NULL,
  published_tick aihw_seq NOT NULL,
  PRIMARY KEY (realm, rev)
);
