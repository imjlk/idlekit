import { z } from "zod";
import type { Engine } from "../engine/types";
import type { StandardSchema } from "../scenario/standardSchema";
import { zodStandardSchema } from "../scenario/validate";

/*
 * Helpers shared by the built-in models. Not exported from the package barrel.
 */

const DECIMAL = /^[+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** A non-negative decimal or scientific amount, kept as a string so a big-number engine reads it exactly. */
export const nonNegativeAmount = z
  .string()
  .trim()
  .regex(DECIMAL, "must be a non-negative decimal or scientific amount, for example '12' or '1.5e30'");

/** A positive finite number such as a growth factor. */
export const growthFactor = z.number().finite().min(1);

/** An identifier used in an action id or a vars key. */
export const modelKey = z
  .string()
  .regex(/^[a-z][a-z0-9_-]{0,47}$/, "must start with a lowercase letter and use only a-z, 0-9, '_' or '-'");

export class BuiltinModelRangeError extends RangeError {
  constructor(modelId: string, label: string) {
    super(
      `${modelId} ${label} exceeds the selected engine's finite range. Use a big-number engine such as breakInfinity, or reduce the inputs.`,
    );
    this.name = "BuiltinModelRangeError";
  }
}

export function finiteAmount<N>(E: Engine<N>, value: N, modelId: string, label: string): N {
  if (!E.isFinite(value)) throw new BuiltinModelRangeError(modelId, label);
  return value;
}

/** Parse a validated amount string in the engine. */
export function amountOf<N>(E: Engine<N>, raw: string, modelId: string, label: string): N {
  return finiteAmount(E, E.from(raw), modelId, label);
}

/**
 * 10^exponent in the engine without passing Infinity to `E.from`.
 * A number engine rejects an exponent above its range through `finiteAmount` at the caller.
 */
export function pow10<N>(E: Engine<N>, exponent: number): N {
  if (!Number.isFinite(exponent)) return E.from(exponent > 0 ? "1e400" : "0");
  if (Math.abs(exponent) < 300) return E.from(Math.pow(10, exponent));
  const whole = Math.floor(exponent);
  const mantissa = Math.pow(10, exponent - whole);
  return E.from(`${mantissa}e${whole}`);
}

/** Compute g^n and 1+g+...+g^(n-1) in O(log n), without overflowing a Number first. */
function geometricFactors<N>(E: Engine<N>, growth: number, count: number): { power: N; sum: N } {
  let power = E.from(1);
  let sum = E.zero();
  let blockPower = E.from(growth);
  let blockSum = E.from(1);
  for (let remaining = count; remaining > 0; remaining = Math.floor(remaining / 2)) {
    if (remaining % 2 === 1) {
      sum = E.add(sum, E.mulN(power, blockSum));
      power = E.mulN(power, blockPower);
    }
    if (remaining > 1) {
      blockSum = E.add(blockSum, E.mulN(blockPower, blockSum));
      blockPower = E.mulN(blockPower, blockPower);
    }
  }
  return { power, sum };
}

/** growth^start in the engine. */
export function geometricPower<N>(E: Engine<N>, growth: number, start: number): N {
  if (start <= 0) return E.from(1);
  const direct = Math.pow(growth, start);
  return Number.isFinite(direct) ? E.from(direct) : geometricFactors(E, growth, start).power;
}

/**
 * base * (growth^start + ... + growth^(start+count-1)): the price of `count` purchases after `start` owned.
 * `growth === 1` is the flat price `base * count`.
 */
export function geometricSeries<N>(E: Engine<N>, base: N, growth: number, start: number, count: number): N {
  if (count <= 0) return E.zero();
  if (growth === 1) return E.mul(base, count);
  const sumNumber = (Math.pow(growth, count) - 1) / (growth - 1);
  const sumFactor = Number.isFinite(sumNumber) ? E.from(sumNumber) : geometricFactors(E, growth, count).sum;
  return E.mulN(E.mulN(base, geometricPower(E, growth, start)), sumFactor);
}

/** A non-negative integer count from vars. A missing or malformed value is 0. */
export function countOf(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/** Engine amount from a vars string. A missing value is zero. */
export function stockOf<N>(E: Engine<N>, raw: unknown): N {
  if (typeof raw === "string" && raw.length > 0) return E.from(raw);
  if (typeof raw === "number" && Number.isFinite(raw)) return E.from(raw);
  return E.zero();
}

export function minAmount<N>(E: Engine<N>, a: N, b: N): N {
  return E.cmp(a, b) <= 0 ? a : b;
}

export function maxAmount<N>(E: Engine<N>, a: N, b: N): N {
  return E.cmp(a, b) >= 0 ? a : b;
}

/** Bulk sizes offered by built-in buy actions, clipped to the levels left under a cap. */
export function bulkSizes(remaining: number): number[] {
  return [1, 10, 25, 100].filter((size) => size <= remaining);
}

export type SoftCapSpec = Readonly<{
  kind: "pow" | "sqrt" | "log";
  startsAt: string;
  strength?: number;
}>;

export const softCapSchema = z.object({
  kind: z.enum(["pow", "sqrt", "log"]).default("pow"),
  startsAt: nonNegativeAmount.refine((value) => Number(value) > 0, "softCap.startsAt must be > 0"),
  strength: z.number().finite().positive().max(1).optional(),
});

/**
 * Income above `startsAt` is compressed. Below or at the start, income is unchanged.
 * - pow: S * (x/S)^strength (default strength 0.5)
 * - sqrt: S * (x/S)^0.5
 * - log: S * (1 + strength * ln(x/S)) (default strength 1)
 * The ratio is read in log10 space, so a big-number engine keeps a value beyond the Number range.
 */
export function applySoftCap<N>(E: Engine<N>, raw: N, cap: SoftCapSpec | undefined, startsAt: N | undefined): N {
  if (!cap || startsAt === undefined) return raw;
  if (E.cmp(raw, startsAt) <= 0) return raw;
  const ratioLog10 = E.absLog10(raw) - E.absLog10(startsAt);
  if (cap.kind === "log") {
    const strength = cap.strength ?? 1;
    return E.mul(startsAt, 1 + strength * ratioLog10 * Math.LN10);
  }
  const exponent = cap.kind === "sqrt" ? 0.5 : (cap.strength ?? 0.5);
  return E.mulN(startsAt, pow10(E, exponent * ratioLog10));
}

/** A Standard Schema that reads a missing params or vars object as `{}`, the way `create` does. */
export function optionalObjectSchema<T>(schema: z.ZodType<T>): StandardSchema<T> {
  return zodStandardSchema(z.preprocess((value) => value ?? {}, schema) as unknown as z.ZodType<T>);
}
