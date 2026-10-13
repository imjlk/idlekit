import { describe, expect, it } from "bun:test";
import { createBreakInfinityEngine, createNumberEngine } from "../../engine/breakInfinity";
import { checkResetCycleResume } from "../../testkit/conformance";
import type { Action, CompiledScenario } from "../types";
import { executeResetCycles, validateResetCycleArtifact } from "./resetCycle";

type Vars = { boost: number };
const unit = { code: "COIN" as const };
const policy = { kind: "fixed-interval" as const, cycles: 1, intervalSec: 2 };

function fixture() {
  const reset: Action<number, "COIN", Vars> = {
    id: "reset", kind: "prestige", canApply: () => true, cost: () => null,
    apply: (_ctx, state) => ({ ...state, wallet: { money: { unit, amount: 0 }, bucket: 0 },
      prestige: { ...state.prestige, count: state.prestige.count + 1, points: state.prestige.points + 1 } }),
  };
  const scenario: CompiledScenario<number, "COIN", Vars> = {
    ctx: { E: createNumberEngine({ epsilon: 0 }), unit, tickPolicy: { mode: "drop" }, stepSec: 1 },
    model: { id: "checkpoint-boundary", version: 1, income: (_ctx, state) => ({ unit, amount: 1 + state.vars.boost }), actions: () => [reset] },
    initial: { t: 0, wallet: { money: { unit, amount: 0 }, bucket: 0 }, maxMoneyEver: { unit, amount: 0 },
      prestige: { count: 0, points: 0, multiplier: 1 }, vars: { boost: 0 } },
    run: { stepSec: 1, durationSec: 5 },
  };
  return { ...scenario };
}

describe("reset checkpoint boundaries", () => {
  for (const path of ["budget", "missing-adapter", "refused"] as const) {
    it(`rejects nonfinite carried prestige on the ${path} exit`, () => {
      for (const field of ["count", "points", "multiplier"] as const) {
        for (const value of [NaN, Infinity, -Infinity]) {
          const scenario = fixture();
          const actions = scenario.model.actions;
          scenario.model = {
            ...scenario.model,
            evolve: (_ctx, state) => ({ ...state, prestige: { ...state.prestige, [field]: value } }),
            actions: path === "missing-adapter" ? () => [] : (ctx, state) => actions(ctx, state).map((action) => path === "refused" ? { ...action, canApply: () => false } : action),
          };
          expect(() => executeResetCycles({ scenario, policy, ...(path === "budget" ? { budgetSteps: 1 } : {}) })).toThrow(/nonfinite|not finite/);
        }
      }
    });
  }

  it("rejects an invalid opening state before snapshot hooks even when no cycle runs", () => {
    const scenario = fixture();
    scenario.initial = { ...scenario.initial, prestige: { ...scenario.initial.prestige, count: NaN } };
    let snapshots = 0;
    scenario.strategy = { id: "snapshot", decide: () => [], snapshotState: () => { snapshots += 1; return 0; }, restoreState: () => {} };
    expect(() => executeResetCycles({ scenario, policy, maxCycles: 0 })).toThrow(/nonfinite|not finite/);
    expect(snapshots).toBe(0);
  });

  it("rejects nonfinite strategy versions before taking or restoring a snapshot", () => {
    for (const stateVersion of [NaN, Infinity, -Infinity]) {
      const scenario = fixture();
      let hooks = 0;
      scenario.strategy = { id: "versioned", stateVersion, decide: () => [], snapshotState: () => { hooks += 1; return 0; }, restoreState: () => { hooks += 1; } };
      expect(() => executeResetCycles({ scenario, policy, maxCycles: 0 })).toThrow("stateVersion");
      expect(hooks).toBe(0);
    }
  });

  it("validates resumed prestige and strategy versions before all snapshot and restore hooks", () => {
    for (const invalid of ["prestige", "version"] as const) {
      const scenario = fixture();
      let hooks = 0;
      scenario.strategy = { id: "versioned", stateVersion: 1, decide: () => [],
        snapshotState: () => { hooks += 1; return 0; }, restoreState: () => { hooks += 1; } };
      const first = executeResetCycles({ scenario, policy });
      const checkpoint = invalid === "prestige"
        ? { ...first.checkpoint, state: { ...first.checkpoint.state, prestige: { ...first.checkpoint.state.prestige, count: NaN } } }
        : { ...first.checkpoint, strategyStateVersion: Infinity };
      if (invalid === "version") scenario.strategy = { ...scenario.strategy, stateVersion: Infinity };
      hooks = 0;
      const rng = { id: "unused", stateVersion: 1, snapshot: () => { hooks += 1; return 0; }, restore: () => { hooks += 1; } };
      expect(() => executeResetCycles({ scenario, policy, resume: checkpoint, maxCycles: 0 })).toThrow(invalid === "prestige" ? /nonfinite|not finite/ : /stateVersion/);
      expect(hooks).toBe(0);
      expect(() => executeResetCycles({ scenario, policy, resume: checkpoint, maxCycles: 0, rng })).toThrow();
      expect(hooks).toBe(0);
    }
  });

  it("keeps optional and finite strategy versions resumable", () => {
    for (const stateVersion of [undefined, 0, 1]) {
      const scenario = fixture();
      scenario.strategy = { id: "versioned", stateVersion, decide: () => [], snapshotState: () => 0, restoreState: () => {} };
      const first = executeResetCycles({ scenario, policy });
      const resumed = executeResetCycles({ scenario, policy, resume: first.checkpoint });
      expect(validateResetCycleArtifact(resumed.artifact).success).toBe(true);
      expect(resumed.checkpoint.nextIndex).toBe(2);
    }
  });

  it("rejects a new RNG on a checkpoint without its binding before any restore hook", () => {
    const scenario = fixture();
    let strategyHooks = 0;
    scenario.strategy = { id: "paired", stateVersion: 1, decide: () => [],
      snapshotState: () => { strategyHooks += 1; return 0; }, restoreState: () => { strategyHooks += 1; } };
    const first = executeResetCycles({ scenario, policy });
    strategyHooks = 0;
    let restores = 0;
    let snapshots = 0;
    const rng = { id: "rng", stateVersion: 1, snapshot: () => { snapshots += 1; return 0; }, restore: () => { restores += 1; } };
    expect(() => executeResetCycles({ scenario, policy, resume: first.checkpoint, rng })).toThrow("no rngState");
    expect(restores).toBe(0);
    expect(snapshots).toBe(0);
    expect(strategyHooks).toBe(0);
    expect(executeResetCycles({ scenario, policy, resume: first.checkpoint }).checkpoint.nextIndex).toBe(2);
    const bound = executeResetCycles({ scenario, policy, rng });
    expect(executeResetCycles({ scenario, policy, resume: bound.checkpoint, rng }).checkpoint.nextIndex).toBe(2);
    expect(restores).toBe(1);
  });

  it("keeps finite Decimal prestige values outside the Number domain checkpointable", () => {
    const E = createBreakInfinityEngine();
    const base = fixture();
    const zero = E.zero();
    const scenario: CompiledScenario<ReturnType<typeof E.from>, "COIN", Vars> = {
      ctx: { E, unit, tickPolicy: { mode: "drop" }, stepSec: 1 },
      model: { id: "decimal-checkpoint", version: 1, income: () => ({ unit, amount: zero }), actions: () => [] },
      initial: { ...base.initial, wallet: { money: { unit, amount: zero }, bucket: zero }, maxMoneyEver: { unit, amount: zero },
        prestige: { count: 1, points: E.from("1e1000"), multiplier: E.from("1e500") } },
      run: { stepSec: 1, durationSec: 5 },
    };
    const result = executeResetCycles({ scenario, policy, maxCycles: 0 });
    expect(E.toString(result.checkpoint.state.prestige.points)).toBe("1e+1000");
    expect(validateResetCycleArtifact(result.artifact).success).toBe(true);
  });

  it("skips either unpaired state hook and still checks paired or stateless strategies", () => {
    for (const hook of ["snapshotState", "restoreState"] as const) {
      const scenario = fixture();
      let hooks = 0;
      scenario.strategy = { id: "unpaired", decide: () => [], [hook]: () => { hooks += 1; return 0; } };
      const result = checkResetCycleResume(true, scenario, { ...policy, cycles: 2 }, { cycles: 1 });
      expect(result).toMatchObject({ ok: true, applicable: false });
      expect(hooks).toBe(0);
    }
    expect(checkResetCycleResume(true, fixture(), { ...policy, cycles: 2 }, { budgetSteps: 1 })).toMatchObject({ ok: true, applicable: true });
    const paired = fixture();
    paired.strategy = { id: "paired", stateVersion: 1, decide: () => [], snapshotState: () => 0, restoreState: () => {} };
    expect(checkResetCycleResume(true, paired, { ...policy, cycles: 2 }, { cycles: 1 })).toMatchObject({ ok: true, applicable: true });
  });
});

