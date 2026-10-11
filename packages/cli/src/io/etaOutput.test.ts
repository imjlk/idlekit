import { describe, expect, it } from "bun:test";
import { createNumberEngine, etaSimulate } from "@idlekit/core";
import { OUTPUT_CONTRACT_VERSION } from "./outputMeta";
import { readEtaOutput } from "./etaOutput";

describe("eta output reader", () => {
  it("keeps legacy seconds beside a censored artifact", () => {
    const engine = createNumberEngine();
    const unit = { code: "COIN" as const };
    const result = etaSimulate({
      scenario: {
        ctx: { E: engine, unit, tickPolicy: { mode: "drop" }, stepSec: 1 },
        model: {
          id: "m",
          version: 1,
          income: () => ({ unit, amount: 1 }),
          actions: () => [],
          analytic: () => ({ incomeKind: "constant" }),
        },
        initial: {
          t: 0,
          wallet: { money: { unit, amount: 0 }, bucket: 0 },
          maxMoneyEver: { unit, amount: 0 },
          prestige: { count: 0, points: 0, multiplier: 1 },
          vars: {},
        },
        run: { stepSec: 1, durationSec: 10 },
      },
      target: { kind: "money", value: "999" },
      maxDurationSec: 10,
    });
    const legacy = {
      reached: result.reached,
      seconds: result.seconds,
      mode: result.mode,
      _meta: {
        command: "eta",
        generatedAt: "2026-10-01T00:00:00.000Z",
        contractVersion: OUTPUT_CONTRACT_VERSION,
        cliVersion: "0.0.0",
        gitSha: "abc",
        pluginDigest: {},
        schemaRef: "docs/schemas/eta.output.schema.json",
      },
    };
    // The ETA estimate is its own contract, not AnalysisArtifactV1, so it sits beside _meta as `analysis` directly.
    const linked = { ...legacy, analysis: result.estimate };
    const read = readEtaOutput({ ...legacy, analysis: result.estimate });
    expect(linked._meta.contractVersion).toBe("1.4.0");
    expect(linked._meta.schemaRef).toBe("docs/schemas/eta.output.schema.json");
    expect("analysis" in linked._meta).toBe(false);
    expect(read.legacySeconds).toBe(10);
    expect(read.artifactSeconds).toBeNull();
    expect(read.status).toBe("censored");
    expect(read.artifactSeconds).not.toBe(0);
    expect(read.legacySeconds).not.toBe(read.artifactSeconds);
  });
});
