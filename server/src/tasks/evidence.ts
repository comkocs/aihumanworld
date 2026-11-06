// [S24] Task evidence (事实格式 §9.1). Presence (find / reach place) is written
// on look / go as a self `discover` deed; gather evidence is the `take` deed;
// slay is counted at submit from S10's combat deeds read as facts (combat_win
// whose changes show the victim dead; duels never count). Evidence is
// deduplicated and only facts after accepted_seq count.

import type { Queryable } from "../db/db.ts";
import { getRow, selectRows } from "../facts/store.ts";
import type { Change, CharRow, DeedRow, ID, ItemInstanceRow, PlaceRow, TaskInstanceRow, Tick } from "../facts/types.ts";
import type { Writer } from "../facts/writer.ts";
import { emitTaskChanged, merged, must } from "./common.ts";

export interface Tx {
  q: Queryable;
  w: Writer;
  tick: Tick;
}

async function acceptedTasks(q: Queryable, charId: ID, tpls: string, tick: Tick): Promise<TaskInstanceRow[]> {
  const rows = await selectRows(
    q,
    "task",
    `record = 'instance' AND state = 'accepted' AND taker = $1 AND tpl IN (${tpls}) AND expires_tick > $2`,
    [charId, tick],
    'ORDER BY id COLLATE "C"',
  );
  return rows as TaskInstanceRow[];
}

async function addEvidence(tx: Tx, t: TaskInstanceRow, deedId: ID): Promise<Change> {
  const progress = { count: t.progress.count + 1, evidence: [...t.progress.evidence, deedId] };
  const change = must(await tx.w.update("task", t.id, { progress }));
  await emitTaskChanged(tx.w, merged(t, { progress }, tx.tick), deedId);
  return change;
}

/** find / reach-place evidence for the char's accepted tasks at `place` (one per task). */
export async function presenceEvidence(tx: Tx, char: CharRow, place: PlaceRow, verb: "look" | "go"): Promise<Change[]> {
  const changes: Change[] = [];
  for (const t of await acceptedTasks(tx.q, char.id, "'find', 'reach'", tx.tick)) {
    if (t.progress.count >= 1) continue;
    const c = t.condition;
    let target: ID | null = null;
    if (c.tpl === "reach" && c.mode === "place" && c.place === place.id) target = place.id;
    if (c.tpl === "find") {
      const who = await getRow(tx.q, "char", c.target);
      if (who !== null && who.id !== char.id && who.loc === place.id && who.life === "alive" && who.state !== "buried") target = who.id;
    }
    if (target === null) continue;
    const deed = await tx.w.deed({
      actor: char.id,
      verb,
      kind: "discover",
      targets: [target, t.id],
      place_id: place.id,
      result: { outcome: "success", changes: [], roll: null, proposal: null },
      visibility: "self",
      participants: [char.id],
    });
    changes.push(await addEvidence(tx, t, deed.id));
  }
  return changes;
}

/** gather evidence: the take deed of a matching instance, one per item. */
export async function gatherEvidence(tx: Tx, char: CharRow, item: ItemInstanceRow, takeDeed: ID): Promise<Change[]> {
  const changes: Change[] = [];
  for (const t of await acceptedTasks(tx.q, char.id, "'gather'", tx.tick)) {
    const c = t.condition;
    if (c.tpl !== "gather" || c.item_def !== item.def_id || t.progress.count >= c.count) continue;
    if (t.progress.evidence.length > 0) {
      const seen = (await selectRows(
        tx.q,
        "deed",
        "id IN (SELECT jsonb_array_elements_text($1::jsonb))",
        [JSON.stringify(t.progress.evidence)],
      )) as DeedRow[];
      if (seen.some((d) => d.targets.includes(item.id))) continue;
    }
    changes.push(await addEvidence(tx, t, takeDeed));
  }
  return changes;
}

/** Deeds proving the slay condition since acceptance (at most condition.count). */
export async function slayEvidence(q: Queryable, char: CharRow, t: TaskInstanceRow): Promise<ID[]> {
  const c = t.condition;
  if (c.tpl !== "slay" || t.accepted_seq === null) return [];
  const deeds = (await selectRows(
    q,
    "deed",
    "actor = $1 AND kind = 'combat_win' AND seq > $2",
    [char.id, t.accepted_seq],
    "ORDER BY seq",
  )) as DeedRow[];
  const out: ID[] = [];
  for (const d of deeds) {
    const snap = d.result.roll?.inputs.target ?? null;
    const victim = snap?.char_id ?? d.targets.find((x) => x !== char.id) ?? null;
    if (victim === null) continue;
    const died = d.result.changes.some((ch) => ch.table === "char" && ch.id === victim && ch.after.life === "dead");
    if (!died) continue;
    let ok: boolean;
    if (c.target !== null) {
      ok = victim === c.target;
    } else {
      const v = snap ?? (await getRow(q, "char", victim));
      ok = v !== null && v.archetype === c.archetype && v.tier === c.tier;
    }
    if (ok) out.push(d.id);
    if (out.length >= c.count) break;
  }
  return out;
}
