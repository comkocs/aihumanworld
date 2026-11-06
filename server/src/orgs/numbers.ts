// S25 reads the loaded S5 bundle without widening another stream's shared types.

import type { Balance } from "../growth/balance.ts";
import { reject } from "../protocol/errors.ts";

function missing(path: string): never {
  return reject("RULES_UNSET", { rule_key: `balance.${path}` });
}

export function valueAt(balance: Balance, path: string): unknown {
  let value: unknown = balance.numbers;
  for (const key of path.split(".")) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return missing(path);
    value = (value as Record<string, unknown>)[key];
  }
  if (value === undefined || value === null) return missing(path);
  return value;
}

export function uintValue(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return missing(path);
  return value;
}

export function numberAt(balance: Balance, path: string): number {
  return uintValue(valueAt(balance, path), path);
}

export function periodAt(balance: Balance, path: string): bigint {
  const value = numberAt(balance, path);
  if (value === 0) return missing(path);
  return BigInt(value);
}

export function boolAt(balance: Balance, path: string): boolean {
  const value = valueAt(balance, path);
  if (typeof value !== "boolean") return missing(path);
  return value;
}

export function cellAt(balance: Balance, path: string, keys: Record<string, number>): Record<string, unknown> {
  const rows = valueAt(balance, path);
  if (!Array.isArray(rows)) return missing(path);
  const found = rows.filter((row: unknown) => typeof row === "object" && row !== null &&
    Object.entries(keys).every(([key, value]) => (row as Record<string, unknown>)[key] === value));
  if (found.length !== 1) return missing(path);
  return found[0] as Record<string, unknown>;
}

export function cellNumber(balance: Balance, path: string, keys: Record<string, number>, field: string): number {
  return uintValue(cellAt(balance, path, keys)[field], `${path}.${field}`);
}

export function checkedUInt(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("S25 settlement outside UInt range");
  return Number(value);
}

export function floorRatio(value: number, factor: number, denominator = 10000): number {
  if (denominator <= 0) throw new Error("S25 non-positive divisor");
  return checkedUInt(BigInt(value) * BigInt(factor) / BigInt(denominator));
}

export function ceilRatio(value: bigint, denominator: bigint): number {
  if (denominator <= 0n) throw new Error("S25 non-positive divisor");
  return checkedUInt((value + denominator - 1n) / denominator);
}

export function requireRevision(balance: Balance, revision: string, key: string | null): void {
  if (key === null || key !== balance.numbers.meta.revision_key || revision !== key) missing("revision");
}
