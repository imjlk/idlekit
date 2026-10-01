import { createHash } from "crypto";
import typia, { tags, type IValidation } from "typia";
import type { ScenarioV1 } from "./types";

/**
 * Structural contract for ScenarioV1.
 * Semantic checks stay in validateScenarioV1. This module does not replace them.
 * PR-08 appends analysis DTOs to contractRegistry. It does not migrate every existing DTO.
 */

const CONTRACT_GENERATOR = "idlekit.contract-generator" as const;
const CONTRACT_GENERATOR_VERSION = 1 as const;
const JSON_SCHEMA_EXPORT = "typia.json.schema" as const;
const JSON_SCHEMA_DIALECT = "openapi-3.1" as const;
const TYPIA_VERSION = "14.0.6" as const;
const SCENARIO_SCHEMA_ID = "https://idlekit.dev/schemas/scenario.v1.schema.json" as const;

/**
 * @evidence docs/requirements/active/typed-contract-generation.md#req-tc05-typed-contract-single-source ScenarioV1 is the generated structural contract. The registry starts with that id.
 * @evidenceReview docs/requirements/active/typed-contract-generation.md#req-tc05-typed-contract-single-source #4326433 Re-read the section: the id is idlekit.scenario.v1 and the export is typia.json.schema 3.1. PR-08 appends the analysis artifact id.
 */
export const typedContractSingleSource = "idlekit.scenario.v1" as const;

/**
 * @evidence docs/requirements/active/typed-contract-generation.md#req-tc05-semantic-validation-retained The runtime gate stays validateScenarioV1. Generated structure does not claim cross-field or parser checks.
 * @evidenceReview docs/requirements/active/typed-contract-generation.md#req-tc05-semantic-validation-retained #ef40883 Re-read the section: a zero step fails the handwritten gate only, and both runtimes allow an unknown field.
 */
export const semanticValidationRetained = "validateScenarioV1" as const;

/**
 * @evidence docs/requirements/active/typed-contract-generation.md#req-tc05-published-validator-transformed The published validator is createValidate of ScenarioV1, not an unresolved generic.
 * @evidenceReview docs/requirements/active/typed-contract-generation.md#req-tc05-published-validator-transformed #fafe1c5 Re-read the section: the call is typia.createValidate of ScenarioV1.
 */
export const publishedValidatorTransformed = "typia.createValidate<ScenarioV1>" as const;

const contractRegistry = [
  {
    id: typedContractSingleSource,
    kind: "scenario" as const,
    typeName: "ScenarioV1",
    source: "packages/core/src/scenario/types.ts",
  },
  {
    id: "idlekit.analysis.artifact.v1" as const,
    kind: "analysis-artifact" as const,
    typeName: "AnalysisArtifactV1",
    source: "packages/core/src/sim/analysis/contracts.ts",
  },
] as const;

/**
 * Supported typia tags. Not applied to ScenarioV1: the brand is not assignable from number.
 */
export type FiniteUnitRate = number & tags.Minimum<0> & tags.Maximum<1>;

/*
 * The typia calls below run on first use, not at module load. A plugin that imports
 * core source from a bundled CLI process loads this module without the transform.
 */
let finiteUnitRateValidator: ((input: unknown) => IValidation<FiniteUnitRate>) | undefined;

export const validateFiniteUnitRate = (input: unknown): IValidation<FiniteUnitRate> =>
  (finiteUnitRateValidator ??= typia.createValidate<FiniteUnitRate>())(input);

let scenarioStructureValidator: ((input: unknown) => IValidation<ScenarioV1>) | undefined;

/**
 * Concrete structural validator. Unresolved typia.validate of a type parameter is not this path.
 */
export const validateScenarioStructure = (input: unknown): IValidation<ScenarioV1> =>
  (scenarioStructureValidator ??= typia.createValidate<ScenarioV1>())(input);

export function parseScenarioStructure(input: string): IValidation<ScenarioV1> {
  return typia.json.validateParse<ScenarioV1>(input);
}

let scenarioJsonSchemaUnit: ReturnType<typeof buildScenarioJsonSchema> | undefined;

function buildScenarioJsonSchema() {
  return typia.json.schema<ScenarioV1, "3.1">();
}

function scenarioJsonSchema(): ReturnType<typeof buildScenarioJsonSchema> {
  scenarioJsonSchemaUnit ??= buildScenarioJsonSchema();
  return scenarioJsonSchemaUnit;
}

export function registeredContracts(): typeof contractRegistry {
  return contractRegistry;
}

const SEMANTIC_NOT_GENERATED = [
  "cross-field stop condition",
  "positive step",
  "empty amount string",
  "model registry membership",
  "big-number parser",
  "safe expression",
] as const;

export type SourceDigest = Readonly<{ path: string; sha256: string }>;

export type ContractDocument = Readonly<{
  idlekitContract: Readonly<{
    generator: typeof CONTRACT_GENERATOR;
    generatorVersion: typeof CONTRACT_GENERATOR_VERSION;
    exportApi: typeof JSON_SCHEMA_EXPORT;
    dialect: typeof JSON_SCHEMA_DIALECT;
    typia: typeof TYPIA_VERSION;
    schemaId: typeof SCENARIO_SCHEMA_ID;
    unknownFieldPolicy: "runtime-allow";
    jsonSchemaAdditionalProperties: false;
    runtimeValidator: typeof semanticValidationRetained;
    semanticNotGenerated: readonly string[];
    registrations: typeof contractRegistry;
    sourceHash: string;
    sources: readonly SourceDigest[];
  }>;
  schema: Readonly<{
    $id: typeof SCENARIO_SCHEMA_ID;
    version: "3.1";
    schema: unknown;
    components: unknown;
  }>;
}>;

export function canonicalJson(value: unknown): string {
  return renderCanonical(value, new Set());
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function renderCanonical(value: unknown, seen: Set<object>): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (seen.has(value)) return '"[circular]"';
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((entry) => renderCanonical(entry ?? null, seen)).join(",")}]`;
    }
    const entries = Object.entries(value).filter(([key, entry]) => key !== "__type" && entry !== undefined);
    entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${renderCanonical(entry, seen)}`)
      .join(",")}}`;
  } finally {
    seen.delete(value);
  }
}

function orderedSources(sources: readonly SourceDigest[]): SourceDigest[] {
  return [...sources].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
}

export function contractSourceHash(sources: readonly SourceDigest[]): string {
  const ordered = orderedSources(sources);
  return sha256Text(
    canonicalJson({
      dialect: JSON_SCHEMA_DIALECT,
      exportApi: JSON_SCHEMA_EXPORT,
      generator: CONTRACT_GENERATOR,
      generatorVersion: CONTRACT_GENERATOR_VERSION,
      registrations: contractRegistry,
      sources: ordered,
      typia: TYPIA_VERSION,
    }),
  );
}

export function buildContractDocument(sources: readonly SourceDigest[]): ContractDocument {
  const ordered = orderedSources(sources);
  const unit = scenarioJsonSchema();
  return {
    idlekitContract: {
      generator: CONTRACT_GENERATOR,
      generatorVersion: CONTRACT_GENERATOR_VERSION,
      exportApi: JSON_SCHEMA_EXPORT,
      dialect: JSON_SCHEMA_DIALECT,
      typia: TYPIA_VERSION,
      schemaId: SCENARIO_SCHEMA_ID,
      unknownFieldPolicy: "runtime-allow",
      jsonSchemaAdditionalProperties: false,
      runtimeValidator: semanticValidationRetained,
      semanticNotGenerated: SEMANTIC_NOT_GENERATED,
      registrations: contractRegistry,
      sourceHash: contractSourceHash(ordered),
      sources: ordered,
    },
    schema: {
      $id: SCENARIO_SCHEMA_ID,
      version: unit.version,
      schema: unit.schema,
      components: unit.components,
    },
  };
}

export type FieldMetadata = Readonly<{
  idlekitContract: Readonly<{
    kind: "structural-metadata";
    schemaId: typeof SCENARIO_SCHEMA_ID;
    sourceHash: string;
    note: "Names, enum values, and schema descriptions only. No design intent, example balances, or translations.";
  }>;
  properties: readonly string[];
  enums: Readonly<Record<string, readonly string[]>>;
  comments: Readonly<Record<string, string>>;
}>;

export function structuralFieldMetadata(unit: { schema: unknown; components: unknown }): {
  properties: string[];
  enums: Record<string, string[]>;
  comments: Record<string, string>;
} {
  const components =
    unit.components && typeof unit.components === "object" && !Array.isArray(unit.components)
      ? (unit.components as Record<string, unknown>)
      : {};
  const schemas =
    components.schemas && typeof components.schemas === "object" && !Array.isArray(components.schemas)
      ? (components.schemas as Record<string, unknown>)
      : {};
  const properties: string[] = [];
  const enums: Record<string, string[]> = {};
  const comments: Record<string, string> = {};
  const seen = new Set<unknown>();

  function walk(node: unknown, path: string): void {
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    const record = node as Record<string, unknown>;
    if (typeof record.$ref === "string") {
      const name = record.$ref.startsWith("#/components/schemas/")
        ? record.$ref.slice("#/components/schemas/".length)
        : "";
      if (name) walk(schemas[name], path);
      return;
    }
    if (typeof record.description === "string" && path.length > 0 && comments[path] === undefined) {
      comments[path] = record.description;
    }
    if (Array.isArray(record.enum) && path.length > 0 && enums[path] === undefined) {
      const values = record.enum.filter((item): item is string => typeof item === "string");
      if (values.length > 0) enums[path] = values;
    }
    if (Array.isArray(record.oneOf) && path.length > 0 && enums[path] === undefined) {
      const values = record.oneOf.map((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return undefined;
        return (entry as Record<string, unknown>).const;
      });
      if (values.length > 0 && values.every((entry): entry is string => typeof entry === "string")) {
        enums[path] = values;
      }
    }
    const props = record.properties;
    if (props && typeof props === "object" && !Array.isArray(props)) {
      for (const key of Object.keys(props).sort()) {
        const next = path.length > 0 ? `${path}.${key}` : key;
        if (!properties.includes(next)) properties.push(next);
        walk((props as Record<string, unknown>)[key], next);
      }
    }
    if (record.items) walk(record.items, path.length > 0 ? `${path}[]` : "[]");
    for (const key of ["oneOf", "anyOf", "allOf"]) {
      const list = record[key];
      if (Array.isArray(list)) {
        for (const entry of list) walk(entry, path);
      }
    }
  }

  walk(unit.schema, "");
  properties.sort();
  return { properties, enums, comments };
}

export function buildFieldMetadata(sources: readonly SourceDigest[]): FieldMetadata {
  const fields = structuralFieldMetadata(scenarioJsonSchema());
  return {
    idlekitContract: {
      kind: "structural-metadata",
      schemaId: SCENARIO_SCHEMA_ID,
      sourceHash: contractSourceHash(sources),
      note: "Names, enum values, and schema descriptions only. No design intent, example balances, or translations.",
    },
    properties: fields.properties,
    enums: fields.enums,
    comments: fields.comments,
  };
}
