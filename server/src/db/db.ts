// Database adapters. Production: PostgreSQL via `pg`. Local dev / tests: PGlite.
// Both run the same SQL (migrations/*.sql). int8 values come back as decimal
// strings from both drivers; the fact codec (src/facts/tables.ts) converts them.

import { PGlite } from "@electric-sql/pglite";

export interface QueryResult<R> {
  rows: R[];
  affected: number;
}

export type DbRow = Record<string, unknown>;

export interface Queryable {
  /** One parameterised statement. */
  query<R = DbRow>(sql: string, params?: readonly unknown[]): Promise<QueryResult<R>>;
  /** Multi-statement SQL without parameters (migrations). */
  exec(sql: string): Promise<void>;
}

export interface Db extends Queryable {
  readonly driver: "pglite" | "postgres";
  /** Runs `fn` inside BEGIN … COMMIT; any throw rolls back. */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface DbConfig {
  driver: "pglite" | "postgres";
  /** PGlite data directory; null = in-memory (tests). */
  pglite_dir: string | null;
  /** PostgreSQL connection string (from env only; never stored in the repo). */
  url: string | null;
  pool_max: number;
}

/** Transient failure: the transaction did not commit, the caller may retry. */
export class RetryableDbError extends Error {
  override readonly name = "RetryableDbError";
}

/** COMMIT outcome unknown (connection lost, or an error class that does not guarantee rollback). */
export class AmbiguousCommitError extends Error {
  override readonly name = "AmbiguousCommitError";
}

const RETRYABLE_SQLSTATE = new Set(["40001", "40P01", "55P03"]);

/**
 * SQLSTATE classes that guarantee COMMIT rolled the transaction back:
 * serialization failure 40001, deadlock 40P01, transaction integrity 40002,
 * and integrity violations of deferred constraints (class 23). Any other error
 * at COMMIT (admin shutdown 57P0x, connection 08xxx, internal XX…) leaves the
 * outcome unknown.
 */
function commitRolledBack(st: string): boolean {
  return st === "40001" || st === "40P01" || st === "40002" || st.startsWith("23");
}

function sqlState(err: unknown): string | null {
  if (typeof err === "object" && err !== null && "code" in err) {
    const c = (err as { code: unknown }).code;
    return typeof c === "string" ? c : null;
  }
  return null;
}

export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  if (sqlState(err) !== "23505") return false;
  if (constraint === undefined) return true;
  return (err as { constraint?: unknown }).constraint === constraint;
}

export async function openDb(cfg: DbConfig): Promise<Db> {
  if (cfg.driver === "pglite") return openPglite(cfg.pglite_dir);
  if (cfg.url === null || cfg.url === "") {
    throw new Error("db.driver=postgres requires AIHW_DATABASE_URL in the environment");
  }
  return openPostgres(cfg.url, cfg.pool_max);
}

// ---------- PGlite ----------

const INT8_OID = 20;
const NUMERIC_OID = 1700;

async function openPglite(dir: string | null): Promise<Db> {
  const options = {
    parsers: {
      [INT8_OID]: (v: string) => v,
      [NUMERIC_OID]: (v: string) => v,
    },
  };
  const pg = dir === null ? await PGlite.create(options) : await PGlite.create(dir, options);

  type PgliteQ = {
    query<R>(sql: string, params?: unknown[]): Promise<{ rows: R[]; affectedRows?: number }>;
    exec(sql: string): Promise<unknown>;
  };
  const wrap = (t: PgliteQ): Queryable => ({
    async query<R = DbRow>(sql: string, params: readonly unknown[] = []) {
      const r = await t.query<R>(sql, [...params]);
      return { rows: r.rows, affected: r.affectedRows ?? 0 };
    },
    async exec(sql: string) {
      await t.exec(sql);
    },
  });
  const base = wrap(pg);
  return {
    driver: "pglite",
    query: base.query,
    exec: base.exec,
    // PGlite serialises transactions on its single connection; other calls wait.
    tx: <T>(fn: (q: Queryable) => Promise<T>) => pg.transaction((t) => fn(wrap(t))),
    close: () => pg.close(),
  };
}

// ---------- PostgreSQL ----------

async function openPostgres(url: string, poolMax: number): Promise<Db> {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: url, max: poolMax });
  pool.on("error", () => {
    // Idle client errors are surfaced on the next checkout; nothing to do here.
  });

  type PgClient = {
    query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
  };
  const wrap = (c: PgClient): Queryable => ({
    async query<R = DbRow>(sql: string, params: readonly unknown[] = []) {
      try {
        const r = await c.query(sql, [...params]);
        return { rows: r.rows as R[], affected: r.rowCount ?? 0 };
      } catch (err) {
        if (RETRYABLE_SQLSTATE.has(sqlState(err) ?? "")) throw new RetryableDbError(String(sqlState(err)));
        throw err;
      }
    },
    async exec(sql: string) {
      await c.query(sql);
    },
  });
  const base = wrap(pool);
  return {
    driver: "postgres",
    query: base.query,
    exec: base.exec,
    async tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      let released = false;
      try {
        await client.query("BEGIN");
        let out: T;
        try {
          out = await fn(wrap(client));
        } catch (err) {
          await client.query("ROLLBACK").catch(() => undefined);
          throw err;
        }
        try {
          await client.query("COMMIT");
        } catch (err) {
          // Only classes that guarantee a rollback count as "not committed".
          const st = sqlState(err);
          if (st === "40001" || st === "40P01") throw new RetryableDbError(st);
          if (st !== null && commitRolledBack(st)) throw err;
          // Anything else (or no SQLSTATE: connection lost mid-COMMIT): outcome unknown.
          client.release(true);
          released = true;
          throw new AmbiguousCommitError("commit outcome unknown");
        }
        return out;
      } finally {
        if (!released) client.release();
      }
    },
    close: () => pool.end(),
  };
}
