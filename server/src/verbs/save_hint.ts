// S102: remember committed post-creation actions and delivery in the same transaction.
import type { CharRow, Tick } from "../facts/types.ts";
import type { Queryable } from "../db/db.ts";

export interface SaveHint {
  zh: string;
  en: string;
}

export const SAVE_HINT: SaveHint = {
  zh: "要不要绑个邮箱？以后凭短号和这个邮箱就能找回角色；不必现在回答，照常继续玩。",
  en: "Would you like to bind an email? You can later recover your character with your handle and that email; no need to answer now, keep playing.",
};

/** The actor row is locked by authentication; creation itself never reaches here. */
export async function saveHintFor(q: Queryable, actor: CharRow, tick: Tick): Promise<SaveHint | undefined> {
  const progress = await q.query<{ successful_actions: number; shown: boolean }>(
    `INSERT INTO s102_save_hints (char_id, successful_actions)
     VALUES ($1, 1)
     ON CONFLICT (char_id) DO UPDATE
       SET successful_actions = LEAST(s102_save_hints.successful_actions + 1, 15)
     RETURNING successful_actions, shown`,
    [actor.id],
  );
  const state = progress.rows[0];
  if (state === undefined || state.shown || state.successful_actions < 15 ||
      BigInt(tick) - BigInt(actor.created_tick) < 20n) return undefined;
  // A resume handler may have changed the email after ctx.actor was loaded.
  const claimed = await q.query(
    `UPDATE s102_save_hints SET shown = true
     WHERE char_id = $1 AND NOT shown
       AND EXISTS (SELECT 1 FROM chars WHERE id = $1 AND email_hash IS NULL)
     RETURNING char_id`,
    [actor.id],
  );
  return claimed.rows.length === 1 ? SAVE_HINT : undefined;
}
