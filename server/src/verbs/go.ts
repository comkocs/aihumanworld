// [S24] go (动词表 §4.5): walk one exit of the current place.
// Effect: char.loc → exit target, known_places, deed travel (place-visible,
// public fields only), discover / first_found on first arrival (personal arrival
// bonus, plus a world-first deed), find / reach evidence via tasks/hooks.ts,
// moved to self + source and target place. No task completes by itself.
// Guard rule (S5 has no number for it): a guard NPC alive and present at the
// place stops a char with an active wanted record in that place's region.

import type { ClockCtx } from "../clock/phases.ts";
import { noteFirstCrossing } from "../facts/firsts.ts";
import { openWorldEvent, secretRealmBonus } from "../world_events/clock.ts";
import { countRows, getRow, mustGetRow } from "../facts/store.ts";
import type { Change, CharRow, ID, PlaceRow, ReputationRow, Reward } from "../facts/types.ts";
import { NO_DETAILS, reject } from "../protocol/errors.ts";
import { direction } from "../protocol/shapes.ts";
import { obj, type Out } from "../protocol/validate.ts";
import { bonusReward, creditGrowth, merged, must, publicChanges } from "../tasks/common.ts";
import { recordPresenceEvidence } from "../tasks/hooks.ts";
import { taskNumbers, tierNumbers } from "../tasks/numbers.ts";
import { defineVerb, type VerbContext } from "./types.ts";

const args = obj({ dir: direction });
export type GoArgs = Out<typeof args>;
export interface GoResult {
  from: ID;
  to: ID;
  changes: Change[];
}

/** S72: true when an open secret realm has waived the key on this exact door. */
async function realmDoorWaived(q: VerbContext["q"], placeId: ID, dir: string): Promise<boolean> {
  const row = await openWorldEvent(q);
  if (row === null || row.kind !== "secret_realm") return false;
  const spawned = Array.isArray(row.spawned) ? row.spawned : [];
  return spawned.some((e) => typeof e === "object" && e !== null &&
    (e as { place_id?: unknown }).place_id === placeId && (e as { dir?: unknown }).dir === dir);
}

async function guardStops(ctx: VerbContext, guardId: ID, here: PlaceRow, me: CharRow): Promise<boolean> {
  const g = await getRow(ctx.q, "char", guardId);
  if (g === null || g.life !== "alive" || g.loc !== here.id || g.state === "buried") return false;
  const wanted = await countRows(
    ctx.q,
    "wanted",
    "char_id = $1 AND region = $2 AND state = 'active' AND until_tick > $3",
    [me.id, here.region, ctx.tick],
  );
  return wanted > 0;
}

export async function arrivalReward(ctx: Pick<ClockCtx, "q" | "w" | "balance">, me: CharRow, dest: PlaceRow, verb: "go" | "clock", knownChange: Change | null): Promise<{ row: CharRow; changes: Change[] }> {
  const { w } = ctx;
  if (me.kind === "npc") return { row: me, changes: [] };
  const firstKey = `first_found:${dest.id}`;
  const first = !(await w.firstTaken(firstKey));
  // Maps and look can reveal places without a visit. Revivals use a null actor.
  const arrived = await countRows(
    ctx.q, "deed",
    "place_id = $2 AND ((actor = $1 AND ((verb = 'go' AND kind = 'travel') OR (verb = 'enter' AND kind = 'identity'))) OR (verb = 'clock' AND kind = 'revive' AND targets @> $3::jsonb))",
    [me.id, dest.id, JSON.stringify([me.id])],
  );
  let cur = me;
  let bonus: { changes: Change[]; reward: Reward; rep: ReputationRow | null } | null = null;
  if (arrived === 0) {
    const n = taskNumbers(ctx.balance);
    const reward = bonusReward(n.bonus.first_found, tierNumbers(n, Math.min(me.tier, dest.tier)));
    const g = await creditGrowth(ctx.q, w, cur, reward);
    cur = g.row;
    bonus = { changes: g.changes, reward, rep: g.rep };
  }
  if (knownChange !== null || first || bonus !== null) {
    const own = [...(knownChange === null ? [] : [knownChange]), ...(bonus?.changes ?? [])];
    const d = await w.deed({
      actor: me.id, verb, kind: "discover", targets: [dest.id], place_id: dest.id,
      result: { outcome: "success", changes: own, roll: null, proposal: null },
      visibility: "self", participants: [me.id],
    });
    await w.emit({ scope: "self", recipients: [me.id], type: "discovered", deed_id: d.id, data: { char_id: me.id, target: dest.id, first } });
    if (bonus !== null) {
      await w.emit({ scope: "self", recipients: [me.id], type: "reward_granted", deed_id: d.id, data: { char_id: me.id, source: d.id, reward: bonus.reward } });
      await w.emit({ scope: "self", recipients: [me.id], type: "fact_changed", deed_id: d.id, data: { changes: bonus.changes } });
      if (bonus.rep !== null) await w.emit({ scope: "self", recipients: [me.id], type: "reputation_changed", deed_id: d.id, data: { reputation: bonus.rep } });
    }
  }
  if (first) {
    const fd = await w.deed({
      actor: me.id, verb, kind: "first_found", targets: [dest.id], place_id: dest.id,
      result: { outcome: "success", changes: [], roll: null, proposal: null },
      visibility: "world", participants: [me.id], first_key: firstKey,
    });
    await w.emit({ scope: "world", type: "discovered", deed_id: fd.id, data: { char_id: me.id, target: dest.id, first: true } });
  }
  return { row: cur, changes: bonus?.changes ?? [] };
}

export const def = defineVerb<GoArgs, GoResult>({
  verb: "go",
  summary: "沿当前地点的指定方向出口移动；锁门须先 use unlock。",
  errors: ["NOT_FOUND", "EXIT_BLOCKED"],
  args,
  lock: "world",
  auth: () => true,
  costKey: () => "go",
  async handler(ctx, a) {
    const me = ctx.actor;
    if (me === null) throw new Error("go without actor");
    const { w } = ctx;
    const here = await mustGetRow(ctx.q, "place", me.loc);
    const exit = here.exits.find((e) => e.dir === a.dir);
    if (exit === undefined) return reject("NOT_FOUND", NO_DETAILS, "args.dir");
    // S72: while a secret realm is open, the one door it unbarred needs no key. The
    // clock puts the lock back at the close, so this only widens the window.
    const waived = exit.locked && (await realmDoorWaived(ctx.q, here.id, exit.dir));
    if (exit.locked && !waived) return reject("EXIT_BLOCKED", { reason: "locked" });
    if (exit.guard !== null && (await guardStops(ctx, exit.guard, here, me))) return reject("EXIT_BLOCKED", { reason: "guard" });
    const dest = await getRow(ctx.q, "place", exit.to);
    if (dest === null) return reject("NOT_FOUND", NO_DETAILS, "args.dir");

    const fresh = !me.known_places.includes(dest.id);
    const patch: Partial<CharRow> = fresh ? { loc: dest.id, known_places: [...me.known_places, dest.id] } : { loc: dest.id };
    const moveChange = must(await w.update("char", me.id, patch));
    let cur = merged(me, patch, ctx.tick);
    const changes: Change[] = [moveChange];

    const arrival = await arrivalReward(ctx, cur, dest, "go", fresh ? moveChange : null);
    cur = arrival.row;
    changes.push(...arrival.changes);

    // S72: the first non-NPC through a secret realm's door takes a small once-only bonus.
    const realm = await secretRealmBonus(ctx, cur, dest);
    if (realm !== null) {
      cur = realm.row;
      changes.push(...realm.changes);
      const d = await w.deed({
        actor: me.id, verb: "go", kind: "world_event", targets: [dest.id], place_id: dest.id,
        result: { outcome: "success", changes: realm.changes, roll: null, proposal: null },
        visibility: "world", participants: [me.id],
      });
      await w.emit({ scope: "self", recipients: [me.id], type: "reward_granted", deed_id: d.id, data: { char_id: me.id, source: d.id, reward: { ...realm.reward, items: [] } } });
    }

    const travel = await w.deed({
      actor: me.id,
      verb: "go",
      kind: "travel",
      targets: [dest.id],
      place_id: dest.id,
      result: { outcome: "success", changes: publicChanges([moveChange]), roll: null, proposal: null },
      visibility: "place",
      participants: [me.id],
    });
    const moved = { char_id: me.id, from: here.id, to: dest.id };
    await w.emit({ scope: "self", recipients: [me.id], type: "moved", deed_id: travel.id, data: moved });
    await w.emit({ scope: "place", place_id: here.id, type: "moved", deed_id: travel.id, data: moved });
    await w.emit({ scope: "place", place_id: dest.id, type: "moved", deed_id: travel.id, data: moved });

    ctx.actor = cur;
    // S62: first of this origin region to step into another origin region's start place.
    await noteFirstCrossing(w, cur, dest);
    changes.push(...(await recordPresenceEvidence(ctx, cur, dest, "go")));
    return { from: here.id, to: dest.id, changes };
  },
});
