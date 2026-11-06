// ID allocation: `<realm>:<type>:<local>`. Locals come from per-type sequences
// (never reused). Seed / import locals contain an underscore, so they can never
// collide with allocated `<letter><digits>` locals.

import type { Queryable } from "../db/db.ts";
import type { ID, Seq } from "./types.ts";

export const ALLOC_TYPES = [
  "place",
  "item",
  "char",
  "skill",
  "bond",
  "org",
  "reputation",
  "wanted",
  "task",
  "identity",
] as const;
export type AllocType = (typeof ALLOC_TYPES)[number];

const PREFIX: Readonly<Record<AllocType, string>> = {
  place: "p",
  item: "i",
  char: "c",
  skill: "s",
  bond: "b",
  org: "o",
  reputation: "r",
  wanted: "w",
  task: "t",
  identity: "k",
};

export async function newId(q: Queryable, realm: string, type: AllocType): Promise<ID> {
  const r = await q.query<{ n: unknown }>(`SELECT nextval('aihw_local_${type}') AS n`);
  const n = r.rows[0]?.n;
  if (n === undefined) throw new Error(`sequence aihw_local_${type} returned nothing`);
  return `${realm}:${type}:${PREFIX[type]}${String(n)}`;
}

export const worldId = (realm: string): ID => `${realm}:world:main`;
export const deedIdOf = (realm: string, seq: Seq): ID => `${realm}:deed:d${seq}`;
export const eventIdOf = (realm: string, cursor: Seq): ID => `${realm}:event:e${cursor}`;
export const seedId = (realm: string, type: string, local: string): ID => `${realm}:${type}:${local}`;
