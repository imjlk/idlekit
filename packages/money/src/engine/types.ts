export interface Engine<N> {
  zero(): N;
  from(input: number | string | N): N;

  add(a: N, b: N): N;
  sub(a: N, b: N): N;

  mul(a: N, k: number): N;
  div(a: N, k: number): N;

  mulN(a: N, b: N): N;
  divN(a: N, b: N): N;

  cmp(a: N, b: N): -1 | 0 | 1;

  absLog10(a: N): number;
  isFinite(a: N): boolean;

  toString(a: N): string;
  toNumber(a: N): number;
}
