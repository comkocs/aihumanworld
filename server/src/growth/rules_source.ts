// Load S5 directly or through the deployable pointer used by the S9 config path.

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseBalance, type Balance } from "./balance.ts";

export interface RulesBundle {
  rules_revision: unknown;
  rules: unknown;
  balance: Balance;
  /** Absolute path of the S5 numbers file actually loaded (after the pointer). */
  numbers_file: string;
}

export async function loadRulesBundle(configDir: string, rulesFile: string): Promise<RulesBundle> {
  let path = resolve(configDir, rulesFile);
  let raw = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  if (typeof raw.numbers_file === "string") {
    path = resolve(dirname(path), raw.numbers_file);
    raw = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  }
  const balance = parseBalance(raw);
  const source = raw.world_rules;
  if (typeof source !== "object" || source === null || Array.isArray(source)) throw new Error("S5 world_rules missing");
  const rules = source as Record<string, unknown>;
  const costs = rules.ap_costs;
  if (typeof costs !== "object" || costs === null || Array.isArray(costs)) throw new Error("S5 ap_costs missing");
  const flat: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(costs)) {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      for (const [op, amount] of Object.entries(value)) flat[`${key}.${op}`] = amount;
    } else flat[key] = value;
  }
  if (rules.balance_key !== balance.numbers.meta.revision_key) throw new Error("S5 balance revision mismatch");
  return { rules_revision: balance.numbers.meta.revision_key, rules: { ...rules, ap_costs: flat }, balance, numbers_file: path };
}
