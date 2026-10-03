import { describe, expect, it } from "bun:test";
import { resolve } from "path";
import { createNumberEngine, type Action, type CompiledScenario } from "@idlekit/core";
import { buildGuardrailKpi, emptyCounts, mergeCounts, runLtvAnalysis } from "./ltv";

describe("ltv guardrail counts", () => {
  it("counts cooldown skips without diluting the funds stall ratio", () => {
    const counts = mergeCounts(emptyCounts(), {
      actions: {
        applied: 100,
        skippedCannotApply: 0,
        skippedInsufficientFunds: 100,
        skippedInvalidQuote: 0,
        skippedCooldown: 300,
      },
    });
    expect(counts.actionsSkippedCooldown).toBe(300);
    const kpi = buildGuardrailKpi({
      counts,
      actionCounts: {},
      firstUpgradeSec: null,
      growthLog10PerDay: 0,
    });
    expect(kpi.stallRatio).toBe(0.5);
  });
});

describe("ltv prestige cooldown", () => {
  it("carries a reset from one horizon segment into the next", async () => {
    const scenario = await Bun.file(resolve(process.cwd(), "../../examples/tutorials/01-cafe-baseline.json")).json();
    const reset: Action<number, string, Record<string, unknown>> = {
      id: "prestige.reset",
      kind: "prestige",
      canApply: () => true,
      cost: () => null,
      apply: (_ctx, current) => ({
        ...current,
        prestige: { ...current.prestige, count: current.prestige.count + 1 },
      }),
    };
    const resets: number[] = [];
    const compiled: CompiledScenario<number, string, Record<string, unknown>> = {
      ctx: { E: createNumberEngine(), unit: { code: "COIN" }, tickPolicy: { mode: "drop" }, stepSec: 1 },
      model: {
        id: "ltv-anchor",
        version: 1,
        income: () => ({ unit: { code: "COIN" }, amount: 1 }),
        actions: () => [reset],
      },
      initial: {
        t: 0,
        wallet: { money: { unit: { code: "COIN" }, amount: 0 }, bucket: 0 },
        maxMoneyEver: { unit: { code: "COIN" }, amount: 0 },
        prestige: { count: 0, points: 0, multiplier: 1 },
        vars: {},
      },
      constraints: { minPrestigeIntervalSec: 100 },
      run: { stepSec: 1, onPrestigeReset: (t) => resets.push(t) },
      strategy: { id: "always-reset", decide: () => [{ action: reset }] },
    };
    // The reset at 0 cools until 100, so the 60s segment start stays blocked.
    runLtvAnalysis({
      scenario,
      scenarioPath: "ltv-anchor.json",
      compiled,
      strategy: compiled.strategy,
      horizonsRaw: "60s,90s",
      fast: false,
      seed: 1,
    });
    expect(resets).toEqual([0]);
  });
});

describe("ltv step budget", () => {
  it("rejects a horizon segment cut by maxSteps", async () => {
    const scenario = await Bun.file(resolve(process.cwd(), "../../examples/tutorials/01-cafe-baseline.json")).json();
    const compiled: CompiledScenario<number, string, Record<string, unknown>> = {
      ctx: { E: createNumberEngine(), unit: { code: "COIN" }, tickPolicy: { mode: "drop" }, stepSec: 1 },
      model: {
        id: "ltv-budget",
        version: 1,
        income: () => ({ unit: { code: "COIN" }, amount: 1 }),
        actions: () => [],
      },
      initial: {
        t: 0,
        wallet: { money: { unit: { code: "COIN" }, amount: 0 }, bucket: 0 },
        maxMoneyEver: { unit: { code: "COIN" }, amount: 0 },
        prestige: { count: 0, points: 0, multiplier: 1 },
        vars: {},
      },
      run: { stepSec: 1, maxSteps: 5 },
    };
    const analyze = (horizonsRaw: string) =>
      runLtvAnalysis({ scenario, scenarioPath: "ltv-budget.json", compiled, strategy: undefined, horizonsRaw, fast: false, seed: 1 });
    expect(() => analyze("60s")).toThrow(/ltv 60s exceeded maxSteps \(5\)/);
    expect(() => analyze("5s")).not.toThrow();
  });
});
