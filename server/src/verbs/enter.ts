// [S11 owns this file after S9] enter — first entry (code issue) and resume
// (动词表 §4.1). `create`: A7-format code shown once, only SHA-256 stored,
// draft char with four base skills from 0, registry-org member bond, world
// reputation row, budget; initial tasks via the task hook. `resume` (S11):
// lifecycle restore — dormant / buried (inside the revive window) return to
// active, draft stays draft; display fields update when given; no code is
// re-issued and no initial assets are granted again. Life is never touched.

import { SKILL_BASES } from "../facts/enums.ts";
import { worldClientView, type WorldClientView } from "../facts/project.ts";
import { getRow, selectRows } from "../facts/store.ts";
import type {
  BondRow,
  Change,
  CharRow,
  IdentityRow,
  ReputationRow,
  SkillDefinitionRow,
  SkillLearnedRow,
  Tick,
} from "../facts/types.ts";
import { deriveStats, startValues } from "../growth/balance.ts";
import { generateCode, hashCode, type NewCode } from "../identity/code.ts";
import { reject } from "../protocol/errors.ts";
import { charClass, door, skin } from "../protocol/shapes.ts";
import { nullable, opt, str, union, type Out } from "../protocol/validate.ts";
import { requireRule } from "../rules/world_rules.ts";
import { sanitizeLabel } from "../speech/sanitize.ts";
import { supplyInitialTasks } from "../tasks/hooks.ts";
import { defineVerb, type VerbContext } from "./types.ts";

const args = union("mode", {
  create: {
    skin,
    door,
    class: opt(nullable(charClass), null),
    model: opt(nullable(str()), null),
  },
  resume: {
    skin: opt(skin, undefined),
    class: opt(nullable(charClass), undefined),
    door: opt(door, undefined),
    model: opt(nullable(str()), undefined),
  },
});
export type EnterArgs = Out<typeof args>;

export interface EnterResult {
  char: CharRow;
  /** Only on create, only once; never stored, logged or re-issued. */
  identity_code: string | null;
  created: boolean;
  changes: Change[];
  world: WorldClientView;
}

async function freshCode(ctx: VerbContext): Promise<{ code: NewCode; hash: string }> {
  for (let i = 0; i < 4; i += 1) {
    const code = generateCode();
    const hash = hashCode(code.normalized);
    const r = await ctx.q.query("SELECT 1 FROM identities WHERE code_hash = $1", [hash]);
    if (r.rows.length === 0) return { code, hash };
  }
  throw new Error("identity code space collision");
}

async function create(ctx: VerbContext, a: Extract<EnterArgs, { mode: "create" }>): Promise<EnterResult> {
  if (a.class !== null && a.skin !== "fantasy") {
    reject("INVALID_ARGUMENT", { expected: "null unless skin is fantasy" }, "args.class");
  }
  if (a.door !== ctx.door) {
    reject("INVALID_ARGUMENT", { expected: "door of the entry shell (api for /v1/actions)" }, "args.door");
  }
  const { w, world, tick } = ctx;
  const textMax = requireRule(ctx.rules, "text_max_chars");
  requireRule(ctx.rules, "ap_per_tick");
  const start = startValues(ctx.balance);

  const spawn = world.spawn_places[a.skin];
  const orgId = world.registry_orgs[a.skin];
  const org = await getRow(ctx.q, "org", orgId);
  if (org === null || !org.registry) throw new Error(`registry org of ${a.skin} missing`);
  const rank = org.ranks.find((r) => r.key === "org_rank.member") ?? org.ranks[0];
  if (rank === undefined) throw new Error(`registry org ${orgId} has no ranks`);
  const defs = (await selectRows(
    ctx.q,
    "skill",
    "record = 'definition' AND key IN ('strike', 'guard', 'move', 'inner')",
  )) as SkillDefinitionRow[];
  if (defs.length !== SKILL_BASES.length) throw new Error("base skill definitions missing");

  const { code, hash } = await freshCode(ctx);
  const charId = await w.newId("char");
  const base: CharRow = {
    id: charId,
    created_tick: tick,
    updated_tick: tick,
    kind: "player",
    door: ctx.door,
    model: sanitizeLabel(a.model, textMax),
    skin: a.skin,
    class: a.class,
    origin_region: a.skin,
    body: "humanoid",
    archetype: null,
    tier: 1,
    stage: 1,
    xp: 0,
    potential: 0,
    vigor: 0,
    coin: start.coin,
    cycles: 0,
    legacy: 0,
    loc: spawn,
    respawn_place: spawn,
    life: "alive",
    revive_tick: null,
    state: "draft",
    state_since: tick,
    last_seen_tick: tick,
    last_yield_tick: tick,
    ap_tick: tick,
    seen_at: ctx.now.toISOString().replace(".000Z", "Z"),
    ap_spent: 0,
    train_skill: null,
    day_index: world.day_index,
    system_tasks_today: 0,
    known_places: [spawn],
    patrol_route: [],
    patrol_index: 0,
  };
  const char: CharRow = { ...base, vigor: deriveStats(ctx.balance, base).vigor_max };

  const changes: Change[] = [];
  const push = (c: Change | null): void => {
    if (c !== null) changes.push(c);
  };
  push(await w.insert("char", char));
  const identity: IdentityRow = {
    id: await w.newId("identity"),
    created_tick: tick,
    updated_tick: tick,
    char_id: charId,
    code_hash: hash,
    expires_tick: null,
  };
  await w.insert("identity", identity);

  for (const b of SKILL_BASES) {
    const d = defs.find((x) => x.key === b) as SkillDefinitionRow;
    const learned: SkillLearnedRow = {
      id: await w.newId("skill"),
      created_tick: tick,
      updated_tick: tick,
      record: "learned",
      char_id: charId,
      def_id: d.id,
      level: 0,
      cap: start.skill_cap,
    };
    push(await w.insert("skill", learned));
  }
  const bond: BondRow = {
    id: await w.newId("bond"),
    created_tick: tick,
    updated_tick: tick,
    kind: "member",
    a: charId,
    b: orgId,
    state: "active",
    weight: 0,
    rank: rank.rank,
    since_tick: tick,
    ended_tick: null,
  };
  push(await w.insert("bond", bond));
  const rep: ReputationRow = {
    id: await w.newId("reputation"),
    created_tick: tick,
    updated_tick: tick,
    char_id: charId,
    scope: "world",
    org_id: null,
    value: 0,
  };
  push(await w.insert("reputation", rep));
  ctx.actor = char;
  changes.push(...(await supplyInitialTasks(ctx, char)));

  const deed = await w.deed({
    actor: charId,
    verb: "enter",
    kind: "identity",
    targets: [charId],
    place_id: spawn,
    result: { outcome: "success", changes, roll: null, proposal: null },
    visibility: "self",
    participants: [charId],
  });
  await w.emit({
    scope: "self",
    recipients: [charId],
    type: "identity_state",
    deed_id: deed.id,
    data: { char_id: charId, from: null, to: "draft", reason: "create" },
  });
  return { char, identity_code: code.display, created: true, changes, world: worldClientView(world) };
}

async function resume(ctx: VerbContext, a: Extract<EnterArgs, { mode: "resume" }>): Promise<EnterResult> {
  const c = ctx.actor;
  if (c === null) throw new Error("enter resume: no actor");
  if (a.door !== undefined && a.door !== ctx.door) {
    reject("INVALID_ARGUMENT", { expected: "door of the entry shell (api for /v1/actions)" }, "args.door");
  }
  const skin = a.skin ?? c.skin;
  if (a.class !== undefined && a.class !== null && skin !== "fantasy") {
    reject("INVALID_ARGUMENT", { expected: "null unless skin is fantasy" }, "args.class");
  }
  const textMax = requireRule(ctx.rules, "text_max_chars");
  // Leaving fantasy clears the class server-side unless the caller already did.
  const cls = a.class !== undefined ? a.class : skin !== "fantasy" ? null : c.class;
  const model = a.model !== undefined ? sanitizeLabel(a.model, textMax) : c.model;

  const patch: {
    skin?: CharRow["skin"];
    class?: CharRow["class"];
    door?: CharRow["door"];
    model?: CharRow["model"];
    state?: "active";
    state_since?: Tick;
    last_yield_tick?: Tick;
  } = {};
  if (skin !== c.skin) patch.skin = skin;
  if (cls !== c.class) patch.class = cls;
  if (a.door !== undefined && ctx.door !== c.door) patch.door = ctx.door;
  if (model !== c.model) patch.model = model;
  const restored = c.state === "dormant" || c.state === "buried";
  if (restored) {
    patch.state = "active";
    patch.state_since = ctx.tick;
    patch.last_yield_tick = ctx.tick;
  }
  const changes: Change[] = [];
  if (Object.keys(patch).length > 0) {
    const ch = await ctx.w.update("char", c.id, patch);
    if (ch !== null) changes.push(ch);
  }
  const char: CharRow = { ...c };
  if (patch.skin !== undefined) char.skin = patch.skin;
  if (patch.class !== undefined) char.class = patch.class;
  if (patch.door !== undefined) char.door = patch.door;
  if (patch.model !== undefined) char.model = patch.model;
  if (restored) {
    char.state = "active";
    char.state_since = ctx.tick;
    char.last_yield_tick = ctx.tick;
    // Revived inside the window: the credential is healthy again, the countdown stops.
    for (const ident of await selectRows(ctx.q, "identity", "char_id = $1 AND expires_tick IS NOT NULL", [c.id])) {
      await ctx.w.update("identity", ident.id, { expires_tick: null });
    }
  }
  const deed = await ctx.w.deed({
    actor: c.id,
    verb: "enter",
    kind: "identity",
    targets: [c.id],
    place_id: c.loc,
    result: { outcome: "success", changes, roll: null, proposal: null },
    visibility: "self",
    participants: [c.id],
  });
  if (restored) {
    await ctx.w.emit({
      scope: "self",
      recipients: [c.id],
      type: "identity_state",
      deed_id: deed.id,
      data: { char_id: c.id, from: c.state, to: "active", reason: "resume" },
    });
  }
  return { char, identity_code: null, created: false, changes, world: worldClientView(ctx.world) };
}

export const def = defineVerb<EnterArgs, EnterResult>({
  verb: "enter",
  args,
  lock: "world",
  auth: (a) => a.mode === "resume",
  costKey: () => "enter",
  gate: () => "none",
  async handler(ctx, a) {
    if (a.mode === "create") return create(ctx, a);
    return resume(ctx, a);
  },
});
