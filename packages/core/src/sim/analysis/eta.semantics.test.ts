import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "bun:test";
import { createBreakInfinityEngine, createNumberEngine } from "../../engine/breakInfinity";
import type { CompiledScenario, Model, SimState } from "../types";
import { evaluateGoal } from "./metrics";
import {
  etaAnalytic,
  etaCensoredObservation,
  etaEngineRatio,
  etaEstimateAlgorithmVersion,
  etaEstimateJsonSchema,
  etaEstimateSchemaId,
  etaExactOrLocal,
  etaGoalForTarget,
  etaSecondsFromEngineRatio,
  etaSimulate,
  parseEtaAmount,
  validateEtaEstimate,
  validateEtaEstimateSemantics,
} from "./eta";

/*
 * PR-09 inventory host. The legacy cases stay in eta.test.ts, whose printf-titled
 * it.each rows are not a static runner registration.
 */

function coinState<N>(amount: N, points: N, multiplier: N): SimState<N, "COIN", { owned: number }> {
  return {
    t: 0,
    wallet: { money: { unit: { code: "COIN" }, amount }, bucket: amount },
    maxMoneyEver: { unit: { code: "COIN" }, amount },
    prestige: { count: 0, points, multiplier },
    vars: { owned: 0 },
  };
}

function modelOf<N>(
  engine: { zero: () => N; from: (input: number | string | N) => N },
  income: N,
  extra: Partial<Model<N, "COIN", { owned: number }>> = {},
): CompiledScenario<N, "COIN", { owned: number }> {
  const unit = { code: "COIN" as const };
  return {
    ctx: { E: engine as CompiledScenario<N, "COIN", { owned: number }>["ctx"]["E"], unit, tickPolicy: { mode: "drop" }, stepSec: 1 },
    model: {
      id: "m",
      version: 1,
      income: () => ({ unit, amount: income }),
      actions: () => [],
      analytic: () => ({ incomeKind: "constant" }),
      ...extra,
    },
    initial: coinState(engine.zero(), engine.zero(), engine.from(1)),
    run: { stepSec: 1, durationSec: 100 },
  };
}

/**
 * @evidence docs/requirements/active/eta-numeric-and-goal-semantics.md#req-pr09-engine-ratio 1e402 divided by 1e400 stays 100, and suffix goals match.
 * @evidenceReview docs/requirements/active/eta-numeric-and-goal-semantics.md#req-pr09-engine-ratio #fe46221 Re-read the section, then checked the engine ratio and the shared suffix goal.
 * @evidence ./eta.ts#etaEngineRatio Reads the engine-ratio contract id.
 * @evidenceReview ./eta.ts#etaEngineRatio #63fad40 The declaration is engine-divn-before-number.
 * @evidence ./eta.ts#validateEtaEstimate Runs the generated estimate validator on the 100 second result.
 * @evidenceReview ./eta.ts#validateEtaEstimate #3725150 The arrow builds typia.createValidate of EtaEstimateV1 on first call and reuses it.
 * @evidence ./eta.ts#etaEstimateJsonSchema Reads the generated OpenAPI 3.1 schema object.
 * @evidenceReview ./eta.ts#etaEstimateJsonSchema #2f0bdab The function memoizes typia.json.schema of EtaEstimateV1.
 * @evidence ./eta.ts#etaSecondsFromEngineRatio Divides 1e402 by 1e400 in the engine and rejects a 1e400 second ratio.
 * @evidenceReview ./eta.ts#etaSecondsFromEngineRatio #ce3e42d The function checks finiteness, divides the gap by the rate with divN, and narrows only a finite ratio within 1e308.
 * @evidence ./eta.ts#etaAnalytic Runs the analytic estimate on the break_infinity fixture and the suffix goal.
 * @evidenceReview ./eta.ts#etaAnalytic #17a1808 The function wraps analyticEstimate and adds a fixed-step compare only when a fallback is requested.
 * @evidence ./eta.ts#etaSimulate Runs the fixed-step estimate on the same fixtures and compares goal ids.
 * @evidenceReview ./eta.ts#etaSimulate #a298152 The function runs the scenario until the shared goal, rejects a budget stop, and censors a missed horizon.
 * @evidence ./eta.ts#etaGoalForTarget Binds the 1aa suffix goal twice and evaluates it at the target.
 * @evidenceReview ./eta.ts#etaGoalForTarget #ed715cb The function parses the target once and returns moneyAtLeast or netWorthAtLeast on its wire string.
 * @evidence ./eta.ts#parseEtaAmount Parses the 1aa suffix with the ETA notation.
 * @evidenceReview ./eta.ts#parseEtaAmount #a8a175b The function calls parseMoney with the scenario unit and the alphaInfinite suffix of minimum length 2.
 * @evidence ./eta.ts#validateEtaEstimateSemantics Accepts the 100 second estimate.
 * @evidenceReview ./eta.ts#validateEtaEstimateSemantics #dd6cd28 The function rejects censored seconds, non-finite ok seconds, a non-ok exact method, a non-ok bracket, and the word unreachable.
 * @evidence ./eta.ts#etaEstimateSchemaId Reads the estimate schema id.
 * @evidenceReview ./eta.ts#etaEstimateSchemaId #f15f511 The function returns the eta.estimate.v1 schema URL constant.
 * @evidence ./eta.ts#etaEstimateAlgorithmVersion Reads the algorithm version stamped on the estimate.
 * @evidenceReview ./eta.ts#etaEstimateAlgorithmVersion #fde593d The function returns the eta-estimate-v1 constant.
 */
export function keepsEngineRatioBeforeNarrowing(): void {
  expect(etaEngineRatio).toBe("engine-divn-before-number");
  const source = readFileSync(join(import.meta.dir, "eta.ts"), "utf8");
  expect(source).toContain("E.divN(E.sub(target, current), rate)");
  expect(source).not.toContain("toNumber(rate)");
  expect(source).not.toContain("toNumber(E.sub");
  const big = createBreakInfinityEngine();
  const ratio = etaSecondsFromEngineRatio(big, big.from("1e402"), big.zero(), big.from("1e400"), true);
  expect(ratio.seconds).toBe(100);
  expect(Number.isFinite(big.toNumber(big.from("1e400")))).toBe(false);
  expect(Number.isFinite(ratio.seconds)).toBe(true);
  const huge = etaSecondsFromEngineRatio(big, big.from("1e400"), big.zero(), big.from(1), true);
  expect(huge.seconds).toBeNull();
  expect(huge.status).toBe("invalid");
  expect(huge.secondsDecimal).toBeDefined();
  expect(Number.isFinite(Number(huge.secondsDecimal))).toBe(false);

  const scenario = modelOf(big, big.from("1e400"));
  const analytic = etaAnalytic({ scenario, target: { kind: "money", value: "1e402" } });
  const simulated = etaSimulate({ scenario, target: { kind: "money", value: "1e402" }, maxDurationSec: 100 });
  expect(analytic.seconds).toBe(100);
  expect(analytic.estimate.seconds).toBe(100);
  expect(validateEtaEstimate(analytic.estimate).success).toBe(true);
  expect(etaEstimateJsonSchema().version).toBe("3.1");
  expect(etaEstimateJsonSchema().schema).toBeDefined();
  expect(Number.isNaN(analytic.seconds)).toBe(false);
  expect(simulated.estimate.goalId).toBe(analytic.estimate.goalId);
  const suffix = modelOf(createNumberEngine(), 1000);
  const goal = etaGoalForTarget(suffix, { kind: "money", value: "1aa" });
  expect(etaGoalForTarget(suffix, { kind: "money", value: "1aa" }).goal.id).toBe(goal.goal.id);
  const atTarget = coinState(1000, 0, 1);
  expect(evaluateGoal(goal.goal, atTarget, suffix.ctx).reached).toBe(true);
  expect(etaAnalytic({ scenario: suffix, target: { kind: "money", value: "1aa" } }).estimate.goalId).toBe("money.atLeast");
  expect(etaSimulate({ scenario: suffix, target: { kind: "money", value: "1aa" }, maxDurationSec: 5 }).estimate.goalId).toBe(
    "money.atLeast",
  );
  expect(validateEtaEstimate(analytic.estimate).success).toBe(true);
  expect(validateEtaEstimateSemantics(analytic.estimate)).toEqual([]);
  expect(validateEtaEstimateSemantics({ ...analytic.estimate, status: "censored" })).toContain(
    "censored estimate carries seconds",
  );
  expect(etaEstimateSchemaId()).toBe("https://idlekit.dev/schemas/eta.estimate.v1.schema.json");
  expect(analytic.estimate.algorithmVersion).toBe(etaEstimateAlgorithmVersion());
  expect(suffix.ctx.E.toString(parseEtaAmount(suffix, "1aa"))).toBe(suffix.ctx.E.toString(goal.threshold));
}

/**
 * @evidence docs/requirements/active/eta-numeric-and-goal-semantics.md#req-pr09-exact-local Purchases and asset net worth are not exact. A requested fallback records both methods.
 * @evidenceReview docs/requirements/active/eta-numeric-and-goal-semantics.md#req-pr09-exact-local #4433726 Re-read the section: constant income alone is not enough when an action or a net-worth value exists.
 * @evidence ./eta.ts#etaExactOrLocal Reads the exact-or-local contract id.
 * @evidenceReview ./eta.ts#etaExactOrLocal #92a4940 The declaration is exact-or-analytic-local.
 */
export function separatesExactAndLocalEta(): void {
  expect(etaExactOrLocal).toBe("exact-or-analytic-local");
  const engine = createNumberEngine();
  const exact = etaAnalytic({
    scenario: modelOf(engine, 1),
    target: { kind: "money", value: "3" },
    fallback: { maxDurationSec: 10 },
  });
  expect(exact.seconds).toBe(3);
  expect(exact.estimate.method).toBe("exact");
  expect(exact.estimate.compare?.localSec).toBe(3);
  expect(exact.estimate.compare?.fixedStepSec).toBe(3);
  expect(exact.estimate.compare?.diffSec).toBe(0);
  expect(exact.estimate.compare?.localMethod).toBe("exact");
  expect(exact.estimate.compare?.fixedStepMethod).toBe("fixed-step");

  const buying = modelOf(engine, 1, {
    actions: () => [
      {
        id: "buy",
        kind: "buy",
        canApply: () => false,
        cost: () => null,
        apply: (_ctx, state) => state,
      },
    ],
  });
  const local = etaAnalytic({ scenario: buying, target: { kind: "money", value: "3" } });
  expect(local.estimate.method).toBe("analytic-local");
  expect(local.estimate.method).not.toBe("exact");
  expect(local.confidence).not.toBe("high");

  const assets = modelOf(engine, 1, {
    netWorth: (_ctx, state) => ({ unit: { code: "COIN" }, amount: state.wallet.money.amount + 50 }),
  });
  const worth = etaAnalytic({ scenario: assets, target: { kind: "netWorth", value: "3" } });
  expect(worth.seconds).toBe(0);
  expect(worth.estimate.status).toBe("ok");
  expect(worth.estimate.seconds).toBe(0);
  expect(worth.estimate.method).not.toBe("exact");
  const ahead = etaAnalytic({ scenario: assets, target: { kind: "netWorth", value: "100" } });
  expect(ahead.estimate.status).toBe("unsupported");
  expect(ahead.estimate.seconds).toBeNull();
  expect(ahead.estimate.method).toBeUndefined();
  expect(ahead.seconds).toBe(50);
  expect(ahead.estimate.assumptions.join(" ")).toContain("unsupported-local");
  expect(JSON.stringify(ahead.estimate)).not.toContain("unreachable");

  const missing = etaAnalytic({
    scenario: modelOf(engine, 1),
    target: { kind: "netWorth", value: "4" },
  });
  expect(missing.estimate.status).toBe("unsupported");
  expect(missing.estimate.seconds).toBeNull();
  expect(missing.seconds).toBe(4);
  expect(missing.estimate.assumptions.join(" ")).toContain("unsupported-local");

  const zero = etaAnalytic({ scenario: modelOf(engine, 0), target: { kind: "money", value: "3" } });
  expect(zero.estimate.status).toBe("unsupported");
  expect(zero.estimate.seconds).toBeNull();
  expect(zero.seconds).toBe(Number.POSITIVE_INFINITY);
  const negative = etaAnalytic({
    scenario: modelOf(engine, -2, { analytic: () => ({ incomeKind: "custom" }) }),
    target: { kind: "money", value: "3" },
  });
  expect(negative.estimate.status).toBe("insufficient-data");
  expect(negative.estimate.seconds).toBeNull();
  const resetting = etaAnalytic({
    scenario: modelOf(engine, 1, {
      prestige: {
        pointsFrom: () => 0,
        multiplierFrom: () => 1,
        resetState: (_ctx, state) => state,
      },
    }),
    target: { kind: "money", value: "3" },
  });
  expect(resetting.estimate.method).toBe("analytic-local");
  expect(resetting.estimate.bracket).toBeUndefined();
  expect(resetting.estimate.assumptions.join(" ")).toContain("non-monotonic");
}

/**
 * @evidence docs/requirements/active/eta-numeric-and-goal-semantics.md#req-pr09-censored-observation Horizon 10 does not reach 999, and a fractional target keeps an observation bracket.
 * @evidenceReview docs/requirements/active/eta-numeric-and-goal-semantics.md#req-pr09-censored-observation #a644d35 Re-read the section: censored seconds are null, legacy seconds stay 10, and the bracket is only on the monotonic case.
 * @evidence ./eta.ts#etaCensoredObservation Reads the censored-observation contract id.
 * @evidenceReview ./eta.ts#etaCensoredObservation #21be743 The declaration is censored-fixed-step.
 */
export function censorsUnreachedHorizon(): void {
  expect(etaCensoredObservation).toBe("censored-fixed-step");
  const engine = createNumberEngine();
  const scenario = modelOf(engine, 1);
  const already = {
    ...scenario,
    initial: coinState(3, 0, 1),
  };
  expect(etaAnalytic({ scenario: already, target: { kind: "money", value: "3" } }).seconds).toBe(0);
  expect(etaSimulate({ scenario: already, target: { kind: "money", value: "3" }, maxDurationSec: 10 }).seconds).toBe(0);

  const missed = etaSimulate({ scenario, target: { kind: "money", value: "999" }, maxDurationSec: 10 });
  expect(missed.reached).toBe(false);
  expect(missed.seconds).toBe(10);
  expect(missed.estimate.status).toBe("censored");
  expect(missed.estimate.seconds).toBeNull();
  expect(missed.estimate.horizonSec).toBe(10);
  expect(missed.estimate.observationResolutionSec).toBe(1);
  expect(JSON.stringify(missed.estimate)).not.toContain("unreachable");
  expect(validateEtaEstimateSemantics(missed.estimate)).toEqual([]);

  const fractional = etaSimulate({ scenario, target: { kind: "money", value: "2.5" }, maxDurationSec: 10 });
  expect(fractional.seconds).toBe(3);
  expect(fractional.estimate.method).toBe("fixed-step");
  expect(fractional.estimate.bracket).toEqual({ lowerSec: 2.5, upperSec: 3 });
  const hidden = etaSimulate({
    scenario: modelOf(engine, 1, {
      prestige: {
        pointsFrom: () => 0,
        multiplierFrom: () => 1,
        resetState: (_ctx, state) => state,
      },
    }),
    target: { kind: "money", value: "3" },
    maxDurationSec: 10,
  });
  expect(hidden.seconds).toBe(3);
  expect(hidden.estimate.bracket).toBeUndefined();
  expect(hidden.estimate.observationResolutionSec).toBe(1);
  expect(hidden.estimate.assumptions.join(" ")).toContain("hidden crossing");
}

describe("PR-09 eta semantics", () => {
  it("keeps engine ratios finite before narrowing seconds", keepsEngineRatioBeforeNarrowing);
  it("labels exact and local eta separately", separatesExactAndLocalEta);
  it("censors an unreached horizon without calling it unreachable", censorsUnreachedHorizon);
});
