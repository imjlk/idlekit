import type { OfflinePolicy } from "../scenario/offlinePolicy";

// Internal. The package barrel does not export this module.

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/** Maps a requested absence to the reward seconds that cap and decay leave. */
export function resolveOfflineSeconds(
  requestedSec: number,
  policy: OfflinePolicy | undefined,
): Readonly<{
  preDecaySec: number;
  effectiveSec: number;
  overflow: "none" | "clamped";
  decayKind: "none" | "linear";
  decayRatio: number;
}> {
  const maxSec = policy?.maxSec;
  const overflowPolicy = policy?.overflowPolicy ?? "clamp";

  let preDecaySec = requestedSec;
  let overflow: "none" | "clamped" = "none";

  if (maxSec !== undefined && requestedSec > maxSec) {
    if (overflowPolicy === "reject") {
      throw new Error(`offline seconds exceed policy maxSec (${maxSec})`);
    }
    preDecaySec = maxSec;
    overflow = "clamped";
  }

  const decayKind = policy?.decay?.kind ?? "none";
  const floorRatio = clamp01(policy?.decay?.floorRatio ?? 0.25);

  let decayRatio = 1;
  if (decayKind === "linear" && maxSec !== undefined && maxSec > 0) {
    const progress = clamp01(preDecaySec / maxSec);
    // 0 sec => ratio 1, maxSec => floorRatio
    decayRatio = floorRatio + (1 - floorRatio) * (1 - progress);
  }

  return {
    preDecaySec,
    effectiveSec: preDecaySec * decayRatio,
    overflow,
    decayKind,
    decayRatio,
  };
}

/**
 * Smallest wall absence in `[0, requestedSec]` whose `resolveOfflineSeconds` effective
 * seconds reach `creditedSec`. The caller passes `creditedSec <= effective(requestedSec)`.
 *
 * No cap, clamp, or reject: effective(r) = min(r, maxSec), so r = creditedSec.
 * Linear decay with maxSec M and floor f: effective(r) = r - a r^2 with a = (1 - f) / M
 * for r <= M, and M f after it. The smaller root is r = 2 s / (1 + sqrt(1 - 4 a s)).
 * That curve peaks at M / (2 (1 - f)), so the smaller root is always on its rising side.
 */
export function offlineAbsenceForCredit(
  creditedSec: number,
  requestedSec: number,
  policy: OfflinePolicy | undefined,
): number {
  if (!(creditedSec > 0)) return 0;
  const maxSec = policy?.maxSec;
  const decayKind = policy?.decay?.kind ?? "none";
  let absence = creditedSec;
  if (decayKind === "linear" && maxSec !== undefined && maxSec > 0) {
    const a = (1 - clamp01(policy?.decay?.floorRatio ?? 0.25)) / maxSec;
    absence = (2 * creditedSec) / (1 + Math.sqrt(Math.max(0, 1 - 4 * a * creditedSec)));
  }
  return Math.min(absence, requestedSec);
}
