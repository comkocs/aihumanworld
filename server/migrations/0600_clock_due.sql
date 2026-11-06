-- Private due indexes: fact changes wake only affected objects, not every tick.
ALTER TABLE chars ADD COLUMN growth_due_tick bigint;
ALTER TABLE chars ADD COLUMN npc_due_tick bigint;
ALTER TABLE orgs ADD COLUMN clock_due_tick bigint NOT NULL DEFAULT 0;

CREATE INDEX s19_growth_due ON chars ((split_part(id, ':', 1)), growth_due_tick)
  WHERE growth_due_tick IS NOT NULL;
CREATE INDEX s19_npc_due ON chars ((split_part(id, ':', 1)), npc_due_tick)
  WHERE npc_due_tick IS NOT NULL;
CREATE INDEX s19_org_due ON orgs ((split_part(id, ':', 1)), clock_due_tick);

CREATE FUNCTION s19_wake_char(who text) RETURNS void LANGUAGE sql AS $$
  UPDATE chars SET
    growth_due_tick = CASE WHEN kind <> 'npc' AND state IN ('draft', 'active')
      THEN CASE WHEN life = 'dead' THEN revive_tick ELSE 0 END END,
    npc_due_tick = CASE WHEN kind = 'npc'
      THEN CASE WHEN life = 'dead' THEN revive_tick ELSE 0 END END
  WHERE id = who;
$$;

CREATE FUNCTION s19_char_due_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.kind, NEW.archetype, NEW.tier, NEW.stage, NEW.legacy, NEW.vigor,
      NEW.life, NEW.revive_tick, NEW.state, NEW.train_skill, NEW.last_yield_tick, NEW.patrol_route)
      IS NOT DISTINCT FROM ROW(OLD.kind, OLD.archetype, OLD.tier, OLD.stage, OLD.legacy, OLD.vigor,
      OLD.life, OLD.revive_tick, OLD.state, OLD.train_skill, OLD.last_yield_tick, OLD.patrol_route) THEN
      RETURN NEW;
    END IF;
  END IF;
  NEW.growth_due_tick := CASE WHEN NEW.kind <> 'npc' AND NEW.state IN ('draft', 'active')
    THEN CASE WHEN NEW.life = 'dead' THEN NEW.revive_tick ELSE 0 END END;
  NEW.npc_due_tick := CASE WHEN NEW.kind = 'npc'
    THEN CASE WHEN NEW.life = 'dead' THEN NEW.revive_tick ELSE 0 END END;
  RETURN NEW;
END;
$$;
CREATE TRIGGER s19_char_due_changed BEFORE INSERT OR UPDATE OF
  kind, archetype, tier, stage, legacy, vigor, life, revive_tick, state, train_skill, last_yield_tick, patrol_route
  ON chars FOR EACH ROW EXECUTE FUNCTION s19_char_due_changed();

-- Backfill once. Full idle participants will be removed from the due index.
UPDATE chars SET
  growth_due_tick = CASE WHEN kind <> 'npc' AND state IN ('draft', 'active')
    THEN CASE WHEN life = 'dead' THEN revive_tick ELSE 0 END END,
  npc_due_tick = CASE WHEN kind = 'npc'
    THEN CASE WHEN life = 'dead' THEN revive_tick ELSE 0 END END;

CREATE FUNCTION s19_skill_due_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  fact skills;
  who text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    fact := OLD;
    IF fact.record = 'learned' THEN
      PERFORM s19_wake_char(fact.char_id);
    ELSE
      FOR who IN SELECT char_id FROM skills WHERE record = 'learned' AND def_id = fact.id LOOP
        PERFORM s19_wake_char(who);
      END LOOP;
    END IF;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    fact := NEW;
    IF fact.record = 'learned' THEN
      PERFORM s19_wake_char(fact.char_id);
    ELSE
      FOR who IN SELECT char_id FROM skills WHERE record = 'learned' AND def_id = fact.id LOOP
        PERFORM s19_wake_char(who);
      END LOOP;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER s19_skill_due_changed AFTER INSERT OR UPDATE OR DELETE ON skills
  FOR EACH ROW EXECUTE FUNCTION s19_skill_due_changed();

CREATE FUNCTION s19_wake_item(fact items) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  instance items;
  gear items;
BEGIN
  IF fact.record = 'definition' THEN
    FOR instance IN SELECT * FROM items WHERE record = 'instance' AND def_id = fact.id LOOP
      PERFORM s19_wake_item(instance);
    END LOOP;
  ELSIF fact.holder ->> 'kind' = 'char' AND fact.equipped AND fact.state = 'available' THEN
    PERFORM s19_wake_char(fact.holder ->> 'id');
  ELSIF fact.holder ->> 'kind' = 'item' THEN
    SELECT * INTO gear FROM items WHERE id = fact.holder ->> 'id';
    IF gear.equipped AND gear.state = 'available' AND gear.holder ->> 'kind' = 'char' THEN
      PERFORM s19_wake_char(gear.holder ->> 'id');
    END IF;
  END IF;
END;
$$;
CREATE FUNCTION s19_item_due_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN PERFORM s19_wake_item(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN PERFORM s19_wake_item(NEW); END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER s19_item_due_changed AFTER INSERT OR UPDATE OR DELETE ON items
  FOR EACH ROW EXECUTE FUNCTION s19_item_due_changed();

CREATE FUNCTION s19_org_due_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.goal IS DISTINCT FROM OLD.goal THEN NEW.clock_due_tick := 0; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER s19_org_due_changed BEFORE UPDATE OF goal ON orgs
  FOR EACH ROW EXECUTE FUNCTION s19_org_due_changed();

CREATE FUNCTION s19_rules_due_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.rules IS DISTINCT FROM OLD.rules OR NEW.rules_revision IS DISTINCT FROM OLD.rules_revision THEN
    UPDATE chars SET
      growth_due_tick = CASE WHEN kind <> 'npc' AND state IN ('draft', 'active')
        THEN CASE WHEN life = 'dead' THEN revive_tick ELSE 0 END END,
      npc_due_tick = CASE WHEN kind = 'npc'
        THEN CASE WHEN life = 'dead' THEN revive_tick ELSE 0 END END
    WHERE split_part(id, ':', 1) = NEW.realm;
    UPDATE orgs SET clock_due_tick = 0 WHERE split_part(id, ':', 1) = NEW.realm;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER s19_rules_due_changed AFTER UPDATE OF rules, rules_revision ON worlds
  FOR EACH ROW EXECUTE FUNCTION s19_rules_due_changed();
