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
  buildContractDocument,
  buildFieldMetadata,
  canonicalJson,
  rootSchemaDocument,
  sha256Text,
  sourceTextDigest,
  structuralFieldMetadata,
  type SourceDigest,
} from "../packages/core/src/scenario/scenarioContract";

export const root = resolve(import.meta.dir, "..");
export const trackedDir = join(root, "docs/schemas/generated");
export const schemaName = "scenario.v1.schema.json";
export const fieldsName = "scenario.v1.fields.json";
export const analysisSchemaName = "analysis.artifact.v1.schema.json";
export const analysisFieldsName = "analysis.artifact.v1.fields.json";

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

/** Digest each source with LF line endings, so a CRLF checkout matches the tracked contract. */
export function digestSources(paths: readonly string[], base = root): SourceDigest[] {
  return paths.map((path) => ({
    path,
    sha256: sourceTextDigest(readFileSync(join(base, path), "utf8")),
  }));
}

export function sourceDigests(base = root): SourceDigest[] {
  return digestSources(inputs, base);
}

export function analysisSourceDigests(base = root): SourceDigest[] {
  return digestSources(analysisInputs, base);
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
  return rootSchemaDocument(analysisSchemaId(), analysisArtifactJsonSchema(), {
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
  });
}

export function renderedContracts(base = root): {
  schema: string;
  fields: string;
  analysisSchema: string;
  analysisFields: string;
} {
  const sources = sourceDigests(base);
  const analysisSources = analysisSourceDigests(base);
  const analysisDocument = buildAnalysisContractDocument(analysisSources);
  const analysisFields = structuralFieldMetadata(analysisArtifactJsonSchema());
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
  };
}

export function writeContracts(dir: string, base = root): void {
  const rendered = renderedContracts(base);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, schemaName), rendered.schema);
  writeFileSync(join(dir, fieldsName), rendered.fields);
  writeFileSync(join(dir, analysisSchemaName), rendered.analysisSchema);
  writeFileSync(join(dir, analysisFieldsName), rendered.analysisFields);
}

export function compareContracts(dir: string, base = root): string[] {
  const rendered = renderedContracts(base);
  const failures: string[] = [];
  for (const [name, next] of [
    [schemaName, rendered.schema],
    [fieldsName, rendered.fields],
    [analysisSchemaName, rendered.analysisSchema],
    [analysisFieldsName, rendered.analysisFields],
  ] as const) {
    const path = join(dir, name);
    let current = "";
    try {
      // A CRLF checkout of the tracked JSON is the same contract.
      current = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
    } catch {
      failures.push(`missing ${name}`);
      continue;
    }
    if (current !== next) failures.push(`drift ${name}`);
  }
  return failures;
}
