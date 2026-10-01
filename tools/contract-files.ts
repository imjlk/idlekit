import { createHash } from "crypto";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import {
  analysisAlgorithmVersion,
  analysisArtifactContract,
  analysisArtifactJsonSchema,
  analysisCanonicalJson,
  analysisSchemaId,
} from "../packages/core/src/sim/analysis/contracts";
import {
  etaEstimateAlgorithmVersion,
  etaEstimateJsonSchema,
  etaEstimateSchemaId,
} from "../packages/core/src/sim/analysis/eta";
import {
  growthFitAlgorithmVersion,
  growthFitJsonSchema,
  growthFitSchemaId,
} from "../packages/core/src/sim/analysis/growthFit";
import {
  resetCycleAlgorithmVersion,
  resetCycleJsonSchema,
  resetCycleSchemaId,
} from "../packages/core/src/sim/analysis/resetCycle";
import {
  buildContractDocument,
  buildFieldMetadata,
  canonicalJson,
  sha256Text,
  structuralFieldMetadata,
  type SourceDigest,
} from "../packages/core/src/scenario/scenarioContract";

export const root = resolve(import.meta.dir, "..");
export const trackedDir = join(root, "docs/schemas/generated");
export const schemaName = "scenario.v1.schema.json";
export const fieldsName = "scenario.v1.fields.json";
export const analysisSchemaName = "analysis.artifact.v1.schema.json";
export const analysisFieldsName = "analysis.artifact.v1.fields.json";
export const etaSchemaName = "eta.estimate.v1.schema.json";
export const etaFieldsName = "eta.estimate.v1.fields.json";
export const resetSchemaName = "reset.cycle.v1.schema.json";
export const resetFieldsName = "reset.cycle.v1.fields.json";
export const growthSchemaName = "growth.fit.v1.schema.json";
export const growthFieldsName = "growth.fit.v1.fields.json";

const inputs = [
  "packages/core/src/scenario/offlinePolicy.ts",
  "packages/core/src/scenario/scenarioContract.ts",
  "packages/core/src/scenario/types.ts",
];

const analysisInputs = [
  "packages/core/src/sim/analysis/contracts.ts",
  "packages/core/src/sim/analysis/metrics.ts",
  "packages/core/src/sim/analysis/registry.ts",
];

const etaInputs = ["packages/core/src/sim/analysis/eta.ts"];
const resetInputs = ["packages/core/src/sim/analysis/resetCycle.ts"];
const growthInputs = ["packages/core/src/sim/analysis/growthFit.ts"];

export function sourceDigests(base = root): SourceDigest[] {
  return inputs.map((path) => ({
    path,
    sha256: createHash("sha256").update(readFileSync(join(base, path))).digest("hex"),
  }));
}

export function analysisSourceDigests(base = root): SourceDigest[] {
  return analysisInputs.map((path) => ({
    path,
    sha256: createHash("sha256").update(readFileSync(join(base, path))).digest("hex"),
  }));
}

export function etaSourceDigests(base = root): SourceDigest[] {
  return etaInputs.map((path) => ({
    path,
    sha256: createHash("sha256").update(readFileSync(join(base, path))).digest("hex"),
  }));
}

export function resetSourceDigests(base = root): SourceDigest[] {
  return resetInputs.map((path) => ({
    path,
    sha256: createHash("sha256").update(readFileSync(join(base, path))).digest("hex"),
  }));
}

export function growthSourceDigests(base = root): SourceDigest[] {
  return growthInputs.map((path) => ({
    path,
    sha256: createHash("sha256").update(readFileSync(join(base, path))).digest("hex"),
  }));
}

export function buildEtaContractDocument(sources: readonly SourceDigest[]) {
  const ordered = [...sources].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const sourceHash = sha256Text(
    canonicalJson({
      algorithmVersion: etaEstimateAlgorithmVersion(),
      contractId: "idlekit.eta.estimate.v1",
      dialect: "openapi-3.1",
      exportApi: "typia.json.schema",
      generator: "idlekit.contract-generator",
      generatorVersion: 1,
      schemaId: etaEstimateSchemaId(),
      sources: ordered,
      typia: "14.0.6",
    }),
  );
  return {
    idlekitContract: {
      generator: "idlekit.contract-generator" as const,
      generatorVersion: 1 as const,
      exportApi: "typia.json.schema" as const,
      dialect: "openapi-3.1" as const,
      typia: "14.0.6" as const,
      schemaId: etaEstimateSchemaId(),
      contractId: "idlekit.eta.estimate.v1",
      algorithmVersion: etaEstimateAlgorithmVersion(),
      sourceHash,
      sources: ordered,
    },
    schema: {
      $id: etaEstimateSchemaId(),
      version: etaEstimateJsonSchema().version,
      schema: etaEstimateJsonSchema().schema,
      components: etaEstimateJsonSchema().components,
    },
  };
}

export function buildResetContractDocument(sources: readonly SourceDigest[]) {
  const ordered = [...sources].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const sourceHash = sha256Text(
    canonicalJson({
      algorithmVersion: resetCycleAlgorithmVersion(),
      contractId: "idlekit.reset-cycle.v1",
      dialect: "openapi-3.1",
      exportApi: "typia.json.schema",
      generator: "idlekit.contract-generator",
      generatorVersion: 1,
      schemaId: resetCycleSchemaId(),
      sources: ordered,
      typia: "14.0.6",
    }),
  );
  return {
    idlekitContract: {
      generator: "idlekit.contract-generator" as const,
      generatorVersion: 1 as const,
      exportApi: "typia.json.schema" as const,
      dialect: "openapi-3.1" as const,
      typia: "14.0.6" as const,
      schemaId: resetCycleSchemaId(),
      contractId: "idlekit.reset-cycle.v1",
      algorithmVersion: resetCycleAlgorithmVersion(),
      sourceHash,
      sources: ordered,
    },
    schema: {
      $id: resetCycleSchemaId(),
      version: resetCycleJsonSchema().version,
      schema: resetCycleJsonSchema().schema,
      components: resetCycleJsonSchema().components,
    },
  };
}

export function buildGrowthContractDocument(sources: readonly SourceDigest[]) {
  const ordered = [...sources].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const sourceHash = sha256Text(
    canonicalJson({
      algorithmVersion: growthFitAlgorithmVersion(),
      contractId: "idlekit.growth-fit.v1",
      dialect: "openapi-3.1",
      exportApi: "typia.json.schema",
      generator: "idlekit.contract-generator",
      generatorVersion: 1,
      schemaId: growthFitSchemaId(),
      sources: ordered,
      typia: "14.0.6",
    }),
  );
  return {
    idlekitContract: {
      generator: "idlekit.contract-generator" as const,
      generatorVersion: 1 as const,
      exportApi: "typia.json.schema" as const,
      dialect: "openapi-3.1" as const,
      typia: "14.0.6" as const,
      schemaId: growthFitSchemaId(),
      contractId: "idlekit.growth-fit.v1",
      algorithmVersion: growthFitAlgorithmVersion(),
      sourceHash,
      sources: ordered,
    },
    schema: {
      $id: growthFitSchemaId(),
      version: growthFitJsonSchema().version,
      schema: growthFitJsonSchema().schema,
      components: growthFitJsonSchema().components,
    },
  };
}

export function buildAnalysisContractDocument(sources: readonly SourceDigest[]) {
  const ordered = [...sources].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const sourceHash = sha256Text(
    canonicalJson({
      algorithmVersion: analysisAlgorithmVersion(),
      contractId: analysisArtifactContract,
      dialect: "openapi-3.1",
      exportApi: "typia.json.schema",
      generator: "idlekit.contract-generator",
      generatorVersion: 1,
      schemaId: analysisSchemaId(),
      sources: ordered,
      typia: "14.0.6",
    }),
  );
  return {
    idlekitContract: {
      generator: "idlekit.contract-generator" as const,
      generatorVersion: 1 as const,
      exportApi: "typia.json.schema" as const,
      dialect: "openapi-3.1" as const,
      typia: "14.0.6" as const,
      schemaId: analysisSchemaId(),
      contractId: analysisArtifactContract,
      algorithmVersion: analysisAlgorithmVersion(),
      sourceHash,
      sources: ordered,
    },
    schema: {
      $id: analysisSchemaId(),
      version: analysisArtifactJsonSchema().version,
      schema: analysisArtifactJsonSchema().schema,
      components: analysisArtifactJsonSchema().components,
    },
  };
}

export function renderedContracts(base = root): {
  schema: string;
  fields: string;
  analysisSchema: string;
  analysisFields: string;
  etaSchema: string;
  etaFields: string;
  resetSchema: string;
  resetFields: string;
  growthSchema: string;
  growthFields: string;
} {
  const sources = sourceDigests(base);
  const analysisSources = analysisSourceDigests(base);
  const etaSources = etaSourceDigests(base);
  const resetSources = resetSourceDigests(base);
  const growthSources = growthSourceDigests(base);
  const analysisDocument = buildAnalysisContractDocument(analysisSources);
  const etaDocument = buildEtaContractDocument(etaSources);
  const resetDocument = buildResetContractDocument(resetSources);
  const growthDocument = buildGrowthContractDocument(growthSources);
  const analysisFields = structuralFieldMetadata(analysisArtifactJsonSchema());
  const etaFields = structuralFieldMetadata(etaEstimateJsonSchema());
  const resetFields = structuralFieldMetadata(resetCycleJsonSchema());
  const growthFields = structuralFieldMetadata(growthFitJsonSchema());
  return {
    schema: `${canonicalJson(buildContractDocument(sources))}\n`,
    fields: `${canonicalJson(buildFieldMetadata(sources))}\n`,
    analysisSchema: `${analysisCanonicalJson(analysisDocument)}\n`,
    analysisFields: `${analysisCanonicalJson({
      idlekitContract: {
        kind: "structural-metadata",
        schemaId: analysisSchemaId(),
        sourceHash: analysisDocument.idlekitContract.sourceHash,
        note: "Names, enum values, and schema descriptions only. No design intent, example balances, or translations.",
      },
      properties: analysisFields.properties,
      enums: analysisFields.enums,
      comments: analysisFields.comments,
    })}\n`,
    etaSchema: `${analysisCanonicalJson(etaDocument)}\n`,
    etaFields: `${analysisCanonicalJson({
      idlekitContract: {
        kind: "structural-metadata",
        schemaId: etaEstimateSchemaId(),
        sourceHash: etaDocument.idlekitContract.sourceHash,
        note: "Names, enum values, and schema descriptions only. No design intent, example balances, or translations.",
      },
      properties: etaFields.properties,
      enums: etaFields.enums,
      comments: etaFields.comments,
    })}\n`,
    resetSchema: `${analysisCanonicalJson(resetDocument)}\n`,
    resetFields: `${analysisCanonicalJson({
      idlekitContract: {
        kind: "structural-metadata",
        schemaId: resetCycleSchemaId(),
        sourceHash: resetDocument.idlekitContract.sourceHash,
        note: "Names, enum values, and schema descriptions only. No design intent, example balances, or translations.",
      },
      properties: resetFields.properties,
      enums: resetFields.enums,
      comments: resetFields.comments,
    })}\n`,
    growthSchema: `${analysisCanonicalJson(growthDocument)}\n`,
    growthFields: `${analysisCanonicalJson({
      idlekitContract: {
        kind: "structural-metadata",
        schemaId: growthFitSchemaId(),
        sourceHash: growthDocument.idlekitContract.sourceHash,
        note: "Names, enum values, and schema descriptions only. No design intent, example balances, or translations.",
      },
      properties: growthFields.properties,
      enums: growthFields.enums,
      comments: growthFields.comments,
    })}\n`,
  };
}

export function writeContracts(dir: string, base = root): void {
  const rendered = renderedContracts(base);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, schemaName), rendered.schema);
  writeFileSync(join(dir, fieldsName), rendered.fields);
  writeFileSync(join(dir, analysisSchemaName), rendered.analysisSchema);
  writeFileSync(join(dir, analysisFieldsName), rendered.analysisFields);
  writeFileSync(join(dir, etaSchemaName), rendered.etaSchema);
  writeFileSync(join(dir, etaFieldsName), rendered.etaFields);
  writeFileSync(join(dir, resetSchemaName), rendered.resetSchema);
  writeFileSync(join(dir, resetFieldsName), rendered.resetFields);
  writeFileSync(join(dir, growthSchemaName), rendered.growthSchema);
  writeFileSync(join(dir, growthFieldsName), rendered.growthFields);
}

export function compareContracts(dir: string, base = root): string[] {
  const rendered = renderedContracts(base);
  const failures: string[] = [];
  for (const [name, next] of [
    [schemaName, rendered.schema],
    [fieldsName, rendered.fields],
    [analysisSchemaName, rendered.analysisSchema],
    [analysisFieldsName, rendered.analysisFields],
    [etaSchemaName, rendered.etaSchema],
    [etaFieldsName, rendered.etaFields],
    [resetSchemaName, rendered.resetSchema],
    [resetFieldsName, rendered.resetFields],
    [growthSchemaName, rendered.growthSchema],
    [growthFieldsName, rendered.growthFields],
  ] as const) {
    const path = join(dir, name);
    let current = "";
    try {
      current = readFileSync(path, "utf8");
    } catch {
      failures.push(`missing ${name}`);
      continue;
    }
    if (current !== next) failures.push(`drift ${name}`);
  }
  return failures;
}
