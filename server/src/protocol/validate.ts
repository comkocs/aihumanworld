// Strict request-argument validators. Every failure is INVALID_ARGUMENT with the
// JSON path in `field` and a fixed type description in `details.expected`
// (never echoing user input). Objects reject unknown fields; branches reject
// fields of other branches (动词表 §1 「缺项／未知字段／错误类型」).

import { reject } from "./errors.ts";

export type V<T> = (input: unknown, path: string) => T;
export type Out<S> = S extends V<infer T> ? T : S extends Opt<infer T> ? T : never;

/** Read-only JSON Schema metadata travels with the actual validator, not a second argument table. */
export interface ValueSchema {
  type?: "string" | "integer" | "boolean" | "object" | "array" | "null";
  description?: string;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  const?: string;
  enum?: readonly string[];
  default?: unknown;
  properties?: Record<string, ValueSchema>;
  required?: string[];
  additionalProperties?: false;
  items?: ValueSchema;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  oneOf?: ValueSchema[];
  anyOf?: ValueSchema[];
}

const schemas = new WeakMap<V<unknown>, ValueSchema>();

export function described<T>(v: V<T>, schema: ValueSchema): V<T> {
  schemas.set(v, schema);
  return v;
}

export function schemaOf(v: V<unknown>): ValueSchema {
  const schema = schemas.get(v);
  if (schema === undefined) throw new Error("argument validator has no public schema");
  return schema;
}

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

export function bad(path: string, expected: string): never {
  return reject("INVALID_ARGUMENT", { expected }, path);
}

export const str = (opts: { min?: number; max?: number } = {}): V<string> => described((x, p) => {
  if (typeof x !== "string") return bad(p, "string");
  const n = [...x].length;
  if (opts.min !== undefined && n < opts.min) return bad(p, `string of at least ${opts.min} characters`);
  if (opts.max !== undefined && n > opts.max) return bad(p, `string of at most ${opts.max} characters`);
  return x;
}, { type: "string", ...(opts.min === undefined ? {} : { minLength: opts.min }), ...(opts.max === undefined ? {} : { maxLength: opts.max }) });

export const uint: V<number> = described((x, p) =>
  typeof x === "number" && Number.isSafeInteger(x) && x >= 0 && x <= MAX_SAFE
    ? x
    : bad(p, "non-negative safe integer"),
{ type: "integer", minimum: 0, maximum: MAX_SAFE });

export const posUint: V<number> = described((x, p) =>
  typeof x === "number" && Number.isSafeInteger(x) && x > 0 ? x : bad(p, "positive safe integer"),
{ type: "integer", minimum: 1, maximum: MAX_SAFE });

export const int: V<number> = described((x, p) =>
  typeof x === "number" && Number.isSafeInteger(x) ? x : bad(p, "safe integer"),
{ type: "integer", minimum: -MAX_SAFE, maximum: MAX_SAFE });

export const range = (lo: number, hi: number, what: string): V<number> => described((x, p) =>
  typeof x === "number" && Number.isInteger(x) && x >= lo && x <= hi ? x : bad(p, what),
{ type: "integer", minimum: lo, maximum: hi, description: what });

export const tier = range(1, 9, "tier integer 1..9");
export const stage = range(1, 4, "stage integer 1..4");
export const grade = range(1, 3, "grade integer 1..3");

export const bool: V<boolean> = described((x, p) => (typeof x === "boolean" ? x : bad(p, "boolean")), { type: "boolean" });

export function oneOf<const T extends string>(values: readonly T[], what?: string): V<T> {
  const set = new Set<string>(values);
  const expected = what ?? `one of ${values.join("/")}`;
  return described((x, p) => (typeof x === "string" && set.has(x) ? (x as T) : bad(p, expected)),
    { type: "string", enum: values, description: expected });
}

export function lit<const T extends string>(value: T): V<T> {
  return described((x, p) => (x === value ? value : bad(p, `"${value}"`)), { type: "string", const: value });
}

const SEQ_RE = /^(0|[1-9][0-9]*)$/;
export const isCanonicalSeq = (s: string): boolean => SEQ_RE.test(s);

/** Tick / Seq as canonical decimal string. */
export const seq: V<string> = described((x, p) =>
  typeof x === "string" && SEQ_RE.test(x) ? x : bad(p, "decimal integer string"),
{ type: "string", pattern: SEQ_RE.source, description: "decimal integer string" });

const ID_RE = /^[a-z][a-z0-9_]*:([a-z]+):[a-z][a-z0-9_]*$/;

export function idType(id: string): string | null {
  const m = ID_RE.exec(id);
  return m === null ? null : (m[1] ?? null);
}

/** `<realm>:<type>:<local>` restricted to the given table types. */
export function id(...types: string[]): V<string> {
  const expected = `ID of ${types.join("/")}`;
  return described((x, p) => {
    if (typeof x !== "string") return bad(p, expected);
    const t = idType(x);
    return t !== null && types.includes(t) ? x : bad(p, expected);
  }, { type: "string", pattern: `^[a-z][a-z0-9_]*:(${types.join("|")}):[a-z][a-z0-9_]*$`, description: expected });
}

const KEY_RE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/;
export const key: V<string> = described((x, p) =>
  typeof x === "string" && KEY_RE.test(x) ? x : bad(p, "dotted lowercase key"),
{ type: "string", pattern: KEY_RE.source, description: "dotted lowercase key" });

export function nullable<T>(v: V<T>): V<T | null> {
  return described((x, p) => (x === null ? null : v(x, p)), { anyOf: [schemaOf(v), { type: "null" }] });
}

export interface Opt<T> {
  readonly optional: true;
  readonly v: V<unknown>;
  readonly dflt: T;
}

/** Optional field; absent → default. */
export function opt<T, D extends T | undefined>(v: V<T>, dflt: D): Opt<T | D> {
  return { optional: true, v, dflt };
}

export type Shape = Record<string, V<unknown> | Opt<unknown>>;
export type ObjOut<S extends Shape> = { [K in keyof S]: Out<S[K]> };

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function readShape<S extends Shape>(
  shape: S,
  input: Record<string, unknown>,
  path: string,
  skip: string | null,
): ObjOut<S> {
  for (const k of Object.keys(input)) {
    if (k !== skip && !Object.hasOwn(shape, k)) bad(`${path}.${k}`, "no such field");
  }
  const out: Record<string, unknown> = {};
  for (const [k, spec] of Object.entries(shape)) {
    const fp = `${path}.${k}`;
    if (typeof spec === "function") {
      if (!Object.hasOwn(input, k)) bad(fp, "required field");
      out[k] = spec(input[k], fp);
    } else if (Object.hasOwn(input, k)) {
      out[k] = spec.v(input[k], fp);
    } else if (spec.dflt !== undefined) {
      out[k] = spec.dflt;
    }
  }
  return out as unknown as ObjOut<S>;
}

function shapeSchema(shape: Shape): ValueSchema {
  const properties: Record<string, ValueSchema> = {};
  const required: string[] = [];
  for (const [name, spec] of Object.entries(shape)) {
    if (typeof spec === "function") {
      properties[name] = schemaOf(spec);
      required.push(name);
    } else {
      properties[name] = { ...schemaOf(spec.v), ...(spec.dflt === undefined ? {} : { default: spec.dflt }) };
    }
  }
  return { type: "object", properties, required, additionalProperties: false };
}

export function obj<S extends Shape>(shape: S): V<ObjOut<S>> {
  return described((x, p) => (isPlainObject(x) ? readShape(shape, x, p, null) : bad(p, "object")), shapeSchema(shape));
}

export function arr<T>(v: V<T>, opts: { max?: number; min?: number; unique?: boolean } = {}): V<T[]> {
  return described((x, p) => {
    if (!Array.isArray(x)) return bad(p, "array");
    if (opts.max !== undefined && x.length > opts.max) return bad(p, `array of at most ${opts.max}`);
    if (opts.min !== undefined && x.length < opts.min) return bad(p, `array of at least ${opts.min}`);
    const out = x.map((e, i) => v(e, `${p}[${i}]`));
    if (opts.unique === true && new Set(out.map((e) => JSON.stringify(e))).size !== out.length) {
      return bad(p, "array without duplicates");
    }
    return out;
  }, { type: "array", items: schemaOf(v), ...(opts.min === undefined ? {} : { minItems: opts.min }),
    ...(opts.max === undefined ? {} : { maxItems: opts.max }), ...(opts.unique === undefined ? {} : { uniqueItems: opts.unique }) });
}

export type UnionOut<F extends string, B extends Record<string, Shape>> = {
  [K in keyof B & string]: { [P in F]: K } & ObjOut<B[K]>;
}[keyof B & string];

/** Discriminated object: `field` selects the branch shape. */
export function union<const F extends string, B extends Record<string, Shape>>(
  field: F,
  branches: B,
): V<UnionOut<F, B>> {
  const names = Object.keys(branches);
  const expected = `one of ${names.join("/")}`;
  return described((x, p) => {
    if (!isPlainObject(x)) return bad(p, "object");
    const tag = x[field];
    if (typeof tag !== "string" || !Object.hasOwn(branches, tag)) return bad(`${p}.${field}`, expected);
    const body = readShape(branches[tag] as Shape, x, p, field);
    return { [field]: tag, ...body } as unknown as UnionOut<F, B>;
  }, { oneOf: Object.entries(branches).map(([tag, shape]) => shapeSchema({ [field]: lit(tag), ...shape })) });
}

/** Post-check on a validated value. */
export function refine<T>(v: V<T>, ok: (t: T) => boolean, expected: string): V<T> {
  return described((x, p) => {
    const t = v(x, p);
    return ok(t) ? t : bad(p, expected);
  }, { ...schemaOf(v), description: expected });
}
