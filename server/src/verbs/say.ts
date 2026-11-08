// [S12 owns this file after S9] say (动词表 §4.6): place speech or direct message.
// Text goes through speech/sanitize.ts and lives only in speech/store.ts; the fact
// store keeps the speech event (who / to whom / when / channel), never the text.
// No deed is written for speech itself (事实格式 §13 keeps no chat history); the one exception is the
// S46 `discourse` deed, written by growth/discourse.ts when this sentence completes a discourse.

import { getRow } from "../facts/store.ts";
import type { Change, EventRow, ID } from "../facts/types.ts";
import { settleDiscourse } from "../growth/discourse.ts";
import { NO_DETAILS, reject } from "../protocol/errors.ts";
import { charId } from "../protocol/shapes.ts";
import { nullable, obj, opt, str, type Out } from "../protocol/validate.ts";
import { requireRule } from "../rules/world_rules.ts";
import { sanitizeText } from "../speech/sanitize.ts";
import { defineVerb } from "./types.ts";

const args = obj({ text: str(), target: opt(nullable(charId), null) });
export type SayArgs = Out<typeof args>;
export interface SayResult {
  channel: "place" | "direct";
  target: ID | null;
  other_speech: string;
  speech_status: "available";
  delivered_event_ids: ID[];
  /** S46: only when this sentence completed a discourse: the speaker's own xp / potential changes. */
  changes?: Change[];
  /**
   * S54: only when this sentence was said directly to an NPC at the same place. The NPC answers with one
   * fixed line (no LLM); `text` is that line and `event_id` is its speech event.
   */
  npc_reply?: { from: ID; text: string; event_id: ID };
}

export const def = defineVerb<SayArgs, SayResult>({
  verb: "say",
  summary:
    "向当前地点说话，或向任意地点的人物发送私话；对同地 NPC 发私话（target 填该 NPC）可获规则回复。随时自由聊天，空聊不发修为；与玩家或官方人物完成合格交付、悬赏、同杀或授技，双方可得论道修为。",
  errors: ["NOT_FOUND", "NOT_HERE"],
  args,
  lock: "world",
  auth: () => true,
  costKey: () => "say",
  async handler(ctx, a) {
    const me = ctx.actor;
    if (me === null) throw new Error("say without actor");
    const textMax = requireRule(ctx.rules, "text_max_chars");
    const ttl = requireRule(ctx.rules, "speech_ttl_ticks");
    // Length is counted on what the speaker sent, in Unicode code points; an empty message is not a message.
    const n = [...a.text].length;
    if (n < 1 || n > textMax) {
      reject("INVALID_ARGUMENT", { expected: `string of 1 to ${textMax} characters` }, "args.text");
    }

    let event: EventRow;
    if (a.target === null) {
      event = await ctx.w.emit({
        scope: "place",
        place_id: me.loc,
        type: "speech",
        deed_id: null,
        data: { speaker: me.id, channel: "place", target: null },
      });
    } else {
      const target = await getRow(ctx.q, "char", a.target);
      if (target === null) reject("NOT_FOUND", NO_DETAILS, "args.target");
      // Only draft / active can receive; dormant / buried say their state, never a location.
      if (target.state !== "draft" && target.state !== "active") {
        reject("STATE_BLOCKED", { state: target.state, required_action: "enter" });
      }
      event = await ctx.w.emit({
        scope: "self",
        recipients: [me.id, target.id],
        type: "speech",
        deed_id: null,
        data: { speaker: me.id, channel: "direct", target: target.id },
      });
    }

    // S46 / S54 论道: this sentence may complete one (reward + deed, same transaction), or be said to an NPC.
    const settled = await settleDiscourse(ctx, event, a.text);

    // Last step of the handler: the in-memory text must not outlive a rollback.
    const clean = sanitizeText(a.text);
    const expires = String(BigInt(ctx.tick) + BigInt(ttl));
    await ctx.services.speech.persist(ctx.q, event.id, clean, expires, ctx.tick);
    if (settled.npcReply !== null) await ctx.services.speech.persist(ctx.q, settled.npcReply.event_id, settled.npcReply.text, expires, ctx.tick);
    return {
      channel: a.target === null ? "place" : "direct",
      target: a.target,
      other_speech: clean,
      speech_status: "available",
      delivered_event_ids: settled.npcReply === null ? [event.id] : [event.id, settled.npcReply.event_id],
      ...(settled.changes.length > 0 ? { changes: settled.changes } : {}),
      ...(settled.npcReply === null ? {} : { npc_reply: { from: settled.npcReply.from, text: settled.npcReply.text, event_id: settled.npcReply.event_id } }),
    };
  },
});
