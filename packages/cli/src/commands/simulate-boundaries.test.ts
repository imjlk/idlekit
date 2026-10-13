import type { ScenarioV1 } from "@idlekit/core";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createTempDir, removePath, runCliFailure, runCliJson, writeText } from "../testkit/bun";

type BoundaryCase = {
  id: string;
  initialT: number;
  clock: ScenarioV1["clock"];
  error?: string;
  expected?: {
    elapsedSec: number;
    endMoney: string;
    timestampChanged: boolean;
    timestampDelta?: number;
  };
};

const matrix = JSON.parse(readFileSync(
  new URL("../../../../fixtures/regressions/time-boundaries.json", import.meta.url),
  "utf8",
)) as { scenario: ScenarioV1; cases: BoundaryCase[] };

describe("shared bundled CLI clock boundary matrix", () => {
  let dir: string;
  beforeAll(async () => { dir = await createTempDir("idlekit-clock-boundaries"); });
  afterAll(async () => { if (dir) await removePath(dir); });

  for (const engine of ["number", "breakInfinity"]) {
    for (const boundary of matrix.cases) {
      it(`${engine}: ${boundary.id}`, async () => {
        const path = resolve(dir, `${engine}-${boundary.id}.json`);
        const scenario = {
          ...structuredClone(matrix.scenario),
          initial: { ...matrix.scenario.initial, t: boundary.initialT },
          clock: boundary.clock,
        };
        await writeText(path, JSON.stringify(scenario));
        const args = ["simulate", path, "--engine", engine, "--format", "json"];
        if (boundary.error) {
          const result = runCliFailure(args);
          expect(`${result.stderr}\n${result.stdout}`).toContain(boundary.error);
          return;
        }
        const out = runCliJson(args);
        const expected = boundary.expected!;
        expect(out.durationSec).toBe(expected.elapsedSec);
        expect(out.totalElapsedSec).toBe(expected.elapsedSec);
        expect(out.endMoney).toBe(expected.endMoney);
        expect(out.endT !== out.startT).toBe(expected.timestampChanged);
        if (expected.timestampDelta !== undefined) expect(out.endT - out.startT).toBe(expected.timestampDelta);
      });
    }
  }
});
