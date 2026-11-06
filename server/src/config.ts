// Server configuration: config/server.json (paths relative to the config dir),
// overridable by environment. Secrets (database URL) come only from the
// environment and never from files in the repository.
//
//   AIHW_CONFIG        path of the JSON config file (default server/config/server.json)
//   AIHW_HOST          http.host
//   AIHW_PORT          http.port
//   AIHW_DB_DRIVER     db.driver: pglite | postgres
//   AIHW_PGLITE_DIR    db.pglite_dir ("memory" = in-memory)
//   AIHW_DATABASE_URL  PostgreSQL connection string (db.driver=postgres)
//   AIHW_CONTENT_DIR   content_dir ("null" = do not import world content)

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DbConfig } from "./db/db.ts";

export interface Config {
  realm: string;
  http: { host: string; port: number; body_max_bytes: number };
  db: DbConfig;
  /** Directory of the config file; relative paths resolve against it. */
  config_dir: string;
  rules_file: string;
  /** World content imported after the seed (content/world/*.json); null = none. */
  content_dir: string | null;
  migrations_dir: string;
  clock: { max_catchup_ticks_per_tx: number; enabled: boolean };
}

export const SERVER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const REALM_RE = /^[a-z][a-z0-9_]*$/;
const DEFAULT_CONTENT_DIR = resolve(SERVER_ROOT, "../content/world");

function need<T>(v: T | undefined, what: string, ok: (v: T) => boolean): T {
  if (v === undefined || !ok(v)) throw new Error(`config: ${what} is invalid`);
  return v;
}

export async function loadConfig(env: NodeJS.ProcessEnv = process.env): Promise<Config> {
  const path = resolve(env.AIHW_CONFIG ?? resolve(SERVER_ROOT, "config/server.json"));
  const raw = JSON.parse(await readFile(path, "utf8")) as {
    realm?: string;
    http?: { host?: string; port?: number; body_max_bytes?: number };
    db?: { driver?: string; pglite_dir?: string | null; pool_max?: number };
    rules_file?: string;
    content_dir?: string | null;
    clock?: { max_catchup_ticks_per_tx?: number };
  };
  const dir = dirname(path);
  const driver = env.AIHW_DB_DRIVER ?? raw.db?.driver ?? "pglite";
  if (driver !== "pglite" && driver !== "postgres") throw new Error("config: db.driver must be pglite or postgres");
  const pgliteRaw = env.AIHW_PGLITE_DIR ?? raw.db?.pglite_dir ?? null;
  // Absent → the repo's content/world; null (or env "null") → no import.
  const contentEnv = env.AIHW_CONTENT_DIR;
  const contentRaw =
    contentEnv !== undefined ? (contentEnv === "null" ? null : contentEnv) : raw.content_dir === undefined ? DEFAULT_CONTENT_DIR : raw.content_dir;
  if (contentRaw !== null && (typeof contentRaw !== "string" || contentRaw === "")) throw new Error("config: content_dir is invalid");
  const portRaw = env.AIHW_PORT !== undefined ? Number(env.AIHW_PORT) : raw.http?.port;
  return {
    realm: need(raw.realm, "realm", (r) => REALM_RE.test(r)),
    http: {
      host: env.AIHW_HOST ?? raw.http?.host ?? "127.0.0.1",
      port: need(portRaw, "http.port", (p) => Number.isInteger(p) && p >= 0 && p < 65536),
      body_max_bytes: need(raw.http?.body_max_bytes ?? 65536, "http.body_max_bytes", (n) => Number.isInteger(n) && n > 0),
    },
    db: {
      driver,
      pglite_dir: pgliteRaw === null || pgliteRaw === "memory" ? null : resolve(dir, pgliteRaw),
      url: env.AIHW_DATABASE_URL ?? null,
      pool_max: need(raw.db?.pool_max ?? 10, "db.pool_max", (n) => Number.isInteger(n) && n > 0),
    },
    config_dir: dir,
    rules_file: need(raw.rules_file, "rules_file", (s) => s.length > 0),
    content_dir: contentRaw === null ? null : resolve(dir, contentRaw),
    migrations_dir: resolve(SERVER_ROOT, "migrations"),
    clock: {
      max_catchup_ticks_per_tx: need(
        raw.clock?.max_catchup_ticks_per_tx ?? 120,
        "clock.max_catchup_ticks_per_tx",
        (n) => Number.isInteger(n) && n > 0,
      ),
      enabled: true,
    },
  };
}
