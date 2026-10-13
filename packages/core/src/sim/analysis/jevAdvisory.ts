import typia, { type IValidation, type tags } from "typia";

/**
 * Structural advisory report for an opt-in Jev call.
 * This module does not fetch, does not read an API key, and does not import a provider package.
 */

const JEV_SCHEMA_ID = "https://idlekit.dev/schemas/jev.advisory.v1.schema.json" as const;
const JEV_ALGORITHM_VERSION = "jev-advisory-1" as const;

/**
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-opt-in-live The published schema id is the Jev advisory report.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-opt-in-live #7fc28bd Re-read the section: the id is the advisory schema, not a numeric contract.
 */
export function jevSchemaId(): typeof JEV_SCHEMA_ID {
  return JEV_SCHEMA_ID;
}

/**
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-opt-in-live The algorithm version is jev-advisory-1.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-opt-in-live #7fc28bd Re-read the section: the version string is jev-advisory-1.
 */
export function jevAlgorithmVersion(): typeof JEV_ALGORITHM_VERSION {
  return JEV_ALGORITHM_VERSION;
}

export type JevAdvisoryV1 = Readonly<{
  schemaVersion: 1;
  contract: "idlekit.jev.advisory.v1";
  algorithmVersion: typeof JEV_ALGORITHM_VERSION;
  provider: "jev";
  status: "ok" | "failed" | "skipped" | "unavailable" | "abstain" | "advisory-warning";
  reason: string;
  requestedModel: string;
  resolvedModel: string | null;
  rubricVersion: string;
  numericalDigest: string;
  numericalUnchanged: true;
  endpoint: string;
  /** Token counts are whole and never negative. */
  usage: Readonly<{ inputTokens: number & tags.Type<"uint32">; outputTokens: number & tags.Type<"uint32"> }> | null;
  cache: "hit" | "miss" | "bypass";
  attempts: number & tags.Type<"uint32">;
  plannedRequests: number & tags.Type<"uint32">;
  dryRun: boolean;
  aliasPolicy: "ttl-24h" | "pinned";
  confidencePolicy: "not-game-correctness";
  externalProvider: true;
  answers: readonly JevAdvisoryAnswerV1[];
}>;

type JevProbability = number & tags.Minimum<0> & tags.Maximum<1>;
type JevDisposition = "ok" | "abstain" | "advisory-warning";

/**
 * One answer per rubric rule. Each wire type keeps its own fields: Noul carries `noul` and no confidence,
 * Choice and Score carry a confidence. Probabilities and confidences are on 0..1.
 */
export type JevAdvisoryAnswerV1 =
  | Readonly<{ id: string; type: "noul"; confidence: null; noul: JevProbability; choice: null; score: null; disposition: JevDisposition }>
  | Readonly<{ id: string; type: "choice"; confidence: JevProbability; noul: null; choice: string; score: null; disposition: JevDisposition }>
  | Readonly<{ id: string; type: "score"; confidence: JevProbability; noul: null; choice: null; score: number; disposition: JevDisposition }>;

/*
 * typia runs on first call, not at module load. A plugin that the bundled CLI loads
 * imports core source without the transform, and a module-load call would throw there.
 */
let validateJevAdvisoryValidator: ((input: unknown) => IValidation<JevAdvisoryV1>) | undefined;

/**
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-wire-shapes The published validator is createValidate of the advisory report.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-wire-shapes #a924cbf Re-read the section: the structural document is JevAdvisoryV1.
 */
export const validateJevAdvisory = (input: unknown): IValidation<JevAdvisoryV1> =>
  (validateJevAdvisoryValidator ??= typia.createValidate<JevAdvisoryV1>())(input);

function buildJevJsonSchema() {
  return typia.json.schema<JevAdvisoryV1, "3.1">();
}

let jevJsonSchemaUnit: ReturnType<typeof buildJevJsonSchema> | undefined;

/**
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-wire-shapes The structural schema is OpenAPI 3.1 from typia.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-wire-shapes #a924cbf Re-read the section: schema version is 3.1 and the contract id is idlekit.jev.advisory.v1.
 */
export function jevJsonSchema(): ReturnType<typeof buildJevJsonSchema> {
  jevJsonSchemaUnit ??= buildJevJsonSchema();
  return jevJsonSchemaUnit;
}
