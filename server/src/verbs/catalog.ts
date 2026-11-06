// Public discovery is a projection of the registered validators and live AP rules.

import type { WorldRules } from "../facts/types.ts";
import type { ErrorCode } from "../protocol/errors.ts";
import { schemaOf, type ValueSchema } from "../protocol/validate.ts";
import { REGISTRY } from "./registry.ts";

function variants(schema: ValueSchema): ValueSchema[] {
  if (schema.oneOf !== undefined) return schema.oneOf;
  for (const field of ["mode", "section", "op", "kind"]) {
    const values = schema.properties?.[field]?.enum;
    if (values === undefined) continue;
    return values.map((value) => ({
      ...schema,
      properties: { ...schema.properties, [field]: { ...schema.properties![field], const: value, enum: undefined } },
    }));
  }
  return [schema];
}

function selector(schema: ValueSchema): Record<string, unknown> {
  return Object.fromEntries(Object.entries(schema.properties ?? {}).flatMap(([name, value]) =>
    value.const !== undefined ? [[name, value.const]] : []));
}

export function verbCatalog(rules: WorldRules, revision: string): object {
  return {
    protocol: "aihw.v1",
    rules_revision: revision,
    request: { method: "POST", path: "/v1/actions/{verb}", body: { args: "branch arguments" }, authorization: "Bearer <identity_code> except enter create" },
    read_only: { definitions: "/v1/defs", shop: "/v1/shops/{npc}" },
    verbs: Object.values(REGISTRY).map((def) => ({
      verb: def.verb,
      summary: def.summary,
      branches: variants(schemaOf(def.args)).map((shape) => {
        const a = selector(shape);
        const costKey = def.costKey(a);
        const cost = rules.ap_costs[costKey] ?? null;
        const auth = def.auth(a);
        const gate = def.gate?.(a) ?? (cost !== null && cost > 0 ? "acting" : "none");
        const errors: ErrorCode[] = ["INVALID_ARGUMENT", "RULES_UNSET", "RETRY_LATER", ...def.errors];
        if (auth) errors.push("AUTH_REQUIRED", "AUTH_INVALID", "IDENTITY_EXPIRED");
        if (gate !== "none") errors.push("STATE_BLOCKED");
        if (gate === "acting") errors.push("LIFE_BLOCKED");
        if (auth && cost !== null && cost > 0) errors.push("AP_EXHAUSTED");
        return { selector: a, args: shape, auth_required: auth, ap_cost_key: costKey, ap_cost: cost,
          gate, purpose: def.purpose?.(a) ?? def.summary, common_errors: [...new Set(errors)] };
      }),
    })),
  };
}
