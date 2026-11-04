import type { ModelFactory } from "../scenario/registry";
import { createExponentialFactory } from "./exponential";
import { createMultiCurrencyFactory } from "./multiCurrency";
import { createPrestigeFactory } from "./prestige";
import { createProductionChainFactory } from "./productionChain";

export {
  EXPONENTIAL_MODEL_ID,
  createExponentialFactory,
  createExponentialModel,
  exponentialParamsSchema,
  exponentialVarsSchema,
  parseExponentialParams,
  type ExponentialParams,
  type ExponentialParamsInput,
  type ExponentialVars,
} from "./exponential";
export {
  PRESTIGE_MODEL_ID,
  PRESTIGE_RESET_ACTION_ID,
  createPrestigeFactory,
  createPrestigeModel,
  parsePrestigeParams,
  prestigeMultiplierFor,
  prestigeParamsSchema,
  prestigePointsFor,
  prestigeVarsSchema,
  previewPrestigeGain,
  type PrestigeGainPreview,
  type PrestigeParams,
  type PrestigeParamsInput,
  type PrestigeRules,
  type PrestigeVars,
} from "./prestige";
export {
  MULTI_CURRENCY_MODEL_ID,
  createMultiCurrencyFactory,
  createMultiCurrencyModel,
  multiCurrencyParamsSchema,
  multiCurrencyRate,
  multiCurrencyVarsSchema,
  parseMultiCurrencyParams,
  type MultiCurrencyParams,
  type MultiCurrencyParamsInput,
  type MultiCurrencyVars,
} from "./multiCurrency";
export {
  PRODUCTION_CHAIN_MODEL_ID,
  analyzeProductionChain,
  createProductionChainFactory,
  createProductionChainModel,
  parseProductionChainParams,
  productionChainParamsSchema,
  productionChainVarsSchema,
  recipeOrder,
  type ChainLimit,
  type ChainRecipeFlow,
  type ChainResourceFlow,
  type ProductionChainAnalysis,
  type ProductionChainParams,
  type ProductionChainParamsInput,
  type ProductionChainVars,
} from "./productionChain";
export { BuiltinModelRangeError } from "./shared";
export { builtinModelParamsJsonSchemas, builtinModelParamsSchemaId, type BuiltinModelId } from "./jsonSchema";

/**
 * The built-in models that need no plugin, apart from `linear`, which the CLI registers itself.
 * Each call returns new factory objects.
 */
export function builtinModelFactories(): ModelFactory[] {
  return [createExponentialFactory(), createPrestigeFactory(), createMultiCurrencyFactory(), createProductionChainFactory()];
}
