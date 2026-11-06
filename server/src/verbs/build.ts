// [S12 owns this file after S9] build (动词表 §4.15): data definitions only,
// machine-checked (shape / references / in-tier numbers / unique content_key),
// no review queue. Checks live in src/build/ (check.ts pure, refs.ts database,
// limits.ts the S5 tables); this file validates the request shape, writes the
// definition, and records the deed and the `built` events.

import { TASK_TPLS } from "../facts/enums.ts";
import type { Change, ID, PlaceRow, ItemDefinitionRow, TaskTemplateRow } from "../facts/types.ts";
import { checkContentKey, checkItem, checkPlace, checkTask, CONTENT_KEY_RE, type CheckEnv } from "../build/check.ts";
import { buildLimits } from "../build/limits.ts";
import { checkAnchor, checkItemRefs, checkTaskRefs, ensureKeyFree } from "../build/refs.ts";
import { reject } from "../protocol/errors.ts";
import {
  combat,
  condition,
  danger,
  direction,
  element,
  features,
  itemEffect,
  itemKind,
  modifiers,
  orgId,
  placeId,
  placeKind,
  region,
  rewardSpec,
} from "../protocol/shapes.ts";
import { bad, grade, nullable, obj, oneOf, opt, stage, str, tier, uint, union, type Out, type V } from "../protocol/validate.ts";
import { requireRule } from "../rules/world_rules.ts";
import { sanitizeText } from "../speech/sanitize.ts";
import { defineVerb } from "./types.ts";

/** content.<realm>.<type>.<local>: a malformed key is INVALID_KEY, not a generic argument error. */
const contentKey: V<string> = (x, p) => {
  if (typeof x !== "string") return bad(p, "content key string");
  return CONTENT_KEY_RE.test(x) ? x : reject("INVALID_KEY", { expected: "content.<realm>.<type>.<local>" }, p);
};

const note = opt(nullable(str()), null);

const args = union("kind", {
  place: {
    data: obj({ content_key: contentKey, region, kind: placeKind, features, tier, danger, combat, owner_org: nullable(orgId) }),
    attach: obj({ from: placeId, dir: direction, back: direction }),
    note,
  },
  item: {
    data: obj({
      content_key: contentKey,
      kind: itemKind,
      tier,
      grade,
      element,
      slots: uint,
      cap: uint,
      dura_max: uint,
      modifiers,
      effect: itemEffect,
    }),
    note,
  },
  task: {
    data: obj({
      content_key: contentKey,
      tpl: oneOf(TASK_TPLS, "task template"),
      tier,
      stage,
      condition,
      reward_spec: rewardSpec,
      duration_ticks: uint,
    }),
    note,
  },
});
export type BuildArgs = Out<typeof args>;
export interface BuildResult {
  table: "place" | "item" | "task";
  id: ID;
  record: PlaceRow | ItemDefinitionRow | TaskTemplateRow;
  changes: Change[];
  other_speech: string | null;
}

export const def = defineVerb<BuildArgs, BuildResult>({
  verb: "build",
  args,
  lock: "world",
  auth: () => true,
  costKey: () => "build",
  async handler(ctx, a) {
    const me = ctx.actor;
    if (me === null) throw new Error("build without actor");
    const { w, q, tick } = ctx;

    const minTier = requireRule(ctx.rules, "build_min_tier");
    if (me.tier < minTier) reject("CONDITION_UNMET", { reason: "tier" });
    if (a.note !== null) {
      const textMax = requireRule(ctx.rules, "text_max_chars");
      if ([...a.note].length > textMax) {
        reject("INVALID_ARGUMENT", { expected: `string of at most ${textMax} characters` }, "args.note");
      }
    }
    const limits = buildLimits();
    // The S5 tables apply to the revision they were written for, not to whatever is loaded.
    if (limits.revision !== ctx.world.rules_revision) reject("RULES_UNSET", { rule_key: "numbers.revision" });
    const env: CheckEnv = {
      limits,
      builderTier: me.tier,
      socketMax: a.kind === "item" ? requireRule(ctx.rules, "socket_max") : 0,
    };
    checkContentKey(ctx.world.realm, a.kind, a.data.content_key);

    const changes: Change[] = [];
    const push = (c: Change | null): void => {
      if (c !== null) changes.push(c);
    };
    const stamp = { created_tick: tick, updated_tick: tick };
    let id: ID;
    let record: BuildResult["record"];
    const targets: ID[] = [];

    if (a.kind === "place") {
      checkPlace(a.data, env);
      const from = await checkAnchor(q, me, a.attach, a.data);
      await ensureKeyFree(q, "place", a.data.content_key);
      id = await w.newId("place");
      const row: PlaceRow = {
        id,
        ...stamp,
        ...a.data,
        exits: [{ dir: a.attach.back, to: from.id, locked: false, key_def: null, guard: null }],
        by: me.id,
      };
      push(await w.insert("place", row));
      // The new exit is appended to the anchor in the same transaction; existing exits are untouched.
      push(await w.update("place", from.id, { exits: [...from.exits, { dir: a.attach.dir, to: id, locked: false, key_def: null, guard: null }] }));
      record = row;
      targets.push(id, from.id);
    } else if (a.kind === "item") {
      checkItem(a.data, env);
      await ensureKeyFree(q, "item", a.data.content_key);
      await checkItemRefs(q, a.data);
      id = await w.newId("item");
      const row: ItemDefinitionRow = { id, ...stamp, record: "definition", ...a.data, by: me.id };
      push(await w.insert("item", row));
      record = row;
      targets.push(id);
    } else {
      checkTask(a.data, env);
      await ensureKeyFree(q, "task", a.data.content_key);
      await checkTaskRefs(q, a.data, limits);
      id = await w.newId("task");
      const row: TaskTemplateRow = { id, ...stamp, record: "template", ...a.data, by: me.id };
      push(await w.insert("task", row));
      record = row;
      targets.push(id);
    }

    const deed = await w.deed({
      actor: me.id,
      verb: "build",
      kind: "build",
      targets,
      place_id: me.loc,
      result: { outcome: "success", changes, roll: null, proposal: null },
      visibility: a.kind === "place" ? "place" : "self",
      participants: [me.id],
    });
    const data = { builder: me.id, table: a.kind, id, content_key: a.data.content_key };
    await w.emit({ scope: "self", recipients: [me.id], type: "built", deed_id: deed.id, data });
    if (a.kind === "place") await w.emit({ scope: "place", place_id: me.loc, type: "built", deed_id: deed.id, data });

    // The note is only echoed to the builder: 事实格式 §13 fixes other_speech to null for non-speech events.
    return { table: a.kind, id, record, changes, other_speech: a.note === null ? null : sanitizeText(a.note) };
  },
});
