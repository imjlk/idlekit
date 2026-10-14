import { z } from "zod";

/**
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-opt-in-live The wire endpoint is the System One URL rechecked for this change.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-opt-in-live #7fc28bd Re-read the updated section: the URL is https://api.typesafe.ai/v1/systemone.
 */
export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone" as const;

/**
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-no-default-fetch Rules stays on the local judge. Jev is not the default provider.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-no-default-fetch #e8a02f1 Re-read the updated section: default commands do not call the network.
 */
export const jevNoDefaultFetch = "rules-stay-local" as const;

/**
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-wire-shapes Choice, Score, and Noul stay distinct wire shapes.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-wire-shapes #a924cbf Re-read the updated section: Noul has noul, and Choice or Score confidence is not copied onto it.
 */
export const jevWireShapes = "distinct-answer-types" as const;

/**
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-http-budget Auth fails once. Rate limits retry inside a budget. Timeout aborts.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-http-budget #84d6272 Re-read the updated section: 401 and 403 are authentication, and 429 or 5xx stay bounded.
 */
export const jevHttpBudget = "bounded-retry" as const;

/**
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-cache-identity A pinned model can hit. An alias is not a permanent id.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-cache-identity #467d10f Re-read the updated section: echoed alias responses expire after 24 hours, jev-latest is revalidated, and a rubric change misses.
 */
export const jevCacheIdentity = "alias-is-not-pinned" as const;

/**
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-secret-boundary The key and the raw state stay out of the cache and the report.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-secret-boundary #2f2eef3 Re-read the updated section: secrets and full state are not stored.
 */
export const jevSecretBoundary = "redacted-projection" as const;

/**
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-numerical-unchanged A model disagreement does not flip the numerical verdict.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-numerical-unchanged #5f86d87 Re-read the updated section: low confidence is abstain, not a passing diagnosis.
 */
export const jevNumericalUnchanged = "verdict-stays" as const;

/**
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-opt-in-live A live call is opt-in. CI uses a mock transport.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-opt-in-live #7fc28bd Re-read the updated section: the live smoke is not the default test.
 */
export const jevOptInLive = "mock-unless-opt-in" as const;

const noulAnswer = z.object({
  type: z.literal("noul"),
  noul: z.number(),
}).strict();

const choiceAnswer = z.object({
  type: z.literal("choice"),
  choice: z.string(),
  confidence: z.number(),
  probabilities: z.record(z.string(), z.number()),
}).strict();

const scoreAnswer = z.object({
  type: z.literal("score"),
  score: z.number(),
  confidence: z.number(),
  legend: z.record(z.string(), z.string()),
  probabilities: z.record(z.string(), z.number()),
}).strict();

const wireAnswer = z.discriminatedUnion("type", [noulAnswer, choiceAnswer, scoreAnswer]);

const wireResponse = z.object({
  model: z.string().min(1),
  answers: z.record(z.string(), wireAnswer),
  usage: z.object({
    input_tokens: z.number().int().nonnegative().max(4294967295),
    output_tokens: z.number().int().nonnegative().max(4294967295),
  }).strict(),
}).strict();

type JevWireResponse = Readonly<z.infer<typeof wireResponse>>;

type JevQuestion =
  | Readonly<{ type: "noul"; instructions: string; criteria?: Readonly<{ true: string; false: string }> }>
  | Readonly<{ type: "choice"; instructions: string; criteria: Readonly<Record<string, string>> }>
  | Readonly<{ type: "score"; instructions: string; criteria: readonly string[] }>;

function outsideRoundingTolerance(actual: number, expected: number): boolean {
  const epsilon = Number.EPSILON * Math.max(1, Math.abs(actual), Math.abs(expected)) * 8;
  return Math.abs(actual - expected) > 0.02 + epsilon;
}

function probabilityShape(value: Record<string, number>, expectedKeys: readonly string[]): string | null {
  const keys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    return "probability keys do not match the question";
  }
  let sum = 0;
  for (const item of Object.values(value)) {
    if (!Number.isFinite(item) || item < 0 || item > 1) return "probability is outside 0..1";
    sum += item;
  }
  if (outsideRoundingTolerance(sum, 1)) return "probabilities do not sum to 1";
  return null;
}

/**
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-wire-shapes A response is accepted only when each answer matches its question type.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-wire-shapes #a924cbf Re-read the updated section: unknown ids, malformed JSON, a bad probability shape, and a Noul outside 0 to 1 are rejected.
 */
export function readJevWire(
  body: string,
  questions: Readonly<Record<string, JevQuestion>>,
): { ok: true; response: JevWireResponse } | { ok: false; reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, reason: "malformed-json" };
  }
  const result = wireResponse.safeParse(parsed);
  if (!result.success) return { ok: false, reason: "shape" };
  const expectedIds = Object.keys(questions).sort();
  const actualIds = Object.keys(result.data.answers).sort();
  if (expectedIds.join("\n") !== actualIds.join("\n")) return { ok: false, reason: "unknown-question" };
  for (const [id, question] of Object.entries(questions)) {
    const answer = result.data.answers[id];
    if (!answer || answer.type !== question.type) return { ok: false, reason: "shape" };
    if (answer.type === "choice" && question.type === "choice") {
      if (!Object.hasOwn(question.criteria, answer.choice)) return { ok: false, reason: "shape" };
      const shape = probabilityShape(answer.probabilities, Object.keys(question.criteria));
      if (shape) return { ok: false, reason: "shape" };
      if (answer.probabilities[answer.choice] !== Math.max(...Object.values(answer.probabilities))) {
        return { ok: false, reason: "shape" };
      }
      if (!Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1) {
        return { ok: false, reason: "shape" };
      }
    }
    if (answer.type === "score" && question.type === "score") {
      const levels = question.criteria.map((_, index) => String(index));
      const shape = probabilityShape(answer.probabilities, levels);
      if (shape) return { ok: false, reason: "shape" };
      if (Object.keys(answer.legend).length !== levels.length ||
          levels.some((level, index) => answer.legend[level] !== question.criteria[index])) return { ok: false, reason: "shape" };
      const weighted = levels.reduce((sum, level, index) => sum + index * answer.probabilities[level]!, 0);
      // As with probability sums, tolerate small model rounding while requiring the requested score range.
      if (answer.score < 0 || answer.score > levels.length - 1 || outsideRoundingTolerance(answer.score, weighted)) {
        return { ok: false, reason: "shape" };
      }
      if (!Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1) {
        return { ok: false, reason: "shape" };
      }
    }
    // Noul is a probability. A value outside 0..1 is malformed, not a confident yes or no.
    if (answer.type === "noul" && (!Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1)) {
      return { ok: false, reason: "shape" };
    }
  }
  return { ok: true, response: result.data };
}
