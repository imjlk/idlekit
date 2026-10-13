import { z } from "zod";

/**
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-opt-in-live The wire endpoint is the System One URL rechecked for this change.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-opt-in-live #6484686 Re-read the section: the URL is https://api.typesafe.ai/v1/systemone.
 */
export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone" as const;

/**
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-no-default-fetch Rules stays on the local judge. Jev is not the default provider.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-no-default-fetch #e8a02f1 Re-read the section: default commands do not call the network.
 */
export const jevNoDefaultFetch = "rules-stay-local" as const;

/**
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-wire-shapes Choice, Score, and Noul stay distinct wire shapes.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-wire-shapes #cdacf48 Re-read the section: Noul has noul, and Choice or Score confidence is not copied onto it.
 */
export const jevWireShapes = "distinct-answer-types" as const;

/**
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-http-budget Auth fails once. Rate limits retry inside a budget. Timeout aborts.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-http-budget #84d6272 Re-read the section: 401 and 403 are authentication, and 429 or 5xx stay bounded.
 */
export const jevHttpBudget = "bounded-retry" as const;

/**
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-cache-identity A pinned model can hit. An alias is not a permanent id.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-cache-identity #d783953 Re-read the section: jev-latest is revalidated and a rubric change misses.
 */
export const jevCacheIdentity = "alias-is-not-pinned" as const;

/**
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-secret-boundary The key and the raw state stay out of the cache and the report.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-secret-boundary #870ea17 Re-read the section: secrets and full state are not stored.
 */
export const jevSecretBoundary = "redacted-projection" as const;

/**
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-numerical-unchanged A model disagreement does not flip the numerical verdict.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-numerical-unchanged #5f86d87 Re-read the section: low confidence is abstain, not a passing diagnosis.
 */
export const jevNumericalUnchanged = "verdict-stays" as const;

/**
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-opt-in-live A live call is opt-in. CI uses a mock transport.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-opt-in-live #6484686 Re-read the section: the live smoke is not the default test.
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
    input_tokens: z.number().int(),
    output_tokens: z.number().int(),
  }).strict(),
}).strict();

type JevWireResponse = Readonly<z.infer<typeof wireResponse>>;

type JevQuestion =
  | Readonly<{ type: "noul"; instructions: string; criteria?: Readonly<{ true: string; false: string }> }>
  | Readonly<{ type: "choice"; instructions: string; criteria: Readonly<Record<string, string>> }>
  | Readonly<{ type: "score"; instructions: string; criteria: readonly string[] }>;

function probabilityShape(value: Record<string, number>, expectedKeys: readonly string[]): string | null {
  const keys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (keys.join("\n") !== expected.join("\n")) return "probability keys do not match the question";
  let sum = 0;
  for (const item of Object.values(value)) {
    if (!Number.isFinite(item) || item < 0 || item > 1) return "probability is outside 0..1";
    sum += item;
  }
  if (Math.abs(sum - 1) > 0.02) return "probabilities do not sum to 1";
  return null;
}

/**
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-wire-shapes A response is accepted only when each answer matches its question type.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-wire-shapes #cdacf48 Re-read the section: unknown ids, malformed JSON, a bad probability shape, and a Noul outside 0 to 1 are rejected.
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
      const shape = probabilityShape(answer.probabilities, Object.keys(question.criteria));
      if (shape) return { ok: false, reason: "shape" };
      if (!Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1) {
        return { ok: false, reason: "shape" };
      }
    }
    if (answer.type === "score" && question.type === "score") {
      const shape = probabilityShape(answer.probabilities, Object.keys(answer.legend));
      if (shape) return { ok: false, reason: "shape" };
      if (Object.keys(answer.legend).length !== question.criteria.length) return { ok: false, reason: "shape" };
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
