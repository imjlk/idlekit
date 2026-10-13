import { describe, expect, it } from "bun:test";
import { createNumberEngine } from "../../engine/breakInfinity";
import { assertScenarioPlanInputs } from "../../scenario/compile";
import type { ScenarioV1 } from "../../scenario/types";
import { applyOfflineSeconds } from "../offline";
import { runScenario } from "../simulator";
import { applyDecisions } from "../step";
import type { Action, CompiledScenario } from "../types";

const unit = { code: "COIN" as const };

function fixture() {
  const reset: Action<number, "COIN", {}> = {
    id: "reset", kind: "prestige", canApply: () => true, cost: () => null,
    apply: (_ctx, state) => ({ ...state, prestige: { ...state.prestige, count: state.prestige.count + 1 } }),
  };
  const scenario: CompiledScenario<number, "COIN", {}> = {
    ctx: { E: createNumberEngine({ epsilon: 0 }), unit, tickPolicy: { mode: "drop" }, stepSec: 1,
      clocks: { wallT: 100, wallEndT: 102, rewardT: 0, activeT: 0 } },
    model: { id: "clock-boundary", version: 1, clocks: { respondsTo: ["wall"] },
      income: () => ({ unit, amount: 1 }), actions: () => [reset] },
    initial: { t: 0, wallet: { money: { unit, amount: 0 }, bucket: 0 }, maxMoneyEver: { unit, amount: 0 },
      prestige: { count: 0, points: 0, multiplier: 1 }, vars: {} },
    strategy: { id: "reset-each-tick", decide: () => [{ action: reset }] },
    run: { stepSec: 1, durationSec: 5 },
  };
  return { ...scenario };
}

function plan(initialT: number, clock: ScenarioV1["clock"]): ScenarioV1 {
  return { schemaVersion: 1, unit, policy: { mode: "drop" }, model: { id: "unused", version: 1 },
    initial: { t: initialT, wallet: { unit: "COIN", amount: "0" } }, clock };
}

describe("simulation time boundary consistency", () => {
  it("caps explicit reset wall time at the segment end on the shared action path", () => {
    for (const [wallT, expected] of [[101, 101], [105, 102]] as const) {
      const scenario = fixture();
      const action = scenario.model.actions(scenario.ctx, scenario.initial)[0]!;
      const result = applyDecisions({ ctx: scenario.ctx, model: scenario.model, state: scenario.initial,
        decisions: [{ action }], wallT });
      expect(result.committedResets[0]?.wallT).toBe(expected);
    }
    for (const clocks of [undefined, { wallT: 100, wallEndT: Infinity, rewardT: 0, activeT: 0 }]) {
      const scenario = fixture();
      const ctx = { ...scenario.ctx, clocks };
      const action = scenario.model.actions(ctx, scenario.initial)[0]!;
      expect(applyDecisions({ ctx, model: scenario.model, state: scenario.initial,
        decisions: [{ action }], wallT: 105 }).committedResets[0]?.wallT).toBe(105);
    }
  });

  for (const mode of ["online", "offline"] as const) {
    it(`keeps ${mode} reset observations within the wall segment`, () => {
      const scenario = fixture();
      const walls: (number | null)[] = [];
      scenario.run = { ...scenario.run, observer: { onReset: (reset) => { walls.push(reset.wallT); } } };
      if (mode === "online") runScenario(scenario);
      else applyOfflineSeconds({ scenario, seconds: 5, options: { actions: { mode: "allow", categories: ["prestige"] } } });
      expect(walls).toEqual([100, 101, 102, 102, 102]);
    });
  }

  it("accepts a duration already reached by the runner epsilon before any tick", () => {
    const raw = plan(100, { stepSec: 1, durationSec: 1e-16 });
    expect(() => assertScenarioPlanInputs({ scenario: raw, E: createNumberEngine(), stepSecs: [1, 0.5] })).not.toThrow();
    const scenario = fixture();
    scenario.initial = { ...scenario.initial, t: 100 };
    scenario.run = { stepSec: 1, durationSec: 1e-16 };
    expect(runScenario(scenario).stop).toMatchObject({ reason: "duration", steps: 0 });
  });

  it("accepts an already true safe until expression before a nonadvancing tick", () => {
    const raw = plan(1e20, { stepSec: 1, untilExpr: "t >= 1" });
    expect(() => assertScenarioPlanInputs({ scenario: raw, E: createNumberEngine(), stepSecs: [1, 0.5] })).not.toThrow();
    const scenario = fixture();
    scenario.initial = { ...scenario.initial, t: 1e20 };
    scenario.run = { stepSec: 1, until: (state) => state.t >= 1 };
    expect(runScenario(scenario).stop).toMatchObject({ reason: "until", steps: 0 });
  });

  it("uses the compiled initial economy when checking an already true until expression", () => {
    for (const untilExpr of ["money >= 10", "prestige.points >= 2", "vars.goal >= 1"]) {
      const raw: ScenarioV1 = { ...plan(1e20, { stepSec: 1, untilExpr }),
        initial: { t: 1e20, wallet: { unit: "COIN", amount: "10" },
          prestige: { points: "2" }, vars: { goal: 1 } } };
      expect(() => assertScenarioPlanInputs({ scenario: raw, E: createNumberEngine() })).not.toThrow();
    }
  });

  it("preserves the explicit absence clock when offline credit is decayed", () => {
    for (const [wallEndT, expectedSecond] of [[102, 101.09611796797792], [101.05, 101.05]] as const) {
      const scenario = fixture();
      scenario.ctx = { ...scenario.ctx, clocks: { wallT: 100, wallEndT, rewardT: 0, activeT: 0 } };
      const walls: (number | null)[] = [];
      scenario.run = { ...scenario.run, observer: { onReset: (reset) => { walls.push(reset.wallT); } } };
      applyOfflineSeconds({ scenario, seconds: 10, options: {
        policy: { maxSec: 10, decay: { kind: "linear", floorRatio: 0.2 } },
        actions: { mode: "allow", categories: ["prestige"] },
      } });
      expect(walls).toHaveLength(2);
      expect(walls[0]).toBe(100);
      expect(walls[1]).toBeCloseTo(expectedSecond, 10);
    }
  });

  it("validates initial money and finite clocks even for a zero-tick stop", () => {
    const E = createNumberEngine();
    for (const t of [NaN, Infinity, -Infinity]) {
      expect(() => assertScenarioPlanInputs({ scenario: plan(t, { stepSec: 1, durationSec: 0 }), E })).toThrow("state.t");
    }
    for (const durationSec of [NaN, Infinity, -Infinity]) {
      expect(() => assertScenarioPlanInputs({ scenario: plan(0, { stepSec: 1, durationSec }), E })).toThrow("durationSec");
    }
    const raw = plan(0, { stepSec: 1, durationSec: 0 });
    expect(() => assertScenarioPlanInputs({ scenario: { ...raw,
      initial: { ...raw.initial, wallet: { unit: "COIN", amount: "invalid" } } }, E })).toThrow();
  });

  it("rejects a finite first tick whose timestamp addition overflows", () => {
    const raw = plan(1e308, { stepSec: 1e308, durationSec: 1e308 });
    expect(() => assertScenarioPlanInputs({ scenario: raw, E: createNumberEngine() })).toThrow("state.t must be a finite number");
    const scenario = fixture();
    scenario.initial = { ...scenario.initial, t: 1e308 };
    scenario.run = { stepSec: 1e308, durationSec: 1e308 };
    expect(() => runScenario(scenario)).toThrow("state.t must be a finite number");
  });

  it("still rejects invalid clocks, unsafe until syntax, and an actual nonadvancing first tick", () => {
    const E = createNumberEngine();
    for (const stepSec of [0, Infinity, NaN]) {
      expect(() => assertScenarioPlanInputs({ scenario: plan(1e20, { stepSec, untilExpr: "t >= 1" }), E })).toThrow("stepSec");
    }
    expect(() => assertScenarioPlanInputs({ scenario: plan(1e20, { stepSec: 1, untilExpr: "t > 1e21" }), E })).toThrow("did not advance");
    expect(() => assertScenarioPlanInputs({ scenario: plan(100, { stepSec: 1, durationSec: 0, untilExpr: "evil()" }), E })).toThrow("Invalid untilExpr");
    expect(() => assertScenarioPlanInputs({ scenario: plan(1e20, { stepSec: 1, durationSec: 0 }), E })).not.toThrow();
  });
});
