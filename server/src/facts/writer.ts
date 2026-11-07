// Writer: the one way verb handlers and clock phases change facts inside a
// transaction. Deed seq and event cursor are allocated from the world row
// (deed_head / event_head) under the world row lock, so every head value seen
// by a reader is gap-free and fully committed (events read `(after, through]`).

import type { Queryable } from "../db/db.ts";
import type { DeedKind, DeedVerb, EventScope, PublicTable, Visibility } from "./enums.ts";
import { deedIdOf, eventIdOf, newId, type AllocType } from "./ids.ts";
import { createdChange, insertRow, isPublicTable, updateRow, type Patch } from "./store.ts";
import type {
  Change,
  DeedResult,
  DeedRow,
  EventDataMap,
  EventRow,
  EventType,
  FactTable,
  ID,
  Key,
  RowMap,
  Tick,
} from "./types.ts";

export interface DeedInput {
  actor: ID | null;
  verb: DeedVerb;
  kind: DeedKind;
  targets: ID[];
  place_id: ID | null;
  result: DeedResult;
  visibility: Visibility;
  /** self-visible audience; the actor is added automatically. */
  participants: ID[];
  /**
   * Required for the world-first kinds (first_found / first_clear / first_kill and
   * the S62 region firsts first_gate / first_build / first_crossing). Uniqueness is
   * the first_key column, so the key itself states the scope.
   */
  first_key?: string;
}

export type EventInput<T extends EventType> = {
  type: T;
  deed_id: ID | null;
  data: EventDataMap[T];
} & (
  | { scope: "self"; recipients: ID[] }
  | { scope: "place"; place_id: ID }
  | { scope: "world" }
);

export class Writer {
  readonly q: Queryable;
  readonly realm: string;
  readonly tick: Tick;
  readonly rulesRevision: Key;
  /** True only when the transaction holds the world row lock. */
  readonly locked: boolean;
  readonly deedIds: ID[] = [];
  readonly eventIds: ID[] = [];

  constructor(q: Queryable, realm: string, tick: Tick, rulesRevision: Key, locked: boolean) {
    this.q = q;
    this.realm = realm;
    this.tick = tick;
    this.rulesRevision = rulesRevision;
    this.locked = locked;
  }

  private requireLock(what: string): void {
    if (!this.locked) throw new Error(`${what} requires the world row lock (verb lock: "world")`);
  }

  newId(type: AllocType): Promise<ID> {
    return newId(this.q, this.realm, type);
  }

  async insert<T extends FactTable>(table: T, row: RowMap[T]): Promise<Change | null> {
    if (table === "deed" || table === "event") throw new Error("use deed() / emit()");
    await insertRow(this.q, table, row);
    return isPublicTable(table) ? createdChange(table as PublicTable, row as { id: ID }) : null;
  }

  update<T extends FactTable>(
    table: T,
    id: ID,
    patch: Patch<T>,
  ): Promise<Change | null> {
    return updateRow(this.q, table, id, patch, this.tick);
  }

  /** True if a world-first with this key already exists. */
  async firstTaken(firstKey: string): Promise<boolean> {
    const r = await this.q.query("SELECT 1 FROM deeds WHERE first_key = $1", [firstKey]);
    return r.rows.length > 0;
  }

  async deed(d: DeedInput): Promise<DeedRow> {
    this.requireLock("deed");
    const isFirst =
      d.kind === "first_found" || d.kind === "first_clear" || d.kind === "first_kill" ||
      d.kind === "first_gate" || d.kind === "first_build" || d.kind === "first_crossing";
    if (isFirst !== (d.first_key !== undefined)) throw new Error(`deed ${d.kind}: first_key mismatch`);
    const r = await this.q.query<{ deed_head: string }>(
      "UPDATE worlds SET deed_head = deed_head + 1 WHERE realm = $1 RETURNING deed_head",
      [this.realm],
    );
    const seq = String(r.rows[0]?.deed_head);
    const participants = d.actor === null || d.participants.includes(d.actor) ? d.participants : [d.actor, ...d.participants];
    const row: DeedRow = {
      id: deedIdOf(this.realm, seq),
      seq,
      tick: this.tick,
      actor: d.actor,
      verb: d.verb,
      kind: d.kind,
      targets: d.targets,
      place_id: d.place_id,
      result: d.result,
      visibility: d.visibility,
      participants: [...new Set(participants)],
      rules_revision: this.rulesRevision,
    };
    await insertRow(this.q, "deed", row, d.first_key === undefined ? {} : { first_key: d.first_key });
    this.deedIds.push(row.id);
    return row;
  }

  async emit<T extends EventType>(e: EventInput<T>): Promise<EventRow> {
    this.requireLock("emit");
    const scope: EventScope = e.scope;
    const recipients = e.scope === "self" ? [...new Set(e.recipients)] : [];
    if (e.scope === "self" && recipients.length === 0) throw new Error("self event without recipients");
    const r = await this.q.query<{ event_head: string }>(
      "UPDATE worlds SET event_head = event_head + 1 WHERE realm = $1 RETURNING event_head",
      [this.realm],
    );
    const cursor = String(r.rows[0]?.event_head);
    const row = {
      id: eventIdOf(this.realm, cursor),
      cursor,
      tick: this.tick,
      scope,
      recipients,
      place_id: e.scope === "place" ? e.place_id : null,
      type: e.type,
      deed_id: e.deed_id,
      data: e.data,
    } as unknown as EventRow;
    await insertRow(this.q, "event", row);
    for (const c of recipients) {
      await this.q.query("INSERT INTO event_inbox (char_id, cursor) VALUES ($1, $2)", [c, cursor]);
    }
    this.eventIds.push(row.id);
    return row;
  }
}
