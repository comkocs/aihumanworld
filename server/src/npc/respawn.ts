// Per-person kills a day stay where the ledger has them.
import type { Queryable } from "../db/db.ts";
import { countRows } from "../facts/store.ts";
import type { CharRow, Tick } from "../facts/types.ts";
import type { Balance } from "../growth/balance.ts";

export async function monsterRespawnWait(q: Queryable, balance: Balance, monster: CharRow, tick: Tick): Promise<number> {
  const aliveMonsters = await countRows(q, "char", "loc = $1 AND tier = $2 AND archetype = 'monster' AND life = 'alive' AND id <> $3", [monster.loc, monster.tier, monster.id]);
  const participants = await countRows(q, "char", "loc = $1 AND tier = $2 AND kind <> 'npc' AND life = 'alive' AND state = 'active' AND last_seen_tick >= $3::bigint", [monster.loc, monster.tier, (BigInt(tick) - 30n).toString()]);
  const slots = aliveMonsters + 1;
  const normalWait = balance.numbers.npc.monster_respawn_ticks;
  return participants <= slots ? normalWait : Math.max(balance.numbers.npc.monster_respawn_crowded_ticks, Math.floor(normalWait * slots / participants));
}
