import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SERVER_ROOT } from "./config.ts";

export const VERSION = (() => {
  try { return readFileSync(resolve(SERVER_ROOT, "../VERSION"), "utf8").trim(); }
  catch { return "0.0.0"; }
})();
