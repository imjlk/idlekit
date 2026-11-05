import { z } from "zod";
import { EXPONENTIAL_MODEL_ID, exponentialParamsSchema } from "./exponential";
import { MULTI_CURRENCY_MODEL_ID, multiCurrencyParamsSchema } from "./multiCurrency";
import { PRESTIGE_MODEL_ID, prestigeParamsSchema } from "./prestige";
import { PRODUCTION_CHAIN_MODEL_ID, productionChainParamsSchema } from "./productionChain";

export type BuiltinModelId =
  | typeof EXPONENTIAL_MODEL_ID
  | typeof PRESTIGE_MODEL_ID
  | typeof MULTI_CURRENCY_MODEL_ID
  | typeof PRODUCTION_CHAIN_MODEL_ID;

const sources = [
  [EXPONENTIAL_MODEL_ID, exponentialParamsSchema, "Params of the built-in exponential@1 model."],
  [PRESTIGE_MODEL_ID, prestigeParamsSchema, "Params of the built-in prestige@1 model."],
  [MULTI_CURRENCY_MODEL_ID, multiCurrencyParamsSchema, "Params of the built-in multi-currency@1 model."],
  [PRODUCTION_CHAIN_MODEL_ID, productionChainParamsSchema, "Params of the built-in production-chain@1 model."],
] as const;

/** `$id` of the params schema that `docs/schemas/models/` stores for a built-in model. */
export function builtinModelParamsSchemaId(id: BuiltinModelId): string {
  return `https://idlekit.dev/schemas/models/${id}.params.v1.schema.json`;
}

/**
 * Structural JSON Schemas (2020-12) for `scenario.model.params` of each built-in model, generated from the
 * same zod schemas the factories validate with. Cross-field rules (unknown references, duplicate ids,
 * recipe cycles) and the `> 0` amount checks stay in the runtime validator only.
 */
export function builtinModelParamsJsonSchemas(): Record<BuiltinModelId, Record<string, unknown>> {
  const out = {} as Record<BuiltinModelId, Record<string, unknown>>;
  for (const [id, schema, title] of sources) {
    const generated = z.toJSONSchema(schema, { io: "input", target: "draft-2020-12" }) as Record<string, unknown>;
    const { $schema, ...rest } = generated;
    out[id] = { $schema, $id: builtinModelParamsSchemaId(id), title, ...rest };
  }
  return out;
}
