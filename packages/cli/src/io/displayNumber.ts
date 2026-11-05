/**
 * Display policy for decimal values in human-facing output (`--format md`).
 *
 * The number engine serializes amounts with `String(n)`, the shortest text that
 * round-trips to the same IEEE-754 double. That is why JSON shows values such as
 * `"81276.59999999998"`: it is the exact value the run produced, not a
 * formatting bug. JSON, CSV, replay artifacts, and saved state keep that
 * lossless text because resume, replay verification, and hashes depend on it.
 *
 * Markdown is read by people, so it rounds plain decimal values to
 * {@link DISPLAY_SIGNIFICANT_DIGITS} significant digits and drops trailing zeros.
 * Integers, exponent or engine-specific text (for example break_infinity
 * `"1.5e300"`), and non-numeric strings are left unchanged.
 */
export const DISPLAY_SIGNIFICANT_DIGITS = 12;

const PLAIN_DECIMAL = /^-?\d+\.\d+$/;

function roundNumber(value: number): number {
  if (!Number.isFinite(value) || Number.isInteger(value)) return value;
  return Number(value.toPrecision(DISPLAY_SIGNIFICANT_DIGITS));
}

/** Round one scalar for display. Anything that is not a plain finite decimal is returned as is. */
export function displayDecimal(value: unknown): unknown {
  if (typeof value === "number") return roundNumber(value);
  if (typeof value !== "string" || !PLAIN_DECIMAL.test(value)) return value;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  // Keep the authored text when rounding would not change it (no float residue).
  const rounded = roundNumber(parsed);
  return rounded === parsed ? value : String(rounded);
}

/** Apply {@link displayDecimal} to every scalar in a JSON-like value. */
export function displayDecimals(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(displayDecimals);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, displayDecimals(item)]));
  }
  return displayDecimal(value);
}
