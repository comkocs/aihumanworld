// Migration runner: applies migrations/*.sql in file-name order, each in its own
// transaction, recording the file name in schema_migrations. Already-applied files
// are never re-run or edited; schema changes go into a new file.
// File-name ranges per work stream are listed in server/README.md.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Db } from "./db.ts";

const NAME_RE = /^\d{4}_[a-z0-9_]+\.sql$/;

export async function migrate(db: Db, dir: string): Promise<string[]> {
  await db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    if (!NAME_RE.test(f)) throw new Error(`migration file name not allowed: ${f}`);
  }
  const done = new Set(
    (await db.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name),
  );
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = await readFile(join(dir, f), "utf8");
    await db.tx(async (q) => {
      // Serialises concurrent starters on PostgreSQL; harmless on PGlite.
      await q.query("SELECT pg_advisory_xact_lock(7234001)");
      const again = await q.query("SELECT 1 FROM schema_migrations WHERE name = $1", [f]);
      if (again.rows.length > 0) return;
      await q.exec(sql);
      await q.query("INSERT INTO schema_migrations (name) VALUES ($1)", [f]);
    });
    applied.push(f);
  }
  return applied;
}
