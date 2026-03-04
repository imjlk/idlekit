import { describe, expect, it } from "bun:test";
import { createNumberEngine } from "../../engine/breakInfinity";
import type { CompiledScenario } from "../types";
import { etaAnalytic, etaSimulate } from "./eta";

function makeScenario(): CompiledScenario<number, "COIN", Record<string, unknown>> {
  const E = createNumberEngine();
  const unit = { code: "COIN" as const };

  return {
    ctx: {
      E,
      unit,
      tickPolicy: { mode: "drop" },
      stepSec: 1,
    },
    model: {
      id: "m",
      version: 1,
      income: () => ({ unit, amount: 1 }),
      actions: () => [],
    },
    initial: {
      t: 0,
      wallet: {
        money: { unit, amount: 0 },
        bucket: 0,
      },
      maxMoneyEver: { unit, amount: 0 },
      prestige: { count: 0, points: 0, multiplier: 1 },
      vars: {},
    },
    run: {
      stepSec: 1,
      durationSec: 100,
    },
  };
}

describe("etaSimulate", () => {
  it("returns first reached time instead of maxDuration", () => {
    const out = etaSimulate({
      scenario: makeScenario(),
      target: { kind: "money", value: "3" },
      maxDurationSec: 10,
    });

    expect(out.reached).toBeTrue();
    expect(out.seconds).toBe(3);
  });

  it("returns maxDuration when target is not reached", () => {
    const out = etaSimulate({
      scenario: makeScenario(),
      target: { kind: "money", value: "999" },
      maxDurationSec: 10,
    });

    expect(out.reached).toBeFalse();
    expect(out.seconds).toBe(10);
  });

  it("omits run payload by default", () => {
    const out = etaSimulate({
      scenario: makeScenario(),
      target: { kind: "money", value: "10" },
      maxDurationSec: 10,
    });

    expect(out.mode).toBe("simulate");
    expect(out.run).toBeUndefined();
  });

  it("includes run payload when includeRun=true", () => {
    const out = etaSimulate({
      scenario: makeScenario(),
      target: { kind: "money", value: "10" },
      maxDurationSec: 10,
      includeRun: true,
    });

    expect(out.mode).toBe("simulate");
    expect(out.run).toBeDefined();
  });
});

describe("etaAnalytic", () => {
  it("never includes run payload", () => {
    const out = etaAnalytic({
      scenario: makeScenario(),
      target: { kind: "money", value: "10" },
    });

    expect(out.mode).toBe("analytic");
    expect(out.run).toBeUndefined();
  });
});
