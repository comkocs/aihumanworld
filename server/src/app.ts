// Composition root: database → migrations → boot / seed → clock → HTTP.

import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { useBuildLimits } from "./build/limits.ts";
import { Clock } from "./clock/scheduler.ts";
import type { Config } from "./config.ts";
import { openDb, type Db } from "./db/db.ts";
import { migrate } from "./db/migrate.ts";
import { loadRulesBundle } from "./growth/rules_source.ts";
import { createHttpServer } from "./http/server.ts";
import { log } from "./log.ts";
import { bootWorld } from "./seed/boot.ts";
import { SpeechStore } from "./speech/store.ts";
import { dispatch, type DispatchInput, type RunnerDeps } from "./verbs/runner.ts";
import type { Services } from "./verbs/types.ts";

export interface App {
  config: Config;
  db: Db;
  clock: Clock;
  services: Services;
  server: Server;
  /** Base URL once listening, e.g. http://127.0.0.1:8787 */
  url: string;
  dispatch(input: DispatchInput): ReturnType<typeof dispatch>;
  close(): Promise<void>;
}

export async function startApp(config: Config): Promise<App> {
  const db = await openDb(config.db);
  try {
    const applied = await migrate(db, config.migrations_dir);
    if (applied.length > 0) log.info("migrations applied", { count: applied.length });
    const bundle = await loadRulesBundle(config.config_dir, config.rules_file);
    // The build validator reads the same S5 numbers file the world rules came from.
    useBuildLimits(bundle.numbers_file);
    const boot = await bootWorld(db, config.realm, bundle, new Date());
    log.info("world ready", { realm: config.realm, seeded: boot.seeded, rules_updated: boot.rulesUpdated });

    const services: Services = { speech: new SpeechStore(), balance: () => bundle.balance };
    const clock = new Clock(db, {
      realm: config.realm,
      maxCatchupPerTx: config.clock.max_catchup_ticks_per_tx,
      balance: services.balance,
    });
    const runner: RunnerDeps = { db, realm: config.realm, clock, services };
    const run = (input: DispatchInput) => dispatch(runner, input);
    const server = createHttpServer({
      ...runner,
      bodyMaxBytes: config.http.body_max_bytes,
      public: { db, realm: config.realm, dispatch: run },
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(config.http.port, config.http.host, () => resolve());
    });
    const addr = server.address() as AddressInfo;
    const host = addr.family === "IPv6" ? `[${addr.address}]` : addr.address;
    if (config.clock.enabled) clock.start();

    let closed = false;
    return {
      config,
      db,
      clock,
      services,
      server,
      url: `http://${host}:${addr.port}`,
      dispatch: run,
      async close() {
        if (closed) return;
        closed = true;
        clock.stop();
        const closing = new Promise<void>((resolve) => server.close(() => resolve()));
        server.closeAllConnections();
        await closing;
        await clock.idle();
        await db.close();
      },
    };
  } catch (err) {
    await db.close().catch(() => undefined);
    throw err;
  }
}
