import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { pathToFileURL } from "url";
import { type Decimal, createBreakInfinityEngine, createNumberEngine } from "../../engine/breakInfinity";
import type { Engine } from "../../engine/types";
import type { SimContext, SimState } from "../types";
import {
  defineGoal,
  evaluateGoalForCheck,
  evaluateGoalForEta,
  evaluateGoalForExperiment,
  moneyAtLeast,
  netWorthAtLeast,
  prestigePointsAtLeast,
} from "./metrics";

function fixture<N>(E: Engine<N>, amount: N): { ctx: SimContext<N, "COIN", {}>; state: SimState<N, "COIN", {}> } {
  const unit = { code: "COIN" as const };
  return {
    ctx: { E, unit, tickPolicy: { mode: "drop" } },
    state: {
      t: 0,
      wallet: { money: { unit, amount }, bucket: E.zero() },
      maxMoneyEver: { unit, amount },
      prestige: { count: 0, points: amount, multiplier: E.from(1) },
      vars: {},
    },
  };
}

function rejectsNonfiniteInputs<N>(E: Engine<N>, makeInvalid = (token: string): N => E.from(token)): void {
  for (const token of ["NaN", "Infinity", "-Infinity"]) {
    const invalid = fixture(E, makeInvalid(token));
    const valid = fixture(E, E.from(5));
    for (const [target, current] of [["3", invalid], [token, valid]] as const) {
      const goals = [
        moneyAtLeast<N, "COIN", {}>(target),
        netWorthAtLeast<N, "COIN", {}>({ target, netWorth: (state) => state.wallet.money.amount }),
        prestigePointsAtLeast<N, "COIN", {}>(target),
      ];
      for (const goal of goals) {
        expect(goal.met(current.state, current.ctx)).not.toBe(true);
        for (const evaluate of [evaluateGoalForEta, evaluateGoalForExperiment, evaluateGoalForCheck]) {
          const result = evaluate(goal, current.state, current.ctx);
          expect(result.status).toBe("invalid");
          expect(result.reached).toBeUndefined();
          expect(result.method).toBeUndefined();
        }
      }
    }
  }
}

describe("shared goal input validity", () => {
  it("rejects nonfinite amounts and targets with the number engine", () => {
    rejectsNonfiniteInputs(createNumberEngine());
  });

  it("rejects nonfinite amounts and targets with the decimal engine", () => {
    const E = createBreakInfinityEngine();
    rejectsNonfiniteInputs(E, (token) => token === "NaN"
      ? E.from(token)
      : E.from(1).fromMantissaExponent_noNormalize(token.startsWith("-") ? -1 : 1, Number.POSITIVE_INFINITY));
  });

  it("keeps absent net worth unsupported and validates a requested wallet fallback", () => {
    const E = createNumberEngine();
    const current = fixture(E, Number.NaN);
    const absent = netWorthAtLeast<number, "COIN", {}>({ target: "3", netWorth: () => undefined });
    expect(evaluateGoalForCheck(absent, current.state, current.ctx).status).toBe("unsupported");
    const fallback = netWorthAtLeast<number, "COIN", {}>({ target: "3", netWorth: () => undefined, fallbackToWallet: true });
    const result = evaluateGoalForCheck(fallback, current.state, current.ctx);
    expect(result.status).toBe("invalid");
    expect(result.reached).toBeUndefined();
    expect(result.method).toBeUndefined();
  });

  it("preserves finite negative, zero, and large decimal comparisons", () => {
    const E = createBreakInfinityEngine();
    for (const [amount, target, reached] of [["-1", "0", false], ["0", "0", true], ["1e400", "1e400", true], ["1e400", "1e401", false], ["1e9000000000000000", "1e9000000000000000", true]] as const) {
      const current = fixture(E, E.from(amount));
      const result = evaluateGoalForCheck(moneyAtLeast<Decimal, "COIN", {}>(target), current.state, current.ctx);
      expect(result.status).toBe("ok");
      expect(result.reached).toBe(reached);
      expect(result.method).toBe("exact");
    }
  });

  it("keeps custom met predicates without an observation hook", () => {
    const current = fixture(createNumberEngine(), 0);
    const goal = defineGoal<number, "COIN", {}>({
      id: "custom.never", version: 1, observation: "custom", timeResolution: "step", met: () => false,
    });
    const result = evaluateGoalForCheck(goal, current.state, current.ctx);
    expect(result.status).toBe("ok");
    expect(result.reached).toBe(false);
    expect(result.method).toBe("exact");
  });

  it("reads present net worth once per adapter evaluation", () => {
    const current = fixture(createNumberEngine(), 5);
    let reads = 0;
    const goal = netWorthAtLeast<number, "COIN", {}>({
      target: "3",
      netWorth: (state) => { reads++; return state.wallet.money.amount; },
    });
    for (const evaluate of [evaluateGoalForEta, evaluateGoalForExperiment, evaluateGoalForCheck]) {
      reads = 0;
      expect(evaluate(goal, current.state, current.ctx).reached).toBe(true);
      expect(reads).toBe(1);
    }
  });

  it("honors a met override on a copied built-in goal", () => {
    const current = fixture(createNumberEngine(), 5);
    const goal = { ...moneyAtLeast<number, "COIN", {}>("3"), met: () => false };
    expect(evaluateGoalForCheck(goal, current.state, current.ctx).reached).toBe(false);
  });

  it("preserves invalid status across independently loaded module copies", async () => {
    const contractsUrl = pathToFileURL(join(import.meta.dir, "contracts.ts")).href;
    const source = readFileSync(join(import.meta.dir, "metrics.ts"), "utf8").replace('"./contracts"', JSON.stringify(contractsUrl));
    // This module has no compiler macros. Strip its types and load a separate JS
    // module, so the identity check does not start ttsc for a temporary TS file
    // outside the project while the ordinary assertion deadline is ticking.
    const javascript = new Bun.Transpiler({ loader: "ts" }).transformSync(source);
    const copy = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`) as typeof import("./metrics");
    expect(copy.moneyAtLeast).not.toBe(moneyAtLeast);
    const current = fixture(createNumberEngine(), Number.NaN);
    const goal = copy.moneyAtLeast<number, "COIN", {}>("3");
    const result = evaluateGoalForCheck(goal, current.state, current.ctx);
    expect(result.status).toBe("invalid");
    expect(result.reached).toBeUndefined();
    expect(result.method).toBeUndefined();
  });
});
