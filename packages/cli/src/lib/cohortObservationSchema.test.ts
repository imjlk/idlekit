import { expect, it } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import schema from "../../../../docs/schemas/calibrate.output.schema.json" with { type: "json" };
import { assertCohortObservation, compareRetention, observeCohort, planRetentionPatch } from "./cohortObservation";

const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
function document() {
  const observation = observeCohort([{ userId: "a", day: 0, iapRevenue: 0, adRevenue: 0 }, { userId: "a", day: 1, iapRevenue: 0, adRevenue: 0 }], 7);
  const patch = planRetentionPatch(observation, { d1: 0.8 });
  return {
    ok: true, source: "cohort.csv", sample: { rows: 2, users: 1 },
    monetization: { retention: {}, revenue: {}, acquisition: {}, uncertainty: { correlation: {} } },
    scenarioPatch: { monetization: { retention: patch.retention } }, patchStatus: patch.status, patchWarnings: [...patch.warnings], observation,
    comparison: compareRetention(observation, { d1: 0.8 }),
    _meta: { command: "calibrate", contractVersion: "1.4.0", schemaRef: "docs/schemas/calibrate.output.schema.json", cliVersion: "0.4.0", gitSha: "test", telemetryHash: "test", pluginDigest: {} },
  };
}

it("accepts observed, unconfigured and future points in a real cohort report", () => {
  expect(validate(document())).toBe(true);
  const ready = document();
  const patch = planRetentionPatch(ready.observation, { d30: 0, d90: 0 });
  ready.patchStatus = patch.status;
  ready.patchWarnings = [...patch.warnings];
  ready.scenarioPatch.monetization.retention = patch.retention;
  ready.comparison = compareRetention(ready.observation, { d30: 0, d90: 0 });
  expect(ready.patchStatus).toBe("ready");
  expect(validate(ready)).toBe(true);
  ready.scenarioPatch.monetization.retention = {};
  expect(validate(ready)).toBe(false);
});

it("rejects contradictory observation and comparison states", () => {
  const mutate = (change: (value: any) => void) => {
    const value = structuredClone(document());
    change(value);
    expect(validate(value)).toBe(false);
  };
  mutate(value => { value.observation.retention[0].rate = null; });
  mutate(value => { value.observation.retention[0].activeUsers = null; });
  mutate(value => { value.observation.retention[2].rate = 0; });
  mutate(value => { value.observation.retention[2].interval95 = { min: 0, max: 1 }; });
  mutate(value => { value.observation.retention[0].interval95.extra = 1; });
  mutate(value => { value.comparison[0].assumption = null; });
  mutate(value => { value.comparison[0].observed = null; });
  mutate(value => { value.comparison[0].differencePercentagePoints = null; });
  mutate(value => { value.comparison[1].assumption = 0.5; });
  mutate(value => { value.comparison[1].differencePercentagePoints = 0; });
  mutate(value => { value.comparison[2].observed = 0; });
  mutate(value => { delete value.patchStatus; });
  mutate(value => { value.observation.retention[1].day = 1; });
  mutate(value => { value.comparison[1].day = 1; });
  mutate(value => { value.scenarioPatch.monetization.retention = { d1: 0.5 }; });
  mutate(value => { delete value.observation; delete value.comparison; });
  mutate(value => { value.scenarioPatch.monetization.revenue = {}; });
});

it("keeps confidence intervals ordered around observed rates including both endpoints", () => {
  for (let retained = 0; retained <= 10; retained++) {
    const rows = Array.from({ length: 10 }, (_, index) => ({ userId: String(index), day: 0, iapRevenue: 0, adRevenue: 0 }));
    rows.push(...rows.slice(0, retained).map(row => ({ ...row, day: 1 })));
    const point = observeCohort(rows, 1).retention[0]!;
    expect(point.interval95!.min).toBeGreaterThanOrEqual(0);
    expect(point.interval95!.min).toBeLessThanOrEqual(point.rate!);
    expect(point.interval95!.max).toBeGreaterThanOrEqual(point.rate!);
    expect(point.interval95!.max).toBeLessThanOrEqual(1);
  }
});

it("rejects impossible counts and inconsistent intervals at the semantic output boundary", () => {
  const mutate = (change: (value: any) => void) => {
    const value = structuredClone(document().observation);
    change(value);
    expect(() => assertCohortObservation(value)).toThrow();
  };
  mutate(value => { value.retention[0].activeUsers = 999; });
  mutate(value => { value.retention[0].rate = 0.25; });
  mutate(value => { value.retention[0].users = 2; });
  mutate(value => { value.retention[0].interval95 = { min: 0.8, max: 0.2 }; });
  mutate(value => { value.retention[0].interval95.min = NaN; });
  mutate(value => { value.observedThroughDay = 0; });
});
