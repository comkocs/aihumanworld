-- S27 resource supply (资源点产出表 + 商人货单, 数值表 npc.resource_respawn_ticks /
-- npc.merchant_restock_ticks). Private clock data: restock only fills a holder up
-- to cap, so a full holder leaves the due index entirely (S19-style idle cost 0).
CREATE TABLE s27_supply (
  holder_kind text NOT NULL CHECK (holder_kind IN ('place', 'char')),
  holder_id aihw_ref NOT NULL,
  def_id aihw_ref NOT NULL,
  cap aihw_uint NOT NULL,
  due_tick bigint,
  PRIMARY KEY (holder_kind, holder_id, def_id)
);
CREATE INDEX s27_supply_due ON s27_supply (due_tick) WHERE due_tick IS NOT NULL;
