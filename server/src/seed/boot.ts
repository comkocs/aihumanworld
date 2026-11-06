// Boot: validate the rules bundle, seed an empty database, or bring world.rules
// up to the configured revision. world.rules is B→S: the server validates it
// against the fixed field set before it is stored.

import type { Db } from "../db/db.ts";
import { worldId } from "../facts/ids.ts";
import { getRow, updateRow } from "../facts/store.ts";
import type { RulesBundle } from "../growth/rules_source.ts";
import { parseWorldRules } from "../rules/world_rules.ts";
import { seedWorld } from "./minimal.ts";

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (typeof v === "object" && v !== null) {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

export async function bootWorld(
  db: Db,
  realm: string,
  bundle: RulesBundle,
  now: Date,
): Promise<{ seeded: boolean; rulesUpdated: boolean }> {
  const { rules, rules_revision } = parseWorldRules(bundle.rules, bundle.rules_revision);
  return db.tx(async (q) => {
    await q.query("SELECT pg_advisory_xact_lock(7234002)");
    const world = await getRow(q, "world", worldId(realm), { lock: true });
    if (world === null) {
      const other = await q.query<{ realm: string }>("SELECT realm FROM worlds LIMIT 1");
      if (other.rows.length > 0) throw new Error("database already holds a different realm");
      await seedWorld(q, realm, rules, rules_revision, bundle.balance, now);
      return { seeded: true, rulesUpdated: false };
    }
    if (world.rules_revision === rules_revision && canonical(world.rules) === canonical(rules)) {
      return { seeded: false, rulesUpdated: false };
    }
    await updateRow(q, "world", world.id, { rules, rules_revision }, world.tick);
    return { seeded: false, rulesUpdated: true };
  });
}
