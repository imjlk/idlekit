import { describe, expect, it } from "bun:test";
import { createBreakInfinityEngine, createNumberEngine } from "../../engine/breakInfinity";
import type { Engine } from "../../engine/types";
import type { CompiledScenario } from "../types";
import { etaAnalytic, etaSecondsFromEngineRatio, etaSimulate } from "./eta";

type Currency = "COIN" | "GEM";

function fixture<N>(E: Engine<N>, income: N, incomeUnit: Currency = "COIN"): CompiledScenario<N, Currency, {}> {
  const unit = { code: "COIN" as Currency };
  return {
    ctx: { E, unit, tickPolicy: { mode: "drop" }, stepSec: 1 },
    model: {
      id: "eta-validation", version: 1,
      income: () => ({ unit: { code: incomeUnit }, amount: income }),
      actions: () => [], analytic: () => ({ incomeKind: "constant" }),
    },
    initial: {
      t: 0, wallet: { money: { unit, amount: E.zero() }, bucket: E.zero() },
      maxMoneyEver: { unit, amount: E.zero() },
      prestige: { count: 0, points: E.zero(), multiplier: E.from(1) }, vars: {},
    },
    run: { stepSec: 1, durationSec: 100 },
  };
}

describe("ETA input and comparison validity", () => {
  it("rejects a positive number ratio lost during division", () => {
    const E = createNumberEngine({ epsilon: 0 });
    expect(etaSecondsFromEngineRatio(E, 1e-300, 0, 1e100, true)).toEqual({ status: "invalid", seconds: null });
    const result = etaAnalytic({ scenario: fixture(E, 1e100), target: { kind: "money", value: "1e-300" } });
    expect(result.estimate.status).toBe("invalid");
    expect(result.estimate.seconds).toBeNull();
    expect(result.reached).toBe(false);
    expect(result.confidence).toBe("low");
    expect(result.seconds).toBe(Infinity);
  });

  it("keeps zero gaps and decimal underflow distinct", () => {
    const E = createNumberEngine({ epsilon: 0 });
    expect(etaSecondsFromEngineRatio(E, 3, 3, 1, true)).toEqual({ status: "ok", seconds: 0 });
    const big = createBreakInfinityEngine({ epsilon: 0 });
    const ratio = etaSecondsFromEngineRatio(big, big.from(1), big.zero(), big.from("1e400"), true);
    expect(ratio.status).toBe("invalid");
    expect(ratio.seconds).toBeNull();
    expect(ratio.secondsDecimal).toBe("1e-400");
  });

  it("rejects income that settlement cannot apply to the wallet", () => {
    const scenario = fixture(createNumberEngine({ epsilon: 0 }), 1, "GEM");
    const target = { kind: "money" as const, value: "3" };
    const analytic = etaAnalytic({ scenario, target });
    const stepped = etaSimulate({ scenario, target, maxDurationSec: 10 });
    expect(analytic.estimate.status).toBe("invalid");
    expect(analytic.estimate.seconds).toBeNull();
    expect(analytic.reached).toBe(false);
    expect(analytic.seconds).toBe(Infinity);
    expect(analytic.confidence).toBe("low");
    expect(stepped.estimate.status).toBe("censored");
  });

  it("does not label the default epsilon boundary exact", () => {
    const scenario = fixture(createNumberEngine(), 2e-12);
    const target = { kind: "money" as const, value: "8.9e-12" };
    const analytic = etaAnalytic({ scenario, target });
    const stepped = etaSimulate({ scenario, target, maxDurationSec: 10 });
    expect(analytic.seconds).toBe(4.45);
    expect(analytic.estimate.method).toBe("analytic-local");
    expect(analytic.confidence).toBe("medium");
    expect(stepped.seconds).toBe(4);
    expect(stepped.estimate.bracket).toBeUndefined();
  });

  it("keeps a custom epsilon estimate local", () => {
    const scenario = fixture(createNumberEngine({ epsilon: 1 }), 2);
    const target = { kind: "money" as const, value: "5" };
    const analytic = etaAnalytic({ scenario, target });
    expect(analytic.seconds).toBe(2.5);
    expect(analytic.estimate.method).toBe("analytic-local");
    expect(etaSimulate({ scenario, target, maxDurationSec: 10 }).seconds).toBe(2);
  });

  it("keeps a declared strict comparator exact", () => {
    const scenario = fixture(createNumberEngine({ epsilon: 0 }), 2);
    const target = { kind: "money" as const, value: "5" };
    const analytic = etaAnalytic({ scenario, target });
    const stepped = etaSimulate({ scenario, target, maxDurationSec: 10 });
    expect(analytic.estimate.method).toBe("exact");
    expect(analytic.seconds).toBe(2.5);
    expect(stepped.seconds).toBe(3);
    expect(stepped.estimate.bracket).toEqual({ lowerSec: 2.5, upperSec: 3 });
  });

  it("does not infer exactness for an undeclared custom comparator", () => {
    const E = { ...createNumberEngine({ epsilon: 0 }), comparisonIsExact: undefined };
    const analytic = etaAnalytic({ scenario: fixture(E, 1), target: { kind: "money", value: "3" } });
    expect(analytic.estimate.method).toBe("analytic-local");
    expect(analytic.seconds).toBe(3);
  });

  it("keeps constant non-positive income unsupported with a tolerant comparator", () => {
    const analytic = etaAnalytic({ scenario: fixture(createNumberEngine(), 0), target: { kind: "money", value: "3" } });
    expect(analytic.estimate.status).toBe("unsupported");
  });
});
