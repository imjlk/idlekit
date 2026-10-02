import type { Engine } from "../engine/types";

/**
 * Cross-engine amount comparison for conformance tests.
 * The money package keeps the same refusal rule in its own testkit copy.
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

/** `cmp` returns 0 inside epsilon, so `0` and `1e-13` must not share a sign. */
function exactSign(text: string): -1 | 0 | 1 {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?(?:e[+-]?\d+)?$/i.exec(text.trim());
  if (!match) return text.trim().startsWith("-") ? -1 : 1;
  const digits = `${match[2] ?? ""}${match[3] ?? ""}`;
  if (/^0+$/.test(digits)) return 0;
  return match[1] === "-" ? -1 : 1;
}

/**
 * @evidence docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness Compares engine amounts and refuses equal non-finite number collapse.
 * @evidenceReview docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness #a195f0e Re-read the section and this function: a non-finite toNumber or engine value returns refused-number-collapse instead of an equal match.
 */
export function compareAmounts<A, B>(
  left: AmountSide<A>,
  right: AmountSide<B>,
  logTolerance = DEFAULT_LOG_TOLERANCE,
): AmountComparison {
  if (!Number.isFinite(logTolerance) || logTolerance < 0) {
    throw new Error("logTolerance must be a finite non-negative number");
  }
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

  const leftSign = exactSign(leftText);
  const rightSign = exactSign(rightText);
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
