import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import typia from "typia";
import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { createModelRegistry, type ModelFactory } from "./registry";
import {
  buildContractDocument,
  buildFieldMetadata,
  canonicalJson,
  contractSourceHash,
  registeredContracts,
  parseScenarioStructure,
  semanticValidationRetained,
  sha256Text,
  structuralFieldMetadata,
  typedContractSingleSource,
  validateFiniteUnitRate,
  validateScenarioStructure,
  type SourceDigest,
} from "./scenarioContract";
import type { ScenarioV1 } from "./types";
import { standardSchemaFromValidate, validateScenarioV1, zodStandardSchema } from "./validate";

const repoRoot = resolve(import.meta.dir, "../../../..");
const sources: SourceDigest[] = [
  { path: "packages/core/src/scenario/offlinePolicy.ts", sha256: "a" },
  { path: "packages/core/src/scenario/scenarioContract.ts", sha256: "b" },
  { path: "packages/core/src/scenario/types.ts", sha256: "c" },
];

function minimal(): ScenarioV1 {
  return {
    schemaVersion: 1,
    unit: { code: "COIN" },
    policy: { mode: "drop" },
    model: { id: "m", version: 1 },
    initial: { wallet: { unit: "COIN", amount: "0" } },
    clock: { stepSec: 1, durationSec: 1 },
  };
}

function spawnContract(args: string[], cwd = repoRoot): { exitCode: number; stdout: string; stderr: string } {
  const proc = Bun.spawnSync(
    [process.execPath, "--preload", "@ttsc/unplugin/bun-register", ...args],
    { cwd, stdout: "pipe", stderr: "pipe" },
  );
  return {
    exitCode: proc.exitCode ?? 1,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

/**
 * @evidence docs/requirements/active/typed-contract-generation.md#req-tc05-typed-contract-single-source Two generations match, a type field changes the schema, and the digest has no directory.
 * @evidenceReview docs/requirements/active/typed-contract-generation.md#req-tc05-typed-contract-single-source #4326433 Re-read the section, then checked the registry, the 3.1 schema id, and the directory-free hash.
 * @evidence ./scenarioContract.ts#typedContractSingleSource Reads the scenario registration id.
 * @evidenceReview ./scenarioContract.ts#typedContractSingleSource #fff2b70 The declaration is idlekit.scenario.v1.
 * @evidence ./scenarioContract.ts#registeredContracts Reads the registry ids.
 * @evidenceReview ./scenarioContract.ts#registeredContracts #8e0c3ba The function returns contractRegistry, which lists idlekit.scenario.v1 only.
 * @evidence ./scenarioContract.ts#canonicalJson Renders the contract document twice and round-trips it.
 * @evidenceReview ./scenarioContract.ts#canonicalJson #c5c90d7 The function delegates to renderCanonical, which sorts keys and drops undefined entries.
 * @evidence ./scenarioContract.ts#buildContractDocument Builds the document and checks its schema id, version, and policies.
 * @evidenceReview ./scenarioContract.ts#buildContractDocument #fd83812 The function orders sources, stamps the generator fields, and copies the memoized typia 3.1 schema.
 * @evidence ./scenarioContract.ts#contractSourceHash Compares the document hash with a direct call and with reversed sources.
 * @evidenceReview ./scenarioContract.ts#contractSourceHash #f62fd37 The function orders sources before hashing, so input order does not change the digest.
 * @evidence ./scenarioContract.ts#sha256Text Hashes the empty string.
 * @evidenceReview ./scenarioContract.ts#sha256Text #cc439ad The function returns the hex sha256 digest of its input.
 * @evidence ./scenarioContract.ts#buildFieldMetadata Reads enum, property, and comment metadata from the scenario schema.
 * @evidenceReview ./scenarioContract.ts#buildFieldMetadata #2791f4d The function runs structuralFieldMetadata on the memoized scenario schema and stamps the source hash.
 * @evidence ./scenarioContract.ts#structuralFieldMetadata Walks a small inline schema with one enum property.
 * @evidenceReview ./scenarioContract.ts#structuralFieldMetadata #eb29715 The walker records property paths and string enums from the schema node.
 */
export function keepsTypedContractSingleSource(): void {
  expect(typedContractSingleSource).toBe("idlekit.scenario.v1");
  expect(registeredContracts().map((entry) => entry.id)).toEqual([
    "idlekit.scenario.v1",
    "idlekit.analysis.artifact.v1",
    "idlekit.eta.estimate.v1",
    "idlekit.reset-cycle.v1",
    "idlekit.growth-fit.v1",
  ]);
  const text = canonicalJson(buildContractDocument(sources));
  expect(canonicalJson(buildContractDocument(sources))).toBe(text);
  expect(text).not.toContain("/tmp/");
  expect(text).not.toContain("/Users/");
  expect(text).not.toContain("generatedAt");
  const doc = buildContractDocument(sources);
  expect(doc.schema.version).toBe("3.1");
  expect(doc.schema.$id).toBe("https://idlekit.dev/schemas/scenario.v1.schema.json");
  expect(doc.idlekitContract.exportApi).toBe("typia.json.schema");
  expect(doc.idlekitContract.unknownFieldPolicy).toBe("runtime-allow");
  expect(doc.idlekitContract.jsonSchemaAdditionalProperties).toBe(false);
  expect(canonicalJson(doc.schema)).toContain('"additionalProperties":false');
  const fields = buildFieldMetadata(sources);
  expect(fields.enums["policy.mode"]).toEqual(["accumulate", "drop"]);
  expect(fields.properties).toContain("clock.stepSec");
  expect(fields.comments["sim.offline.decay.floorRatio"]).toContain("linear");
  expect(JSON.stringify(fields)).not.toContain("자주");
  type ProbeA = { readonly id: string };
  type ProbeB = { readonly id: string; readonly added: boolean };
  expect(canonicalJson(typia.json.schema<ProbeA, "3.1">())).not.toBe(
    canonicalJson(typia.json.schema<ProbeB, "3.1">()),
  );
  const roundTrip = canonicalJson(JSON.parse(text));
  expect(roundTrip).toBe(text);
  expect(doc.idlekitContract.sourceHash).toBe(contractSourceHash(sources));
  expect(contractSourceHash([...sources].reverse())).toBe(contractSourceHash(sources));
  expect(fields.idlekitContract.sourceHash).toBe(contractSourceHash(sources));
  expect(sha256Text("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  expect(
    structuralFieldMetadata({
      schema: { type: "object", properties: { mode: { type: "string", enum: ["a", "b"] } } },
      components: {},
    }),
  ).toEqual({ properties: ["mode"], enums: { mode: ["a", "b"] }, comments: {} });
}

/**
 * @evidence docs/requirements/active/typed-contract-generation.md#req-tc05-semantic-validation-retained Handwritten validation stays stricter on steps, amounts, and stop conditions.
 * @evidenceReview docs/requirements/active/typed-contract-generation.md#req-tc05-semantic-validation-retained #ef40883 Re-read the section: zero step fails handwritten only, and 1e400 stays a string.
 * @evidence ./scenarioContract.ts#semanticValidationRetained Reads the runtime validator name.
 * @evidenceReview ./scenarioContract.ts#semanticValidationRetained #acacc7a The declaration is validateScenarioV1.
 * @evidence ./scenarioContract.ts#validateScenarioStructure Runs the structural validator against the fixed corpus.
 * @evidenceReview ./scenarioContract.ts#validateScenarioStructure #76b51ac The arrow builds typia.createValidate of ScenarioV1 on first call and reuses it.
 * @evidence ./scenarioContract.ts#validateFiniteUnitRate Checks the supported Minimum and Maximum tags.
 * @evidenceReview ./scenarioContract.ts#validateFiniteUnitRate #d1526e0 The arrow builds typia.createValidate of FiniteUnitRate on first call and reuses it.
 * @evidence ./scenarioContract.ts#parseScenarioStructure Parses a valid scenario and a bad enum from JSON text.
 * @evidenceReview ./scenarioContract.ts#parseScenarioStructure #6986bbd The function is typia.json.validateParse of ScenarioV1.
 */
export function keepsSemanticValidation(): void {
  expect(semanticValidationRetained).toBe("validateScenarioV1");
  const base = minimal();
  expect(validateScenarioV1(base).ok).toBeTrue();
  expect(validateScenarioStructure(base).success).toBeTrue();

  const missingUnit = { ...base, unit: undefined } as unknown;
  expect(validateScenarioV1(missingUnit).ok).toBeFalse();
  expect(validateScenarioStructure(missingUnit).success).toBeFalse();

  const badEnum = { ...base, policy: { mode: "nope" as "drop" } };
  expect(validateScenarioV1(badEnum).ok).toBeFalse();
  expect(validateScenarioStructure(badEnum).success).toBeFalse();

  const extra = { ...base, note: "extra" };
  expect(validateScenarioV1(extra).ok).toBeTrue();
  expect(validateScenarioStructure(extra).success).toBeTrue();

  const zero = { ...base, clock: { stepSec: 0, durationSec: 1 } };
  const negative = { ...base, clock: { stepSec: -1, durationSec: 1 } };
  const nan = { ...base, clock: { stepSec: Number.NaN, durationSec: 1 } };
  expect(validateScenarioV1(zero).ok).toBeFalse();
  expect(validateScenarioV1(negative).ok).toBeFalse();
  expect(validateScenarioV1(nan).ok).toBeFalse();
  expect(validateScenarioStructure(zero).success).toBeTrue();
  expect(validateScenarioStructure(negative).success).toBeTrue();
  expect(validateScenarioStructure(nan).success).toBeTrue();

  const infinite = { ...base, clock: { stepSec: Number.POSITIVE_INFINITY, durationSec: 1 } };
  expect(validateScenarioV1(infinite).ok).toBeTrue();
  expect(validateScenarioStructure(infinite).success).toBeTrue();

  const emptyAmount = {
    ...base,
    initial: { wallet: { unit: "COIN", amount: "" } },
  };
  expect(validateScenarioV1(emptyAmount).ok).toBeFalse();
  expect(validateScenarioStructure(emptyAmount).success).toBeTrue();

  const noStop = { ...base, clock: { stepSec: 1 } };
  expect(validateScenarioV1(noStop).ok).toBeFalse();
  expect(validateScenarioStructure(noStop).success).toBeTrue();

  const nullMeta = { ...base, meta: null } as unknown;
  expect(validateScenarioV1(nullMeta).ok).toBeTrue();
  expect(validateScenarioStructure(nullMeta).success).toBeFalse();

  const big = { ...base, initial: { wallet: { unit: "COIN", amount: "1e400" } } };
  const suffix = { ...base, initial: { wallet: { unit: "COIN", amount: "1aa" } } };
  expect(validateScenarioV1(big).ok).toBeTrue();
  expect(validateScenarioStructure(big).success).toBeTrue();
  expect(validateScenarioV1(suffix).ok).toBeTrue();
  expect(validateScenarioStructure(suffix).success).toBeTrue();
  expect(Number.isFinite(Number("1e400"))).toBeFalse();

  expect(validateFiniteUnitRate(0.5).success).toBeTrue();
  expect(validateFiniteUnitRate(0).success).toBeTrue();
  expect(validateFiniteUnitRate(1).success).toBeTrue();
  expect(validateFiniteUnitRate(-0.1).success).toBeFalse();
  expect(validateFiniteUnitRate(1.1).success).toBeFalse();
  expect(validateFiniteUnitRate(Number.NaN).success).toBeFalse();

  const transforming = zodStandardSchema(z.object({ count: z.coerce.number().finite() }));
  const transformed = transforming["~standard"].validate({ count: "2" });
  expect(transformed.success).toBeTrue();
  if (transformed.success) expect(transformed.value).toEqual({ count: 2 });
  const rawParams = { ...base, model: { id: "m", version: 1, params: { count: "2" } } };
  expect(validateScenarioStructure(rawParams).success).toBeTrue();
  const model: ModelFactory = {
    id: "m",
    version: 1,
    paramsSchema: transforming,
    create: () => ({
      id: "m",
      version: 1,
      income: (ctx: any) => ({ unit: ctx.unit, amount: ctx.E.from(0) }),
      actions: () => [],
    }),
  };
  const accepted = validateScenarioV1(rawParams, createModelRegistry([model]));
  expect(accepted.ok).toBeTrue();
  expect(accepted.scenario?.model.params).toEqual({ count: "2" });
  const badParams = { ...base, model: { id: "m", version: 1, params: { count: "no" } } };
  expect(validateScenarioStructure(badParams).success).toBeTrue();
  expect(validateScenarioV1(badParams, createModelRegistry([model])).ok).toBeFalse();

  const adapted = standardSchemaFromValidate(validateScenarioStructure);
  const adaptedOk = adapted["~standard"].validate(base);
  expect(adaptedOk.success).toBeTrue();
  if (adaptedOk.success) {
    expect(adaptedOk.value.schemaVersion).toBe(1);
    expect("data" in adaptedOk).toBeFalse();
  }
  const typiaOk = validateScenarioStructure(base);
  expect(typiaOk.success).toBeTrue();
  if (typiaOk.success) expect(typiaOk.data.schemaVersion).toBe(1);
  const adaptedBad = adapted["~standard"].validate({ schemaVersion: 1 });
  expect(adaptedBad.success).toBeFalse();
  if (!adaptedBad.success) {
    expect(typeof adaptedBad.issues[0]?.path).toBe("string");
    expect("errors" in adaptedBad).toBeFalse();
  }
  expect("vendor" in adapted["~standard"]).toBeFalse();

  const parsed = parseScenarioStructure(JSON.stringify(base));
  expect(parsed.success).toBeTrue();
  const parsedBad = parseScenarioStructure(JSON.stringify(badEnum));
  expect(parsedBad.success).toBeFalse();
}

/**
 * @evidence docs/requirements/active/typed-contract-generation.md#req-tc05-published-validator-transformed The bundled probe runs outside the repo, and a stale schema fails the check.
 * @evidenceReview docs/requirements/active/typed-contract-generation.md#req-tc05-published-validator-transformed #fafe1c5 Re-read the section: source and bundle print contract-ok, and check does not write.
 * @evidence ./scenarioContract.ts#publishedValidatorTransformed Reads the concrete generator name.
 * @evidenceReview ./scenarioContract.ts#publishedValidatorTransformed #1c7fe35 The declaration is typia.createValidate of ScenarioV1.
 */
export function runsPublishedScenarioValidator(): void {
  const source = spawnContract(["tools/contract-smoke.ts", "source"]);
  expect(source.exitCode).toBe(0);
  expect(source.stdout).toContain("contract-ok");

  const bundled = spawnContract(["tools/contract-smoke.ts", "bundle"]);
  expect(bundled.exitCode).toBe(0);
  expect(bundled.stdout).toContain("contract-ok");

  const left = join(tmpdir(), `idlekit-tc05-gen-a-${crypto.randomUUID()}`);
  const right = join(tmpdir(), `idlekit-tc05-gen-b-${crypto.randomUUID()}`);
  const wroteLeft = spawnContract(["tools/generate-contracts.ts", "--dest", left]);
  const wroteRight = spawnContract(["tools/generate-contracts.ts", "--dest", right]);
  expect(wroteLeft.exitCode).toBe(0);
  expect(wroteRight.exitCode).toBe(0);
  const schemaLeft = readFileSync(join(left, "scenario.v1.schema.json"), "utf8");
  const schemaRight = readFileSync(join(right, "scenario.v1.schema.json"), "utf8");
  const fieldsLeft = readFileSync(join(left, "scenario.v1.fields.json"), "utf8");
  const fieldsRight = readFileSync(join(right, "scenario.v1.fields.json"), "utf8");
  expect(schemaLeft).toBe(schemaRight);
  expect(fieldsLeft).toBe(fieldsRight);
  expect(schemaLeft.endsWith("\n")).toBeTrue();
  expect(canonicalJson(JSON.parse(schemaLeft))).toBe(schemaLeft.trim());
  expect(schemaLeft).not.toContain("/Users/");
  expect(schemaLeft).not.toContain("generatedAt");

  const stale = join(tmpdir(), `idlekit-tc05-stale-${crypto.randomUUID()}`);
  mkdirSync(stale, { recursive: true });
  writeFileSync(join(stale, "scenario.v1.schema.json"), schemaLeft.replace('"schemaVersion"', '"schemaVersionRemoved"'));
  writeFileSync(join(stale, "scenario.v1.fields.json"), fieldsLeft);
  const drifted = spawnContract(["tools/contracts-check.ts", "--expected", stale]);
  expect(drifted.exitCode).toBe(1);
  expect(drifted.stderr).toContain("drift");

  const refused = spawnContract(["tools/contracts-check.ts", "--write"]);
  expect(refused.exitCode).toBe(2);

  const checked = spawnContract(["tools/contracts-check.ts"]);
  expect(checked.exitCode).toBe(0);
}

describe("TC-05 typed contract", () => {
  it("keeps one scenario schema", keepsTypedContractSingleSource);
  it("keeps semantic validation", keepsSemanticValidation);
  it("runs the published scenario validator", runsPublishedScenarioValidator, 180000);
});
