// [S11 owns this file after S9] Identity lifecycle tick phase (事实格式 §6;
// 起算口径照数值表_v1 §9). Runs once per tick from→to, inside the tick
// transaction that already holds the world row lock:
//   promotion  draft with a completed system task instance → active
//              (reason first_system_task). Runs before the draft TTL so a
//              promoted char is never expired as a draft (转正不是闸).
//   dormancy   active unseen dormant_after_ticks since last_seen_tick → dormant
//   burial     active | dormant unseen bury_after_ticks since last_seen_tick →
//              buried; identity.expires_tick = bury tick + revive_window_ticks
//              (window runs from the bury tick, 数值表 §9).
//   draft TTL  draft older than draft_expire_ticks since created_tick → buried
//              with the credential row deleted — no revive window for an
//              expired draft (事实格式 §6 「draft 到期转 buried 并清除 identity」).
//   window     credential rows with expires_tick ≤ to are deleted; the char
//              stays buried, biography and deeds remain.
// Every state transition writes a `clock` deed (kind identity) and emits
// identity_state to the char's self layer. Null rule slots disable the matching
// branch — the phase never invents defaults. NPCs hold no identity and never
// change state here. Credential deletion releases nothing else: releasing
// accepted tasks / escrow on burial belongs to the task stream's own hooks.

import type { ClockCtx, ClockPhase } from "../clock/phases.ts";
import { selectRows, updateRow } from "../facts/store.ts";
import type { CharRow, Change } from "../facts/types.ts";

async function transition(ctx: ClockCtx, c: CharRow, to: IdentityTarget, reason: "idle" | "expired"): Promise<void> {
  const changes: Change[] = [];
  const ch = await updateRow(ctx.q, "char", c.id, { state: to, state_since: ctx.to_tick }, ctx.to_tick);
  if (ch !== null) changes.push(ch);
  const deed = await ctx.w.deed({
    actor: c.id,
    verb: "clock",
    kind: "identity",
    targets: [c.id],
    place_id: c.loc,
    result: { outcome: "success", changes, roll: null, proposal: null },
    visibility: "self",
    participants: [c.id],
  });
  await ctx.w.emit({
    scope: "self",
    recipients: [c.id],
    type: "identity_state",
    deed_id: deed.id,
    data: { char_id: c.id, from: c.state, to, reason },
  });
}

type IdentityTarget = "dormant" | "buried";

export const identityPhase: ClockPhase = {
  name: "identity_lifecycle",
  owner: "S11",
  async run(ctx: ClockCtx): Promise<void> {
    const to = ctx.to_tick;
    const toNum = Number(to);

    // Promotion: first completed system task instance turns a draft active.
    // Judged from facts only (task instance preferred; no task-stream code).
    const drafts = await selectRows(
      ctx.q,
      "char",
      "kind = 'player' AND state = 'draft' AND EXISTS (SELECT 1 FROM tasks WHERE record = 'instance' AND kind = 'system' AND state = 'completed' AND taker = chars.id)",
    );
    for (const c of drafts) {
      const ch = await updateRow(ctx.q, "char", c.id, { state: "active", state_since: to }, to);
      const deed = await ctx.w.deed({
        actor: c.id,
        verb: "clock",
        kind: "identity",
        targets: [c.id],
        place_id: c.loc,
        result: { outcome: "success", changes: ch === null ? [] : [ch], roll: null, proposal: null },
        visibility: "self",
        participants: [c.id],
      });
      await ctx.w.emit({
        scope: "self",
        recipients: [c.id],
        type: "identity_state",
        deed_id: deed.id,
        data: { char_id: c.id, from: "draft", to: "active", reason: "first_system_task" },
      });
    }

    // Burial: unseen past bury_after_ticks (from last_seen_tick). Checked before
    // dormancy so a char old enough for both lands in the final state directly.
    const bury = ctx.rules.bury_after_ticks;
    if (bury !== null) {
      const rows = await selectRows(
        ctx.q,
        "char",
        "kind = 'player' AND state IN ('active', 'dormant') AND last_seen_tick + $1::bigint <= $2::bigint",
        [String(bury), String(toNum)],
      );
      for (const c of rows) {
        await transition(ctx, c, "buried", "idle");
        const window = ctx.rules.revive_window_ticks;
        if (window !== null) {
          const expires = toNum + window;
          const id = await selectRows(ctx.q, "identity", "char_id = $1", [c.id]);
          for (const row of id) await updateRow(ctx.q, "identity", row.id, { expires_tick: String(expires) }, to);
        }
      }
    }

    // Dormancy: unseen past dormant_after_ticks but not (or no longer) bury-old.
    const dormant = ctx.rules.dormant_after_ticks;
    if (dormant !== null) {
      const rows = await selectRows(
        ctx.q,
        "char",
        "kind = 'player' AND state = 'active' AND last_seen_tick + $1::bigint <= $2::bigint",
        [String(dormant), String(toNum)],
      );
      for (const c of rows) await transition(ctx, c, "dormant", "idle");
    }

    // Draft TTL: from created_tick (数值表 §9), credential cleared with no window.
    const draftTtl = ctx.rules.draft_expire_ticks;
    if (draftTtl !== null) {
      const rows = await selectRows(
        ctx.q,
        "char",
        "kind = 'player' AND state = 'draft' AND created_tick + $1::bigint <= $2::bigint",
        [String(draftTtl), String(toNum)],
      );
      for (const c of rows) {
        await transition(ctx, c, "buried", "expired");
        await ctx.q.query("DELETE FROM identities WHERE char_id = $1", [c.id]);
      }
    }

    // Revive window over: credential rows past expires_tick are deleted; no
    // state change and no event (the char is already buried).
    await ctx.q.query("DELETE FROM identities WHERE expires_tick IS NOT NULL AND expires_tick <= $1::bigint", [
      String(toNum),
    ]);
  },
};
