// S25 neutral read model. No calls into combat or growth settlement code.

import type { Queryable } from "../db/db.ts";
import { getRow, selectRows } from "../facts/store.ts";
import type { CharRow, ItemDefinitionRow, ItemInstanceRow, Stats } from "../facts/types.ts";
import type { Balance } from "../growth/balance.ts";
import { cellNumber, checkedUInt, floorRatio, numberAt } from "../orgs/numbers.ts";

export async function definition(q: Queryable, id: string): Promise<ItemDefinitionRow> {
  const row = await getRow(q, "item", id);
  if (row?.record !== "definition") throw new Error("S25 missing item definition");
  return row;
}

export async function equipped(q: Queryable, char: string): Promise<ItemInstanceRow[]> {
  return (await selectRows(q, "item", "record = 'instance' AND holder ->> 'kind' = 'char' AND holder ->> 'id' = $1 AND state = 'available' AND equipped = true", [char], 'ORDER BY id COLLATE "C"')).filter((r): r is ItemInstanceRow => r.record === "instance");
}

export async function capacity(q: Queryable, item: ItemInstanceRow): Promise<number> {
  let cap = BigInt((await definition(q, item.def_id)).cap);
  for (const id of item.sockets) {
    if (id === null) continue;
    const core = await getRow(q, "item", id);
    if (core?.record !== "instance" || core.state !== "available" || core.holder.kind !== "item" || core.holder.id !== item.id) throw new Error("S25 invalid socket fact");
    cap += BigInt((await definition(q, core.def_id)).cap);
  }
  return checkedUInt(cap);
}

export async function stats(q: Queryable, balance: Balance, char: CharRow): Promise<Stats> {
  const tutorial = char.kind === "npc" && char.archetype === "tutorial_opponent";
  const keys = { tier: tutorial ? 1 : char.tier, stage: tutorial ? 1 : char.stage };
  const result: Stats = {
    power: cellNumber(balance, "grid", keys, "power"), guard: cellNumber(balance, "grid", keys, "guard"),
    speed: cellNumber(balance, "grid", keys, "speed"), vigor_max: cellNumber(balance, "grid", keys, "vigor_max"),
    cap_max: cellNumber(balance, "tiers", { tier: char.tier }, "cap_max"),
  };
  if (char.kind === "npc") {
    if (char.archetype === null) throw new Error("S25 NPC without archetype");
    const factor = numberAt(balance, `combat.npc_rating_bp.${char.archetype}`);
    for (const key of ["power", "guard", "speed", "vigor_max"] as const) result[key] = floorRatio(result[key], factor);
    return result;
  }
  const levels = { strike: 0, guard: 0, move: 0, inner: 0 };
  for (const row of await selectRows(q, "skill", "record = 'learned' AND char_id = $1", [char.id])) {
    if (row.record !== "learned") continue;
    const def = await getRow(q, "skill", row.def_id);
    if (def?.record !== "definition") throw new Error("S25 missing skill definition");
    levels[def.base] = Math.max(levels[def.base], row.level);
  }
  const legacy = BigInt(Math.min(char.legacy, numberAt(balance, "cycle.legacy_cap"))) * BigInt(numberAt(balance, "cycle.legacy_bp_per_point"));
  const attributes = { power: "strike", guard: "guard", speed: "move", vigor_max: "inner" } as const;
  const modifiers = { power: 0n, guard: 0n, speed: 0n, vigor: 0n };
  for (const item of await equipped(q, char.id)) {
    if (item.dura === 0) continue;
    const defs = [await definition(q, item.def_id)];
    for (const id of item.sockets) {
      if (id === null) continue;
      const core = await getRow(q, "item", id);
      if (core?.record !== "instance") throw new Error("S25 missing core instance");
      defs.push(await definition(q, core.def_id));
    }
    for (const def of defs) {
      const mod = def.effect.kind === "socket" ? def.effect.modifiers : def.modifiers;
      for (const key of ["power", "guard", "speed", "vigor"] as const) modifiers[key] += BigInt(mod[key]);
    }
  }
  for (const key of ["power", "guard", "speed", "vigor_max"] as const) {
    const factor = 10000n + BigInt(levels[attributes[key]]) * BigInt(numberAt(balance, "stats.skill_bp_per_level")) + legacy;
    const value = BigInt(result[key]) * factor / 10000n + modifiers[key === "vigor_max" ? "vigor" : key];
    result[key] = checkedUInt(value < 0n ? 0n : value);
  }
  return result;
}
