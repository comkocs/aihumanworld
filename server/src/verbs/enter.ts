// [S11 owns this file after S9] enter — first entry (code issue) and resume
// (动词表 §4.1). `create`: A7-format code shown once, only SHA-256 stored,
// draft char with four base skills from 0, registry-org member bond, world
// reputation row, budget; initial tasks via the task hook. `resume` (S11):
// lifecycle restore — dormant / buried (inside the revive window) return to
// active, draft stays draft; display fields update when given; no code is
// re-issued and no initial assets are granted again. Life is never touched.
// A `skin` different from the current one is a conversion (改宗, 产品文档 v1
// 阵营 = 出身皮): tier <= 3, standing in the target region, registry-org member
// only; skin / origin_region / respawn_place / registry bond move together.

import { SKILL_BASES, type Skin } from "../facts/enums.ts";
import { worldClientView, type WorldClientView } from "../facts/project.ts";
import { getRow, selectRows } from "../facts/store.ts";
import type {
  BondRow,
  Change,
  CharRow,
  IdentityRow,
  OrgRow,
  ReputationRow,
  SkillDefinitionRow,
  SkillLearnedRow,
  Tick,
} from "../facts/types.ts";
import { deriveStats, startValues } from "../growth/balance.ts";
import { touchSeen } from "../identity/auth.ts";
import { generateCode, hashCode, type NewCode } from "../identity/code.ts";
import { hashEmail, normalizeEmail } from "../identity/email.ts";
import { allocateHandle } from "../identity/handles.ts";
import { emitBond, membership } from "../orgs/membership.ts";
import { NO_DETAILS, reject } from "../protocol/errors.ts";
import { charClass, door, email as emailShape, handle as handleShape, skin } from "../protocol/shapes.ts";
import { nullable, opt, str, union, type Out } from "../protocol/validate.ts";
import { requireRule } from "../rules/world_rules.ts";
import { sanitizeLabel } from "../speech/sanitize.ts";
import { publicChanges } from "../tasks/common.ts";
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
    // S32: continue by handle + email (no bearer code), or bind / rebind / unbind
    // (null) the email of the authenticated char. Absent → email not involved.
    handle: opt(nullable(handleShape), undefined),
    email: opt(nullable(emailShape), undefined),
  },
});
export type EnterArgs = Out<typeof args>;

export interface EnterResult {
  char: CharRow;
  /** On create and on handle+email resume, only once; never stored, logged or re-issued. */
  identity_code: string | null;
  created: boolean;
  /** S32: email binding state after this call; null when email was not involved. */
  email_bound: boolean | null;
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
    handle: await allocateHandle(ctx.q),
    email_hash: null,
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
  return { char, identity_code: code.display, created: true, email_bound: null, changes, world: worldClientView(world) };
}

/** 产品文档 v1 阵营 = 出身皮: switching is free through tier 3, locked after. */
const CONVERT_TIER_MAX = 3;

interface Conversion {
  from: BondRow;
  registry: OrgRow;
  spawn: CharRow["respawn_place"];
}

/** Conversion preconditions, in order: tier, standing in the target region, registry-only membership. */
async function conversionGuard(ctx: VerbContext, c: CharRow, target: Skin): Promise<Conversion> {
  if (c.tier > CONVERT_TIER_MAX) return reject("NOT_ALLOWED", { reason: "faith_locked" });
  const here = await getRow(ctx.q, "place", c.loc);
  if (here === null || here.region !== target) return reject("NOT_HERE", NO_DETAILS);
  const from = await membership(ctx.q, c.id);
  const old = await getRow(ctx.q, "org", from.b);
  if (old === null) throw new Error(`org ${from.b} of the membership bond missing`);
  if (!old.registry) return reject("NOT_ALLOWED", { reason: "org" });
  const registry = await getRow(ctx.q, "org", ctx.world.registry_orgs[target]);
  if (registry === null || !registry.registry) throw new Error(`registry org of ${target} missing`);
  return { from, registry, spawn: ctx.world.spawn_places[target] };
}

async function resume(
  ctx: VerbContext,
  a: Extract<EnterArgs, { mode: "resume" }>,
  fresh: { code: NewCode; hash: string } | null,
): Promise<EnterResult> {
  const c = ctx.actor;
  if (c === null) throw new Error("enter resume: no actor");
  if (a.door !== undefined && a.door !== ctx.door) {
    reject("INVALID_ARGUMENT", { expected: "door of the entry shell (api for /v1/actions)" }, "args.door");
  }
  if (fresh !== null && a.email === undefined) {
    reject("INVALID_ARGUMENT", { expected: "email required with handle" }, "args.email");
  }
  const skin = a.skin ?? c.skin;
  if (a.class !== undefined && a.class !== null && skin !== "fantasy") {
    reject("INVALID_ARGUMENT", { expected: "null unless skin is fantasy" }, "args.class");
  }
  const textMax = requireRule(ctx.rules, "text_max_chars");
  // Leaving fantasy clears the class server-side unless the caller already did.
  const cls = a.class !== undefined ? a.class : skin !== "fantasy" ? null : c.class;
  const model = a.model !== undefined ? sanitizeLabel(a.model, textMax) : c.model;
  const conversion = skin !== c.skin ? await conversionGuard(ctx, c, skin) : null;

  const patch: {
    skin?: CharRow["skin"];
    class?: CharRow["class"];
    origin_region?: CharRow["origin_region"];
    respawn_place?: CharRow["respawn_place"];
    door?: CharRow["door"];
    model?: CharRow["model"];
    email_hash?: CharRow["email_hash"];
    state?: "active";
    state_since?: Tick;
    last_yield_tick?: Tick;
  } = {};
  // S32 bind / rebind / unbind: only the hash is stored, the address never echoed.
  const emailBound = a.email === undefined ? null : a.email !== null;
  if (a.email !== undefined && a.email !== null) patch.email_hash = hashEmail(normalizeEmail(a.email));
  else if (a.email === null) patch.email_hash = null;
  if (conversion !== null) {
    patch.skin = skin;
    patch.origin_region = skin;
    patch.respawn_place = conversion.spawn;
  }
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
  let ended: BondRow | null = null;
  let added: BondRow | null = null;
  if (conversion !== null) {
    // Same transaction: the old registry bond ends, the target registry bond begins.
    const rank = conversion.registry.ranks.find((r) => r.key === "org_rank.member") ?? conversion.registry.ranks[0];
    if (rank === undefined) throw new Error(`registry org ${conversion.registry.id} has no ranks`);
    const endChange = await ctx.w.update("bond", conversion.from.id, { state: "ended", ended_tick: ctx.tick });
    if (endChange !== null) changes.push(endChange);
    ended = { ...conversion.from, state: "ended", ended_tick: ctx.tick, updated_tick: ctx.tick };
    added = {
      id: await ctx.w.newId("bond"),
      created_tick: ctx.tick,
      updated_tick: ctx.tick,
      kind: "member",
      a: c.id,
      b: conversion.registry.id,
      state: "active",
      weight: 0,
      rank: rank.rank,
      since_tick: ctx.tick,
      ended_tick: null,
    };
    const addChange = await ctx.w.insert("bond", added);
    if (addChange !== null) changes.push(addChange);
  }
  const char: CharRow = { ...c };
  if (patch.skin !== undefined) char.skin = patch.skin;
  if (patch.class !== undefined) char.class = patch.class;
  if (patch.origin_region !== undefined) char.origin_region = patch.origin_region;
  if (patch.respawn_place !== undefined) char.respawn_place = patch.respawn_place;
  if (patch.door !== undefined) char.door = patch.door;
  if (patch.model !== undefined) char.model = patch.model;
  if (patch.email_hash !== undefined) char.email_hash = patch.email_hash;
  if (restored) {
    char.state = "active";
    char.state_since = ctx.tick;
    char.last_yield_tick = ctx.tick;
    // Revived inside the window: the credential is healthy again, the countdown stops.
    for (const ident of await selectRows(ctx.q, "identity", "char_id = $1 AND expires_tick IS NOT NULL", [c.id])) {
      await ctx.w.update("identity", ident.id, { expires_tick: null });
    }
  }
  // A conversion is a public fact (chronicle); a plain resume stays self-visible.
  const deed = await ctx.w.deed({
    actor: c.id,
    verb: "enter",
    kind: "identity",
    targets: conversion === null ? [c.id] : [c.id, conversion.registry.id],
    place_id: c.loc,
    result: { outcome: "success", changes: conversion === null ? changes : publicChanges(changes), roll: null, proposal: null },
    visibility: conversion === null ? "self" : "world",
    participants: [c.id],
  });
  if (ended !== null && added !== null) {
    await emitBond(ctx.w, ended, deed.id);
    await emitBond(ctx.w, added, deed.id);
  }
  if (restored) {
    await ctx.w.emit({
      scope: "self",
      recipients: [c.id],
      type: "identity_state",
      deed_id: deed.id,
      data: { char_id: c.id, from: c.state, to: "active", reason: "resume" },
    });
  }
  return { char, identity_code: fresh === null ? null : fresh.code.display, created: false, email_bound: emailBound, changes, world: worldClientView(ctx.world) };
}

/** S32 (设计者原话 2026-11-06 19): handle + email, no bearer code → a fresh code. */
const CODES_PER_CHAR = 20;

async function resumeByHandle(ctx: VerbContext, a: Extract<EnterArgs, { mode: "resume" }>): Promise<EnterResult> {
  if (a.email === undefined || a.email === null) {
    reject("INVALID_ARGUMENT", { expected: "email required with handle" }, "args.email");
  }
  const byHandle = await selectRows(ctx.q, "char", "handle = $1 AND kind IN ('player', 'official')", [a.handle]);
  const found = byHandle[0];
  // Unknown handle, unbound email and mismatched address answer identically.
  if (found === undefined) return reject("AUTH_INVALID", NO_DETAILS);
  const c = await getRow(ctx.q, "char", found.id, { lock: true });
  if (c === null || c.email_hash !== hashEmail(normalizeEmail(a.email))) return reject("AUTH_INVALID", NO_DETAILS);

  // Lifecycle gate mirrors code resume: past recovery refuses with IDENTITY_EXPIRED.
  const idents = await selectRows(ctx.q, "identity", "char_id = $1", [c.id]);
  const withinWindow = idents.some((i) => i.expires_tick === null || BigInt(i.expires_tick) > BigInt(ctx.tick));
  const draftTtl = ctx.rules.draft_expire_ticks;
  const draftExpired = c.state === "draft" && draftTtl !== null && Number(ctx.tick) - Number(c.created_tick) >= draftTtl;
  if (draftExpired || !withinWindow) return reject("IDENTITY_EXPIRED", { can_create: true });

  // A fresh code for this window; old codes stay valid, capped at 20 (oldest retired).
  const fresh = await freshCode(ctx);
  const identity: IdentityRow = {
    id: await ctx.w.newId("identity"),
    created_tick: ctx.tick,
    updated_tick: ctx.tick,
    char_id: c.id,
    code_hash: fresh.hash,
    expires_tick: null,
  };
  await ctx.w.insert("identity", identity);
  if (idents.length + 1 > CODES_PER_CHAR) {
    const oldest = [...idents]
      .sort((x, y) => (BigInt(x.created_tick) < BigInt(y.created_tick) ? -1 : BigInt(x.created_tick) > BigInt(y.created_tick) ? 1 : x.id < y.id ? -1 : 1))
      .slice(0, idents.length + 1 - CODES_PER_CHAR)
      .map((i) => i.id);
    await ctx.q.query("DELETE FROM identities WHERE id = ANY($1::text[])", [oldest]);
  }
  ctx.actor = await touchSeen(ctx.w, c, ctx.tick, ctx.now);
  return resume(ctx, a, fresh);
}

export const def = defineVerb<EnterArgs, EnterResult>({
  verb: "enter",
  summary: "创建角色并领取一次性身份码，或恢复已有角色。",
  errors: ["NOT_ALLOWED", "CONDITION_UNMET"],
  purpose: (a) =>
    a.mode === "create"
      ? "创建角色并领取短号；身份码只在本次回包显示。"
      : a.handle !== undefined && a.handle !== null
        ? "短号 + 邮箱续玩：核验后给本窗口新发一枚身份码（只显示一次），旧码仍有效。"
        : "用已有身份码恢复角色，可更新展示字段或绑定 / 解绑邮箱。",
  args,
  lock: "world",
  auth: (a) => a.mode === "resume" && (a.handle === undefined || a.handle === null),
  costKey: () => "enter",
  gate: () => "none",
  async handler(ctx, a) {
    if (a.mode === "create") return create(ctx, a);
    if (a.handle !== undefined && a.handle !== null) return resumeByHandle(ctx, a);
    return resume(ctx, a, null);
  },
});
