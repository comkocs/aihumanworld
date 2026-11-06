// [S12 owns this file after S9] say (动词表 §4.6): place speech or direct message.
// Text goes through speech/sanitize.ts and lives only in speech/store.ts; the fact
// store keeps the speech event (who / to whom / when / channel), never the text.
// No deed is written (the deed kinds have no chat kind; 事实格式 §13 keeps no chat history).

import { getRow } from "../facts/store.ts";
import type { EventRow, ID } from "../facts/types.ts";
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
}

export const def = defineVerb<SayArgs, SayResult>({
  verb: "say",
  summary: "向当前地点说话，或向同地人物发送私话。",
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

    // Last step of the handler: the in-memory text must not outlive a rollback.
    const clean = sanitizeText(a.text);
    ctx.services.speech.put(event.id, clean, String(BigInt(ctx.tick) + BigInt(ttl)), ctx.tick);
    return {
      channel: a.target === null ? "place" : "direct",
      target: a.target,
      other_speech: clean,
      speech_status: "available",
      delivered_event_ids: [event.id],
    };
  },
});
