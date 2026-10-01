import { hashContent, stableStringify } from "../../io/outputMeta";

/**
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-cache-identity An alias entry expires after one day.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-cache-identity #c388239 Re-read the section: the TTL is 24 hours.
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
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-cache-identity #c388239 Re-read the section: a different rubric or requested model misses.
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
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-cache-identity #c388239 Re-read the section: jev-latest is not treated as a permanent response.
 */
export function jevCacheHit(
  entry: JevCacheEntry | undefined,
  requestedModel: string,
  nowMs: number,
): entry is JevCacheEntry {
  if (!entry) return false;
  const alias = requestedModel === "jev-latest" || requestedModel.endsWith("-latest");
  if (alias) {
    if (entry.resolvedModel === requestedModel || entry.resolvedModel.endsWith("-latest")) return false;
    return nowMs - entry.storedAtMs < JEV_ALIAS_TTL_MS;
  }
  return entry.resolvedModel === requestedModel;
}

/**
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-secret-boundary The cache file is a digest record, not a copy of the request key.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-secret-boundary #29ebf2c Re-read the section: the stored JSON is the advisory, not the API key.
 */
export function serializeJevCache(entries: readonly JevCacheEntry[]): string {
  return `${stableStringify({ entries })}\n`;
}

/**
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-cache-identity A cache file is read back only as stored entries.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-cache-identity #c388239 Re-read the section: a miss falls through when the entry is absent.
 */
export function parseJevCache(text: string): JevCacheEntry[] {
  const parsed = JSON.parse(text) as { entries?: JevCacheEntry[] };
  if (!parsed || !Array.isArray(parsed.entries)) return [];
  return parsed.entries.filter((entry) => typeof entry?.key === "string" && typeof entry.advisoryJson === "string");
}
