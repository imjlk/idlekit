import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import {
  jevAlgorithmVersion,
  type AnalysisArtifactV1,
  type JevAdvisoryV1,
  type JudgeReportV1,
  type JudgeRubricV1,
} from "@idlekit/core";
import {
  jevCacheHit,
  jevCacheKey,
  parseJevCache,
  serializeJevCache,
  type JevCacheEntry,
} from "../cache";
import { JEV_ENDPOINT, readJevWire } from "./jev.schema";

type JevAnswerDisposition = "ok" | "abstain" | "advisory-warning";

type JevQuestion =
  | Readonly<{ type: "noul"; instructions: string; criteria?: Readonly<{ true: string; false: string }> }>
  | Readonly<{ type: "choice"; instructions: string; criteria: Readonly<Record<string, string>> }>
  | Readonly<{ type: "score"; instructions: string; criteria: readonly string[] }>;

type JevWireAnswer =
  | Readonly<{ type: "noul"; noul: number }>
  | Readonly<{ type: "choice"; choice: string; confidence: number; probabilities: Readonly<Record<string, number>> }>
  | Readonly<{ type: "score"; score: number; confidence: number; legend: Readonly<Record<string, string>>; probabilities: Readonly<Record<string, number>> }>;

type JevWireResponse = Readonly<{
  model: string;
  answers: Readonly<Record<string, JevWireAnswer>>;
  usage: Readonly<{ input_tokens: number; output_tokens: number }>;
}>;

const SECRET_KEYS = new Set([
  "apiKey",
  "apikey",
  "authorization",
  "env",
  "password",
  "pluginCode",
  "secret",
  "source",
  "token",
]);

type JevTransportRequest = Readonly<{
  url: string;
  body: string;
  headers: Readonly<Record<string, string>>;
  signal: AbortSignal;
}>;

export type JevTransport = (request: JevTransportRequest) => Promise<{ status: number; body: string }>;

type JevProjection = Readonly<{
  state: Readonly<Record<string, unknown>>;
  questions: Readonly<Record<string, JevQuestion>>;
}>;

/**
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-opt-in-live The default transport is fetch. Tests inject a mock.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-opt-in-live #c295136 Re-read the section: the ordinary test does not call the live API.
 */
export const jevLiveTransport = "injected-or-fetch" as const;

/*
 * A local path can sit anywhere in a string and can come from any host layout:
 * a `file:` URI, a `~/` home path, a POSIX absolute path with two or more segments,
 * a Windows drive path with either separator, or a UNC share. A following
 * space-separated token that still holds a separator is taken as the same path,
 * so a directory name with a space does not leak its tail. Each match is replaced
 * in place and the rest of the string still reaches the provider. A web URL is not
 * a local path and stays.
 */
const LOCAL_PATH_PATTERN =
  /(?:file:\/\/[^\s"'`()<>[\]{},;|]*|(?<=^|[\s"'`(=,:;[{<])(?:~\/[^\s"'`()<>[\]{},;|]*|\/(?:[^\s"'`()<>[\]{},;|/]+\/)+[^\s"'`()<>[\]{},;|]*|[A-Za-z]:[\\/][^\s"'`()<>[\]{},;|]*|\\\\[^\s\\]+\\[^\s"'`()<>[\]{},;|]*))(?: [^\s"'`()<>|]*[\\/][^\s"'`()<>|]*)*/g;

function redactString(value: string, keyMaterial: string): string {
  if (keyMaterial.length > 0 && value.includes(keyMaterial)) return "[redacted]";
  if (value.includes("TYPESAFE_API_KEY")) return "[redacted]";
  return value.replace(LOCAL_PATH_PATTERN, "[redacted]");
}

function redact(value: unknown, keyMaterial: string): unknown {
  if (typeof value === "string") return redactString(value, keyMaterial);
  if (Array.isArray(value)) return value.map((item) => redact(item, keyMaterial));
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEYS.has(key)) continue;
    out[key] = redact(item, keyMaterial);
  }
  return out;
}

/**
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-secret-boundary The projection keeps metrics, assumptions, and rubric intent.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-secret-boundary #d26dcf6 Re-read the section: raw source and secrets are dropped, and a local path in any host layout is replaced in place.
 */
export function projectJevState(
  artifact: AnalysisArtifactV1,
  rubric: JudgeRubricV1,
  keyMaterial: string,
): JevProjection {
  // The numerical judge compares the recorded meaning, method, and unit with the rule. Jev sees the same identity.
  const metrics = artifact.metrics.map((metric) => ({
    domain: metric.domain,
    meaning: metric.meaning,
    method: metric.method ?? null,
    metricId: metric.metricId,
    metricVersion: metric.metricVersion,
    reading: metric.reading,
    status: metric.status,
    unit: metric.domain === "amount" ? (metric.amount?.unit ?? "amount") : metric.domain,
    value: "value" in metric ? metric.value : null,
  }));
  const rules = rubric.rules.map((rule) => ({
    definition: rule.definition,
    id: rule.id,
    method: rule.method,
    metricId: rule.metricId,
    operator: rule.operator,
    recommendationId: rule.recommendationId,
    threshold: rule.threshold,
    unit: rule.unit,
    upperThreshold: rule.upperThreshold,
  }));
  // Object.fromEntries defines own properties, so an id such as __proto__ does not touch the prototype.
  const questions: Record<string, JevQuestion> = Object.fromEntries(
    rubric.rules.map((rule): [string, JevQuestion] => [
      rule.id,
      {
        type: "noul",
        instructions:
          "Does the recorded reading conflict with the rubric definition for this metric? Do not compute a new ETA, growth rate, or steady state.",
        criteria: {
          true: "The recorded reading conflicts with the stated definition",
          false: "The recorded reading does not conflict with the stated definition",
        },
      },
    ]),
  );
  return {
    state: redact(
      {
        assumptions: artifact.assumptions,
        metrics,
        rules,
      },
      keyMaterial,
    ) as JevProjection["state"],
    questions,
  };
}

type JevFetch = (
  input: string,
  init: {
    method: string;
    headers: Readonly<Record<string, string>>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<{ status: number; text: () => Promise<string> }>;

/**
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-opt-in-live The fetch transport posts only the body the caller already built.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-opt-in-live #c295136 Re-read the section: the URL is the documented System One endpoint.
 */
export function createFetchTransport(fetchImpl: JevFetch = (input, init) => globalThis.fetch(input, init)): JevTransport {
  return async (request) => {
    const response = await fetchImpl(request.url, {
      method: "POST",
      headers: request.headers,
      body: request.body,
      signal: request.signal,
    });
    return { status: response.status, body: await response.text() };
  };
}

function aliasPolicy(model: string): JevAdvisoryV1["aliasPolicy"] {
  return model === "jev-latest" || model.endsWith("-latest") ? "ttl-24h" : "pinned";
}

function blank(args: {
  requestedModel: string;
  rubricVersion: string;
  numericalDigest: string;
  status: JevAdvisoryV1["status"];
  reason: string;
  dryRun: boolean;
  cache: JevAdvisoryV1["cache"];
  attempts: number;
  plannedRequests: number;
  resolvedModel?: string | null;
  usage?: JevAdvisoryV1["usage"];
  answers?: JevAdvisoryV1["answers"];
}): JevAdvisoryV1 {
  return {
    schemaVersion: 1,
    contract: "idlekit.jev.advisory.v1",
    algorithmVersion: jevAlgorithmVersion(),
    provider: "jev",
    status: args.status,
    reason: args.reason,
    requestedModel: args.requestedModel,
    resolvedModel: args.resolvedModel ?? null,
    rubricVersion: args.rubricVersion,
    numericalDigest: args.numericalDigest,
    numericalUnchanged: true,
    endpoint: JEV_ENDPOINT,
    usage: args.usage ?? null,
    cache: args.cache,
    attempts: args.attempts,
    plannedRequests: args.plannedRequests,
    dryRun: args.dryRun,
    aliasPolicy: aliasPolicy(args.requestedModel),
    confidencePolicy: "not-game-correctness",
    externalProvider: true,
    answers: args.answers ?? [],
  };
}

/**
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-numerical-unchanged Low confidence abstains. A conflict is a warning, not a new verdict.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-numerical-unchanged #edaa1fe Re-read the section: confidence is not a game-correctness probability.
 */
export function jevAnswerDisposition(
  answer: JevWireAnswer,
  numericalFail: boolean | null,
): JevAnswerDisposition {
  if (answer.type === "noul") {
    if (answer.noul > 0.4 && answer.noul < 0.6) return "abstain";
    // An inconclusive or unsupported rule has no pass or fail for the answer to disagree with.
    if (numericalFail === null) return "ok";
    if (numericalFail && answer.noul < 0.4) return "advisory-warning";
    if (!numericalFail && answer.noul > 0.6) return "advisory-warning";
    return "ok";
  }
  if (answer.confidence < 0.5) return "abstain";
  return "ok";
}

/** The numerical stance of each rule: true for fail, false for pass, null when the check decided neither. */
function numericalStances(numerical: JudgeReportV1): ReadonlyMap<string, boolean | null> {
  const stances = new Map<string, boolean | null>();
  for (const result of numerical.numerical.results) {
    stances.set(result.id, result.verdict === "fail" ? true : result.verdict === "pass" ? false : null);
  }
  return stances;
}

function summarize(
  response: JevWireResponse,
  rubric: JudgeRubricV1,
  numerical: JudgeReportV1,
): JevAdvisoryV1["answers"] {
  const stances = numericalStances(numerical);
  return rubric.rules.flatMap((rule) => {
    const answer = response.answers[rule.id];
    if (!answer) return [];
    return [{
      id: rule.id,
      type: answer.type,
      confidence: answer.type === "noul" ? null : answer.confidence,
      noul: answer.type === "noul" ? answer.noul : null,
      choice: answer.type === "choice" ? answer.choice : null,
      score: answer.type === "score" ? answer.score : null,
      disposition: jevAnswerDisposition(answer, stances.get(rule.id) ?? null),
    }];
  });
}

/*
 * One rubric rule is one Jev question. A repeated id would merge two questions, and the
 * wire parser drops an own __proto__ key, so either one would lose an answer.
 */
function questionIdIssue(rubric: JudgeRubricV1): string | null {
  const seen = new Set<string>();
  for (const rule of rubric.rules) {
    if (rule.id === "__proto__") return "unsafe-question-id";
    if (seen.has(rule.id)) return "duplicate-question-id";
    seen.add(rule.id);
  }
  return null;
}

function reportStatus(answers: JevAdvisoryV1["answers"]): JevAdvisoryV1["status"] {
  if (answers.some((item) => item.disposition === "abstain")) return "abstain";
  if (answers.some((item) => item.disposition === "advisory-warning")) return "advisory-warning";
  return "ok";
}

function readCache(path: string | undefined): JevCacheEntry[] {
  if (!path) return [];
  try {
    return parseJevCache(readFileSync(path, "utf8"));
  } catch {
    return [];
  }
}

function writeCache(path: string, entries: readonly JevCacheEntry[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeJevCache(entries));
}

function retryable(status: number): boolean {
  return status === 429 || status === 529 || status >= 500;
}

/**
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-opt-in-live The live transport runs only when the caller asks for Jev.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-opt-in-live #c295136 Re-read the section: dry-run and a missing key do not send the request.
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-http-budget Retry stays inside the attempt budget.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-http-budget #84d6272 Re-read the section: timeout becomes unavailable and authentication is not retried.
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-numerical-unchanged The numerical digest is copied, not recomputed by the model.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-numerical-unchanged #edaa1fe Re-read the section: the advisory cannot change the recorded verdict.
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-no-default-fetch Only judge with provider jev reaches this transport. The rules provider returns before it.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-no-default-fetch #e8a02f1 Re-read the section: provider rules does not call the Jev transport, even with TYPESAFE_API_KEY set.
 */
export async function adviseWithJev(args: Readonly<{
  artifact: AnalysisArtifactV1;
  rubric: JudgeRubricV1;
  numerical: JudgeReportV1;
  requestedModel: string;
  dryRun: boolean;
  cachePath?: string;
  timeoutMs?: number;
  maxRetries?: number;
  maxInputChars?: number;
  transport?: JevTransport;
  env?: Readonly<Record<string, string | undefined>>;
  nowMs?: number;
  sleep?: (ms: number) => Promise<void>;
}>): Promise<JevAdvisoryV1> {
  const env = args.env ?? process.env;
  const key = env.TYPESAFE_API_KEY?.trim() ?? "";
  const projection = projectJevState(args.artifact, args.rubric, key);
  const numericalDigest = args.numerical.advisoryDigest;
  const keyMaterial = jevCacheKey({
    projection: projection.state,
    numericalDigest,
    rubricVersion: args.rubric.rubricVersion,
    requestedModel: args.requestedModel,
    adapterVersion: jevAlgorithmVersion(),
  });
  const plannedRequests = 1;
  const base = {
    requestedModel: args.requestedModel,
    rubricVersion: args.rubric.rubricVersion,
    numericalDigest,
    dryRun: args.dryRun,
    plannedRequests,
  };
  const idIssue = questionIdIssue(args.rubric);
  if (idIssue) {
    return blank({ ...base, plannedRequests: 0, status: "failed", reason: idIssue, cache: "bypass", attempts: 0 });
  }
  if (args.dryRun) {
    return blank({
      ...base,
      status: "skipped",
      reason: "dry-run",
      cache: "bypass",
      attempts: 0,
    });
  }
  const body = JSON.stringify({
    state: projection.state,
    model: args.requestedModel,
    questions: projection.questions,
  });
  if (body.length > (args.maxInputChars ?? 8000)) {
    return blank({ ...base, status: "failed", reason: "input-too-large", cache: "bypass", attempts: 0 });
  }
  const entries = readCache(args.cachePath);
  const found = entries.find((entry) => entry.key === keyMaterial);
  const nowMs = args.nowMs ?? Date.now();
  if (jevCacheHit(found, args.requestedModel, nowMs)) {
    const cached = JSON.parse(found.advisoryJson) as JevAdvisoryV1;
    return { ...cached, cache: "hit", attempts: 0, dryRun: false };
  }
  if (key.length === 0) {
    return blank({ ...base, status: "unavailable", reason: "missing-api-key", cache: "miss", attempts: 0 });
  }
  const transport = args.transport ?? createFetchTransport();
  const sleep = args.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const maxRetries = args.maxRetries ?? 2;
  const timeoutMs = args.timeoutMs ?? 10_000;
  let lastReason = "upstream";
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await transport({
        url: JEV_ENDPOINT,
        body,
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) {
        return blank({ ...base, status: "failed", reason: "authentication", cache: "miss", attempts: attempt + 1 });
      }
      if (retryable(response.status)) {
        lastReason = response.status === 429 || response.status === 529 ? "rate-limit" : "upstream";
        if (attempt < maxRetries) {
          await sleep(50 * 2 ** attempt);
          continue;
        }
        return blank({ ...base, status: "unavailable", reason: lastReason, cache: "miss", attempts: attempt + 1 });
      }
      if (response.status !== 200) {
        return blank({ ...base, status: "failed", reason: "upstream", cache: "miss", attempts: attempt + 1 });
      }
      const wire = readJevWire(response.body, projection.questions);
      if (!wire.ok) {
        return blank({ ...base, status: "failed", reason: wire.reason, cache: "miss", attempts: attempt + 1 });
      }
      const answers = summarize(wire.response, args.rubric, args.numerical);
      const status = reportStatus(answers);
      const advisory = blank({
        ...base,
        status,
        reason: status === "ok" ? "advisory" : status,
        cache: "miss",
        attempts: attempt + 1,
        resolvedModel: wire.response.model,
        usage: {
          inputTokens: wire.response.usage.input_tokens,
          outputTokens: wire.response.usage.output_tokens,
        },
        answers,
      });
      if (args.cachePath) {
        const next = entries.filter((entry) => entry.key !== keyMaterial);
        next.push({
          key: keyMaterial,
          requestedModel: args.requestedModel,
          resolvedModel: wire.response.model,
          rubricVersion: args.rubric.rubricVersion,
          storedAtMs: nowMs,
          advisoryJson: JSON.stringify(advisory),
        });
        writeCache(args.cachePath, next);
      }
      return advisory;
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      if (name === "AbortError") {
        return blank({ ...base, status: "unavailable", reason: "timeout", cache: "miss", attempts: attempt + 1 });
      }
      lastReason = "upstream";
      if (attempt < maxRetries) {
        await sleep(50 * 2 ** attempt);
        continue;
      }
      return blank({ ...base, status: "unavailable", reason: lastReason, cache: "miss", attempts: attempt + 1 });
    } finally {
      clearTimeout(timer);
    }
  }
  return blank({ ...base, status: "unavailable", reason: lastReason, cache: "miss", attempts: maxRetries + 1 });
}
