// Load only neutral skills/equipped objects; inventory stays out of Roll inputs.

import type { Queryable } from "../db/db.ts";
import { getRow, selectRows } from "../facts/store.ts";
import type { CharRow, Combatant, ID, ItemDefinitionRow, ItemInstanceRow, SkillDefinitionRow, SkillLearnedRow } from "../facts/types.ts";
import { deriveStats, type Balance, type Equipment, type NeutralFacts } from "./balance.ts";

export async function skillDefinition(q: Queryable, key: string): Promise<SkillDefinitionRow | null> {
  const rows = await selectRows(q, "skill", "record = 'definition' AND key = $1", [key]);
  const row = rows[0];
  return row?.record === "definition" ? row : null;
}
export async function learnedSkill(q: Queryable, char: ID, def: ID): Promise<SkillLearnedRow | null> {
  const rows = await selectRows(q, "skill", "record = 'learned' AND char_id = $1 AND def_id = $2", [char, def]);
  const row = rows[0];
  return row?.record === "learned" ? row : null;
}
export async function itemDefinition(q: Queryable, id: ID): Promise<ItemDefinitionRow> {
  const row = await getRow(q, "item", id);
  if (row?.record !== "definition") throw new Error("item definition missing");
  return row;
}
export async function neutralFacts(q: Queryable, char: Pick<CharRow, "id" | "kind">): Promise<NeutralFacts> {
  if (char.kind === "npc") return { skills: [], equipment: [] };
  const skills: NeutralFacts["skills"] = [];
  const learned = await selectRows(q, "skill", "record = 'learned' AND char_id = $1", [char.id], 'ORDER BY id COLLATE "C"');
  for (const row of learned) {
    if (row.record !== "learned") continue;
    const def = await getRow(q, "skill", row.def_id);
    if (def?.record !== "definition") throw new Error("skill definition missing");
    skills.push({ learned: row, definition: def });
  }
  const equipment: Equipment[] = [];
  const items = await selectRows(q, "item", "record = 'instance' AND state = 'available' AND equipped = true AND holder ->> 'kind' = 'char' AND holder ->> 'id' = $1", [char.id], 'ORDER BY id COLLATE "C"');
  for (const row of items) {
    if (row.record !== "instance") continue;
    const cores: Equipment["cores"] = [];
    for (const id of row.sockets) {
      if (id === null) continue;
      const core = await getRow(q, "item", id);
      if (core?.record !== "instance" || core.state !== "available" || core.holder.kind !== "item" || core.holder.id !== row.id) throw new Error("invalid socket holder fact");
      const def = await itemDefinition(q, core.def_id);
      if (def.kind !== "core" || def.effect.kind !== "socket") throw new Error("invalid socket definition fact");
      cores.push({ instance: core, definition: def });
    }
    equipment.push({ instance: row, definition: await itemDefinition(q, row.def_id), cores });
  }
  return { skills, equipment };
}
export function combatant(balance: Balance, char: CharRow, facts: NeutralFacts): Combatant {
  return {
    char_id: char.id, body: char.body, tier: char.tier, stage: char.stage, xp: char.xp,
    vigor: char.vigor, cycles: char.cycles, legacy: char.legacy, archetype: char.archetype,
    stats: deriveStats(balance, char, facts),
    skills: char.kind === "npc" ? [] : facts.skills.map(({ definition, learned }) => ({ key: definition.key, base: definition.base, level: learned.level })),
    equipment: char.kind === "npc" ? [] : facts.equipment.map((e) => ({ def_id: e.definition.id, dura: e.instance.dura, core_defs: e.cores.map((c) => c.definition.id) })),
  };
}
export async function backpack(q: Queryable, char: ID): Promise<ItemInstanceRow[]> {
  return (await selectRows(q, "item", "record = 'instance' AND state = 'available' AND equipped = false AND holder ->> 'kind' = 'char' AND holder ->> 'id' = $1", [char], 'ORDER BY id COLLATE "C"')).filter((r): r is ItemInstanceRow => r.record === "instance");
}
