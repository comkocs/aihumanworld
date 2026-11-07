-- S77c: wake existing ambushers so the NPC clock schedules their next ambush.
UPDATE chars AS npc SET npc_due_tick = 0
FROM places AS place
WHERE npc.kind = 'npc'
  AND npc.archetype = 'monster'
  AND npc.life = 'alive'
  AND place.id = npc.loc
  AND place.danger = 'high'
  AND place.tier = npc.tier
  AND place.combat NOT IN ('safe', 'duel');
