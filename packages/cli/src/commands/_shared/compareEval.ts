export function formatEtaLabel(seconds: number, reached: boolean): string {
  if (!reached) return "unreached";
  return Number.isFinite(seconds) ? `${seconds}` : "unreached";
}

export function etaPenalty(maxDuration: number): number {
  return maxDuration + 1_000_000_000;
}

export function betterFromCmp(cmp: -1 | 0 | 1): "a" | "b" | "tie" {
  if (cmp === 0) return "tie";
  return cmp > 0 ? "a" : "b";
}

export function toComparableEta(seconds: number | undefined, maxDuration: number): number | undefined {
  if (seconds === undefined) return undefined;
  return Number.isFinite(seconds) ? seconds : etaPenalty(maxDuration);
}
