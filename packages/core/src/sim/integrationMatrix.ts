/**
 * Hand answers for the integration matrix.
 * These formulas do not call the simulator. A matching run is checked separately.
 * `breakEternity` is unsupported. Optional tracks stay out of the default path.
 */

/**
 * @evidence docs/requirements/active/analysis-integration-release-gates.md#req-pr20-integration-matrix The selected release includes the optional tracks without making them the default.
 * @evidenceReview docs/requirements/active/analysis-integration-release-gates.md#req-pr20-integration-matrix #84f17c2 Re-read the section: flow, guarded advance, Jev, and workers are shipped as optional capabilities, and their tests still run in the publish preflight.
 */
export const integrationReleaseScope = "selected-optional-tracks" as const;

/**
 * @evidence docs/requirements/active/analysis-integration-release-gates.md#req-pr20-integration-matrix breakEternity is not a supported engine in this release.
 * @evidenceReview docs/requirements/active/analysis-integration-release-gates.md#req-pr20-integration-matrix #84f17c2 Re-read the section: the placeholder engine is not advertised as ready.
 */
export const integrationUnsupportedEngine = "breakEternity" as const;

/**
 * @evidence docs/requirements/active/analysis-integration-release-gates.md#req-pr20-integration-matrix Constant income uses integer seconds, not a stored simulator snapshot.
 * @evidenceReview docs/requirements/active/analysis-integration-release-gates.md#req-pr20-integration-matrix #84f17c2 Re-read the section: end money is initial plus income per second times duration.
 */
export const integrationHandAnswer = "integer-income-times-duration" as const;

const INTEGER = /^-?\d+$/;

function integer(value: string, label: string): bigint {
  if (!INTEGER.test(value)) throw new Error(`${label} must be an integer string`);
  return BigInt(value);
}

function assertStep(stepSec: number): void {
  if (!Number.isInteger(stepSec) || stepSec <= 0) throw new Error("stepSec must be an integer > 0");
}

/**
 * End wallet for constant per-second income.
 * A duration off the step grid ends on a shorter final tick, as `runScenario` does, so the
 * ticks still cover every second and the answer is income times the whole duration.
 */
export function expectedLinearEnd(args: {
  initial: string;
  incomePerSec: string;
  stepSec: number;
  durationSec: number;
}): string {
  assertStep(args.stepSec);
  if (!Number.isInteger(args.durationSec) || args.durationSec < 0) throw new Error("durationSec must be an integer >= 0");
  const gained = integer(args.incomePerSec, "incomePerSec") * BigInt(args.durationSec);
  return (integer(args.initial, "initial") + gained).toString();
}

/** End wallet when `maxSteps` stops the run before the requested duration. */
export function expectedBudgetEnd(args: {
  initial: string;
  incomePerSec: string;
  stepSec: number;
  maxSteps: number;
}): string {
  assertStep(args.stepSec);
  if (!Number.isInteger(args.maxSteps) || args.maxSteps < 0) throw new Error("maxSteps must be an integer >= 0");
  // Even individually exact Number operands can have an inexact product. Keep the hand answer in integer arithmetic.
  const gained = integer(args.incomePerSec, "incomePerSec") * BigInt(args.stepSec) * BigInt(args.maxSteps);
  return (integer(args.initial, "initial") + gained).toString();
}

/** Wallet after one quoted bulk payment. The quote total is not `unitCost * size`. */
export function expectedQuotedWallet(start: string, quoteCost: string): string {
  return (integer(start, "start") - integer(quoteCost, "quoteCost")).toString();
}

/**
 * Declared prestige gain and the wallet the reset leaves behind.
 * The carry wallet must differ from the pre-reset wallet.
 */
export function expectedResetCarry(args: {
  gain: string;
  carryWallet: string;
  initialWallet: string;
}): { rewardDelta: string; wallet: string } {
  const gain = integer(args.gain, "gain");
  const carry = integer(args.carryWallet, "carryWallet");
  // Compared as numbers: "01" and "1", or "-0" and "0", are the same wallet.
  if (carry === integer(args.initialWallet, "initialWallet")) throw new Error("carry wallet must differ from the pre-reset wallet");
  return { rewardDelta: gain.toString(), wallet: carry.toString() };
}
