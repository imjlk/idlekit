import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { recordFlowSample } from "../observation";
import {
  diagnoseFlow,
  flowAlgorithmVersion,
  flowCauseForGrowthRegime,
  flowConservation,
  flowJsonSchema,
  flowOptionalAdapter,
  flowPipelineConstraint,
  flowSchemaId,
  flowSuspectedCause,
  flowUnsupportedModel,
  parseFlowObservation,
  validateFlowReport,
  type FlowFactV1,
  type FlowObservationV1,
  type FlowReportV1,
} from "./flow";
import { flowResult } from "./registry";

const fixture = JSON.parse(readFileSync(new URL("../../../../../examples/analysis/flow-pipeline.json", import.meta.url), "utf8")) as {
  seed: string;
  cases: Record<string, unknown>;
};

function load(name: string): FlowObservationV1 {
  const parsed = parseFlowObservation(fixture.cases[name]);
  if (!parsed.ok) throw new Error(`${name}: ${parsed.issues.join("; ")}`);
  return parsed.observation;
}

function fact(report: FlowReportV1, kind: FlowFactV1["kind"], processId?: string): FlowFactV1 | undefined {
  return report.facts.find((item) => item.kind === kind && (processId === undefined || item.processId === processId));
}

function expectValid(report: FlowReportV1): void {
  expect(validateFlowReport(report).success).toBe(true);
  expect(report.contract).toBe("idlekit.flow.v1");
  expect(report.algorithmVersion).toBe(flowAlgorithmVersion());
  expect(report.stallMapped).toBe(false);
  expect(report.externalProvider).toBe(false);
}

/**
 * @evidence docs/requirements/active/flow-observability.md#req-pr15-flow-adapter The observer hook is optional and three fixtures share it.
 * @evidenceReview docs/requirements/active/flow-observability.md#req-pr15-flow-adapter #84c33b7 Re-read the section, then ran this function: onFlow records one sample and the three skins agree.
 * @evidence ./flow.ts#flowOptionalAdapter Reads the optional-adapter marker.
 * @evidenceReview ./flow.ts#flowOptionalAdapter #d29de61 The declaration is observer-not-required-model.
 * @evidence ./flow.ts#validateFlowReport Reads the published validator.
 * @evidenceReview ./flow.ts#validateFlowReport #159856d The validator is createValidate of FlowReportV1, built on first call, and accepts each fixture report.
 * @evidence ./flow.ts#flowJsonSchema Reads the generated schema marker.
 * @evidenceReview ./flow.ts#flowJsonSchema #ddf221b The memoized schema version is 3.1.
 * @evidence ./flow.ts#flowSchemaId Reads the schema id.
 * @evidenceReview ./flow.ts#flowSchemaId #bac22e3 The id is the flow v1 schema URL.
 * @evidence ./flow.ts#flowAlgorithmVersion Reads the algorithm version.
 * @evidenceReview ./flow.ts#flowAlgorithmVersion #7cd8b0b Every fixture report carries flow-observation-1.
 * @evidence ./flow.ts#parseFlowObservation Validates a fixture case as data.
 * @evidenceReview ./flow.ts#parseFlowObservation #da2290c Fixture cases parse, and a case with the wrong contract is rejected with issues.
 * @evidence ../observation.ts#recordFlowSample Forwards one sample to the optional observer hook.
 * @evidenceReview ../observation.ts#recordFlowSample #eab5d36 onFlow receives the sample once, and an absent observer or hook is a no-op.
 */
export function declaresFlowAdapter(): void {
  expect(fixture.seed).toBe("15");
  expect(flowOptionalAdapter).toBe("observer-not-required-model");
  expect(flowSchemaId()).toBe("https://idlekit.dev/schemas/flow.v1.schema.json");
  expect(flowJsonSchema().version).toBe("3.1");
  expect(flowAlgorithmVersion()).toBe("flow-observation-1");
  const rejected = parseFlowObservation({ ...(fixture.cases.steady as object), contract: "idlekit.flow.v1" });
  expect(rejected.ok).toBe(false);
  if (!rejected.ok) expect(rejected.issues.length).toBeGreaterThan(0);
  const source = readFileSync(new URL("./flow.ts", import.meta.url), "utf8");
  for (const word of ["mine", "smelt", "ore", "haul", "crate", "expedition", "scout"]) {
    expect(new RegExp(`\\b${word}\\b`).test(source)).toBe(false);
  }
  const sample = load("steady").samples[0];
  if (!sample) throw new Error("steady sample missing");
  const seen: typeof sample[] = [];
  recordFlowSample({ onFlow: (item) => seen.push(item) }, sample);
  expect(seen).toEqual([sample]);
  recordFlowSample(undefined, sample);
  recordFlowSample({}, sample);
  const known = flowResult("statically-known");
  expect(known).toEqual({
    capability: "flow",
    knowledge: "statically-known",
    status: "insufficient-data",
    reason: "flow observations were not supplied",
  });
  expect(flowResult("unsupported").status).toBe("unsupported");
  for (const [name, processId, unit] of [
    ["logistics", "pack", "crate/min"],
    ["crafting", "assemble", "part/min"],
    ["expedition", "camp", "slot/min"],
  ] as const) {
    const report = diagnoseFlow(load(name));
    expectValid(report);
    expect(report.status).toBe("ok");
    expect(report.hypotheses[0]?.status).toBe("confirmed");
    expect(report.hypotheses[0]?.claim).toBe("capacity-constraint");
    expect(report.hypotheses[0]?.processId).toBe(processId);
    expect(fact(report, "final-throughput")?.amount).toBe("20");
    expect(fact(report, "final-throughput")?.unit).toBe(unit);
  }
}

/**
 * @evidence docs/requirements/active/flow-observability.md#req-pr15-pipeline A 100 to 20 to 30 chain binds at the middle stage.
 * @evidenceReview docs/requirements/active/flow-observability.md#req-pr15-pipeline #2bb5853 Re-read the section, then ran this function: final throughput stays 20 when inflow doubles.
 * @evidence ./flow.ts#flowPipelineConstraint Reads the pipeline marker.
 * @evidenceReview ./flow.ts#flowPipelineConstraint #6971fde The declaration is process-throughput-20.
 * @evidence ./flow.ts#diagnoseFlow Diagnoses throughput, capacity, and the binding stage.
 * @evidenceReview ./flow.ts#diagnoseFlow #95cf0d6 The middle stage binds at 20, doubling inflow keeps 20 and grows the queue, and without a causal model the cause is suspected.
 */
export function diagnosesSteadyPipeline(): void {
  expect(flowPipelineConstraint).toBe("process-throughput-20");
  const steady = diagnoseFlow(load("steady"));
  expectValid(steady);
  expect(steady.status).toBe("ok");
  expect(steady.hypotheses[0]?.processId).toBe("process");
  expect(steady.hypotheses[0]?.status).toBe("confirmed");
  expect(steady.hypotheses[0]?.claim).toBe("capacity-constraint");
  expect(fact(steady, "final-throughput")?.amount).toBe("20");
  expect(fact(steady, "final-throughput")?.unit).toBe("ore/min");
  expect(fact(steady, "saturation-time", "process")?.amount).toBe("60");
  expect(fact(steady, "saturation-time", "process")?.unit).toBe("s");
  expect(fact(steady, "queue", "process")?.amount).toBe("10");
  const doubled = diagnoseFlow(load("doubledMine"));
  expectValid(doubled);
  expect(fact(doubled, "final-throughput")?.amount).toBe("20");
  expect(fact(doubled, "queue", "process")?.amount).toBe("80");
  expect(doubled.hypotheses[0]?.claim).toBe("capacity-constraint");
  const suspected = diagnoseFlow({ ...load("steady"), causal: null });
  expect(suspected.hypotheses[0]?.status).toBe("suspected");
  expect(suspected.hypotheses[0]?.claim).toBe("capacity-constraint");
  expect(suspected.hypotheses[0]?.evidenceRefs.length).toBeGreaterThan(0);
  expect(suspected.facts.some((item) => item.id === suspected.hypotheses[0]?.id)).toBe(false);
}

/**
 * @evidence docs/requirements/active/flow-observability.md#req-pr15-conservation Conversion keeps the destination unit.
 * @evidenceReview docs/requirements/active/flow-observability.md#req-pr15-conservation #792fb51 Re-read the section, then ran this function: 100 becomes 45 and the units are not added.
 * @evidence ./flow.ts#flowConservation Reads the conservation marker.
 * @evidenceReview ./flow.ts#flowConservation #ca6486f The declaration is converted-units-stay-apart.
 */
export function checksFlowConservation(): void {
  expect(flowConservation).toBe("converted-units-stay-apart");
  const report = diagnoseFlow(load("conversion"));
  expectValid(report);
  expect(report.status).toBe("ok");
  const conserved = fact(report, "conservation", "dest");
  expect(conserved?.amount).toBe("45");
  expect(conserved?.unit).toBe("ingot/min");
  expect(conserved?.evidenceRefs).toContain("edge:0");
  expect(JSON.stringify(report)).not.toContain("145");
  const sameUnit = diagnoseFlow({
    ...load("conversion"),
    samples: load("conversion").samples.map((sample) =>
      sample.kind === "inflow" ? sample : { ...sample, unit: "ore/min" },
    ),
  });
  expect(sameUnit.facts.some((item) => item.kind === "conservation")).toBe(false);
}

/**
 * @evidence docs/requirements/active/flow-observability.md#req-pr15-unsupported An unsupported model invents no stall cause.
 * @evidenceReview docs/requirements/active/flow-observability.md#req-pr15-unsupported #2733085 Re-read the section, then ran this function: stall stays unmapped.
 * @evidence ./flow.ts#flowUnsupportedModel Reads the unsupported marker.
 * @evidenceReview ./flow.ts#flowUnsupportedModel #cd01ef0 The declaration is no-invented-stall.
 * @evidence ./flow.ts#flowCauseForGrowthRegime Turns a growth regime into an unsupported flow report.
 * @evidenceReview ./flow.ts#flowCauseForGrowthRegime #ab1b17b A stall regime has no facts, no process, claim none, and stallMapped false.
 */
export function leavesUnknownModelsUnsupported(): void {
  expect(flowUnsupportedModel).toBe("no-invented-stall");
  const report = diagnoseFlow(load("noFlow"));
  expectValid(report);
  expect(report.status).toBe("unsupported");
  expect(report.capability).toBe("unsupported");
  expect(report.facts).toEqual([]);
  expect(report.hypotheses[0]?.claim).toBe("none");
  expect(report.hypotheses[0]?.status).toBe("unsupported");
  const stall = flowCauseForGrowthRegime("stall");
  expectValid(stall);
  expect(stall.status).toBe("unsupported");
  expect(stall.stallMapped).toBe(false);
  expect(stall.hypotheses[0]?.claim).toBe("none");
  expect(stall.hypotheses[0]?.processId).toBeNull();
  const unknown = diagnoseFlow({ ...load("noFlow"), capability: "unknown" });
  expect(unknown.status).toBe("insufficient-data");
  expect(unknown.facts).toEqual([]);
  expect(unknown.hypotheses[0]?.claim).toBe("none");
}

/**
 * @evidence docs/requirements/active/flow-observability.md#req-pr15-suspected Unresolved demand and capacity stay insufficient, and ramp-up skips Little's law.
 * @evidenceReview docs/requirements/active/flow-observability.md#req-pr15-suspected #17bae0a Re-read the section, then ran this function: a lone throughput confirms nothing.
 * @evidence ./flow.ts#flowSuspectedCause Reads the suspected-cause marker.
 * @evidenceReview ./flow.ts#flowSuspectedCause #0bfa7f8 The declaration is facts-apart-from-cause.
 */
export function separatesFactsFromCauses(): void {
  expect(flowSuspectedCause).toBe("facts-apart-from-cause");
  const ambiguous = diagnoseFlow(load("ambiguous"));
  expectValid(ambiguous);
  expect(ambiguous.status).toBe("insufficient-data");
  expect(ambiguous.hypotheses[0]?.status).toBe("insufficient-data");
  expect(ambiguous.hypotheses[0]?.claim).toBe("none");
  expect(ambiguous.hypotheses[0]?.processId).toBeNull();
  const starved = diagnoseFlow(load("starved"));
  expect(starved.hypotheses[0]?.status).toBe("suspected");
  expect(starved.hypotheses[0]?.claim).toBe("material-shortage");
  const blocked = diagnoseFlow(load("blocked"));
  expect(blocked.hypotheses[0]?.status).toBe("suspected");
  expect(blocked.hypotheses[0]?.claim).toBe("demand-shortage");
  const ramp = diagnoseFlow(load("ramp"));
  expect(ramp.littlesLaw.status).toBe("not-applicable");
  expect(ramp.hypotheses[0]?.status).not.toBe("confirmed");
  const steady = diagnoseFlow(load("steadyLittles"));
  expect(steady.littlesLaw.status).toBe("consistent");
  expect(steady.hypotheses[0]?.claim).toBe("none");
  expect(steady.hypotheses[0]?.status).toBe("insufficient-data");
}

describe("flow observability", () => {
  it("declares an optional flow adapter", declaresFlowAdapter);
  it("diagnoses a steady pipeline", diagnosesSteadyPipeline);
  it("checks flow conservation", checksFlowConservation);
  it("leaves an unknown model unsupported", leavesUnknownModelsUnsupported);
  it("separates facts from causes", separatesFactsFromCauses);
});
