-- S78: stance between two organizations (ally / enemy). Unlisted pairs stay neutral.
-- a < b so one unordered pair is one row. Player-founded orgs get no rows and stay neutral.
CREATE TABLE s78_org_relations (
  a aihw_ref NOT NULL REFERENCES orgs (id),
  b aihw_ref NOT NULL REFERENCES orgs (id),
  stance text NOT NULL CHECK (stance IN ('ally', 'enemy')),
  PRIMARY KEY (a, b),
  CONSTRAINT s78_org_relations_order CHECK (a COLLATE "C" < b COLLATE "C")
);
