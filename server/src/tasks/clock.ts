// [S24] Task tick phases.
// taskExpiryPhase (first tick phase, 事实格式 §3.1 / §9): open and accepted
// instances whose expires_tick has come → expired; escrow not paid out goes back
// (char issuer refunded, system escrow reclaimed: coin gone, items consumed).
// taskBuriedPhase (right after identity_lifecycle, so a burial is settled in the
// same tick; 事实格式 §6 「入土时释放在办任务并退款／归还托管」): buried chars, read
// as facts (S11 code is not called) — accepted tasks they held go back to open
// (their personal system offers expire), their open bounties are cancelled with
// the escrow refunded to them. Player coin is conserved: escrow moves back to the
// issuer's balance, nothing is created or destroyed.

import type { ClockCtx, ClockPhase } from "../clock/phases.ts";
import { selectRows } from "../facts/store.ts";
import type { ID, TaskInstanceRow } from "../facts/types.ts";
import {
  emitItem,
  emitTaskChanged,
  publicChanges,
  releaseTask,
  reopenTask,
  taskAudience,
  type Released,
} from "./common.ts";

const BURIED = "(SELECT id FROM chars WHERE state = 'buried')";

async function rows(c: ClockCtx, where: string, params: unknown[] = []): Promise<TaskInstanceRow[]> {
  return (await selectRows(c.q, "task", `record = 'instance' AND ${where}`, params, 'ORDER BY id COLLATE "C"')) as TaskInstanceRow[];
}

async function releaseDeed(c: ClockCtx, t: TaskInstanceRow, changes: Released["changes"], audience: ID[]): Promise<ID | null> {
  if (audience.length === 0) return null;
  const d = await c.w.deed({
    actor: null,
    verb: "clock",
    kind: "task_release",
    targets: [t.id],
    place_id: t.offer_place,
    result: { outcome: "success", changes: publicChanges(changes), roll: null, proposal: null },
    visibility: "self",
    participants: audience,
  });
  return d.id;
}

/** Ends a task with its escrow settled; an untouched personal system offer leaves no deed. */
export async function endTask(c: ClockCtx, t: TaskInstanceRow, state: "cancelled" | "expired"): Promise<void> {
  const rel = await releaseTask(c.q, c.w, t, state);
  const quietOffer = t.issuer.kind === "system" && t.taker === null;
  const deedId = quietOffer ? null : await releaseDeed(c, t, rel.changes, taskAudience(rel.task));
  await emitTaskChanged(c.w, rel.task, deedId);
  if (rel.issuer !== null && rel.issuer.changes.length > 0) {
    await c.w.emit({ scope: "self", recipients: [rel.issuer.id], type: "fact_changed", deed_id: deedId, data: { changes: rel.issuer.changes } });
  }
  for (const it of rel.items) {
    if (it.reason === "refund" && rel.issuer !== null) await emitItem(c.w, it.row, "refund", [rel.issuer.id], deedId);
  }
}

export const taskExpiryPhase: ClockPhase = {
  name: "task_expiry",
  owner: "S24",
  async run(c) {
    for (const t of await rows(c, "state IN ('open', 'accepted') AND expires_tick <= $1", [c.to_tick])) {
      await endTask(c, t, "expired");
    }
  },
};

export const taskBuriedPhase: ClockPhase = {
  name: "task_buried_release",
  owner: "S24",
  async run(c) {
    for (const t of await rows(c, `state = 'accepted' AND taker IN ${BURIED}`)) {
      if (t.kind === "system" && t.eligible_char !== null) {
        await endTask(c, t, "expired");
        continue;
      }
      const audience = taskAudience(t);
      const r = await reopenTask(c.w, t);
      const deedId = await releaseDeed(c, t, [r.change], audience);
      await emitTaskChanged(c.w, r.task, deedId, audience);
    }
    const lost = `state = 'open' AND ((issuer ->> 'kind' = 'char' AND issuer ->> 'id' IN ${BURIED}) OR eligible_char IN ${BURIED})`;
    for (const t of await rows(c, lost)) {
      await endTask(c, t, t.issuer.kind === "char" ? "cancelled" : "expired");
    }
  },
};
