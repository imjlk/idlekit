import { describe, expect, it } from "bun:test";
import { createNumberEngine, simulateSessionPattern, type CompiledScenario, type SimState } from "@idlekit/core";
import {
  analyzePerceivedProgression,
  collectExperienceSnapshot,
  comparableExperienceMetric,
  firstMilestoneTime,
  summarizeExperienceMonteCarlo,
} from "./experience";
import { designObjectiveFactories } from "./designObjectives";

type Vars = { bought: number };

function scenario(trace?: CompiledScenario<number, "COIN", Vars>["run"]["trace"]): CompiledScenario<number, "COIN", Vars> {
  const initial: SimState<number, "COIN", Vars> = {
    t: 0,
    wallet: { money: { unit: { code: "COIN" }, amount: 0 }, bucket: 0 },
    maxMoneyEver: { unit: { code: "COIN" }, amount: 0 },
    prestige: { count: 0, points: 0, multiplier: 1 },
    vars: { bought: 0 },
  };
  return {
    ctx: { E: createNumberEngine(), unit: { code: "COIN" }, tickPolicy: { mode: "drop" }, seed: 1 },
    model: {
      id: "linear",
      version: 1,
      income: () => ({ unit: { code: "COIN" }, amount: 1 }),
      actions: () => [
        {
          id: "buy",
          kind: "buy",
          canApply: () => true,
          cost: () => null,
          apply: (_ctx, state) => ({ ...state, vars: { bought: state.vars.bought + 1 } }),
        },
      ],
    },
    strategy: { id: "buy", decide: (ctx, model, state) => model.actions(ctx, state).map((action) => ({ action })) },
    initial,
    run: { stepSec: 1, durationSec: 1, ...(trace ? { trace } : {}) },
  };
}

describe("analyzePerceivedProgression", () => {
  it("does not report a budget-cut session trace as quiet play", () => {
    const pattern = { id: "offline-heavy" as const, days: 1 };
    const full = scenario();
    const report = analyzePerceivedProgression({
      scenario: full,
      session: simulateSessionPattern({ scenario: full, pattern, seed: 1 }),
      series: "money",
    });
    expect(report.activeSeconds).toBe(300);
    expect(report.visibleChangeCount).toBeGreaterThan(0);

    // A budget keeps the session's memory bounded. The per-step metrics cannot be read from it.
    for (const trace of [{ maxPoints: 0 }, { maxPoints: 5 }, { maxActions: 1 }]) {
      const capped = scenario(trace);
      const session = simulateSessionPattern({ scenario: capped, pattern, seed: 1 });
      expect(() => analyzePerceivedProgression({ scenario: capped, session, series: "money" })).toThrow(
        "perceived progression needs every active step",
      );
    }
  });
});

// Net worth that reads the session clock view. It throws when the view is absent.
function clockedScenario(): CompiledScenario<number, "COIN", Vars> {
  const base = scenario();
  return {
    ...base,
    model: {
      ...base.model,
      clocks: { respondsTo: ["active"] },
      netWorth: (ctx, state) => {
        if (!ctx.clocks) throw new Error("netWorth reads ctx.clocks");
        return { unit: state.wallet.money.unit, amount: state.wallet.money.amount + ctx.clocks.activeT };
      },
    },
  };
}

describe("snapshotFromSession", () => {
  it("reads net worth with the clock view each segment used", () => {
    const clocked = clockedScenario();
    const pattern = { id: "twice-daily" as const, days: 1 };
    const { session, snapshot } = collectExperienceSnapshot({ scenario: clocked, sessionPattern: pattern, seed: 1, series: "netWorth" });
    const last = session.segments.at(-1)!;
    expect(last.kind).toBe("offline");
    expect(last.clocks?.activeT).toBe(3600);
    expect(Number(snapshot.endNetWorth)).toBe(session.end.wallet.money.amount + 3600);
    expect(snapshot.growth.valueSource).toBe("netWorth");
    expect(snapshot.growth.segments.length).toBeGreaterThan(0);
    expect(snapshot.perceived.activeSeconds).toBe(3600);
    expect(snapshot.perceived.visibleChangeCount).toBeGreaterThan(0);
  });

  it("does not report growth from a merged trace the session budget cut", () => {
    // Each 1800-second block traces 1801 points and fits. The merged session trace does not.
    const capped = scenario({ maxPoints: 1801 });
    const pattern = { id: "twice-daily" as const, days: 1 };
    const session = simulateSessionPattern({ scenario: capped, pattern, seed: 1 });
    const blocks = session.segments.filter((segment) => segment.kind === "active");
    expect(blocks.map((segment) => segment.run.traceLog?.dropped)).toEqual([0, 0]);
    expect(session.run.traceLog?.dropped).toBe(1801);
    expect(analyzePerceivedProgression({ scenario: capped, session, series: "money" }).activeSeconds).toBe(3600);
    expect(() => collectExperienceSnapshot({ scenario: capped, sessionPattern: pattern, seed: 1 })).toThrow(
      "session growth needs the whole session trace",
    );
  });
});

describe("milestone times under the sample cap", () => {
  // 70 distinct actions, one bought per tick, pass the default cap of 64 milestone keys in one block.
  function manyActions(): CompiledScenario<number, "COIN", Vars> {
    const base = scenario();
    const actions = Array.from({ length: 70 }, (_, i) => ({
      id: `a${i}`,
      kind: "buy" as const,
      canApply: () => true,
      cost: () => null,
      apply: (_ctx: unknown, state: SimState<number, "COIN", Vars>) => state,
    }));
    return {
      ...base,
      model: { ...base.model, actions: () => actions },
      strategy: {
        id: "one-per-tick",
        decide: (_ctx, _model, state) => {
          const action = actions[Math.round(state.t / 60)];
          return action ? [{ action }] : [];
        },
      },
      run: { stepSec: 60, durationSec: 60 },
    };
  }
  const pattern = { id: "always-on" as const, days: 1 };

  it("does not read a dropped key as unreached", () => {
    const { snapshot } = collectExperienceSnapshot({ scenario: manyActions(), sessionPattern: pattern, seed: 1 });
    expect(snapshot.milestones.coverage).toBe("partial");
    for (const milestoneKey of ["action.a69.firstApplied", "action.a0.firstApplied", "never.seen"]) {
      expect(() =>
        comparableExperienceMetric({ snapshot, metric: "timeToMilestone", milestoneKey, fallbackValue: 86401 }),
      ).toThrow(`time to milestone ${milestoneKey} needs a complete milestone report; this one is partial`);
    }
    // The cap keeps the earliest keys, so the first milestone is still known.
    expect(comparableExperienceMetric({ snapshot, metric: "timeToMilestone", fallbackValue: 86401 })).toBe(0);
  });

  it("does not read a partial report with no sample as unreached", () => {
    expect(() => firstMilestoneTime({ milestones: [], coverage: "partial" })).toThrow(
      "time to the first milestone is unknown; this partial report kept no milestone sample",
    );
    expect(firstMilestoneTime({ milestones: [], firstMilestoneSec: 3, coverage: "partial" })).toBe(3);
    expect(firstMilestoneTime({ milestones: [], coverage: "complete" })).toBeUndefined();
  });

  it("does not score a dropped key as the unreached penalty", () => {
    const factory = designObjectiveFactories.find((entry) => entry.id === "timeToMilestoneNegSec")!;
    const objective = factory.create({ sessionPattern: "always-on", days: 1, milestoneKey: "action.a69.firstApplied" });
    expect(() => objective.score({ scenario: manyActions(), run: undefined as never })).toThrow(
      "time to milestone action.a69.firstApplied needs a complete milestone report",
    );
  });
});

describe("experience Monte Carlo first visible change", () => {
  it("estimates the population quantile when every draw shares one observation horizon", () => {
    const summary = summarizeExperienceMonteCarlo({
      scenario: scenario(),
      sessionPattern: { id: "twice-daily", days: 1 },
      draws: 3,
      seed: 1,
      quantiles: [0.5, 0.95],
    });
    // Twice-daily for one day observes visible changes until the end of the second active block.
    expect(summary.firstVisible.horizonSec).toBe(45000);
    expect(summary.firstVisible.population.estimator).toBe("common-horizon-order-statistic");
    expect(summary.firstVisible.population.status).toBe("observed");
    expect(summary.firstVisible.population.value).not.toBeNull();
  });

  it("analyzes one key per quantile when the scenario lists a quantile twice", () => {
    const summary = summarizeExperienceMonteCarlo({
      scenario: scenario(),
      sessionPattern: { id: "twice-daily", days: 1 },
      draws: 2,
      seed: 1,
      quantiles: [0.5, 0.5],
    });
    expect(summary.firstVisible.conditional.map((point) => point.key)).toEqual(["q0.5"]);
  });

  it("keeps the q50 median key when a neighbour rounds to it", () => {
    const summary = summarizeExperienceMonteCarlo({
      scenario: scenario(),
      sessionPattern: { id: "twice-daily", days: 1 },
      draws: 2,
      seed: 1,
      quantiles: [0.5, 0.504],
    });
    expect(Object.keys(summary.endNetWorthLog10.quantiles).sort()).toEqual(["q0.504", "q50"]);
    // A neighbour within any epsilon of 50% is still its own quantile.
    const close = summarizeExperienceMonteCarlo({
      scenario: scenario(),
      sessionPattern: { id: "twice-daily", days: 1 },
      draws: 2,
      seed: 1,
      quantiles: [0.5, 0.500000000001],
    });
    expect(Object.keys(close.endNetWorthLog10.quantiles).sort()).toEqual(["q0.500000000001", "q50"]);
  });

  it("measures the censoring horizon in tick seconds at a large start time", () => {
    // At t = 2^51 a 0.3-second tick rounds to 0.5 seconds of timestamp, so timestamps overstate reward time.
    const base = scenario();
    const late = { ...base, initial: { ...base.initial, t: 2 ** 51 }, run: { ...base.run, stepSec: 0.3 } };
    const summary = summarizeExperienceMonteCarlo({
      scenario: late,
      sessionPattern: { id: "twice-daily", days: 1 },
      draws: 2,
      seed: 1,
      quantiles: [0.5],
    });
    expect(summary.firstVisible.horizonSec).toBeCloseTo(45000, 3);
    // The first visible change is on the same tick clock, so a one-tick block does not overshoot its horizon.
    const oneTick = { ...late, run: { ...late.run, maxSteps: 1 } };
    const capped = summarizeExperienceMonteCarlo({
      scenario: oneTick,
      sessionPattern: { id: "twice-daily", days: 1 },
      draws: 2,
      seed: 1,
      quantiles: [0.5],
    });
    expect(capped.firstVisible.status).not.toBe("unsupported");
  });
});
