import { describe, expect, it } from "bun:test";
import { resolve } from "path";
import Ajv2020 from "ajv/dist/2020";
import schema from "../../../../docs/schemas/cohort-batch.v1.schema.json" with { type: "json" };
import { validateCohortBatch } from "@idlekit/core";
import { parseCohortBatchCsv, readCohortBatchDocument } from "./cohortBatch";
import { REPO_ROOT } from "../testkit/bun";

const validateSchema = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

describe("cohort batch CSV", () => {
  it("groups long-format rows into cohorts and keeps unmeasured money absent", () => {
    const batch = parseCohortBatchCsv([
      "cohort_id,variant,install_date,observed_through_day,user_id,day,active,iap_revenue",
      "w1,control,2026-10-05,7,u1,0,true,0",
      "w1,control,2026-10-05,7,u1,1,,1.5",
      "w1,control,2026-10-05,7,u2,0,false,0",
      "w2,,,1,u3,0,,0",
    ].join("\n"));
    expect(batch.cohorts.map(cohort => cohort.id)).toEqual(["w1", "w2"]);
    expect(batch.cohorts[0]).toMatchObject({ variant: "control", installDate: "2026-10-05", observedThroughDay: 7 });
    expect(batch.cohorts[1]).not.toHaveProperty("variant");
    expect(batch.cohorts[0]!.rows[1]).toEqual({ userId: "u1", day: 1, iapRevenue: 1.5 });
    expect(batch.cohorts[0]!.rows[2]).toEqual({ userId: "u2", day: 0, active: false, iapRevenue: 0 });
    expect(batch.cohorts[0]!.rows[0]).not.toHaveProperty("adRevenue");
    expect(validateCohortBatch(batch).ok).toBe(true);
    expect(validateSchema(batch)).toBe(true);
  });

  it("rejects unknown columns, missing required columns and inconsistent cohort fields", () => {
    for (const csv of [
      "cohort_id,observed_through_day,user_id,day,email\nw1,7,u1,0,a@example.com",
      "cohort_id,user_id,day\nw1,u1,0",
      "cohort_id,observed_through_day,user_id,day\nw1,7,u1,0\nw1,6,u2,0",
      "cohort_id,observed_through_day,user_id,day,active\nw1,7,u1,0,maybe",
      "cohort_id,observed_through_day,user_id,day,iap_revenue\nw1,7,u1,0,",
      "cohort_id,observed_through_day,user_id,day\n,7,u1,0",
      "cohort_id,cohort_id,observed_through_day,user_id,day\nw1,w1,7,u1,0",
    ]) expect(() => parseCohortBatchCsv(csv)).toThrow();
  });
});

describe("cohort batch examples", () => {
  it("the shipped JSON and CSV examples satisfy the schema and the observation contract", async () => {
    for (const file of ["cohorts.json", "cohorts.csv"]) {
      const batch = await readCohortBatchDocument(resolve(REPO_ROOT, "examples/telemetry", file));
      expect(validateSchema(batch)).toBe(true);
      const result = validateCohortBatch(batch);
      expect(result.ok).toBe(true);
    }
  });

  it("the schema rejects fields the validator rejects", () => {
    const base = { schemaVersion: 1, cohorts: [{ id: "w1", observedThroughDay: 1, rows: [{ userId: "u1", day: 0 }] }] };
    expect(validateSchema(base)).toBe(true);
    for (const mutate of [
      (value: any) => { value.cohorts[0].rows[0].email = "a@example.com"; },
      (value: any) => { value.cohorts[0].id = "-bad"; },
      (value: any) => { value.schemaVersion = 2; },
      (value: any) => { value.cohorts = []; },
      (value: any) => { value.cohorts[0].rows[0].iapRevenue = -1; },
    ]) {
      const value = structuredClone(base);
      mutate(value);
      expect(validateSchema(value)).toBe(false);
      expect(validateCohortBatch(value).ok).toBe(false);
    }
  });
});
