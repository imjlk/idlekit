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
  experimentAlgorithmVersion,
  experimentJsonSchema,
  experimentSchemaId,
} from "../packages/core/src/sim/analysis/experiment";
import {
  distributionAlgorithmVersion,
  distributionJsonSchema,
  distributionSchemaId,
} from "../packages/core/src/sim/analysis/distribution";
import {
  balanceChecksAlgorithmVersion,
  balanceChecksJsonSchema,
  balanceChecksSchemaId,
} from "../packages/core/src/sim/analysis/checks";
import {
  resetPolicyAlgorithmVersion,
  resetPolicyJsonSchema,
  resetPolicySchemaId,
} from "../packages/core/src/sim/analysis/resetOptimization";
import {
  resetCycleAlgorithmVersion,
  resetCycleJsonSchema,
  resetCycleSchemaId,
} from "../packages/core/src/sim/analysis/resetCycle";
import { judgeAlgorithmVersion, judgeJsonSchema, judgeSchemaId } from "../packages/core/src/sim/analysis/judge";
import { flowAlgorithmVersion, flowJsonSchema, flowSchemaId } from "../packages/core/src/sim/analysis/flow";
import { advanceAlgorithmVersion, advanceJsonSchema, advanceSchemaId } from "../packages/core/src/sim/advance";
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
export const etaSchemaName = "eta.estimate.v1.schema.json";
export const etaFieldsName = "eta.estimate.v1.fields.json";
export const resetSchemaName = "reset.cycle.v1.schema.json";
export const resetFieldsName = "reset.cycle.v1.fields.json";
export const growthSchemaName = "growth.fit.v1.schema.json";
export const growthFieldsName = "growth.fit.v1.fields.json";
export const experimentSchemaName = "experiment.v1.schema.json";
export const experimentFieldsName = "experiment.v1.fields.json";
export const distributionSchemaName = "distribution.v1.schema.json";
export const distributionFieldsName = "distribution.v1.fields.json";
export const policySchemaName = "reset.policy.v1.schema.json";
export const policyFieldsName = "reset.policy.v1.fields.json";
export const balanceSchemaName = "balance-checks.v1.schema.json";
export const balanceFieldsName = "balance-checks.v1.fields.json";
export const balancePublicSchema = "docs/schemas/balance-checks.v1.schema.json";
export const judgeSchemaName = "judge.v1.schema.json";
export const judgeFieldsName = "judge.v1.fields.json";
export const judgePublicSchema = "docs/schemas/judge.output.schema.json";
export const flowSchemaName = "flow.v1.schema.json";
export const flowFieldsName = "flow.v1.fields.json";
export const flowPublicSchema = "docs/schemas/flow.v1.schema.json";
export const advanceSchemaName = "advance.v1.schema.json";
export const advanceFieldsName = "advance.v1.fields.json";
export const advancePublicSchema = "docs/schemas/advance.v1.schema.json";

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

// EtaEstimateV1 embeds AnalysisStatus and AnalysisMethod from contracts.ts.
const etaInputs = ["packages/core/src/sim/analysis/contracts.ts", "packages/core/src/sim/analysis/eta.ts"];
const resetInputs = ["packages/core/src/sim/analysis/resetCycle.ts"];
// GrowthFitArtifactV1 embeds AnalysisStatus from contracts.ts.
const growthInputs = ["packages/core/src/sim/analysis/contracts.ts", "packages/core/src/sim/analysis/growthFit.ts"];
// The artifact values come from the sweep in experiment.ts and the elasticity and Pareto rules in sensitivity.ts.
const experimentInputs = ["packages/core/src/sim/analysis/experiment.ts", "packages/core/src/sim/analysis/sensitivity.ts"];
const distributionInputs = ["packages/core/src/sim/analysis/distribution.ts"];
const policyInputs = ["packages/core/src/sim/analysis/resetOptimization.ts"];
const balanceInputs = ["packages/core/src/sim/analysis/checks.ts"];

// JudgeReportV1 embeds BalanceCheckReportV1 from checks.ts.
const judgeInputs = ["packages/core/src/sim/analysis/checks.ts", "packages/core/src/sim/analysis/judge.ts"];

const flowInputs = ["packages/core/src/sim/analysis/flow.ts"];

const advanceInputs = ["packages/core/src/sim/advance.ts"];

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

export function etaSourceDigests(base = root): SourceDigest[] {
  return digestSources(etaInputs, base);
}

export function resetSourceDigests(base = root): SourceDigest[] {
  return digestSources(resetInputs, base);
}

export function growthSourceDigests(base = root): SourceDigest[] {
  return digestSources(growthInputs, base);
}

export function experimentSourceDigests(base = root): SourceDigest[] {
  return digestSources(experimentInputs, base);
}

export function distributionSourceDigests(base = root): SourceDigest[] {
  return digestSources(distributionInputs, base);
}

export function policySourceDigests(base = root): SourceDigest[] {
  return digestSources(policyInputs, base);
}

export function balanceSourceDigests(base = root): SourceDigest[] {
  return digestSources(balanceInputs, base);
}

export function judgeSourceDigests(base = root): SourceDigest[] {
  return digestSources(judgeInputs, base);
}

export function flowSourceDigests(base = root): SourceDigest[] {
  return digestSources(flowInputs, base);
}

export function advanceSourceDigests(base = root): SourceDigest[] {
  return digestSources(advanceInputs, base);
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
  return rootSchemaDocument(etaEstimateSchemaId(), etaEstimateJsonSchema(), {
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
  });
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
  return rootSchemaDocument(resetCycleSchemaId(), resetCycleJsonSchema(), {
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
  });
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
  return rootSchemaDocument(growthFitSchemaId(), growthFitJsonSchema(), {
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
  });
}

export function buildExperimentContractDocument(sources: readonly SourceDigest[]) {
  const ordered = [...sources].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const sourceHash = sha256Text(
    canonicalJson({
      algorithmVersion: experimentAlgorithmVersion(),
      contractId: "idlekit.experiment.v1",
      dialect: "openapi-3.1",
      exportApi: "typia.json.schema",
      generator: "idlekit.contract-generator",
      generatorVersion: 1,
      schemaId: experimentSchemaId(),
      sources: ordered,
      typia: "14.0.6",
    }),
  );
  return rootSchemaDocument(experimentSchemaId(), experimentJsonSchema(), {
    generator: "idlekit.contract-generator" as const,
    generatorVersion: 1 as const,
    exportApi: "typia.json.schema" as const,
    dialect: "openapi-3.1" as const,
    typia: "14.0.6" as const,
    schemaId: experimentSchemaId(),
    contractId: "idlekit.experiment.v1",
    algorithmVersion: experimentAlgorithmVersion(),
    sourceHash,
    sources: ordered,
  });
}

export function buildDistributionContractDocument(sources: readonly SourceDigest[]) {
  const ordered = [...sources].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const sourceHash = sha256Text(
    canonicalJson({
      algorithmVersion: distributionAlgorithmVersion(),
      contractId: "idlekit.distribution.v1",
      dialect: "openapi-3.1",
      exportApi: "typia.json.schema",
      generator: "idlekit.contract-generator",
      generatorVersion: 1,
      schemaId: distributionSchemaId(),
      sources: ordered,
      typia: "14.0.6",
    }),
  );
  return rootSchemaDocument(distributionSchemaId(), distributionJsonSchema(), {
    generator: "idlekit.contract-generator" as const,
    generatorVersion: 1 as const,
    exportApi: "typia.json.schema" as const,
    dialect: "openapi-3.1" as const,
    typia: "14.0.6" as const,
    schemaId: distributionSchemaId(),
    contractId: "idlekit.distribution.v1",
    algorithmVersion: distributionAlgorithmVersion(),
    sourceHash,
    sources: ordered,
  });
}

export function buildPolicyContractDocument(sources: readonly SourceDigest[]) {
  const ordered = [...sources].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const sourceHash = sha256Text(
    canonicalJson({
      algorithmVersion: resetPolicyAlgorithmVersion(),
      contractId: "idlekit.reset-policy.v1",
      dialect: "openapi-3.1",
      exportApi: "typia.json.schema",
      generator: "idlekit.contract-generator",
      generatorVersion: 1,
      schemaId: resetPolicySchemaId(),
      sources: ordered,
      typia: "14.0.6",
    }),
  );
  return rootSchemaDocument(resetPolicySchemaId(), resetPolicyJsonSchema(), {
    generator: "idlekit.contract-generator" as const,
    generatorVersion: 1 as const,
    exportApi: "typia.json.schema" as const,
    dialect: "openapi-3.1" as const,
    typia: "14.0.6" as const,
    schemaId: resetPolicySchemaId(),
    contractId: "idlekit.reset-policy.v1",
    algorithmVersion: resetPolicyAlgorithmVersion(),
    sourceHash,
    sources: ordered,
  });
}

export function buildBalanceContractDocument(sources: readonly SourceDigest[]) {
  const ordered = [...sources].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const sourceHash = sha256Text(
    canonicalJson({
      algorithmVersion: balanceChecksAlgorithmVersion(),
      contractId: "idlekit.balance-checks.v1",
      dialect: "openapi-3.1",
      exportApi: "typia.json.schema",
      generator: "idlekit.contract-generator",
      generatorVersion: 1,
      schemaId: balanceChecksSchemaId(),
      sources: ordered,
      typia: "14.0.6",
    }),
  );
  return rootSchemaDocument(balanceChecksSchemaId(), balanceChecksJsonSchema(), {
    generator: "idlekit.contract-generator" as const,
    generatorVersion: 1 as const,
    exportApi: "typia.json.schema" as const,
    dialect: "openapi-3.1" as const,
    typia: "14.0.6" as const,
    schemaId: balanceChecksSchemaId(),
    contractId: "idlekit.balance-checks.v1",
    algorithmVersion: balanceChecksAlgorithmVersion(),
    sourceHash,
    sources: ordered,
  });
}

export function buildJudgeContractDocument(sources: readonly SourceDigest[]) {
  const ordered = [...sources].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const sourceHash = sha256Text(
    canonicalJson({
      algorithmVersion: judgeAlgorithmVersion(),
      contractId: "idlekit.judge.v1",
      dialect: "openapi-3.1",
      exportApi: "typia.json.schema",
      generator: "idlekit.contract-generator",
      generatorVersion: 1,
      schemaId: judgeSchemaId(),
      sources: ordered,
      typia: "14.0.6",
    }),
  );
  return rootSchemaDocument(judgeSchemaId(), judgeJsonSchema(), {
    generator: "idlekit.contract-generator" as const,
    generatorVersion: 1 as const,
    exportApi: "typia.json.schema" as const,
    dialect: "openapi-3.1" as const,
    typia: "14.0.6" as const,
    schemaId: judgeSchemaId(),
    contractId: "idlekit.judge.v1",
    algorithmVersion: judgeAlgorithmVersion(),
    sourceHash,
    sources: ordered,
  });
}

export function buildFlowContractDocument(sources: readonly SourceDigest[]) {
  const ordered = [...sources].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const sourceHash = sha256Text(
    canonicalJson({
      algorithmVersion: flowAlgorithmVersion(),
      contractId: "idlekit.flow.v1",
      dialect: "openapi-3.1",
      exportApi: "typia.json.schema",
      generator: "idlekit.contract-generator",
      generatorVersion: 1,
      schemaId: flowSchemaId(),
      sources: ordered,
      typia: "14.0.6",
    }),
  );
  return rootSchemaDocument(flowSchemaId(), flowJsonSchema(), {
    generator: "idlekit.contract-generator" as const,
    generatorVersion: 1 as const,
    exportApi: "typia.json.schema" as const,
    dialect: "openapi-3.1" as const,
    typia: "14.0.6" as const,
    schemaId: flowSchemaId(),
    contractId: "idlekit.flow.v1",
    algorithmVersion: flowAlgorithmVersion(),
    sourceHash,
    sources: ordered,
  });
}

export function buildAdvanceContractDocument(sources: readonly SourceDigest[]) {
  const ordered = [...sources].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const sourceHash = sha256Text(
    canonicalJson({
      algorithmVersion: advanceAlgorithmVersion(),
      contractId: "idlekit.advance.v1",
      dialect: "openapi-3.1",
      exportApi: "typia.json.schema",
      generator: "idlekit.contract-generator",
      generatorVersion: 1,
      schemaId: advanceSchemaId(),
      sources: ordered,
      typia: "14.0.6",
    }),
  );
  return rootSchemaDocument(advanceSchemaId(), advanceJsonSchema(), {
    generator: "idlekit.contract-generator" as const,
    generatorVersion: 1 as const,
    exportApi: "typia.json.schema" as const,
    dialect: "openapi-3.1" as const,
    typia: "14.0.6" as const,
    schemaId: advanceSchemaId(),
    contractId: "idlekit.advance.v1",
    algorithmVersion: advanceAlgorithmVersion(),
    sourceHash,
    sources: ordered,
  });
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
  etaSchema: string;
  etaFields: string;
  resetSchema: string;
  resetFields: string;
  growthSchema: string;
  growthFields: string;
  experimentSchema: string;
  experimentFields: string;
  distributionSchema: string;
  distributionFields: string;
  policySchema: string;
  policyFields: string;
  balanceSchema: string;
  balanceFields: string;
  judgeSchema: string;
  judgeFields: string;
  flowSchema: string;
  flowFields: string;
  advanceSchema: string;
  advanceFields: string;
} {
  const sources = sourceDigests(base);
  const analysisSources = analysisSourceDigests(base);
  const etaSources = etaSourceDigests(base);
  const resetSources = resetSourceDigests(base);
  const growthSources = growthSourceDigests(base);
  const experimentSources = experimentSourceDigests(base);
  const distributionSources = distributionSourceDigests(base);
  const policySources = policySourceDigests(base);
  const balanceSources = balanceSourceDigests(base);
  const judgeSources = judgeSourceDigests(base);
  const flowSources = flowSourceDigests(base);
  const advanceSources = advanceSourceDigests(base);
  const analysisDocument = buildAnalysisContractDocument(analysisSources);
  const etaDocument = buildEtaContractDocument(etaSources);
  const resetDocument = buildResetContractDocument(resetSources);
  const growthDocument = buildGrowthContractDocument(growthSources);
  const experimentDocument = buildExperimentContractDocument(experimentSources);
  const distributionDocument = buildDistributionContractDocument(distributionSources);
  const policyDocument = buildPolicyContractDocument(policySources);
  const balanceDocument = buildBalanceContractDocument(balanceSources);
  const judgeDocument = buildJudgeContractDocument(judgeSources);
  const judgeFieldsMeta = structuralFieldMetadata(judgeJsonSchema());
  const flowDocument = buildFlowContractDocument(flowSources);
  const flowFieldsMeta = structuralFieldMetadata(flowJsonSchema());
  const advanceDocument = buildAdvanceContractDocument(advanceSources);
  const advanceFieldsMeta = structuralFieldMetadata(advanceJsonSchema());
  const analysisFields = structuralFieldMetadata(analysisArtifactJsonSchema());
  const etaFields = structuralFieldMetadata(etaEstimateJsonSchema());
  const resetFields = structuralFieldMetadata(resetCycleJsonSchema());
  const growthFields = structuralFieldMetadata(growthFitJsonSchema());
  const experimentFields = structuralFieldMetadata(experimentJsonSchema());
  const distributionFields = structuralFieldMetadata(distributionJsonSchema());
  const policyFields = structuralFieldMetadata(resetPolicyJsonSchema());
  const balanceFields = structuralFieldMetadata(balanceChecksJsonSchema());
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
    experimentSchema: `${analysisCanonicalJson(experimentDocument)}\n`,
    experimentFields: `${analysisCanonicalJson({
      idlekitContract: {
        kind: "structural-metadata",
        schemaId: experimentSchemaId(),
        sourceHash: experimentDocument.idlekitContract.sourceHash,
        note: "Names, enum values, and schema descriptions only. No design intent, example balances, or translations.",
      },
      properties: experimentFields.properties,
      enums: experimentFields.enums,
      comments: experimentFields.comments,
    })}\n`,
    distributionSchema: `${analysisCanonicalJson(distributionDocument)}\n`,
    distributionFields: `${analysisCanonicalJson({
      idlekitContract: {
        kind: "structural-metadata",
        schemaId: distributionSchemaId(),
        sourceHash: distributionDocument.idlekitContract.sourceHash,
        note: "Names, enum values, and schema descriptions only. No design intent, example balances, or translations.",
      },
      properties: distributionFields.properties,
      enums: distributionFields.enums,
      comments: distributionFields.comments,
    })}\n`,
    policySchema: `${analysisCanonicalJson(policyDocument)}\n`,
    policyFields: `${analysisCanonicalJson({
      idlekitContract: {
        kind: "structural-metadata",
        schemaId: resetPolicySchemaId(),
        sourceHash: policyDocument.idlekitContract.sourceHash,
        note: "Names, enum values, and schema descriptions only. No design intent, example balances, or translations.",
      },
      properties: policyFields.properties,
      enums: policyFields.enums,
      comments: policyFields.comments,
    })}\n`,
    balanceSchema: `${analysisCanonicalJson(balanceDocument)}\n`,
    balanceFields: `${analysisCanonicalJson({
      idlekitContract: {
        kind: "structural-metadata",
        schemaId: balanceChecksSchemaId(),
        sourceHash: balanceDocument.idlekitContract.sourceHash,
        note: "Names, enum values, and schema descriptions only. No design intent, example balances, or translations.",
      },
      properties: balanceFields.properties,
      enums: balanceFields.enums,
      comments: balanceFields.comments,
    })}\n`,
    judgeSchema: `${analysisCanonicalJson(judgeDocument)}\n`,
    judgeFields: `${analysisCanonicalJson({
      idlekitContract: {
        kind: "structural-metadata",
        schemaId: judgeSchemaId(),
        sourceHash: judgeDocument.idlekitContract.sourceHash,
        note: "Names, enum values, and schema descriptions only. No design intent, example balances, or translations.",
      },
      properties: judgeFieldsMeta.properties,
      enums: judgeFieldsMeta.enums,
      comments: judgeFieldsMeta.comments,
    })}\n`,
    flowSchema: `${analysisCanonicalJson(flowDocument)}\n`,
    flowFields: `${analysisCanonicalJson({
      idlekitContract: {
        kind: "structural-metadata",
        schemaId: flowSchemaId(),
        sourceHash: flowDocument.idlekitContract.sourceHash,
        note: "Names, enum values, and schema descriptions only. No design intent, example balances, or translations.",
      },
      properties: flowFieldsMeta.properties,
      enums: flowFieldsMeta.enums,
      comments: flowFieldsMeta.comments,
    })}\n`,
    advanceSchema: `${analysisCanonicalJson(advanceDocument)}\n`,
    advanceFields: `${analysisCanonicalJson({
      idlekitContract: {
        kind: "structural-metadata",
        schemaId: advanceSchemaId(),
        sourceHash: advanceDocument.idlekitContract.sourceHash,
        note: "Names, enum values, and schema descriptions only. No design intent, example balances, or translations.",
      },
      properties: advanceFieldsMeta.properties,
      enums: advanceFieldsMeta.enums,
      comments: advanceFieldsMeta.comments,
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
  writeFileSync(join(dir, experimentSchemaName), rendered.experimentSchema);
  writeFileSync(join(dir, experimentFieldsName), rendered.experimentFields);
  writeFileSync(join(dir, distributionSchemaName), rendered.distributionSchema);
  writeFileSync(join(dir, distributionFieldsName), rendered.distributionFields);
  writeFileSync(join(dir, policySchemaName), rendered.policySchema);
  writeFileSync(join(dir, policyFieldsName), rendered.policyFields);
  writeFileSync(join(dir, balanceSchemaName), rendered.balanceSchema);
  writeFileSync(join(dir, balanceFieldsName), rendered.balanceFields);
  writeFileSync(join(base, balancePublicSchema), rendered.balanceSchema);
  writeFileSync(join(dir, judgeSchemaName), rendered.judgeSchema);
  writeFileSync(join(dir, judgeFieldsName), rendered.judgeFields);
  writeFileSync(join(base, judgePublicSchema), rendered.judgeSchema);
  writeFileSync(join(dir, flowSchemaName), rendered.flowSchema);
  writeFileSync(join(dir, flowFieldsName), rendered.flowFields);
  writeFileSync(join(base, flowPublicSchema), rendered.flowSchema);
  writeFileSync(join(dir, advanceSchemaName), rendered.advanceSchema);
  writeFileSync(join(dir, advanceFieldsName), rendered.advanceFields);
  writeFileSync(join(base, advancePublicSchema), rendered.advanceSchema);
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
    [experimentSchemaName, rendered.experimentSchema],
    [experimentFieldsName, rendered.experimentFields],
    [distributionSchemaName, rendered.distributionSchema],
    [distributionFieldsName, rendered.distributionFields],
    [policySchemaName, rendered.policySchema],
    [policyFieldsName, rendered.policyFields],
    [balanceSchemaName, rendered.balanceSchema],
    [balanceFieldsName, rendered.balanceFields],
    [judgeSchemaName, rendered.judgeSchema],
    [judgeFieldsName, rendered.judgeFields],
    [flowSchemaName, rendered.flowSchema],
    [flowFieldsName, rendered.flowFields],
    [advanceSchemaName, rendered.advanceSchema],
    [advanceFieldsName, rendered.advanceFields],
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
  // The public balance check schema is a copy of the generated one, so editors can reference a stable path.
  let publicCurrent = "";
  try {
    publicCurrent = readFileSync(join(base, balancePublicSchema), "utf8").replace(/\r\n/g, "\n");
  } catch {
    failures.push(`missing ${balancePublicSchema}`);
  }
  if (publicCurrent && publicCurrent !== rendered.balanceSchema) failures.push(`drift ${balancePublicSchema}`);
  for (const [publicName, next] of [[judgePublicSchema, rendered.judgeSchema]] as const) {
    let current = "";
    try {
      current = readFileSync(join(base, publicName), "utf8").replace(/\r\n/g, "\n");
    } catch {
      failures.push(`missing ${publicName}`);
      continue;
    }
    if (current !== next) failures.push(`drift ${publicName}`);
  }
  for (const [publicName, next] of [[flowPublicSchema, rendered.flowSchema]] as const) {
    let current = "";
    try {
      current = readFileSync(join(base, publicName), "utf8").replace(/\r\n/g, "\n");
    } catch {
      failures.push(`missing ${publicName}`);
      continue;
    }
    if (current !== next) failures.push(`drift ${publicName}`);
  }
  for (const [publicName, next] of [[advancePublicSchema, rendered.advanceSchema]] as const) {
    let current = "";
    try {
      current = readFileSync(join(base, publicName), "utf8").replace(/\r\n/g, "\n");
    } catch {
      failures.push(`missing ${publicName}`);
      continue;
    }
    if (current !== next) failures.push(`drift ${publicName}`);
  }
  return failures;
}
