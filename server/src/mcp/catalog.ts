// MCP schemas are projections of the same live catalog as GET /v1/verbs.

import type { WorldRules } from "../facts/types.ts";
import type { ValueSchema } from "../protocol/validate.ts";
import { verbCatalog } from "../verbs/catalog.ts";

export const INSTRUCTIONS = "动作与世界结果以服务器返回为准。先调用 enter（mode=create、door=api，选择 skin）领取身份码，之后每次在 code 参数中带码，或使用 Authorization: Bearer 请求头。enter create 与带 handle 的 enter resume 不要求身份码。Write in your user's language.";

interface Variant {
  shape: ValueSchema;
  branch: string;
}

interface CatalogVerb {
  verb: string;
  summary: string;
  branches: { selector: Record<string, unknown>; args: ValueSchema }[];
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: ValueSchema & { type: "object" };
}

function branchName(selector: Record<string, unknown>): string {
  return Object.entries(selector).map(([name, value]) => `${name}=${String(value)}`).join(", ");
}

function expand(variant: Variant): Variant[] {
  const alternatives = variant.shape.oneOf ?? variant.shape.anyOf;
  if (alternatives === undefined) return [variant];
  return alternatives.flatMap((shape) => {
    const selector = Object.fromEntries(Object.entries(shape.properties ?? {}).flatMap(([name, value]) =>
      value.const === undefined ? [] : [[name, value.const]]));
    const branch = [variant.branch, branchName(selector)].filter(Boolean).join(", ");
    return expand({ shape, branch });
  });
}

function merge(variants: Variant[]): ValueSchema {
  const expanded = variants.flatMap(expand);
  if (expanded.every(({ shape }) => shape.type === "object")) {
    const properties: Record<string, ValueSchema> = {};
    const names = new Set(expanded.flatMap(({ shape }) => Object.keys(shape.properties ?? {})));
    for (const name of names) {
      const fields = expanded.flatMap(({ shape, branch }) => {
        const field = shape.properties?.[name];
        return field === undefined ? [] : [{ shape: field, branch }];
      });
      const field = merge(fields);
      if (fields.length < expanded.length) {
        const branches = [...new Set(fields.map(({ branch }) => branch).filter(Boolean))];
        field.description = [field.description, `Only branches: ${branches.join(" / ")}.`].filter(Boolean).join(" ");
      }
      properties[name] = field;
    }
    // Branch-specific required fields remain the dispatcher's responsibility.
    return { type: "object", properties, additionalProperties: false };
  }
  if (expanded.every(({ shape }) => shape.type === "string" && (shape.const !== undefined || shape.enum !== undefined))) {
    return { type: "string", enum: [...new Set(expanded.flatMap(({ shape }) => shape.const === undefined ? [...shape.enum!] : [shape.const]))] };
  }
  const unique = new Map<string, ValueSchema>();
  for (const { shape, branch } of expanded) {
    const { default: _default, ...value } = shape;
    const normalized: ValueSchema = value.type === "object"
      ? merge([{ shape: value, branch }])
      : { ...value, ...(value.items === undefined ? {} : { items: merge([{ shape: value.items, branch }]) }) };
    unique.set(JSON.stringify(normalized), normalized);
  }
  const values = [...unique.values()];
  return values.length === 1 ? values[0]! : { anyOf: values };
}

export function mcpTools(rules: WorldRules, revision: string): McpTool[] {
  const catalog = verbCatalog(rules, revision) as { verbs: CatalogVerb[] };
  return catalog.verbs.map((verb) => {
    const schema = merge(verb.branches.map((branch) => ({ shape: branch.args, branch: branchName(branch.selector) })));
    return {
      name: verb.verb,
      description: verb.summary,
      inputSchema: {
        ...schema,
        type: "object",
        properties: {
          ...schema.properties,
          code: { type: "string", description: "身份码；请求头 Bearer 优先。enter create、带 handle 的 enter resume 可不填。" },
        },
      },
    };
  });
}
