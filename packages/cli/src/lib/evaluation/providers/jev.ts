import { closeSync, lstatSync, mkdirSync, openSync, readFileSync, readlinkSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "fs";
import lockfile from "proper-lockfile";
import { basename, dirname, resolve } from "path";
import {
  jevAlgorithmVersion,
  judgeArtifact,
  toObservation,
  validateJevAdvisory,
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

export type JevTransport = (request: JevTransportRequest) => Promise<{ status: number; body: string; retryAfterMs?: number }>;

type JevProjection = Readonly<{
  state: Readonly<Record<string, unknown>>;
  questions: Readonly<Record<string, JevQuestion>>;
}>;

/**
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-opt-in-live The default transport is fetch. Tests inject a mock.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-opt-in-live #7fc28bd Re-read the updated section: the ordinary test does not call the live API.
 */
export const jevLiveTransport = "injected-or-fetch" as const;

/*
 * A local path can sit anywhere in a string and can come from any host layout:
 * a `file:` URI, a `~/` home path, a POSIX absolute path of any depth, including a root-level one,
 * a Windows drive path with either separator, or a UNC share. This pattern finds
 * where a path starts and its first space-free run. A web URL is not a local path
 * and stays.
 */
const LOCAL_PATH_START =
  /https?:\/\/[^\s"'`<>|]*|file:\/\/[^\s"'`()<>[\]{},;|]*|(?<=^|[\s\p{P}\p{S}])(?:~\/[^\s"'`()<>[\]{},;|]*|\/+[^\s"'`()<>[\]{},;|/][^\s"'`()<>[\]{},;|]*|[A-Za-z]:[\\/][^\s"'`()<>[\]{},;|]*|\\\\[^\s\\]+\\[^\s"'`()<>[\]{},;|]*)/giu;
/** A last path component that names a file, such as `save.json`. */
const FILE_COMPONENT = /(?:^|[\\/])[^\\/]*\.[A-Za-z0-9]{1,8}$/;
/** A quote, bracket, or pipe closes the text a path can run through. */
const PATH_CLOSE = /["'`()<>[\]{}|]/;

/*
 * A path ends at its first run when that run already names a file. Otherwise a name
 * with spaces may continue: the path runs through the next space-separated token that
 * names a file, and with no such token it runs to the closing delimiter or the end of
 * the string. Taking too much is the safe side, since every taken character is replaced.
 */
function pathEnd(value: string, start: number, run: string): number {
  const end = start + run.length;
  if (FILE_COMPONENT.test(run)) return end;
  const rest = value.slice(end);
  const close = rest.search(PATH_CLOSE);
  const span = close < 0 ? rest : rest.slice(0, close);
  let offset = 0;
  for (const token of span.split(" ")) {
    offset += token.length;
    if (token.length > 0 && FILE_COMPONENT.test(token)) return end + offset;
    offset += 1;
  }
  return end + span.replace(/\s+$/, "").length;
}

function redactPaths(value: string): string {
  let out = "";
  let cursor = 0;
  for (const match of value.matchAll(LOCAL_PATH_START)) {
    // Consume the whole web URL so punctuation inside it cannot start a local-path match.
    if (/^https?:\/\//i.test(match[0])) continue;
    const start = match.index ?? 0;
    if (start < cursor) continue;
    out += `${value.slice(cursor, start)}[redacted]`;
    cursor = pathEnd(value, start, match[0]);
  }
  return out + value.slice(cursor);
}

function redactString(value: string, keyMaterial: string): string {
  if (keyMaterial.length > 0 && value.includes(keyMaterial)) return "[redacted]";
  if (value.includes("TYPESAFE_API_KEY")) return "[redacted]";
  return redactPaths(value);
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

/** A numerical report is emitted unchanged beside the advisory, so unsafe metadata must be refused first. */
export function isSafeJevReport(report: JudgeReportV1, keyMaterial: string): boolean {
  return JSON.stringify(redact(report, keyMaterial)) === JSON.stringify(report);
}

/**
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-secret-boundary The projection keeps metrics, assumptions, and rubric intent.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-secret-boundary #2f2eef3 Re-read the updated section: raw source and secrets are dropped, and a local path in any host layout is replaced in place.
 */
export function projectJevState(
  artifact: AnalysisArtifactV1,
  rubric: JudgeRubricV1,
  keyMaterial: string,
): JevProjection {
  // The numerical judge compares the recorded meaning, method, and unit with the rule. Jev sees the same identity.
  // The numerical judge reads the first reading of each metric id. Jev sees that reading and no other.
  // Only metrics a rule names are projected, so readings no question asks about do not count against the size limit.
  const referenced = new Set(rubric.rules.map((rule) => rule.metricId));
  const seenMetricIds = new Set<string>();
  const firstReadings = artifact.metrics.filter((metric) => {
    if (!referenced.has(metric.metricId) || seenMetricIds.has(metric.metricId)) return false;
    seenMetricIds.add(metric.metricId);
    return true;
  });
  const coverage = artifact.observationCoverage;
  // Compare the original identities before redaction can collapse different values to the same marker.
  const judged = judgeArtifact(artifact, rubric);
  const verdicts = new Map(judged.ok ? judged.report.numerical.results.map((result) => [result.id, result.verdict] as const) : []);
  const withheld = coverage === "incomplete" || coverage === "unknown" || coverage === "disabled" || artifact.capabilities.metrics !== "statically-known";
  const metrics = firstReadings.flatMap((metric) => rubric.rules.filter((rule) => rule.metricId === metric.metricId).map((rule) => {
    const { observation } = toObservation(artifact, metric, rule);
    return {
      ...observation.identity,
      // An amount reading is stored as a decimal string, not as `value`.
      amount: !withheld && metric.amount ? { decimal: metric.amount.decimal, unit: metric.amount.unit } : null,
      domain: metric.domain,
      meaning: metric.meaning,
      metricId: metric.metricId,
      metricVersion: metric.metricVersion,
      ruleId: rule.id,
      reading: metric.reading,
      sign: observation.status === "measured" ? metric.sign ?? null : null,
      status: metric.status,
      observationStatus: observation.status,
      // Only an observed reading with status ok is a value the numerical judge measures. Any other reading is missing to it,
      // so Jev gets no value either.
      value: observation.value,
    };
  }));
  const rules = rubric.rules.map((rule) => ({
    numericalVerdict: verdicts.get(rule.id) ?? "inconclusive",
    definition: rule.definition,
    id: rule.id,
    method: rule.method,
    metricId: rule.metricId,
    missingPolicy: rule.missingPolicy,
    operator: rule.operator,
    recommendationId: rule.recommendationId,
    threshold: rule.threshold,
    unit: rule.unit,
    upperThreshold: rule.upperThreshold,
    // Optional identity constraints the numerical judge checks. A mismatch there makes the rule inconclusive.
    scenarioVersion: rule.scenarioVersion,
    specVersion: rule.specVersion,
    engineId: rule.engineId,
    pluginVersion: rule.pluginVersion,
    seed: rule.seed,
    algorithmVersion: rule.algorithmVersion,
  }));
  /*
   * The question is the numerical predicate itself: does the recorded reading fail its rule.
   * A Noul answer is then comparable with that rule's verdict, and disagreement means the same thing on both sides.
   * Object.fromEntries defines own properties, so an id such as __proto__ does not touch the prototype.
   */
  const questions: Record<string, JevQuestion> = Object.fromEntries(
    rubric.rules.map((rule): [string, JevQuestion] => [
      rule.id,
      {
        type: "noul",
        instructions:
          "Take the rubric rule whose id is this question's id and the projected reading whose ruleId is that id. Does this reading fail the rule? If the rule's numericalVerdict is inconclusive or unsupported, answer 0.5: it was compared before redaction. Check identity first: definition, method, and unit must match, and every non-null scenarioVersion, specVersion, engineId, pluginVersion, seed, and algorithmVersion constraint must match. An identity mismatch or observationStatus unknown or unsupported is inconclusive: answer 0.5. A missing observation follows missingPolicy: fail means 1; inconclusive and unsupported mean 0.5. If a between rule lacks ordered finite bounds, answer 0.5. For a measured observation, answer whether its recorded value fails the operator, threshold, and upper threshold. Use only the recorded observation; do not infer a value from a withheld sign or amount, or compute a new ETA, growth rate, or steady state.",
        criteria: {
          true: "The recorded reading fails the rule",
          false: "The recorded reading satisfies the rule",
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
) => Promise<{ status: number; body: ReadableStream<Uint8Array> | null; headers?: Pick<Headers, "get"> }>;

const MAX_JEV_RESPONSE_BYTES = 1_048_576;

function retryHint(headers: Pick<Headers, "get"> | undefined): number | undefined {
  const milliseconds = headers?.get("retry-after-ms");
  if (milliseconds != null && milliseconds.trim() !== "") {
    const value = Number(milliseconds);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  const raw = headers?.get("retry-after");
  if (raw == null || raw.trim() === "") return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return seconds >= 0 ? seconds * 1000 : undefined;
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

function retryDelay(attempt: number, hint?: number): number {
  if (hint !== undefined && Number.isFinite(hint) && hint >= 0 && hint <= 60_000) return hint;
  return Math.min(500 * 2 ** attempt, 5_000);
}

/**
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-opt-in-live The fetch transport posts only the body the caller already built.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-opt-in-live #7fc28bd Re-read the updated section: the URL is the documented System One endpoint.
 */
export function createFetchTransport(fetchImpl: JevFetch = (input, init) => globalThis.fetch(input, init)): JevTransport {
  return async (request) => {
    const response = await fetchImpl(request.url, {
      method: "POST",
      headers: request.headers,
      body: request.body,
      signal: request.signal,
    });
    // Error status is enough to classify the response; its untrusted body is never buffered.
    if (response.status !== 200) {
      try { await response.body?.cancel(); } catch { /* Keep the original HTTP status. */ }
      return { status: response.status, body: "", retryAfterMs: retryHint(response.headers) };
    }
    if (!response.body) return { status: response.status, body: "" };
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > MAX_JEV_RESPONSE_BYTES) {
          const error = new Error("Jev response exceeds the byte budget");
          error.name = "JevResponseTooLargeError";
          throw error;
        }
        chunks.push(decoder.decode(chunk.value, { stream: true }));
      }
      chunks.push(decoder.decode());
      return { status: response.status, body: chunks.join("") };
    } finally {
      try { await reader.cancel(); } catch { /* Preserve the transport error or completed response. */ }
      reader.releaseLock();
    }
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
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-numerical-unchanged #5f86d87 Re-read the updated section: confidence is not a game-correctness probability.
 */
export function jevAnswerDisposition(
  answer: JevWireAnswer,
  numericalFail: boolean | null,
): JevAnswerDisposition {
  if (answer.type === "noul") {
    // The band is closed, so a rounded 0.4 or 0.6 is uncertain on both sides instead of slipping to ok.
    if (answer.noul >= 0.4 && answer.noul <= 0.6) return "abstain";
    // A confident provider answer cannot establish a verdict when the numerical check decided neither.
    if (numericalFail === null) return "abstain";
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
    const disposition = jevAnswerDisposition(answer, stances.get(rule.id) ?? null);
    const summary: JevAdvisoryV1["answers"][number] =
      answer.type === "noul"
        ? { id: rule.id, type: "noul", confidence: null, noul: answer.noul, choice: null, score: null, disposition }
        : answer.type === "choice"
          ? { id: rule.id, type: "choice", confidence: answer.confidence, noul: null, choice: answer.choice, score: null, disposition }
          : { id: rule.id, type: "score", confidence: answer.confidence, noul: null, choice: null, score: answer.score, disposition };
    return [summary];
  });
}

/*
 * One rubric rule is one Jev question. A repeated id would merge two questions, and the
 * wire parser drops an own __proto__ key, so either one would lose an answer.
 */
function questionIdIssue(rubric: JudgeRubricV1, keyMaterial: string): string | null {
  const seen = new Set<string>();
  for (const rule of rubric.rules) {
    if (rule.id.trim().length === 0 || rule.id === "__proto__") return "unsafe-question-id";
    // A question id is a property name in the request and is not redacted there, so an id that redaction would change is refused.
    if (redactString(rule.id, keyMaterial) !== rule.id) return "unsafe-question-id";
    if (seen.has(rule.id)) return "duplicate-question-id";
    seen.add(rule.id);
  }
  return null;
}

/** A definite disagreement on any rule outranks an uncertain answer on another, so the warning is never masked. */
function reportStatus(answers: JevAdvisoryV1["answers"]): JevAdvisoryV1["status"] {
  if (answers.some((item) => item.disposition === "advisory-warning")) return "advisory-warning";
  if (answers.some((item) => item.disposition === "abstain")) return "abstain";
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

function readCachedAdvisory(text: string): JevAdvisoryV1 | null {
  try {
    const validated = validateJevAdvisory(JSON.parse(text));
    if (!validated.success) return null;
    const advisory = validated.data;
    // Structural validators may accept extra properties; persisted records cannot replay raw state beside the DTO.
    const fields = new Set(Object.keys(blank(advisory)));
    const answerFields = new Set(["id", "type", "confidence", "noul", "choice", "score", "disposition"]);
    if (Object.keys(advisory).some((field) => !fields.has(field))) return null;
    if (advisory.answers.some((answer) => Object.keys(answer).some((field) => !answerFields.has(field)))) return null;
    return advisory;
  } catch {
    return null;
  }
}

function cacheTarget(path: string, depth = 0): string {
  if (depth >= 32) throw new Error("cyclic cache symlink");
  try { return realpathSync(path); } catch {
    try {
      if (lstatSync(path).isSymbolicLink()) return cacheTarget(resolve(dirname(path), readlinkSync(path)), depth + 1);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const absolute = resolve(path);
    const parent = dirname(absolute);
    return parent === absolute ? absolute : resolve(cacheTarget(parent, depth), basename(absolute));
  }
}

async function writeCache(requestedPath: string, entry: JevCacheEntry): Promise<void> {
  const path = cacheTarget(requestedPath);
  mkdirSync(dirname(path), { recursive: true });
  let compromised: Error | undefined;
  // Heartbeats distinguish a live owner from a lock left by a terminated process. Acquisition remains bounded.
  const release = await lockfile.lock(path, {
    realpath: false,
    stale: 60_000,
    update: 10_000,
    retries: { retries: 100, factor: 1, minTimeout: 10, maxTimeout: 10, randomize: false },
    onCompromised(error) { compromised = error; },
  });
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  let created = false;
  try {
    if (compromised) throw compromised;
    // Read inside the lock: entries read before the HTTP await may already be stale.
    // Keep the most recently written records and evict expired aliases before the atomic rewrite.
    const entries = readCache(path).filter((cached) => cached.key !== entry.key &&
      jevCacheHit(cached, cached.requestedModel, entry.storedAtMs)).slice(-255);
    entries.push(entry);
    const fd = openSync(temporary, "wx");
    created = true;
    try { writeFileSync(fd, serializeJevCache(entries)); } finally { closeSync(fd); }
    renameSync(temporary, path);
  } finally {
    try { if (created) unlinkSync(temporary); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    } finally { await release(); }
  }
}

function retryable(status: number): boolean {
  return status === 429 || status === 529 || status >= 500;
}

/**
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-opt-in-live The live transport runs only when the caller asks for Jev.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-opt-in-live #7fc28bd Re-read the updated section: dry-run and a missing key do not send the request.
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-http-budget Retry stays inside the attempt budget.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-http-budget #84d6272 Re-read the updated section: timeout becomes unavailable and authentication is not retried.
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-numerical-unchanged The numerical digest is copied, not recomputed by the model.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-numerical-unchanged #5f86d87 Re-read the updated section: the advisory cannot change the recorded verdict.
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-no-default-fetch Only judge with provider jev reaches this transport. The rules provider returns before it.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-no-default-fetch #e8a02f1 Re-read the updated section: provider rules does not call the Jev transport, even with TYPESAFE_API_KEY set.
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-cache-identity The cache key is built from the projection here, and a cache that cannot be written fails open.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-cache-identity #125a09d Re-read the updated section: the key takes the projection with the upper bound, and a failed write keeps the advisory without resending.
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
  args = { ...args, requestedModel: args.requestedModel.trim() };
  const env = args.env ?? process.env;
  const key = env.TYPESAFE_API_KEY?.trim() ?? "";
  const projection = projectJevState(args.artifact, args.rubric, key);
  const numericalDigest = args.numerical.advisoryDigest;
  const keyMaterial = jevCacheKey({
    projection: { state: projection.state, questions: projection.questions },
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
  if (args.requestedModel.length === 0) {
    return blank({ ...base, plannedRequests: 0, status: "failed", reason: "invalid-model", cache: "bypass", attempts: 0 });
  }
  // The rubric version is copied into the report, the numerical digest, and the cache. One that carries the key or a
  // path is refused, and the report shows both only as redacted.
  if (redactString(args.rubric.rubricVersion, key) !== args.rubric.rubricVersion) {
    return blank({
      ...base,
      rubricVersion: "[redacted]",
      numericalDigest: "[redacted]",
      plannedRequests: 0,
      status: "failed",
      reason: "unsafe-rubric-version",
      cache: "bypass",
      attempts: 0,
    });
  }
  // The requested model is copied into the report and the cache. One that carries the key or a path is refused,
  // and the report names it only as redacted, so even a dry run does not echo it.
  if (redactString(args.requestedModel, key) !== args.requestedModel) {
    return blank({
      ...base,
      requestedModel: "[redacted]",
      plannedRequests: 0,
      status: "failed",
      reason: "unsafe-model",
      cache: "bypass",
      attempts: 0,
    });
  }
  const idIssue = questionIdIssue(args.rubric, key);
  if (idIssue) {
    return blank({ ...base, plannedRequests: 0, status: "failed", reason: idIssue, cache: "bypass", attempts: 0 });
  }
  const body = JSON.stringify({
    state: projection.state,
    model: args.requestedModel,
    questions: projection.questions,
  });
  // Checked before dry-run, so a plan never promises a request a live run would refuse locally.
  if (body.length > (args.maxInputChars ?? 8000)) {
    return blank({ ...base, plannedRequests: 0, status: "failed", reason: "input-too-large", cache: "bypass", attempts: 0 });
  }
  const cachedForRequest = (): JevAdvisoryV1 | null => {
    const entries = readCache(args.cachePath);
    const found = entries.find((entry) => entry.key === keyMaterial);
    const nowMs = args.nowMs ?? Date.now();
    let cached: JevAdvisoryV1 | null = null;
    if (jevCacheHit(found, args.requestedModel, nowMs)) {
      // A stored advisory that does not parse, does not validate, or names another request is a miss.
      // The request runs and rewrites the entry.
      const stored = readCachedAdvisory(found.advisoryJson);
      const matches =
        stored !== null &&
        stored.numericalDigest === numericalDigest &&
        stored.rubricVersion === args.rubric.rubricVersion &&
        stored.requestedModel === args.requestedModel &&
        stored.resolvedModel === found.resolvedModel &&
        stored.resolvedModel !== null && stored.resolvedModel.trim().length > 0 && stored.resolvedModel === stored.resolvedModel.trim() &&
        stored.endpoint === JEV_ENDPOINT && stored.aliasPolicy === aliasPolicy(args.requestedModel) &&
        JSON.stringify(redact(stored, key)) === JSON.stringify(stored) &&
        stored.answers.length === args.rubric.rules.length &&
        new Set(stored.answers.map((answer) => answer.id)).size === stored.answers.length &&
        stored.answers.every((answer) => {
          const question = projection.questions[answer.id];
          if (!question || question.type !== answer.type) return false;
          const disposition = answer.type === "noul"
            ? jevAnswerDisposition({ type: "noul", noul: answer.noul }, numericalStances(args.numerical).get(answer.id) ?? null)
            : answer.confidence < 0.5 ? "abstain" : "ok";
          return answer.disposition === disposition;
        }) &&
        stored.status === reportStatus(stored.answers) &&
        stored.reason === (stored.status === "ok" ? "advisory" : stored.status) &&
        stored.dryRun === false;
      cached = matches ? stored : null;
    }
    return cached;
  };
  const cached = cachedForRequest();
  // A dry run plans what a live run would send: nothing when the cache already answers.
  if (args.dryRun) {
    return blank({
      ...base,
      plannedRequests: cached || key.length === 0 ? 0 : plannedRequests,
      status: "skipped",
      reason: "dry-run",
      cache: "bypass",
      attempts: 0,
    });
  }
  // A hit and a missing key both end here without a request, so neither plans one.
  if (cached) return { ...cached, cache: "hit", attempts: 0, plannedRequests: 0, dryRun: false, usage: null };
  if (key.length === 0) {
    return blank({ ...base, plannedRequests: 0, status: "unavailable", reason: "missing-api-key", cache: "miss", attempts: 0 });
  }
  let releaseRequest: (() => Promise<void>) | undefined;
  let compromised = false;
  if (args.cachePath) {
    try {
      const target = cacheTarget(args.cachePath);
      mkdirSync(dirname(target), { recursive: true });
      // Serialize only identical requests. Other cache keys can still use the transport concurrently.
      releaseRequest = await lockfile.lock(`${target}.${keyMaterial}.request`, {
        realpath: false, stale: 60_000, update: 10_000,
        retries: { retries: 1000, factor: 1, minTimeout: 50, maxTimeout: 50, randomize: false },
        onCompromised() { compromised = true; },
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ELOCKED") {
        return blank({ ...base, plannedRequests: 0, status: "unavailable", reason: "cache-busy", cache: "miss", attempts: 0 });
      }
      // An unwritable cache still permits one paid request, as it did before request coalescing.
    }
  }
  try {
    // Another process may have filled this key while this request waited for its lease.
    const filled = cachedForRequest();
    if (filled) return { ...filled, cache: "hit", attempts: 0, plannedRequests: 0, dryRun: false, usage: null };
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
            clearTimeout(timer);
            await sleep(retryDelay(attempt, response.retryAfterMs));
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
        const usage = { inputTokens: wire.response.usage.input_tokens, outputTokens: wire.response.usage.output_tokens };
        // The provider chooses the model string. One that carries the key or a local path is refused, not copied or cached.
        if (redactString(wire.response.model, key) !== wire.response.model) {
          return blank({ ...base, status: "failed", reason: "unsafe-model", cache: "miss", attempts: attempt + 1, usage });
        }
        // An alias can be echoed by the API or resolved to a concrete id; it still uses the alias TTL.
        const answeredModel = wire.response.model;
        const modelOk = aliasPolicy(args.requestedModel) === "pinned"
          ? answeredModel === args.requestedModel
          : answeredModel.trim().length > 0 && answeredModel === answeredModel.trim() &&
            (answeredModel === args.requestedModel || aliasPolicy(answeredModel) === "pinned");
        if (!modelOk) {
          return blank({ ...base, status: "failed", reason: "model-mismatch", cache: "miss", attempts: attempt + 1, usage });
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
          usage,
          answers,
        });
        if (args.cachePath && !compromised) {
          const entry: JevCacheEntry = {
            key: keyMaterial,
            requestedModel: args.requestedModel,
            resolvedModel: wire.response.model,
            rubricVersion: args.rubric.rubricVersion,
            storedAtMs: args.nowMs ?? Date.now(),
            advisoryJson: JSON.stringify(advisory),
          };
          // A cache that cannot be written fails open. It is not an upstream failure and does not resend the paid request.
          try {
            await writeCache(args.cachePath, entry);
          } catch {
            // The advisory still stands. The next run misses and asks again.
          }
        }
        return advisory;
      } catch (error) {
        const name = error instanceof Error ? error.name : "";
        if (name === "JevResponseTooLargeError") {
          return blank({ ...base, status: "failed", reason: "response-too-large", cache: "miss", attempts: attempt + 1 });
        }
        if (name === "AbortError") {
          return blank({ ...base, status: "unavailable", reason: "timeout", cache: "miss", attempts: attempt + 1 });
        }
        lastReason = "upstream";
        if (attempt < maxRetries) {
          clearTimeout(timer);
          await sleep(retryDelay(attempt));
          continue;
        }
        return blank({ ...base, status: "unavailable", reason: lastReason, cache: "miss", attempts: attempt + 1 });
      } finally {
        clearTimeout(timer);
      }
    }
    return blank({ ...base, status: "unavailable", reason: lastReason, cache: "miss", attempts: maxRetries + 1 });
  } finally {
    // A lost lease must not turn a valid paid response into an upstream retry.
    try { await releaseRequest?.(); } catch { /* Cache availability does not change the advisory. */ }
  }
}
