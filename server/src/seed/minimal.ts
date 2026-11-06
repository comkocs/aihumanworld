// Minimal seed — facts only, no prose (formal content is S16's): one start place
// per origin region, one neutral market linked to all four, the four registry
// orgs (needed for the member bond of enter create) and the four base skill
// definitions. Written once, when the world row does not exist yet.

import type { Queryable } from "../db/db.ts";
import { SKINS, SKILL_BASES, type Direction, type Skin } from "../facts/enums.ts";
import { seedId, worldId } from "../facts/ids.ts";
import { insertRow } from "../facts/store.ts";
import type { OrgRow, PlaceRow, SkillDefinitionRow, WorldRow, WorldRules } from "../facts/types.ts";
import type { Balance } from "../growth/balance.ts";

/** Market exit toward each start place, and the way back. */
const LINKS: Readonly<Record<Skin, { out: Direction; back: Direction }>> = {
  xiuxian: { out: "north", back: "south" },
  wuxia: { out: "east", back: "west" },
  fantasy: { out: "south", back: "north" },
  scifi: { out: "west", back: "east" },
};

export async function seedWorld(
  q: Queryable,
  realm: string,
  rules: WorldRules,
  rulesRevision: string,
  balance: Balance,
  now: Date,
): Promise<void> {
  if (balance.org_goal === null) throw new Error("seed needs balance.org_goal (placeholder allowed)");
  const t0 = "0";
  const stamp = { created_tick: t0, updated_tick: t0 };
  const market = seedId(realm, "place", "market_neutral");
  const start = (s: Skin) => seedId(realm, "place", `start_${s}`);
  const registry = (s: Skin) => seedId(realm, "org", `registry_${s}`);

  const places: PlaceRow[] = [
    {
      id: market,
      ...stamp,
      content_key: `content.${realm}.place.market_neutral`,
      region: "neutral",
      kind: "market",
      features: ["build_anchor", "portal", "trade"],
      tier: 1,
      danger: "safe",
      combat: "safe",
      exits: SKINS.map((s) => ({ dir: LINKS[s].out, to: start(s), locked: false, key_def: null, guard: null })),
      owner_org: null,
      by: null,
    },
    ...SKINS.map(
      (s): PlaceRow => ({
        id: start(s),
        ...stamp,
        content_key: `content.${realm}.place.start_${s}`,
        region: s,
        kind: "settlement",
        features: ["portal", "respawn", "start"],
        tier: 1,
        danger: "safe",
        combat: "safe",
        exits: [{ dir: LINKS[s].back, to: market, locked: false, key_def: null, guard: null }],
        owner_org: null,
        by: null,
      }),
    ),
  ];
  for (const p of places) await insertRow(q, "place", p);

  const goal = balance.org_goal;
  for (const s of SKINS) {
    const org: OrgRow = {
      id: registry(s),
      ...stamp,
      content_key: `content.${realm}.org.registry_${s}`,
      region: s,
      hall: start(s),
      registry: true,
      ranks: [{ rank: 0, key: "org_rank.member", can_promote: false, can_expel: false }],
      skill_defs: [],
      treasury: 0,
      goal: { week: 0, kind: goal.kind, target: goal.target, progress: 0, member_ids: [], reward_rep: goal.reward_rep, settled: false },
    };
    await insertRow(q, "org", org);
  }

  for (const b of SKILL_BASES) {
    const d: SkillDefinitionRow = {
      id: seedId(realm, "skill", `base_${b}`),
      ...stamp,
      record: "definition",
      key: b,
      base: b,
      org_id: null,
      tier: 1,
    };
    await insertRow(q, "skill", d);
  }

  const startedAt = new Date(Math.floor(now.getTime() / 1000) * 1000).toISOString().replace(".000Z", "Z");
  const world: WorldRow = {
    id: worldId(realm),
    ...stamp,
    realm,
    tick: t0,
    event_head: "0",
    deed_head: "0",
    tick_started_at: startedAt,
    rules_revision: rulesRevision,
    rules,
    spawn_places: { xiuxian: start("xiuxian"), wuxia: start("wuxia"), fantasy: start("fantasy"), scifi: start("scifi") },
    registry_orgs: {
      xiuxian: registry("xiuxian"),
      wuxia: registry("wuxia"),
      fantasy: registry("fantasy"),
      scifi: registry("scifi"),
    },
    day_index: 0,
    week_index: 0,
  };
  await insertRow(q, "world", world);
}
