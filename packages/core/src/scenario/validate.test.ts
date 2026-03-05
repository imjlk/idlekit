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
});
