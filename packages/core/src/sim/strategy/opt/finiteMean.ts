/** Average finite binary64 values with one final round-to-nearest, ties-to-even. */
export function finiteMean(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError("A mean requires at least one value");
  const bits = new DataView(new ArrayBuffer(8));
  let total = 0n;
  for (const value of values) {
    if (!Number.isFinite(value)) throw new RangeError("A mean requires finite values");
    bits.setFloat64(0, value, false);
    const high = bits.getUint32(0, false);
    const low = bits.getUint32(4, false);
    const exponent = (high >>> 20) & 0x7ff;
    const fraction = (BigInt(high & 0xfffff) << 32n) | BigInt(low);
    const significand = exponent === 0 ? fraction : (1n << 52n) | fraction;
    // Every finite binary64 number is an integer multiple of 2^-1074.
    const units = significand << BigInt(Math.max(0, exponent - 1));
    total += high >>> 31 ? -units : units;
  }
  if (total === 0n) return 0;
  const negative = total < 0n;
  const magnitude = negative ? -total : total;
  const count = BigInt(values.length);
  const integerMean = magnitude / count;
  // Preserve all subnormal bits; normals retain their 53-bit significand.
  const shift = Math.max(0, integerMean.toString(2).length - 53);
  const denominator = count << BigInt(shift);
  let significand = magnitude / denominator;
  const twiceRemainder = 2n * (magnitude % denominator);
  if (twiceRemainder > denominator || (twiceRemainder === denominator && (significand & 1n) !== 0n)) {
    significand++;
  }
  const mean = Number(significand) * 2 ** (shift - 1074);
  return negative ? -mean : mean;
}
