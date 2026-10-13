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
 * @evidenceReview docs/requirements/active/flow-observability.md#req-pr15-flow-adapter #0e3f60a Re-read the section, then ran this function: onFlow records one sample, the three skins agree, and exponent spellings parse while unreadable amounts are rejected.
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
 * @evidenceReview ./flow.ts#parseFlowObservation #8e51a17 Fixture cases parse, 1e2 and +2.0E1 parse and still bind, a case with the wrong contract is rejected, an amount such as -5, 1e400, or twenty is rejected with its path, a reversed window is rejected and yields no fact when diagnosed directly, and a duplicate sample key, a duplicate edge, a zero denominator, and a loss above 1 are rejected with their paths.
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
  // Engine spellings with a sign or an exponent are read, not dropped.
  const steadyCase = fixture.cases.steady as FlowObservationV1;
  const spelled = parseFlowObservation({
    ...steadyCase,
    samples: steadyCase.samples.map((sample) => ({
      ...sample,
      amount: sample.amount === "100" ? "1e2" : sample.amount === "20" ? "+2.0E1" : sample.amount,
    })),
    edges: steadyCase.edges.map((edge) => ({ ...edge, numerator: "1e0", loss: "0e0" })),
  });
  expect(spelled.ok).toBe(true);
  if (spelled.ok) {
    const report = diagnoseFlow(spelled.observation);
    expect(report.hypotheses[0]?.claim).toBe("capacity-constraint");
    expect(report.hypotheses[0]?.processId).toBe("process");
    expect(fact(report, "final-throughput")?.amount).toBe("+2.0E1");
  }
  // A spelling the diagnosis cannot read is rejected while parsing.
  for (const amount of ["twenty", "-5", "1e400", "0x14", ""]) {
    const unreadable = parseFlowObservation({
      ...steadyCase,
      samples: steadyCase.samples.map((sample, index) => (index === 1 ? { ...sample, amount } : sample)),
    });
    expect(unreadable.ok).toBe(false);
    if (!unreadable.ok) expect(unreadable.issues).toEqual(["$input.samples[1].amount finite non-negative decimal"]);
  }
  const badEdge = parseFlowObservation({ ...steadyCase, edges: steadyCase.edges.map((edge) => ({ ...edge, loss: "10%" })) });
  expect(badEdge.ok).toBe(false);
  // A reversed evidence window is rejected while parsing and is not evidence for a direct diagnosis.
  const reversed = steadyCase.samples.map((sample) => ({ ...sample, startSec: 60, endSec: 0 }));
  const reversedParse = parseFlowObservation({ ...steadyCase, samples: reversed });
  expect(reversedParse.ok).toBe(false);
  if (!reversedParse.ok) expect(reversedParse.issues).toContain("$input.samples[1].endSec >= startSec");
  const reversedReport = diagnoseFlow({ ...load("steady"), samples: reversed });
  expect(reversedReport.facts.some((item) => item.kind === "saturation-time")).toBe(false);
  expect(reversedReport.facts).toEqual([]);
  // A second sample with the same process, resource, kind, and window is rejected instead of read by order.
  const duplicated = parseFlowObservation({
    ...steadyCase,
    samples: [...steadyCase.samples, { ...(steadyCase.samples[2] as FlowObservationV1["samples"][number]), amount: "10" }],
  });
  expect(duplicated.ok).toBe(false);
  if (!duplicated.ok) expect(duplicated.issues).toEqual(["$input.samples[6] duplicates samples[2]"]);
  // An edge ratio the diagnosis cannot convert is rejected while parsing.
  const zeroDenominator = parseFlowObservation({ ...steadyCase, edges: steadyCase.edges.map((edge, index) => (index === 0 ? { ...edge, denominator: "0" } : edge)) });
  expect(zeroDenominator.ok).toBe(false);
  if (!zeroDenominator.ok) expect(zeroDenominator.issues).toEqual(["$input.edges[0].denominator > 0"]);
  const overLoss = parseFlowObservation({ ...steadyCase, edges: steadyCase.edges.map((edge, index) => (index === 1 ? { ...edge, loss: "1.5" } : edge)) });
  expect(overLoss.ok).toBe(false);
  if (!overLoss.ok) expect(overLoss.issues).toEqual(["$input.edges[1].loss <= 1"]);
  // A copied edge would count the same flow twice, so it is rejected.
  const copiedEdge = parseFlowObservation({ ...steadyCase, edges: [...steadyCase.edges, steadyCase.edges[0]] });
  expect(copiedEdge.ok).toBe(false);
  if (!copiedEdge.ok) expect(copiedEdge.issues).toEqual(["$input.edges[2] duplicates edges[0]"]);
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
 * @evidenceReview docs/requirements/active/flow-observability.md#req-pr15-pipeline #bed62f3 Re-read the section, then ran this function: final throughput stays 20 when inflow doubles, another resource or window does not bind, the causally named bind is confirmed first beside a suspected one, a cycle has no final throughput, two terminals each report one, a terminal reports its latest window in either sample order, an inflow source offers work to the bind, a terminal fed two resources reports both, a process saturated in two windows binds on the latest in either order, a side feed that fills or is missing from the downstream stage removes the bind, the bind cites the downstream capacity and feed, every edgeless series reports a final, colliding ids stay distinct, a lone-surrogate id still reports, a downstream capacity, an upstream source, or a side feed in another unit proves no bind, the bind cites its edges and the throughput that named the downstream unit, and only a confirmed bind cites causal.
 * @evidence ./flow.ts#flowPipelineConstraint Reads the pipeline marker.
 * @evidenceReview ./flow.ts#flowPipelineConstraint #6971fde The declaration is process-throughput-20.
 * @evidence ./flow.ts#diagnoseFlow Diagnoses throughput, capacity, and the binding stage.
 * @evidenceReview ./flow.ts#diagnoseFlow #c0a28a7 The middle stage binds at 20, doubling inflow keeps 20 and grows the queue, without a causal model the cause is suspected, another resource or window does not bind, every saturated process is a candidate with the causal one confirmed first, a bind does not hide another process's wait, a cycle reports no final throughput, each terminal reports a final throughput per delivered resource from its latest window, an inflow source offers work, a process binds on its latest saturated window, downstream slack counts every feed and is cited, edgeless series each report a final with escaped ids, a confirmed bind cites causal and its edges while a suspected one cites no causal record, another-unit downstream capacity, upstream source, or side feed proves no bind, and a 1e300 window formats as a finite saturation time.
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
  // Only a confirmation cites the causal record it rests on.
  expect(suspected.hypotheses[0]?.evidenceRefs).not.toContain("causal");
  expect(steady.hypotheses[0]?.evidenceRefs.at(-1)).toBe("causal");
  expect(suspected.facts.some((item) => item.id === suspected.hypotheses[0]?.id)).toBe(false);
  // Samples of another resource or another window do not combine into a bind.
  const steadyCase = load("steady");
  const otherResource = diagnoseFlow({
    ...steadyCase,
    samples: steadyCase.samples.map((sample) =>
      sample.processId === "process" && sample.kind === "capacity" ? { ...sample, resourceId: "gem" } : sample,
    ),
  });
  expect(otherResource.hypotheses[0]?.claim).not.toBe("capacity-constraint");
  const otherWindow = diagnoseFlow({
    ...steadyCase,
    samples: steadyCase.samples.map((sample) =>
      sample.processId === "mine" ? { ...sample, startSec: 60, endSec: 120 } : sample,
    ),
  });
  expect(otherWindow.hypotheses[0]?.claim).not.toBe("capacity-constraint");
  // When a process handles two resources, the bind reads the resource the edge delivers.
  const twoResources = diagnoseFlow({
    ...steadyCase,
    samples: [
      { processId: "process", resourceId: "gem", kind: "throughput", amount: "5", unit: "ore/min", startSec: 0, endSec: 60 },
      { processId: "process", resourceId: "gem", kind: "capacity", amount: "5", unit: "ore/min", startSec: 0, endSec: 60 },
      ...steadyCase.samples,
    ],
  });
  expect(twoResources.hypotheses[0]?.processId).toBe("process");
  // The refs cite the edges, the downstream capacity that proved the slack (sample 7), and the throughput that named its unit (sample 6), not only the local and upstream samples.
  expect(twoResources.hypotheses[0]?.evidenceRefs).toEqual(["sample:3", "sample:4", "sample:2", "edge:0", "sample:7", "sample:6", "edge:1", "causal"]);
  // A downstream capacity in another unit proves no slack.
  const otherUnit = diagnoseFlow({
    ...steadyCase,
    samples: steadyCase.samples.map((sample) => (sample.processId === "sell" && sample.kind === "capacity" ? { ...sample, unit: "s" } : sample)),
  });
  expect(otherUnit.hypotheses.some((item) => item.claim === "capacity-constraint")).toBe(false);
  // An upstream source in another unit offers nothing on an edge that keeps the resource.
  const otherSourceUnit = diagnoseFlow({
    ...steadyCase,
    samples: steadyCase.samples.map((sample) => (sample.processId === "mine" ? { ...sample, unit: "s" } : sample)),
  });
  expect(otherSourceUnit.hypotheses.some((item) => item.claim === "capacity-constraint")).toBe(false);
  // Downstream slack counts every feed into that destination in the window.
  const sideFeed = (amount: string | null, unit = "ore/min") =>
    diagnoseFlow({
      ...steadyCase,
      samples: [
        ...steadyCase.samples,
        ...(amount === null
          ? []
          : [{ processId: "side", resourceId: "ore", kind: "throughput" as const, amount, unit, startSec: 0, endSec: 60 }]),
      ],
      edges: [
        ...steadyCase.edges,
        { fromProcessId: "side", toProcessId: "sell", fromResourceId: "ore", toResourceId: "ore", numerator: "1", denominator: "1", loss: "0" },
      ],
    });
  expect(sideFeed("15").hypotheses.some((item) => item.claim === "capacity-constraint")).toBe(false);
  expect(sideFeed(null).hypotheses.some((item) => item.claim === "capacity-constraint")).toBe(false);
  const roomy = sideFeed("5");
  expect(roomy.hypotheses[0]?.processId).toBe("process");
  expect(roomy.hypotheses[0]?.evidenceRefs).toEqual(["sample:1", "sample:2", "sample:0", "edge:0", "sample:5", "sample:4", "edge:1", "edge:2", "sample:6", "causal"]);
  // A side feed in another unit is not added to the load, so it cannot prove the slack.
  expect(sideFeed("5", "s").hypotheses.some((item) => item.claim === "capacity-constraint")).toBe(false);
  // Two saturated processes: the causally named one is confirmed even when it appears later.
  const parallel: FlowObservationV1 = {
    ...steadyCase,
    samples: [
      { processId: "src", resourceId: "ore", kind: "throughput", amount: "100", unit: "ore/min", startSec: 0, endSec: 60 },
      { processId: "left", resourceId: "ore", kind: "throughput", amount: "10", unit: "ore/min", startSec: 0, endSec: 60 },
      { processId: "left", resourceId: "ore", kind: "capacity", amount: "10", unit: "ore/min", startSec: 0, endSec: 60 },
      { processId: "right", resourceId: "ore", kind: "throughput", amount: "20", unit: "ore/min", startSec: 0, endSec: 60 },
      { processId: "right", resourceId: "ore", kind: "capacity", amount: "20", unit: "ore/min", startSec: 0, endSec: 60 },
    ],
    edges: [
      { fromProcessId: "src", toProcessId: "left", fromResourceId: "ore", toResourceId: "ore", numerator: "1", denominator: "2", loss: "0" },
      { fromProcessId: "src", toProcessId: "right", fromResourceId: "ore", toResourceId: "ore", numerator: "1", denominator: "2", loss: "0" },
    ],
    causal: { kind: "experiment", processId: "right" },
  };
  const both = diagnoseFlow(parallel);
  expectValid(both);
  expect(both.hypotheses.map((item) => [item.processId, item.status])).toEqual([
    ["right", "confirmed"],
    ["left", "suspected"],
  ]);
  expect(both.facts.filter((item) => item.kind === "saturation-time").map((item) => item.processId)).toEqual(["left", "right"]);
  // A bind on one process does not hide another process's wait.
  const boundAndStarved = diagnoseFlow({
    ...steadyCase,
    samples: [
      ...steadyCase.samples,
      { processId: "sell", resourceId: "ore", kind: "starved-time", amount: "4", unit: "s", startSec: 0, endSec: 60 },
    ],
  });
  expect(boundAndStarved.hypotheses.map((item) => [item.processId, item.claim])).toEqual([
    ["process", "capacity-constraint"],
    ["sell", "material-shortage"],
  ]);
  // A graph with edges but no terminal process has no final throughput.
  const cycle = diagnoseFlow({
    ...steadyCase,
    edges: [
      ...steadyCase.edges,
      { fromProcessId: "sell", toProcessId: "mine", fromResourceId: "ore", toResourceId: "ore", numerator: "1", denominator: "1", loss: "0" },
    ],
  });
  expect(cycle.facts.some((item) => item.kind === "final-throughput")).toBe(false);
  // A huge finite window keeps a finite saturation time instead of formatting as Infinity.
  const huge = diagnoseFlow({
    ...steadyCase,
    samples: steadyCase.samples.map((sample) => ({ ...sample, endSec: 1e300 })),
  });
  expect(fact(huge, "saturation-time", "process")?.amount).toBe("1e+300");
  expectValid(huge);
  // Every terminal process reports its own final throughput, whatever the edge order.
  const forked: FlowObservationV1 = {
    ...steadyCase,
    samples: [
      ...steadyCase.samples,
      { processId: "store", resourceId: "ore", kind: "throughput", amount: "7", unit: "ore/min", startSec: 0, endSec: 60 },
    ],
    edges: [
      ...steadyCase.edges,
      { fromProcessId: "process", toProcessId: "store", fromResourceId: "ore", toResourceId: "ore", numerator: "1", denominator: "1", loss: "0" },
    ],
  };
  const finalsOf = (report: FlowReportV1) =>
    report.facts.filter((item) => item.kind === "final-throughput").map((item) => [item.processId, item.amount]);
  expect(finalsOf(diagnoseFlow(forked))).toEqual([
    ["sell", "20"],
    ["store", "7"],
  ]);
  expect(finalsOf(diagnoseFlow({ ...forked, edges: [...forked.edges].reverse() }))).toEqual([
    ["store", "7"],
    ["sell", "20"],
  ]);
  // A terminal with two windows reports the latest one, whatever the sample order.
  const laterSell = { processId: "sell", resourceId: "ore", kind: "throughput", amount: "25", unit: "ore/min", startSec: 60, endSec: 120 } as const;
  expect(finalsOf(diagnoseFlow({ ...steadyCase, samples: [...steadyCase.samples, laterSell] }))).toEqual([["sell", "25"]]);
  expect(finalsOf(diagnoseFlow({ ...steadyCase, samples: [laterSell, ...steadyCase.samples] }))).toEqual([["sell", "25"]]);
  // A source that reports its offer as inflow still offers work to the bind.
  const inflowSource = diagnoseFlow({
    ...steadyCase,
    samples: steadyCase.samples.map((sample) => (sample.processId === "mine" ? { ...sample, kind: "inflow" as const } : sample)),
  });
  expect(inflowSource.hypotheses[0]?.claim).toBe("capacity-constraint");
  expect(inflowSource.hypotheses[0]?.processId).toBe("process");
  // Without edges, every throughput series reports its latest window, whatever the sample order.
  const edgelessFinals = (samples: FlowObservationV1["samples"]) =>
    diagnoseFlow({ ...steadyCase, edges: [], samples })
      .facts.filter((item) => item.kind === "final-throughput")
      .map((item) => `${item.processId}=${item.amount}`)
      .sort();
  expect(edgelessFinals(steadyCase.samples)).toEqual(["mine=100", "process=20", "sell=20"]);
  expect(edgelessFinals([...steadyCase.samples].reverse())).toEqual(["mine=100", "process=20", "sell=20"]);
  // Fact ids escape process and resource ids, so pairs that join to the same text stay distinct.
  const colliding = diagnoseFlow({
    ...steadyCase,
    samples: [
      { processId: "a:b", resourceId: "c", kind: "throughput", amount: "1", unit: "u", startSec: 0, endSec: 60 },
      { processId: "a", resourceId: "b:c", kind: "throughput", amount: "2", unit: "u", startSec: 0, endSec: 60 },
    ],
    edges: [
      { fromProcessId: "src", toProcessId: "a:b", fromResourceId: "c", toResourceId: "c", numerator: "1", denominator: "1", loss: "0" },
      { fromProcessId: "src", toProcessId: "a", fromResourceId: "c", toResourceId: "b:c", numerator: "1", denominator: "1", loss: "0" },
    ],
  });
  const finalIds = colliding.facts.filter((item) => item.kind === "final-throughput").map((item) => item.id);
  expect(finalIds).toHaveLength(2);
  // An id with a lone surrogate still yields a report.
  const lone = diagnoseFlow({
    ...steadyCase,
    samples: [{ processId: "\ud800", resourceId: "c", kind: "throughput", amount: "1", unit: "u", startSec: 0, endSec: 60 }],
    edges: [{ fromProcessId: "src", toProcessId: "\ud800", fromResourceId: "c", toResourceId: "c", numerator: "1", denominator: "1", loss: "0" }],
  });
  expect(lone.facts.filter((item) => item.kind === "final-throughput")).toHaveLength(1);
  expect(new Set(finalIds).size).toBe(2);
  // A terminal fed two resources reports both, whatever the edge order.
  const twoDelivered: FlowObservationV1 = {
    ...steadyCase,
    samples: [
      ...steadyCase.samples,
      { processId: "sell", resourceId: "gem", kind: "throughput", amount: "3", unit: "gem/min", startSec: 0, endSec: 60 },
    ],
    edges: [
      ...steadyCase.edges,
      { fromProcessId: "process", toProcessId: "sell", fromResourceId: "ore", toResourceId: "gem", numerator: "1", denominator: "1", loss: "0" },
    ],
  };
  const deliveredFinals = (observation: FlowObservationV1) =>
    diagnoseFlow(observation)
      .facts.filter((item) => item.kind === "final-throughput")
      .map((item) => item.unit)
      .sort();
  expect(deliveredFinals(twoDelivered)).toEqual(["gem/min", "ore/min"]);
  expect(deliveredFinals({ ...twoDelivered, edges: [...twoDelivered.edges].reverse() })).toEqual(["gem/min", "ore/min"]);
  // A process saturated in two windows binds on the latest, whatever the sample order.
  const nextWindow = steadyCase.samples.map((sample) => ({ ...sample, startSec: 60, endSec: 120 }));
  for (const samples of [[...steadyCase.samples, ...nextWindow], [...nextWindow, ...steadyCase.samples]]) {
    const twice = diagnoseFlow({ ...steadyCase, samples });
    expect(fact(twice, "saturation-time", "process")?.window).toEqual({ startSec: 60, endSec: 120 });
    expect(twice.facts.filter((item) => item.kind === "saturation-time")).toHaveLength(1);
  }
}

/**
 * @evidence docs/requirements/active/flow-observability.md#req-pr15-conservation Conversion keeps the destination unit.
 * @evidenceReview docs/requirements/active/flow-observability.md#req-pr15-conservation #36612a7 Re-read the section, then ran this function: 100 becomes 45, the units are not added, a queue, unretained, or source sample of another resource or window does not conserve, a later conserving window is found, an overflowed conversion does not match, a 1e-7, 4.5e-13, or 4.5e-25 conversion is not equal to an empty stock, two conserving windows publish the latest in either order, a stock in another unit than the destination throughput does not conserve and a matching one cites that throughput, two edges into one stock are summed to 90, and a conserved 1e-10 keeps its spelling instead of rounding to 0.
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
  // A queue of another resource, or from another window, does not satisfy the edge.
  const conversionCase = load("conversion");
  const shifted = (match: (sample: FlowObservationV1["samples"][number]) => boolean, change: Partial<FlowObservationV1["samples"][number]>) =>
    diagnoseFlow({
      ...conversionCase,
      samples: conversionCase.samples.map((sample) => (match(sample) ? { ...sample, ...change } : sample)),
    });
  const otherResource = shifted((sample) => sample.kind === "queue", { resourceId: "slag" });
  expect(otherResource.facts.some((item) => item.kind === "conservation")).toBe(false);
  const otherWindow = shifted((sample) => sample.kind === "unretained", { startSec: 60, endSec: 120 });
  expect(otherWindow.facts.some((item) => item.kind === "conservation")).toBe(false);
  const otherSource = shifted((sample) => sample.kind === "inflow", { resourceId: "slag" });
  expect(otherSource.facts.some((item) => item.kind === "conservation")).toBe(false);
  // An earlier source window without destination evidence does not hide a later conserving window.
  const laterWindow = diagnoseFlow({
    ...conversionCase,
    samples: [
      { processId: "source", resourceId: "ore", kind: "inflow", amount: "80", unit: "ore/min", startSec: 60, endSec: 120 },
      ...conversionCase.samples,
    ],
  });
  const laterFact = fact(laterWindow, "conservation", "dest");
  expect(laterFact?.amount).toBe("45");
  expect(laterFact?.window).toEqual({ startSec: 0, endSec: 60 });
  // A conversion that overflows is not a match, even against an overflowed destination amount.
  const overflow = diagnoseFlow({
    ...conversionCase,
    samples: conversionCase.samples.map((sample) => (sample.kind === "inflow" ? { ...sample, amount: "1e308" } : sample.kind === "queue" ? { ...sample, amount: "1e308" } : sample)),
    edges: conversionCase.edges.map((edge) => ({ ...edge, numerator: "10", denominator: "1", loss: "0" })),
  });
  expect(overflow.facts.some((item) => item.kind === "conservation")).toBe(false);
  // A stock in another unit than the destination's throughput does not conserve.
  const destinationRate = { processId: "dest", resourceId: "ingot", kind: "throughput" as const, amount: "45", unit: "ingot/min", startSec: 0, endSec: 60 };
  const relabeled = diagnoseFlow({
    ...conversionCase,
    samples: [
      ...conversionCase.samples.map((sample) => (sample.kind === "inflow" ? sample : { ...sample, unit: "gold/min" })),
      destinationRate,
    ],
  });
  expect(relabeled.facts.some((item) => item.kind === "conservation")).toBe(false);
  const matching = diagnoseFlow({ ...conversionCase, samples: [...conversionCase.samples, destinationRate] });
  expect(fact(matching, "conservation", "dest")?.amount).toBe("45");
  // The destination throughput that named the stock unit is cited with the fact.
  expect(fact(matching, "conservation", "dest")?.evidenceRefs).toEqual(["sample:0", "sample:1", "sample:2", "sample:3", "edge:0"]);
  // A sub-unit conversion is not equal to an empty destination.
  const tiny = diagnoseFlow({
    ...conversionCase,
    samples: conversionCase.samples.map((sample) =>
      sample.kind === "inflow" ? { ...sample, amount: "2e-7" } : { ...sample, amount: "0" },
    ),
  });
  expect(tiny.facts.some((item) => item.kind === "conservation")).toBe(false);
  // However small, a positive conversion is not equal to an empty destination.
  for (const amount of ["1e-12", "1e-24"]) {
    const smaller = diagnoseFlow({
      ...conversionCase,
      samples: conversionCase.samples.map((sample) => (sample.kind === "inflow" ? { ...sample, amount } : { ...sample, amount: "0" })),
    });
    expect(smaller.facts.some((item) => item.kind === "conservation")).toBe(false);
  }
  // Two conserving windows publish the latest one, whatever the sample order.
  const secondWindow = conversionCase.samples.map((sample) => ({
    ...sample,
    amount: sample.kind === "inflow" ? "200" : sample.kind === "queue" ? "80" : "10",
    startSec: 60,
    endSec: 120,
  }));
  for (const samples of [[...conversionCase.samples, ...secondWindow], [...secondWindow, ...conversionCase.samples]]) {
    const latestFact = fact(diagnoseFlow({ ...conversionCase, samples }), "conservation", "dest");
    expect(latestFact?.window).toEqual({ startSec: 60, endSec: 120 });
    expect(latestFact?.amount).toBe("90");
  }
  // A conserved amount below the rounding step keeps its own nonzero spelling.
  const small = diagnoseFlow({
    ...conversionCase,
    samples: conversionCase.samples.map((sample) =>
      sample.kind === "inflow" ? { ...sample, amount: "2e-10" } : sample.kind === "queue" ? { ...sample, amount: "1e-10" } : { ...sample, amount: "0" },
    ),
    edges: conversionCase.edges.map((edge) => ({ ...edge, loss: "0" })),
  });
  expect(fact(small, "conservation", "dest")?.amount).toBe("1e-10");
  // Two edges into one destination resource are summed against its stock.
  const fanIn = (queue: string, unretained: string) =>
    diagnoseFlow({
      ...conversionCase,
      samples: [
        { processId: "source", resourceId: "ore", kind: "inflow", amount: "100", unit: "ore/min", startSec: 0, endSec: 60 },
        { processId: "second", resourceId: "ore", kind: "inflow", amount: "100", unit: "ore/min", startSec: 0, endSec: 60 },
        { processId: "dest", resourceId: "ingot", kind: "queue", amount: queue, unit: "ingot/min", startSec: 0, endSec: 60 },
        { processId: "dest", resourceId: "ingot", kind: "unretained", amount: unretained, unit: "ingot/min", startSec: 0, endSec: 60 },
      ],
      edges: [
        ...conversionCase.edges,
        { fromProcessId: "second", toProcessId: "dest", fromResourceId: "ore", toResourceId: "ingot", numerator: "1", denominator: "2", loss: "0.1" },
      ],
    });
  const summed = fanIn("80", "10").facts.filter((item) => item.kind === "conservation");
  expect(summed.map((item) => item.amount)).toEqual(["90"]);
  expect(summed[0]?.evidenceRefs).toEqual(["sample:0", "sample:1", "sample:2", "sample:3", "edge:0", "edge:1"]);
  expect(fanIn("40", "5").facts.some((item) => item.kind === "conservation")).toBe(false);
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
 * @evidenceReview docs/requirements/active/flow-observability.md#req-pr15-suspected #277b0a9 Re-read the section, then ran this function: a lone throughput confirms nothing, starved and blocked time on two processes give two hypotheses, both on one process stay unresolved with that process's own hypothesis, an overflowing Little's law product is insufficient-data, a ramp-up observation keeps the law off, the latest wait window is cited in either sample order, a latest zero wait clears an older positive one, and a positive and a zero wait for two resources in one window give the shortage in either order.
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
  // Starved and blocked time on different processes each keep their own hypothesis.
  const starvedCase = load("starved");
  const split = diagnoseFlow({
    ...starvedCase,
    samples: [
      ...starvedCase.samples,
      { processId: "press", resourceId: "item", kind: "blocked-time", amount: "3", unit: "s", startSec: 0, endSec: 60 },
    ],
  });
  expect(split.status).toBe("ok");
  expect(split.hypotheses.map((item) => [item.processId, item.claim, item.status])).toEqual([
    ["stage", "material-shortage", "suspected"],
    ["press", "demand-shortage", "suspected"],
  ]);
  expect(new Set(split.hypotheses.map((item) => item.id)).size).toBe(2);
  // One process with both kinds of wait stays unresolved.
  const both = diagnoseFlow({
    ...starvedCase,
    samples: [
      ...starvedCase.samples,
      { processId: "stage", resourceId: "item", kind: "blocked-time", amount: "3", unit: "s", startSec: 0, endSec: 60 },
    ],
  });
  expect(both.hypotheses.map((item) => item.claim)).toEqual(["none"]);
  expect(both.hypotheses[0]?.processId).toBe("stage");
  expect(both.status).toBe("insufficient-data");
  // A mixed process keeps its own unresolved hypothesis next to another process's suspected one.
  const mixed = diagnoseFlow({
    ...starvedCase,
    samples: [
      ...starvedCase.samples,
      { processId: "stage", resourceId: "item", kind: "blocked-time", amount: "3", unit: "s", startSec: 0, endSec: 60 },
      { processId: "press", resourceId: "item", kind: "blocked-time", amount: "3", unit: "s", startSec: 0, endSec: 60 },
    ],
  });
  expectValid(mixed);
  expect(mixed.status).toBe("ok");
  expect(mixed.hypotheses.map((item) => [item.processId, item.claim, item.status])).toEqual([
    ["stage", "none", "insufficient-data"],
    ["press", "demand-shortage", "suspected"],
  ]);
  // Finite Little's law inputs whose product overflows are not called consistent.
  const overflowLittles = diagnoseFlow({
    ...load("steadyLittles"),
    littles: { inventory: "1", arrivalPerSec: "1e308", waitSec: "1e308", steady: true, workFlowDefined: true },
  });
  expect(overflowLittles.littlesLaw.status).toBe("insufficient-data");
  // A ramp-up observation keeps Little's law off even when its window claims to be steady.
  const rampedObservation = diagnoseFlow({ ...load("steadyLittles"), steady: false });
  expect(rampedObservation.littlesLaw.status).toBe("not-applicable");
  // The latest wait window is the evidence, whatever the sample order.
  const olderWait = { processId: "stage", resourceId: "item", kind: "starved-time" as const, amount: "9", unit: "s", startSec: -60, endSec: 0 };
  for (const samples of [[olderWait, ...starvedCase.samples], [...starvedCase.samples, olderWait]]) {
    const report = diagnoseFlow({ ...starvedCase, samples });
    const latestIndex = samples.findIndex((sample) => sample.startSec === 0);
    expect(report.hypotheses[0]?.evidenceRefs).toEqual([`sample:${latestIndex}`]);
  }
  // Waits for two resources in the same latest window both count, whatever the sample order.
  const zeroOtherResource = { processId: "stage", resourceId: "part", kind: "starved-time" as const, amount: "0", unit: "s", startSec: 0, endSec: 60 };
  for (const samples of [[zeroOtherResource, ...starvedCase.samples], [...starvedCase.samples, zeroOtherResource]]) {
    const report = diagnoseFlow({ ...starvedCase, samples });
    const positiveIndex = samples.findIndex((sample) => sample.resourceId === "item");
    expect(report.hypotheses.map((item) => item.claim)).toEqual(["material-shortage"]);
    expect(report.hypotheses[0]?.evidenceRefs).toEqual([`sample:${positiveIndex}`]);
  }
  // A latest zero wait clears an older positive one.
  const clearedWait = { processId: "stage", resourceId: "item", kind: "starved-time" as const, amount: "0", unit: "s", startSec: 60, endSec: 120 };
  for (const samples of [[clearedWait, ...starvedCase.samples], [...starvedCase.samples, clearedWait]]) {
    const report = diagnoseFlow({ ...starvedCase, samples });
    expect(report.hypotheses.map((item) => item.claim)).toEqual(["none"]);
    expect(report.status).toBe("insufficient-data");
  }
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
