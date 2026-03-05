import { describe, expect, it } from "bun:test";
import { createModelRegistry, type ModelFactory } from "./registry";
import { validateScenarioV1 } from "./validate";
import type { ScenarioV1 } from "./types";

function baseScenario(): ScenarioV1 {
  return {
    schemaVersion: 1,
    unit: { code: "COIN" },
    policy: { mode: "drop" },
    model: { id: "m", version: 1 },
    initial: {
      wallet: { unit: "COIN", amount: "0" },
    },
    clock: {
      stepSec: 1,
      durationSec: 60,
    },
  };
}

describe("validateScenarioV1 clock stop conditions", () => {
  it("accepts scenario with positive durationSec", () => {
    const out = validateScenarioV1(baseScenario());
    expect(out.ok).toBeTrue();
  });

  it("accepts scenario with untilExpr and no durationSec", () => {
    const sc: ScenarioV1 = {
      ...baseScenario(),
      clock: {
        stepSec: 1,
        untilExpr: "t >= 10",
      },
    };
    const out = validateScenarioV1(sc);
    expect(out.ok).toBeTrue();
  });

  it("rejects scenario without durationSec and untilExpr", () => {
    const sc: ScenarioV1 = {
      ...baseScenario(),
      clock: {
        stepSec: 1,
      },
    };
    const out = validateScenarioV1(sc);
    expect(out.ok).toBeFalse();
    expect(out.issues.some((i) => i.path === "clock")).toBeTrue();
  });

  it("rejects non-positive durationSec", () => {
    const sc: ScenarioV1 = {
      ...baseScenario(),
      clock: {
        stepSec: 1,
        durationSec: 0,
      },
    };
    const out = validateScenarioV1(sc);
    expect(out.ok).toBeFalse();
    expect(out.issues.some((i) => i.path === "clock.durationSec")).toBeTrue();
  });

  it("rejects invalid sim.eventLog.maxEvents", () => {
    const sc: ScenarioV1 = {
      ...baseScenario(),
      sim: {
        eventLog: {
          maxEvents: -1,
        },
      },
    };
    const out = validateScenarioV1(sc);
    expect(out.ok).toBeFalse();
    expect(out.issues.some((i) => i.path === "sim.eventLog.maxEvents")).toBeTrue();
  });

  it("rejects invalid sim.offline.decay.floorRatio", () => {
    const sc: ScenarioV1 = {
      ...baseScenario(),
      sim: {
        offline: {
          maxSec: 3600,
          overflowPolicy: "clamp",
          decay: {
            kind: "linear",
            floorRatio: 1.5,
          },
        },
      },
    };

    const out = validateScenarioV1(sc);
    expect(out.ok).toBeFalse();
    expect(out.issues.some((i) => i.path === "sim.offline.decay.floorRatio")).toBeTrue();
  });

  it("accepts valid sim.offline policy", () => {
    const sc: ScenarioV1 = {
      ...baseScenario(),
      sim: {
        offline: {
          maxSec: 3600,
          overflowPolicy: "reject",
          decay: {
            kind: "none",
          },
        },
      },
    };

    const out = validateScenarioV1(sc);
    expect(out.ok).toBeTrue();
  });

  it("fails closed when model params schema returns unknown shape", () => {
    const badModelFactory: ModelFactory = {
      id: "m",
      version: 1,
      paramsSchema: {
        "~standard": {
          validate: () => ({}) as any,
        },
      },
      create: () => ({
        id: "m",
        version: 1,
        income: (ctx: any) => ({ unit: ctx.unit, amount: 0 }),
        actions: () => [],
      }),
    };

    const out = validateScenarioV1(baseScenario(), createModelRegistry([badModelFactory]));
    expect(out.ok).toBeFalse();
    expect(out.issues.some((i) => i.path === "model.params")).toBeTrue();
    expect(out.issues.some((i) => i.message.includes("invalid result shape"))).toBeTrue();
  });

  it("accepts valid monetization/LTV block", () => {
    const sc: ScenarioV1 = {
      ...baseScenario(),
      monetization: {
        cohorts: { baseUsers: 1000 },
        retention: {
          d1: 0.42,
          d7: 0.2,
          d30: 0.09,
          d90: 0.04,
          longTailDailyDecay: 0.02,
        },
        revenue: {
          payerConversion: 0.03,
          arppuDaily: 0.7,
          adArpDau: 0.02,
          platformFeeRate: 0.3,
          grossMarginRate: 0.92,
          progressionRevenueLift: 0.5,
          progressionLogSpan: 5,
        },
        acquisition: { cpi: 1.8 },
        uncertainty: {
          enabled: true,
          draws: 200,
          quantiles: [0.5, 0.9],
          seed: 11,
          sigma: {
            retention: 0.08,
            conversion: 0.12,
            arppu: 0.2,
            ad: 0.1,
          },
        },
      },
    };

    const out = validateScenarioV1(sc);
    expect(out.ok).toBeTrue();
  });

  it("rejects invalid monetization retention ordering", () => {
    const sc: ScenarioV1 = {
      ...baseScenario(),
      monetization: {
        retention: {
          d1: 0.2,
          d7: 0.25,
          d30: 0.1,
          d90: 0.05,
        },
      },
    };
    const out = validateScenarioV1(sc);
    expect(out.ok).toBeFalse();
    expect(out.issues.some((i) => i.path === "monetization.retention")).toBeTrue();
  });

  it("rejects invalid monetization uncertainty quantile", () => {
    const sc: ScenarioV1 = {
      ...baseScenario(),
      monetization: {
        uncertainty: {
          draws: 100,
          quantiles: [0.5, 1],
        },
      },
    };
    const out = validateScenarioV1(sc);
    expect(out.ok).toBeFalse();
    expect(out.issues.some((i) => i.path === "monetization.uncertainty.quantiles.1")).toBeTrue();
  });
});
