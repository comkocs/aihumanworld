// [S24] go (动词表 §4.5): walk one exit of the current place.
// Effect: char.loc → exit target, known_places, deed travel (place-visible,
// public fields only), discover / first_found on first arrival (S5 first_found
// bonus to the world's first finder), find / reach evidence via tasks/hooks.ts,
// moved to self + source and target place. No task completes by itself.
// Guard rule (S5 has no number for it): a guard NPC alive and present at the
// place stops a char with an active wanted record in that place's region.

import { noteFirstCrossing } from "../facts/firsts.ts";
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
    if (exit.locked) return reject("EXIT_BLOCKED", { reason: "locked" });
    if (exit.guard !== null && (await guardStops(ctx, exit.guard, here, me))) return reject("EXIT_BLOCKED", { reason: "guard" });
    const dest = await getRow(ctx.q, "place", exit.to);
    if (dest === null) return reject("NOT_FOUND", NO_DETAILS, "args.dir");

    const fresh = !me.known_places.includes(dest.id);
    const patch: Partial<CharRow> = fresh ? { loc: dest.id, known_places: [...me.known_places, dest.id] } : { loc: dest.id };
    const moveChange = must(await w.update("char", me.id, patch));
    let cur = merged(me, patch, ctx.tick);
    const changes: Change[] = [moveChange];

    const firstKey = `first_found:${dest.id}`;
    const first = me.kind !== "npc" && !(await w.firstTaken(firstKey));
    let bonus: { changes: Change[]; reward: Reward; rep: ReputationRow | null } | null = null;
    if (first) {
      const n = taskNumbers(ctx.balance);
      const reward = bonusReward(n.bonus.first_found, tierNumbers(n, dest.tier));
      const g = await creditGrowth(ctx.q, w, cur, reward);
      cur = g.row;
      bonus = { changes: g.changes, reward, rep: g.rep };
      changes.push(...g.changes);
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

    if (fresh || first) {
      const own = fresh ? [moveChange, ...(bonus?.changes ?? [])] : [...(bonus?.changes ?? [])];
      const d = await w.deed({
        actor: me.id,
        verb: "go",
        kind: "discover",
        targets: [dest.id],
        place_id: dest.id,
        result: { outcome: "success", changes: own, roll: null, proposal: null },
        visibility: "self",
        participants: [me.id],
      });
      await w.emit({ scope: "self", recipients: [me.id], type: "discovered", deed_id: d.id, data: { char_id: me.id, target: dest.id, first } });
    }
    if (first && bonus !== null) {
      const fd = await w.deed({
        actor: me.id,
        verb: "go",
        kind: "first_found",
        targets: [dest.id],
        place_id: dest.id,
        result: { outcome: "success", changes: [], roll: null, proposal: null },
        visibility: "world",
        participants: [me.id],
        first_key: firstKey,
      });
      await w.emit({ scope: "world", type: "discovered", deed_id: fd.id, data: { char_id: me.id, target: dest.id, first: true } });
      await w.emit({ scope: "self", recipients: [me.id], type: "reward_granted", deed_id: fd.id, data: { char_id: me.id, source: fd.id, reward: bonus.reward } });
      if (bonus.rep !== null) {
        await w.emit({ scope: "self", recipients: [me.id], type: "reputation_changed", deed_id: fd.id, data: { reputation: bonus.rep } });
      }
    }

    ctx.actor = cur;
    // S62: first of this origin region to step into another origin region's start place.
    await noteFirstCrossing(w, cur, dest);
    changes.push(...(await recordPresenceEvidence(ctx, cur, dest, "go")));
    return { from: here.id, to: dest.id, changes };
  },
});
