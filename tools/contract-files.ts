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
} {
  const sources = sourceDigests(base);
  const analysisSources = analysisSourceDigests(base);
  const etaSources = etaSourceDigests(base);
  const analysisDocument = buildAnalysisContractDocument(analysisSources);
  const etaDocument = buildEtaContractDocument(etaSources);
  const analysisFields = structuralFieldMetadata(analysisArtifactJsonSchema());
  const etaFields = structuralFieldMetadata(etaEstimateJsonSchema());
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
