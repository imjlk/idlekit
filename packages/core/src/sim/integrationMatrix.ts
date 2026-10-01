/**
 * Hand answers for the integration matrix.
 * These formulas do not call the simulator. A matching run is checked separately.
 * `breakEternity` is unsupported. Optional tracks stay out of the default path.
 */

/**
 * @evidence docs/requirements/active/analysis-integration-release-gates.md#req-pr20-integration-matrix The selected release includes the optional tracks without making them the default.
 * @evidenceReview docs/requirements/active/analysis-integration-release-gates.md#req-pr20-integration-matrix #12c99a1 Re-read the section: flow, guarded advance, Jev, and workers are shipped as optional capabilities.
 */
export const integrationReleaseScope = "selected-optional-tracks" as const;

/**
 * @evidence docs/requirements/active/analysis-integration-release-gates.md#req-pr20-integration-matrix breakEternity is not a supported engine in this release.
 * @evidenceReview docs/requirements/active/analysis-integration-release-gates.md#req-pr20-integration-matrix #12c99a1 Re-read the section: the placeholder engine is not advertised as ready.
 */
export const integrationUnsupportedEngine = "breakEternity" as const;

/**
 * @evidence docs/requirements/active/analysis-integration-release-gates.md#req-pr20-integration-matrix Constant income uses integer seconds, not a stored simulator snapshot.
 * @evidenceReview docs/requirements/active/analysis-integration-release-gates.md#req-pr20-integration-matrix #12c99a1 Re-read the section: end money is initial plus income per second times duration.
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

/** End wallet for constant per-second income. `durationSec` must divide by `stepSec`. */
export function expectedLinearEnd(args: {
  initial: string;
  incomePerSec: string;
  stepSec: number;
  durationSec: number;
}): string {
  assertStep(args.stepSec);
  if (!Number.isInteger(args.durationSec) || args.durationSec < 0) throw new Error("durationSec must be an integer >= 0");
  if (args.durationSec % args.stepSec !== 0) throw new Error("durationSec must be a multiple of stepSec");
  const steps = BigInt(args.durationSec / args.stepSec);
  const gained = integer(args.incomePerSec, "incomePerSec") * BigInt(args.stepSec) * steps;
  return (integer(args.initial, "initial") + gained).toString();
}

/** End wallet when `maxSteps` stops the run before the requested duration. */
export function expectedBudgetEnd(args: {
  initial: string;
  incomePerSec: string;
  stepSec: number;
  maxSteps: number;
}): string {
  if (!Number.isInteger(args.maxSteps) || args.maxSteps < 0) throw new Error("maxSteps must be an integer >= 0");
  return expectedLinearEnd({
    initial: args.initial,
    incomePerSec: args.incomePerSec,
    stepSec: args.stepSec,
    durationSec: args.stepSec * args.maxSteps,
  });
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
  integer(args.gain, "gain");
  integer(args.carryWallet, "carryWallet");
  integer(args.initialWallet, "initialWallet");
  if (args.carryWallet === args.initialWallet) throw new Error("carry wallet must differ from the pre-reset wallet");
  return { rewardDelta: args.gain, wallet: args.carryWallet };
}
