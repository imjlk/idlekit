import { hashContent, stableStringify } from "../../io/outputMeta";

/**
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-cache-identity An alias entry expires after one day.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-cache-identity #467d10f Re-read the updated section: echoed and concrete alias responses use the same 24-hour TTL.
 */
export const JEV_ALIAS_TTL_MS = 24 * 60 * 60 * 1000;

export type JevCacheEntry = Readonly<{
  key: string;
  requestedModel: string;
  resolvedModel: string;
  rubricVersion: string;
  storedAtMs: number;
  advisoryJson: string;
}>;

/**
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-cache-identity The cache key binds the projection, the rubric, and the requested model.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-cache-identity #467d10f Re-read the updated section: a different rubric or requested model misses.
 */
export function jevCacheKey(parts: Readonly<{
  projection: unknown;
  numericalDigest: string;
  rubricVersion: string;
  requestedModel: string;
  adapterVersion: string;
}>): string {
  return hashContent({
    adapterVersion: parts.adapterVersion,
    numericalDigest: parts.numericalDigest,
    projection: parts.projection,
    requestedModel: parts.requestedModel,
    rubricVersion: parts.rubricVersion,
    schemaVersion: 1,
  });
}

/**
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-cache-identity An alias is revalidated after one day. A pinned id must match the stored model.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-cache-identity #467d10f Re-read the updated section: an echoed alias is accepted within the TTL, another alias is refused, and jev-latest is not a permanent response.
 */
export function jevCacheHit(
  entry: JevCacheEntry | undefined,
  requestedModel: string,
  nowMs: number,
): entry is JevCacheEntry {
  if (!entry) return false;
  const alias = requestedModel === "jev-latest" || requestedModel.endsWith("-latest");
  if (alias) {
    // The API may echo the requested alias; another alias does not identify this request.
    if (entry.resolvedModel !== requestedModel && entry.resolvedModel.endsWith("-latest")) return false;
    // A stored time in the future is not fresh: the age must be known and inside the TTL.
    const age = nowMs - entry.storedAtMs;
    return age >= 0 && age < JEV_ALIAS_TTL_MS;
  }
  return entry.resolvedModel === requestedModel;
}

/**
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-secret-boundary The cache file is a digest record, not a copy of the request key.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-secret-boundary #6f1c48d Re-read the section after the per-rule pinned metricVersion wording: the stored JSON is the advisory, not the API key.
 */
export function serializeJevCache(entries: readonly JevCacheEntry[]): string {
  return `${stableStringify({ entries })}\n`;
}

/**
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-cache-identity A cache file is read back only as stored entries.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-cache-identity #467d10f Re-read the updated section: missing fields are dropped and an absent entry is a miss.
 */
export function parseJevCache(text: string): JevCacheEntry[] {
  const parsed = JSON.parse(text) as { entries?: unknown[] };
  if (!parsed || !Array.isArray(parsed.entries)) return [];
  // Every field is checked, so a corrupt entry is dropped as a miss instead of failing a later lookup.
  return parsed.entries.filter((entry): entry is JevCacheEntry => {
    if (!entry || typeof entry !== "object") return false;
    const record = entry as Record<string, unknown>;
    return (
      typeof record.key === "string" &&
      typeof record.requestedModel === "string" &&
      typeof record.resolvedModel === "string" &&
      typeof record.rubricVersion === "string" &&
      typeof record.storedAtMs === "number" &&
      Number.isFinite(record.storedAtMs) &&
      typeof record.advisoryJson === "string"
    );
  });
}
