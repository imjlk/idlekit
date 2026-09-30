import type { Engine } from "../engine/types";

/**
 * Cross-engine amount comparison for conformance tests.
 * Core keeps the same refusal rule in `packages/core/src/testkit/compareAmounts.ts`.
 * Equal non-finite `toNumber` results are not a match.
 */
export type AmountSide<N> = {
  readonly engineId: string;
  readonly engine: Engine<N>;
  readonly amount: N;
};

export type AmountComparison = {
  readonly status: "equal" | "different" | "refused-number-collapse";
  readonly left: string;
  readonly right: string;
  readonly detail: string;
};

const DEFAULT_LOG_TOLERANCE = 1e-9;

export function compareAmounts<A, B>(
  left: AmountSide<A>,
  right: AmountSide<B>,
  logTolerance = DEFAULT_LOG_TOLERANCE,
): AmountComparison {
  const leftText = left.engine.toString(left.amount);
  const rightText = right.engine.toString(right.amount);
  const leftFiniteAmount = left.engine.isFinite(left.amount);
  const rightFiniteAmount = right.engine.isFinite(right.amount);
  const leftNumber = left.engine.toNumber(left.amount);
  const rightNumber = right.engine.toNumber(right.amount);
  if (
    !leftFiniteAmount ||
    !rightFiniteAmount ||
    !Number.isFinite(leftNumber) ||
    !Number.isFinite(rightNumber)
  ) {
    return {
      status: "refused-number-collapse",
      left: leftText,
      right: rightText,
      detail: "toNumber or engine finiteness is not finite, so Infinity collapse is not an amount match",
    };
  }

  const leftSign = left.engine.cmp(left.amount, left.engine.zero());
  const rightSign = right.engine.cmp(right.amount, right.engine.zero());
  if (leftSign !== rightSign) {
    return {
      status: "different",
      left: leftText,
      right: rightText,
      detail: `signs ${leftSign} and ${rightSign}`,
    };
  }
  if (leftSign === 0) {
    return { status: "equal", left: leftText, right: rightText, detail: "both zero" };
  }

  const leftLog = left.engine.absLog10(left.amount);
  const rightLog = right.engine.absLog10(right.amount);
  if (!Number.isFinite(leftLog) || !Number.isFinite(rightLog)) {
    return {
      status: "refused-number-collapse",
      left: leftText,
      right: rightText,
      detail: "absLog10 was not finite for a finite amount",
    };
  }

  const delta = Math.abs(leftLog - rightLog);
  const status = delta <= logTolerance ? "equal" : "different";
  return {
    status,
    left: leftText,
    right: rightText,
    detail: `absLog10 delta ${delta}`,
  };
}
