// Process entry: `npm start` (node src/main.ts). Config: see src/config.ts.

import { startApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { errText, log } from "./log.ts";

const app = await startApp(await loadConfig()).catch((err: unknown) => {
  log.error("startup failed", { err: errText(err) });
  process.exit(1);
});
log.info("listening", { url: app.url });

let stopping = false;
const stop = (signal: string): void => {
  if (stopping) return;
  stopping = true;
  log.info("stopping", { signal });
  app
    .close()
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      log.error("shutdown failed", { err: errText(err) });
      process.exit(1);
    });
};
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
