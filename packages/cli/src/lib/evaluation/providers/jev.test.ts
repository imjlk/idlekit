import { describe, expect, it } from "bun:test";
import { existsSync, linkSync, mkdirSync, readFileSync, symlinkSync, utimesSync } from "fs";
import lockfile from "proper-lockfile";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { createTempDir, readText, removePath } from "../../../testkit/bun";
import { readJudgeInputs } from "../input";
import { evaluateRules } from "../rules";
import { JEV_ALIAS_TTL_MS, jevCacheHit, jevCacheKey, parseJevCache, serializeJevCache, type JevCacheEntry } from "../cache";
import { runJudge } from "../../../commands/judge";
import {
  adviseWithJev,
  createFetchTransport,
  jevAnswerDisposition,
  jevLiveTransport,
  projectJevState,
  isSafeJevReport,
  type JevTransport,
} from "./jev";
import { jevAlgorithmVersion, jevJsonSchema, jevSchemaId, validateJevAdvisory, type JevAdvisoryV1 } from "@idlekit/core";
import {
  JEV_ENDPOINT,
  jevCacheIdentity,
  jevHttpBudget,
  jevNoDefaultFetch,
  jevNumericalUnchanged,
  jevOptInLive,
  jevSecretBoundary,
  jevWireShapes,
  readJevWire,
} from "./jev.schema";

const fixture = JSON.parse(
  readFileSync(new URL("../../../../../../examples/analysis/jev-wire.json", import.meta.url), "utf8"),
) as {
  seed: string;
  endpoint: string;
  choice: unknown;
  score: unknown;
  noul: unknown;
};

const SECRET = "typesafe-test-key";

/** File symlinks require a privilege on some Windows hosts; hard links and junctions are still checked there. */
function fileSymlink(target: string, link: string): boolean {
  try { symlinkSync(target, link); return true; } catch (error) {
    if (process.platform === "win32" && (error as NodeJS.ErrnoException).code === "EPERM") return false;
    throw error;
  }
}

function artifact(value: number, extraAssumption = "seed-19"): string {
  return JSON.stringify({
    schemaVersion: 1,
    algorithmVersion: "analysis-artifact-v1",
    assumptions: [extraAssumption],
    warnings: ["FULL-STATE-MARKER"],
    observationCoverage: "complete",
    metrics: [
      {
        metricId: "first-reset",
        metricVersion: 1,
        meaning: "first-reset-hours",
        metricKind: "stock",
        timeAxis: "instant",
        domain: "time",
        reading: "observed",
        status: "ok",
        method: "exact",
        value,
      },
    ],
    goals: [],
    capabilities: {
      metrics: "statically-known",
      goals: "statically-known",
      reset: "statically-known",
      flow: "statically-known",
      advance: "statically-known",
    },
  });
}

function rule(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: "first-reset",
    metricId: "first-reset",
    operator: "lte",
    threshold: 2,
    upperThreshold: null,
    unit: "time",
    severity: "error",
    missingPolicy: "inconclusive",
    definition: "first-reset-hours",
    method: "exact",
    scenarioVersion: null,
    specVersion: null,
    engineId: null,
    pluginVersion: null,
    seed: null,
    algorithmVersion: null,
    recommendationId: "rec.metric.outside-threshold",
    ...overrides,
  };
}

function rubric(version = "rubric-19", rules: readonly Record<string, unknown>[] = [rule()]): string {
  return JSON.stringify({
    schemaVersion: 1,
    contract: "idlekit.judge.rubric.v1",
    rubricVersion: version,
    failOn: ["error"],
    rules,
  });
}

function parsed(
  value = 3,
  version = "rubric-19",
  assumption = "seed-19",
  rules: readonly Record<string, unknown>[] = [rule()],
) {
  const result = readJudgeInputs(JSON.parse(artifact(value, assumption)), JSON.parse(rubric(version, rules)));
  if (!result.ok) throw new Error(result.issues.join("; "));
  return result;
}

function noulBody(noul: number, model = "jev-1.13.0"): string {
  return noulAnswers({ "first-reset": noul }, model);
}

function noulAnswers(values: Readonly<Record<string, number>>, model = "jev-1.13.0"): string {
  return JSON.stringify({
    model,
    answers: Object.fromEntries(Object.entries(values).map(([id, noul]) => [id, { type: "noul", noul }])),
    usage: { input_tokens: 11, output_tokens: 3 },
  });
}

/** Relative modules a file loads at evaluation time. Type-only imports and import calls are not followed. */
function staticImportClosure(entry: string): Set<string> {
  const seen = new Set<string>();
  const pending = [entry];
  const pattern = /^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\s+from\s+)?["'](\.{1,2}\/[^"']+)["']/gm;
  while (pending.length > 0) {
    const file = pending.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(pattern)) {
      const base = resolve(dirname(file), match[1] as string);
      const next = [base, `${base}.ts`, `${base}/index.ts`].find((candidate) => existsSync(candidate) && candidate.endsWith(".ts"));
      if (next) pending.push(next);
    }
  }
  return seen;
}

function transportOf(handler: (status: number) => { status: number; body: string } | Promise<{ status: number; body: string }>): {
  transport: JevTransport;
  calls: number;
  bodies: string[];
  headers: string[];
} {
  const state = { calls: 0, bodies: [] as string[], headers: [] as string[] };
  const transport: JevTransport = async (request) => {
    state.calls += 1;
    state.bodies.push(request.body);
    state.headers.push(request.headers.Authorization ?? "");
    return handler(state.calls);
  };
  return {
    transport,
    get calls() {
      return state.calls;
    },
    bodies: state.bodies,
    headers: state.headers,
  };
}

/**
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-no-default-fetch Default commands and the rules provider do not call the network.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-no-default-fetch #e8a02f1 Re-read the section, then ran this function: fetch stayed at zero and the static import graph from main.ts reaches judge but not providers/jev.
 * @evidence ./jev.schema.ts#jevNoDefaultFetch Reads the local-provider marker.
 * @evidenceReview ./jev.schema.ts#jevNoDefaultFetch #23dc4f1 The declaration is rules-stay-local.
 */
export function keepsDefaultCommandsOffNetwork(): Promise<void> {
  return (async (): Promise<void> => {
  expect(fixture.seed).toBe("19");
  expect(jevNoDefaultFetch).toBe("rules-stay-local");
  const files = [
    "packages/cli/src/commands/evaluate.ts",
    "packages/cli/src/commands/tune.ts",
    "packages/cli/src/commands/doctor.ts",
    "packages/cli/src/commands/validate.ts",
    "packages/core/src/index.ts",
    "packages/core/src/sim/simulator.ts",
  ];
  for (const file of files) {
    const text = readFileSync(new URL(`../../../../../../${file}`, import.meta.url), "utf8");
    expect(text.includes("api.typesafe.ai")).toBe(false);
    expect(text.includes("providers/jev")).toBe(false);
  }
  // main.ts registers judge for every command, so the provider must not be on its static import graph.
  // fileURLToPath, not URL.pathname, which is /D:/... on Windows. Separators are compared as forward slashes.
  const reached = [...staticImportClosure(fileURLToPath(new URL("../../../main.ts", import.meta.url)))].map((path) =>
    path.replace(/\\/g, "/"),
  );
  expect(reached.some((path) => path.endsWith("/commands/judge.ts"))).toBe(true);
  expect(reached.some((path) => path.includes("/providers/jev"))).toBe(false);
  const dir = await createTempDir("idlekit-jev-rules");
  const analysis = resolve(dir, "analysis.json");
  const rubricPath = resolve(dir, "rubric.json");
  await Bun.write(analysis, artifact(3));
  await Bun.write(rubricPath, rubric());
  let calls = 0;
  const judged = await runJudge({
    rubric: rubricPath,
    provider: "rules",
    format: "json",
  }, analysis, {
    env: { TYPESAFE_API_KEY: SECRET },
    transport: async () => {
      calls += 1;
      return { status: 200, body: noulBody(0.9) };
    },
  });
  expect(calls).toBe(0);
  expect("contract" in judged && judged.contract).toBe("idlekit.judge.v1");
  await removePath(dir);
})();
}

/**
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-wire-shapes Choice, Score, and Noul samples match the published wire shapes.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-wire-shapes #a924cbf Re-read the section, then ran this function: a bad shape, a Noul or Score confidence outside 0 to 1, a negative token count, and malformed JSON fail.
 * @evidence ./jev.schema.ts#jevWireShapes Reads the wire marker.
 * @evidenceReview ./jev.schema.ts#jevWireShapes #b3bf0a0 The declaration is distinct-answer-types.
 * @evidence ../../../../../core/src/sim/analysis/jevAdvisory.ts#validateJevAdvisory Reads the published validator.
 * @evidenceReview ../../../../../core/src/sim/analysis/jevAdvisory.ts#validateJevAdvisory #e087917 The validator is createValidate of JevAdvisoryV1, built on first call.
 * @evidence ../../../../../core/src/sim/analysis/jevAdvisory.ts#jevJsonSchema Reads the generated schema marker.
 * @evidenceReview ../../../../../core/src/sim/analysis/jevAdvisory.ts#jevJsonSchema #99088db The memoized schema version is 3.1.
 * @evidence ../../../../../core/src/sim/analysis/jevAdvisory.ts#jevSchemaId Reads the schema id.
 * @evidenceReview ../../../../../core/src/sim/analysis/jevAdvisory.ts#jevSchemaId #868d3b8 The id is the Jev advisory v1 schema URL.
 * @evidence ../../../../../core/src/sim/analysis/jevAdvisory.ts#jevAlgorithmVersion Reads the algorithm version.
 * @evidenceReview ../../../../../core/src/sim/analysis/jevAdvisory.ts#jevAlgorithmVersion #3a63e24 The version is jev-advisory-1.
 * @evidence ./jev.schema.ts#readJevWire Accepts an answer only when it matches its question type.
 * @evidenceReview ./jev.schema.ts#readJevWire #1100598 Re-read the request-bound validator and its epsilon-aware tolerance helper: Choice winners and probability keys match the requested options, Score legends and weighted values match the zero-based criteria, and usage fits uint32. This host revalidated the three matching fixture shapes and Noul 0 and 1, and rejects invalid confidence, an unknown id, a bad probability set, and malformed JSON. Separate boundary tests accept rounded sums and weighted scores at 0.02 and reject values beyond the tolerance.
 */
export function validatesWireShapes(): void {
  expect(jevWireShapes).toBe("distinct-answer-types");
  expect(jevSchemaId()).toBe("https://idlekit.dev/schemas/jev.advisory.v1.schema.json");
  expect(jevAlgorithmVersion()).toBe("jev-advisory-1");
  expect(jevJsonSchema().version).toBe("3.1");
  const choice = readJevWire(JSON.stringify(fixture.choice), {
    department: {
      type: "choice",
      instructions: "Which team should handle this",
      criteria: { billing: "Payment", technical: "Bugs", sales: "Pricing" },
    },
  });
  const score = readJevWire(JSON.stringify(fixture.score), {
    frustration: {
      type: "score",
      instructions: "How frustrated the customer appears",
      criteria: ["Calm, just stating facts", "Frustrated but civil", "Very angry, strong language"],
    },
  });
  const noul = readJevWire(JSON.stringify(fixture.noul), {
    is_urgent: { type: "noul", instructions: "Does this message express urgency?" },
  });
  expect(choice.ok && choice.response.answers.department?.type).toBe("choice");
  expect(score.ok && score.response.answers.frustration?.type).toBe("score");
  expect(noul.ok && noul.response.answers.is_urgent?.type).toBe("noul");
  const leaked = readJevWire(JSON.stringify({
    model: "jev-1.13.0",
    answers: { is_urgent: { type: "noul", noul: 0.4, confidence: 0.9 } },
    usage: { input_tokens: 1, output_tokens: 1 },
  }), { is_urgent: { type: "noul", instructions: "urgency" } });
  expect(leaked.ok).toBe(false);
  const unknown = readJevWire(JSON.stringify({
    model: "jev-1.13.0",
    answers: { eta: { type: "noul", noul: 1 } },
    usage: { input_tokens: 1, output_tokens: 1 },
  }), { is_urgent: { type: "noul", instructions: "urgency" } });
  expect(unknown.ok).toBe(false);
  if (!unknown.ok) expect(unknown.reason).toBe("unknown-question");
  for (const outside of [-0.1, 1.1]) {
    const rejected = readJevWire(JSON.stringify({
      model: "jev-1.13.0",
      answers: { is_urgent: { type: "noul", noul: outside } },
      usage: { input_tokens: 1, output_tokens: 1 },
    }), { is_urgent: { type: "noul", instructions: "urgency" } });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.reason).toBe("shape");
  }
  // Score confidence is on 0..1, as Choice confidence is.
  const scoreBody = fixture.score as { answers: { frustration: Record<string, unknown> } };
  for (const confidence of [-0.2, 1.5]) {
    const outOfRange = readJevWire(
      JSON.stringify({ ...scoreBody, answers: { frustration: { ...scoreBody.answers.frustration, confidence } } }),
      {
        frustration: {
          type: "score",
          instructions: "How frustrated the customer appears",
          criteria: ["Calm, just stating facts", "Frustrated but civil", "Very angry, strong language"],
        },
      },
    );
    expect(outOfRange.ok).toBe(false);
  }
  // Token counts cannot be negative.
  const negativeUsage = readJevWire(JSON.stringify({
    model: "jev-1.13.0",
    answers: { is_urgent: { type: "noul", noul: 0.5 } },
    usage: { input_tokens: -1, output_tokens: 1 },
  }), { is_urgent: { type: "noul", instructions: "urgency" } });
  expect(negativeUsage.ok).toBe(false);
  for (const edge of [0, 1]) {
    expect(readJevWire(JSON.stringify({
      model: "jev-1.13.0",
      answers: { is_urgent: { type: "noul", noul: edge } },
      usage: { input_tokens: 1, output_tokens: 1 },
    }), { is_urgent: { type: "noul", instructions: "urgency" } }).ok).toBe(true);
  }
  const badShape = readJevWire(JSON.stringify({
    model: "jev-1.13.0",
    answers: {
      department: {
        type: "choice",
        choice: "technical",
        confidence: 0.4,
        probabilities: { technical: 1 },
      },
    },
    usage: { input_tokens: 1, output_tokens: 1 },
  }), {
    department: {
      type: "choice",
      instructions: "team",
      criteria: { technical: "Bugs", billing: "Payment" },
    },
  });
  expect(badShape.ok).toBe(false);
  const truncatedBody = "{";
  const malformed = readJevWire(truncatedBody, { is_urgent: { type: "noul", instructions: "urgency" } });
  expect(malformed.ok).toBe(false);
  if (!malformed.ok) expect(malformed.reason).toBe("malformed-json");
}

/**
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-http-budget Authentication, rate limits, and timeouts stay inside the budget.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-http-budget #84d6272 Re-read the section, then ran this function: 401 is not retried and 429 stops at the budget.
 * @evidence ./jev.schema.ts#jevHttpBudget Reads the budget marker.
 * @evidenceReview ./jev.schema.ts#jevHttpBudget #fe6ed61 The declaration is bounded-retry.
 * @evidence ./jev.ts#adviseWithJev Runs the injected transport inside the retry budget.
 * @evidenceReview ./jev.ts#adviseWithJev #018a20b Re-read adviseWithJev after accepting an echoed requested alias under the TTL and bounding cache writes: oversized streamed responses fail once and the retry loop remains bounded; 401 and 403 send once, 429 stops after three attempts, 500 twice then 200 recovers, and an abort is a timeout.
 */
export function boundsHttpFailures(): Promise<void> {
  return (async (): Promise<void> => {
  expect(jevHttpBudget).toBe("bounded-retry");
  const input = parsed();
  const numerical = evaluateRules(input);
  const auth = transportOf(() => ({ status: 401, body: `{"error":"${SECRET}"}` }));
  const failed = await adviseWithJev({
    ...input,
    numerical,
    requestedModel: "jev-1.13.0",
    dryRun: false,
    transport: auth.transport,
    env: { TYPESAFE_API_KEY: SECRET },
    sleep: async () => {},
  });
  expect(failed.status).toBe("failed");
  expect(failed.reason).toBe("authentication");
  expect(auth.calls).toBe(1);
  expect(JSON.stringify(failed).includes(SECRET)).toBe(false);
  const forbidden = transportOf(() => ({ status: 403, body: "{}" }));
  const denied = await adviseWithJev({
    ...input,
    numerical,
    requestedModel: "jev-1.13.0",
    dryRun: false,
    transport: forbidden.transport,
    env: { TYPESAFE_API_KEY: SECRET },
    sleep: async () => {},
  });
  expect(denied.reason).toBe("authentication");
  expect(forbidden.calls).toBe(1);
  const limited = transportOf(() => ({ status: 429, body: "{}" }));
  const waited = await adviseWithJev({
    ...input,
    numerical,
    requestedModel: "jev-1.13.0",
    dryRun: false,
    transport: limited.transport,
    env: { TYPESAFE_API_KEY: SECRET },
    sleep: async () => {},
  });
  expect(waited.status).toBe("unavailable");
  expect(waited.reason).toBe("rate-limit");
  expect(limited.calls).toBe(3);
  const down = transportOf((call) => call < 3 ? { status: 500, body: "{}" } : { status: 200, body: noulBody(0.9) });
  const recovered = await adviseWithJev({
    ...input,
    numerical,
    requestedModel: "jev-1.13.0",
    dryRun: false,
    transport: down.transport,
    env: { TYPESAFE_API_KEY: SECRET },
    sleep: async () => {},
  });
  expect(recovered.status).toBe("ok");
  expect(down.calls).toBe(3);
  expect(validateJevAdvisory(recovered).success).toBe(true);
  // The contract keeps each answer type's own fields and bounds.
  const noulAnswer = recovered.answers[0]!;
  expect(validateJevAdvisory({ ...recovered, answers: [{ ...noulAnswer, confidence: 0.5 }] }).success).toBe(false);
  expect(validateJevAdvisory({ ...recovered, answers: [{ ...noulAnswer, noul: 1.5 }] }).success).toBe(false);
  expect(validateJevAdvisory({ ...recovered, plannedRequests: -1 }).success).toBe(false);
  // The published contract keeps token counts whole and non-negative.
  expect(validateJevAdvisory({ ...recovered, usage: { inputTokens: -1, outputTokens: 1 } }).success).toBe(false);
  const stalled = transportOf(() => new Promise((_resolve, reject) => {
    const error = new Error("aborted");
    error.name = "AbortError";
    reject(error);
  }));
  const timed = await adviseWithJev({
    ...input,
    numerical,
    requestedModel: "jev-1.13.0",
    dryRun: false,
    timeoutMs: 20,
    transport: async (request) => {
      await new Promise((_resolve, reject) => {
        request.signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
      return stalled.transport(request);
    },
    env: { TYPESAFE_API_KEY: SECRET },
    sleep: async () => {},
  });
  expect(timed.status).toBe("unavailable");
  expect(timed.reason).toBe("timeout");
})();
}

/**
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-cache-identity A pinned model hits. An alias expires. A rubric change misses.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-cache-identity #467d10f Re-read the updated section, then ran this function: an echoed alias hits only inside the TTL, another alias misses, jev-latest was fetched again after the TTL, a changed between upper bound missed, invalid or mismatched stored advisories missed, a warm cache planned zero requests, and an unwritable cache kept the advisory. Separate tests verify echoed-alias advice and eviction of expired aliases with the 256-entry limit.
 * @evidence ./jev.ts#adviseWithJev Writes the cache after a valid answer and fails open when it cannot.
 * @evidenceReview ./jev.ts#adviseWithJev #018a20b Re-read adviseWithJev and writeCache: invalid or mismatched entries miss, a hit sends nothing and clears current-call usage, dry-run plans zero without a key, writes merge entries under a filesystem lock, and an unwritable path keeps the advisory without resending. An echoed requested alias now uses the same TTL; separate tests verify expiry and the 256-entry write bound.
 * @evidence ./jev.schema.ts#jevCacheIdentity Reads the cache marker.
 * @evidenceReview ./jev.schema.ts#jevCacheIdentity #75b32a2 The declaration is alias-is-not-pinned.
 * @evidence ../cache.ts#JEV_ALIAS_TTL_MS Reads the alias TTL.
 * @evidenceReview ../cache.ts#JEV_ALIAS_TTL_MS #454de67 The TTL is one day.
 * @evidence ../cache.ts#jevCacheKey Binds the projection, numerical digest, rubric, model, and adapter.
 * @evidenceReview ../cache.ts#jevCacheKey #8b24520 The same parts give the same key, and a different rubric or model gives a different one.
 * @evidence ../cache.ts#jevCacheHit Decides a hit for a pinned id or an alias inside the TTL.
 * @evidenceReview ../cache.ts#jevCacheHit #b3d9039 Re-read the age check: a pinned id hits only its stored model; an alias hits inside one day whether resolved to a pinned id or echoed unchanged. A different alias and an entry stored in the future miss.
 * @evidence ../cache.ts#serializeJevCache Writes the stored entries.
 * @evidenceReview ../cache.ts#serializeJevCache #07d024a The serialized entries read back unchanged.
 * @evidence ../cache.ts#parseJevCache Reads back only well-formed entries.
 * @evidenceReview ../cache.ts#parseJevCache #de87c3d Re-read the field checks: a round trip keeps the entry, and entries without advisoryJson, without resolvedModel, or with a string storedAtMs are dropped.
 */
export function separatesCacheIdentity(): Promise<void> {
  return (async (): Promise<void> => {
  expect(jevCacheIdentity).toBe("alias-is-not-pinned");
  expect(JEV_ALIAS_TTL_MS).toBe(24 * 60 * 60 * 1000);
  const keyParts = { projection: { a: 1 }, numericalDigest: "d", rubricVersion: "r1", requestedModel: "jev-1.13.0", adapterVersion: "jev-advisory-1" };
  expect(jevCacheKey(keyParts)).toBe(jevCacheKey({ ...keyParts }));
  expect(jevCacheKey({ ...keyParts, rubricVersion: "r2" })).not.toBe(jevCacheKey(keyParts));
  expect(jevCacheKey({ ...keyParts, requestedModel: "jev-latest" })).not.toBe(jevCacheKey(keyParts));
  const entry: JevCacheEntry = { key: "k", requestedModel: "jev-1.13.0", resolvedModel: "jev-1.13.0", rubricVersion: "r1", storedAtMs: 0, advisoryJson: "{}" };
  expect(jevCacheHit(entry, "jev-1.13.0", 0)).toBe(true);
  expect(jevCacheHit(entry, "jev-1.14.0", 0)).toBe(false);
  expect(jevCacheHit(entry, "jev-latest", JEV_ALIAS_TTL_MS - 1)).toBe(true);
  expect(jevCacheHit(entry, "jev-latest", JEV_ALIAS_TTL_MS)).toBe(false);
  expect(jevCacheHit({ ...entry, resolvedModel: "jev-latest" }, "jev-latest", 0)).toBe(true);
  expect(jevCacheHit({ ...entry, resolvedModel: "other-latest" }, "jev-latest", 0)).toBe(false);
  expect(jevCacheHit(undefined, "jev-1.13.0", 0)).toBe(false);
  // A stored time in the future is not fresh for an alias.
  expect(jevCacheHit({ ...entry, storedAtMs: 10_000 }, "jev-latest", 0)).toBe(false);
  expect(parseJevCache(serializeJevCache([entry]))).toEqual([entry]);
  expect(parseJevCache(JSON.stringify({ entries: [entry, { key: "broken" }] }))).toEqual([entry]);
  // A matching key with a missing resolvedModel is dropped, so an alias lookup cannot throw on it.
  const { resolvedModel: _missing, ...noResolved } = entry;
  expect(parseJevCache(JSON.stringify({ entries: [noResolved, { ...entry, storedAtMs: "0" }] }))).toEqual([]);
  const dir = await createTempDir("idlekit-jev-cache");
  const cachePath = resolve(dir, "cache.json");
  const input = parsed();
  const numerical = evaluateRules(input);
  const pinned = transportOf(() => ({ status: 200, body: noulBody(0.9) }));
  const first = await adviseWithJev({
    ...input,
    numerical,
    requestedModel: "jev-1.13.0",
    dryRun: false,
    cachePath,
    nowMs: 0,
    transport: pinned.transport,
    env: { TYPESAFE_API_KEY: SECRET },
    sleep: async () => {},
  });
  expect(first.cache).toBe("miss");
  const second = await adviseWithJev({
    ...input,
    numerical,
    requestedModel: "jev-1.13.0",
    dryRun: false,
    cachePath,
    nowMs: 10,
    transport: pinned.transport,
    env: { TYPESAFE_API_KEY: SECRET },
    sleep: async () => {},
  });
  expect(second.cache).toBe("hit");
  expect(second.plannedRequests).toBe(0);
  expect(pinned.calls).toBe(1);
  const changed = parsed(3, "rubric-19b");
  const third = await adviseWithJev({
    ...changed,
    numerical: evaluateRules(changed),
    requestedModel: "jev-1.13.0",
    dryRun: false,
    cachePath,
    nowMs: 20,
    transport: pinned.transport,
    env: { TYPESAFE_API_KEY: SECRET },
    sleep: async () => {},
  });
  expect(third.cache).toBe("miss");
  expect(pinned.calls).toBe(2);
  // Only the upper bound of a between rule changes. The rubric version and the numerical digest stay the same.
  const boundsPath = resolve(dir, "bounds.json");
  const bounded = transportOf(() => ({ status: 200, body: noulBody(0.1) }));
  const advisedUpper: number[] = [];
  for (const upperThreshold of [5, 6]) {
    const between = parsed(3, "rubric-19-between", "seed-19", [rule({ operator: "between", threshold: 2, upperThreshold })]);
    const betweenNumerical = evaluateRules(between);
    expect(betweenNumerical.numerical.pass).toBe(true);
    const advised = await adviseWithJev({
      ...between,
      numerical: betweenNumerical,
      requestedModel: "jev-1.13.0",
      dryRun: false,
      cachePath: boundsPath,
      nowMs: 30,
      transport: bounded.transport,
      env: { TYPESAFE_API_KEY: SECRET },
      sleep: async () => {},
    });
    expect(advised.cache).toBe("miss");
    const sent = JSON.parse(bounded.bodies.at(-1) ?? "{}") as { state: { rules: Array<{ upperThreshold: number | null }> } };
    advisedUpper.push(sent.state.rules[0]?.upperThreshold ?? Number.NaN);
  }
  expect(advisedUpper).toEqual([5, 6]);
  expect(bounded.calls).toBe(2);
  // A matching entry whose stored advisory is truncated is a miss, not a crash. The request runs and rewrites it.
  const corruptPath = resolve(dir, "corrupt.json");
  const warmCorrupt = transportOf(() => ({ status: 200, body: noulBody(0.9) }));
  await adviseWithJev({
    ...input,
    numerical,
    requestedModel: "jev-1.13.0",
    dryRun: false,
    cachePath: corruptPath,
    nowMs: 50,
    transport: warmCorrupt.transport,
    env: { TYPESAFE_API_KEY: SECRET },
    sleep: async () => {},
  });
  const stored = parseJevCache(await readText(corruptPath));
  await Bun.write(corruptPath, serializeJevCache(stored.map((entry) => ({ ...entry, advisoryJson: "{\"schemaVersion\":" }))));
  const recovered = await adviseWithJev({
    ...input,
    numerical,
    requestedModel: "jev-1.13.0",
    dryRun: false,
    cachePath: corruptPath,
    nowMs: 60,
    transport: warmCorrupt.transport,
    env: { TYPESAFE_API_KEY: SECRET },
    sleep: async () => {},
  });
  expect(recovered.cache).toBe("miss");
  expect(recovered.status).toBe("ok");
  expect(warmCorrupt.calls).toBe(2);
  // A warm cache answers a dry run's plan: no request would be sent.
  const warmPlan = await adviseWithJev({
    ...input,
    numerical,
    requestedModel: "jev-1.13.0",
    dryRun: true,
    cachePath: corruptPath,
    nowMs: 61,
    env: { TYPESAFE_API_KEY: SECRET },
  });
  expect(warmPlan).toMatchObject({ status: "skipped", plannedRequests: 0 });
  // A valid advisory filed under this key but naming another request is a miss.
  const filed = parseJevCache(await readText(corruptPath));
  await Bun.write(
    corruptPath,
    serializeJevCache(filed.map((entry) => ({
      ...entry,
      advisoryJson: JSON.stringify({ ...JSON.parse(entry.advisoryJson), numericalDigest: "another-report" }),
    }))),
  );
  const misfiled = await adviseWithJev({
    ...input,
    numerical,
    requestedModel: "jev-1.13.0",
    dryRun: false,
    cachePath: corruptPath,
    nowMs: 62,
    transport: warmCorrupt.transport,
    env: { TYPESAFE_API_KEY: SECRET },
    sleep: async () => {},
  });
  expect(misfiled.cache).toBe("miss");
  expect(misfiled.numericalDigest).toBe(numerical.advisoryDigest);
  expect(warmCorrupt.calls).toBe(3);
  // A cache path that cannot be written fails open: one request, and the advisory stands.
  const blocker = resolve(dir, "not-a-directory");
  await Bun.write(blocker, "file");
  const unwritable = transportOf(() => ({ status: 200, body: noulBody(0.9) }));
  const stood = await adviseWithJev({
    ...input,
    numerical,
    requestedModel: "jev-1.13.0",
    dryRun: false,
    cachePath: resolve(blocker, "cache.json"),
    nowMs: 40,
    transport: unwritable.transport,
    env: { TYPESAFE_API_KEY: SECRET },
    sleep: async () => {},
  });
  expect(unwritable.calls).toBe(1);
  expect(stood.status).toBe("ok");
  expect(stood.answers.length).toBe(1);
  const alias = transportOf(() => ({ status: 200, body: noulBody(0.2, "jev-1.13.0") }));
  const aliasPath = resolve(dir, "alias.json");
  const warm = await adviseWithJev({
    ...input,
    numerical,
    requestedModel: "jev-latest",
    dryRun: false,
    cachePath: aliasPath,
    nowMs: 0,
    transport: alias.transport,
    env: { TYPESAFE_API_KEY: SECRET },
    sleep: async () => {},
  });
  expect(warm.resolvedModel).toBe("jev-1.13.0");
  const reused = await adviseWithJev({
    ...input,
    numerical,
    requestedModel: "jev-latest",
    dryRun: false,
    cachePath: aliasPath,
    nowMs: 1_000,
    transport: alias.transport,
    env: { TYPESAFE_API_KEY: SECRET },
    sleep: async () => {},
  });
  expect(reused.cache).toBe("hit");
  const expired = await adviseWithJev({
    ...input,
    numerical,
    requestedModel: "jev-latest",
    dryRun: false,
    cachePath: aliasPath,
    nowMs: JEV_ALIAS_TTL_MS + 1,
    transport: alias.transport,
    env: { TYPESAFE_API_KEY: SECRET },
    sleep: async () => {},
  });
  expect(expired.cache).toBe("miss");
  expect(alias.calls).toBe(2);
  await removePath(dir);
})();
}

/**
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-secret-boundary The request, cache, and report omit the key and the raw marker.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-secret-boundary #2f2eef3 Re-read the section, then ran this function: the secret and each local path form were absent, including a file name with a space and a root-level path, the metric meaning and an amount decimal reached the projection, a rule carried its missing policy, and a repeated metric id projected only its first reading, an estimate and an observed error reading projected no value, a reading no rule names was left out, a path- or key-bearing rubric version was refused unsent, a response or requested model carrying the key was refused, not cached, and not echoed, and a pinned or alias request answered by the wrong model was model-mismatch.
 * @evidence ./jev.schema.ts#jevSecretBoundary Reads the redaction marker.
 * @evidenceReview ./jev.schema.ts#jevSecretBoundary #fe921f9 The declaration is redacted-projection.
 * @evidence ./jev.ts#projectJevState Projects metrics, assumptions, and rules without the key or a local path.
 * @evidenceReview ./jev.ts#projectJevState #ee54760 Re-read projectJevState and the shared Core observation mapper: each rule receives its effective identity and observation status, only measured readings retain a point and sign, amount decimal context remains unsupported, and questions abstain on identity mismatches or unknown observations before using the threshold or valid missing policy, where inconclusive and unsupported both abstain. Secrets and local paths in the request projection are redacted.
 * @evidence ./jev.ts#isSafeJevReport Refuses unsafe metadata in the unchanged sibling numerical report before emitting a Jev bundle.
 * @evidenceReview ./jev.ts#isSafeJevReport #001fec4 Re-read the complete recursive report comparison: the original report with a key-bearing assumption is unsafe, a safe assumption passes, and the CLI rejects unsafe versions and assumptions before transport or output.
 */
export function keepsSecretsOutOfRecords(): Promise<void> {
  return (async (): Promise<void> => {
  expect(jevSecretBoundary).toBe("redacted-projection");
  const assumption = `${SECRET} /Users/secret/plugin.ts`;
  const input = parsed(3, "rubric-19", assumption);
  const numerical = evaluateRules(input);
  expect(isSafeJevReport(numerical, SECRET)).toBe(false);
  expect(isSafeJevReport(evaluateRules(parsed()), SECRET)).toBe(true);
  const seen = transportOf(() => ({ status: 200, body: noulBody(0.9) }));
  const dir = await createTempDir("idlekit-jev-secret");
  const cachePath = resolve(dir, "cache.json");
  const advisory = await adviseWithJev({
    ...input,
    numerical,
    requestedModel: "jev-1.13.0",
    dryRun: false,
    cachePath,
    nowMs: 0,
    transport: seen.transport,
    env: { TYPESAFE_API_KEY: SECRET },
    sleep: async () => {},
  });
  const body = seen.bodies[0] ?? "";
  expect(body.includes(SECRET)).toBe(false);
  expect(body.includes("/Users/secret")).toBe(false);
  expect(body.includes("FULL-STATE-MARKER")).toBe(false);
  expect(body.includes("first-reset")).toBe(true);
  const cached = await readText(cachePath);
  expect(cached.includes(SECRET)).toBe(false);
  expect(cached.includes("/Users/secret")).toBe(false);
  expect(JSON.stringify(advisory).includes(SECRET)).toBe(false);
  const projected = projectJevState(input.artifact, input.rubric, SECRET);
  expect(JSON.stringify(projected).includes(SECRET)).toBe(false);
  const hosts = [
    ["/home/alice/game.json", "[redacted]"],
    ["loaded from /tmp/state.json", "loaded from [redacted]"],
    ["C:\\Users\\alice\\game.json", "[redacted]"],
    ["C:/Users/alice/game.json", "[redacted]"],
    ["save at D:\\Games\\Idle Cafe\\save.json today", "save at [redacted] today"],
    ["\\\\fileserver\\share\\game.json", "[redacted]"],
    ["~/game.json", "[redacted]"],
    ["opened file:///home/alice/game.json", "opened [redacted]"],
    ["(path=/Users/Jane Doe/idle/plugin.ts)", "(path=[redacted])"],
    ["/tmp/My Save.json", "[redacted]"],
    ["/secret.json", "[redacted]"],
    ["loaded from /tmp", "loaded from [redacted]"],
    ["loaded from /tmp/My Save.json today", "loaded from [redacted] today"],
    ["C:\\Users\\alice\\My Save.json", "[redacted]"],
    ["kept under /home/alice/data dir", "kept under [redacted]"],
    ["docs https://example.com/a/b and 3/4 coins/sec", "docs https://example.com/a/b and 3/4 coins/sec"],
  ] as const;
  for (const [raw, expected] of hosts) {
    const hosted = parsed(3, "rubric-19", raw);
    const state = projectJevState(hosted.artifact, hosted.rubric, SECRET).state as { assumptions: readonly string[] };
    expect(state.assumptions).toEqual([expected]);
  }
  const identity = projectJevState(input.artifact, input.rubric, SECRET).state as {
    metrics: readonly Record<string, unknown>[];
    rules: readonly Record<string, unknown>[];
  };
  expect(identity.metrics[0]).toMatchObject({ meaning: "first-reset-hours", method: "exact", unit: "time", metricVersion: 1 });
  expect(identity.rules[0]).toMatchObject({ definition: "first-reset-hours", method: "exact", unit: "time", upperThreshold: null });
  expect(identity.rules[0]).toMatchObject({ missingPolicy: "inconclusive" });
  // A reading no rule names is not projected.
  const extra = {
    ...input.artifact,
    metrics: [...input.artifact.metrics, { ...input.artifact.metrics[0]!, metricId: "unasked", value: 5 }],
  };
  const extraState = projectJevState(extra, input.rubric, SECRET).state as { metrics: readonly Record<string, unknown>[] };
  expect(extraState.metrics.map((metric) => metric.metricId)).toEqual(["first-reset"]);
  const constrained = parsed(3, "rubric-19", "seed-19", [rule({ engineId: "number", seed: "19", scenarioVersion: "v2" })]);
  const constrainedRules = (projectJevState(constrained.artifact, constrained.rubric, SECRET).state as {
    rules: readonly Record<string, unknown>[];
  }).rules;
  expect(constrainedRules[0]).toMatchObject({ engineId: "number", seed: "19", scenarioVersion: "v2", specVersion: null });
  const ruleQuestion = projectJevState(input.artifact, input.rubric, SECRET).questions["first-reset"];
  expect(ruleQuestion?.instructions.includes("missingPolicy")).toBe(true);
  // Two readings with one metric id: only the first, the one the numerical judge reads, is projected.
  const twice = {
    ...input.artifact,
    metrics: [input.artifact.metrics[0]!, { ...input.artifact.metrics[0]!, value: 999 }],
  };
  const deduped = projectJevState(twice, input.rubric, SECRET).state as { metrics: readonly Record<string, unknown>[] };
  expect(deduped.metrics.map((metric) => metric.value)).toEqual([3]);
  // An estimate is missing to the numerical judge, so its value is not projected as a recorded reading.
  const estimated = {
    ...input.artifact,
    metrics: [{ ...input.artifact.metrics[0]!, reading: "estimated" as const, value: 1 }],
  };
  const estimatedState = projectJevState(estimated, input.rubric, SECRET).state as { metrics: readonly Record<string, unknown>[] };
  expect(estimatedState.metrics[0]).toMatchObject({ reading: "estimated", value: null });
  const failedReading = {
    ...input.artifact,
    metrics: [{ ...input.artifact.metrics[0]!, status: "error" as const, value: 1 }],
  };
  const failedState = projectJevState(failedReading, input.rubric, SECRET).state as { metrics: readonly Record<string, unknown>[] };
  expect(failedState.metrics[0]).toMatchObject({ reading: "observed", status: "error", value: null });
  // A model string from the provider that carries the key is refused and never cached.
  const echoDir = await createTempDir("idlekit-jev-model");
  const echoCache = resolve(echoDir, "cache.json");
  const echoed = await adviseWithJev({
    ...input,
    numerical,
    requestedModel: "jev-1.13.0",
    dryRun: false,
    cachePath: echoCache,
    transport: async () => ({ status: 200, body: noulBody(0.9, `jev-${SECRET}`) }),
    env: { TYPESAFE_API_KEY: SECRET },
    sleep: async () => {},
  });
  expect(echoed).toMatchObject({ status: "failed", reason: "unsafe-model", resolvedModel: null });
  // A requested model that carries the key is refused before anything is sent, and the report does not echo it.
  for (const dryRun of [true, false]) {
    let asked = 0;
    const leaky = await adviseWithJev({
      ...input,
      numerical,
      requestedModel: `jev-${SECRET}`,
      dryRun,
      transport: async () => {
        asked += 1;
        return { status: 200, body: noulBody(0.9) };
      },
      env: { TYPESAFE_API_KEY: SECRET },
      sleep: async () => {},
    });
    expect(asked).toBe(0);
    expect(leaky).toMatchObject({ status: "failed", reason: "unsafe-model", requestedModel: "[redacted]", plannedRequests: 0 });
    expect(JSON.stringify(leaky).includes(SECRET)).toBe(false);
  }
  // A rubric version that carries a path or the key is refused before anything is sent and is not echoed.
  for (const version of ["/home/alice/rubric-19", `rubric-${SECRET}`]) {
    let sentVersion = 0;
    const versioned = parsed(3, version);
    const refusedVersion = await adviseWithJev({
      ...versioned,
      numerical: evaluateRules(versioned),
      requestedModel: "jev-1.13.0",
      dryRun: false,
      transport: async () => {
        sentVersion += 1;
        return { status: 200, body: noulBody(0.9) };
      },
      env: { TYPESAFE_API_KEY: SECRET },
      sleep: async () => {},
    });
    expect(sentVersion).toBe(0);
    expect(refusedVersion).toMatchObject({ status: "failed", reason: "unsafe-rubric-version", rubricVersion: "[redacted]" });
    expect(JSON.stringify(refusedVersion).includes(version)).toBe(false);
  }
  // A pinned request answered by another model, or an alias answered by another alias, is not used.
  for (const [requested, answered] of [["jev-1.13.0", "jev-1.14.0"], ["jev-latest", "other-latest"]] as const) {
    const swapped = await adviseWithJev({
      ...input,
      numerical,
      requestedModel: requested,
      dryRun: false,
      transport: async () => ({ status: 200, body: noulBody(0.9, answered) }),
      env: { TYPESAFE_API_KEY: SECRET },
      sleep: async () => {},
    });
    expect(swapped).toMatchObject({ status: "failed", reason: "model-mismatch", answers: [] });
  }
  expect(JSON.stringify(echoed).includes(SECRET)).toBe(false);
  expect(await Bun.file(echoCache).exists()).toBe(false);
  await removePath(echoDir);
  // An amount reading carries its decimal, not `value`, and the projection keeps it.
  const firstMetric = input.artifact.metrics[0]!;
  const amountArtifact = {
    ...input.artifact,
    metrics: [{ ...firstMetric, domain: "amount" as const, sign: "positive" as const, amount: { unit: "COIN", decimal: "12.5" } }],
  };
  const amounts = projectJevState(amountArtifact, input.rubric, SECRET).state as { metrics: readonly Record<string, unknown>[] };
  expect(amounts.metrics[0]).toMatchObject({ amount: { decimal: "12.5", unit: "COIN" }, sign: null, unit: "COIN", observationStatus: "unsupported" });
  expect(amounts.metrics[0]?.value).toBeNull();
  await removePath(dir);
})();
}

/**
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-numerical-unchanged A disagreeing answer does not flip the numerical pass bit.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-numerical-unchanged #5f86d87 Re-read the section, then ran this function: low confidence abstained, the fail stayed a fail, each question asked whether its reading fails the rule, the abstain band was closed at 0.4 and 0.6, a mixed rubric warned only on its failing rule, that warning outranked an abstention, and repeated, __proto__, path, or key ids failed before any send.
 * @evidence ./jev.schema.ts#jevNumericalUnchanged Reads the verdict marker.
 * @evidenceReview ./jev.schema.ts#jevNumericalUnchanged #1105bbe The declaration is verdict-stays.
 * @evidence ./jev.ts#jevAnswerDisposition Maps one answer to ok, abstain, or an advisory warning.
 * @evidenceReview ./jev.ts#jevAnswerDisposition #7d6cee6 Re-read jevAnswerDisposition with the closed abstain band: Choice confidence 0.2, Noul 0.5, and Noul 0.4 and 0.6 on either verdict abstain, 0.399 and 0.601 warn, a Noul of 0.05 against a failing rule is a warning, and the same Noul with no rule verdict abstains.
 * @evidence ./jev.ts#adviseWithJev Compares each answer with its own rule and refuses a rubric whose ids cannot stay separate questions.
 * @evidenceReview ./jev.ts#adviseWithJev #018a20b Re-read adviseWithJev, summarize, and reportStatus after the alias acceptance and bounded cache changes: in a mixed rubric a low Noul warns only on the failing rule, the warning outranks an abstention, and a repeated id, __proto__, or an id holding a path or the key fails before any send.
 */
export function keepsNumericalVerdicts(): Promise<void> {
  return (async (): Promise<void> => {
  expect(jevNumericalUnchanged).toBe("verdict-stays");
  expect(jevAnswerDisposition({ type: "choice", choice: "a", confidence: 0.2, probabilities: { a: 1 } }, false)).toBe("abstain");
  expect(jevAnswerDisposition({ type: "noul", noul: 0.5 }, true)).toBe("abstain");
  const input = parsed();
  const numerical = evaluateRules(input);
  expect(numerical.numerical.pass).toBe(false);
  const conflict = await adviseWithJev({
    ...input,
    numerical,
    requestedModel: "jev-1.13.0",
    dryRun: false,
    transport: async () => ({ status: 200, body: noulBody(0.05) }),
    env: { TYPESAFE_API_KEY: SECRET },
    sleep: async () => {},
  });
  expect(conflict.status).toBe("advisory-warning");
  expect(conflict.numericalUnchanged).toBe(true);
  expect(numerical.numerical.pass).toBe(false);
  expect(conflict.numericalDigest).toBe(numerical.advisoryDigest);
  const unsure = await adviseWithJev({
    ...input,
    numerical,
    requestedModel: "jev-1.13.0",
    dryRun: false,
    transport: async () => ({ status: 200, body: noulBody(0.5) }),
    env: { TYPESAFE_API_KEY: SECRET },
    sleep: async () => {},
  });
  expect(unsure.status).toBe("abstain");
  expect(unsure.status === "ok").toBe(false);
  expect(numerical.numerical.pass).toBe(false);
  expect(jevAnswerDisposition({ type: "noul", noul: 0.05 }, null)).toBe("abstain");
  // The abstain band is closed: rounded boundary values are uncertain, not ok.
  expect(jevAnswerDisposition({ type: "noul", noul: 0.4 }, true)).toBe("abstain");
  expect(jevAnswerDisposition({ type: "noul", noul: 0.6 }, false)).toBe("abstain");
  expect(jevAnswerDisposition({ type: "noul", noul: 0.399 }, true)).toBe("advisory-warning");
  expect(jevAnswerDisposition({ type: "noul", noul: 0.601 }, false)).toBe("advisory-warning");
  // A failing rule makes the report fail. A passing rule's answer is still compared with that rule alone.
  const mixed = parsed(3, "rubric-19-mixed", "seed-19", [
    rule({ id: "too-slow", threshold: 2 }),
    rule({ id: "within-cap", threshold: 5 }),
  ]);
  const mixedNumerical = evaluateRules(mixed);
  expect(mixedNumerical.numerical.pass).toBe(false);
  expect(mixedNumerical.numerical.results.map((result) => [result.id, result.verdict])).toEqual([
    ["too-slow", "fail"],
    ["within-cap", "pass"],
  ]);
  const perRule = await adviseWithJev({
    ...mixed,
    numerical: mixedNumerical,
    requestedModel: "jev-1.13.0",
    dryRun: false,
    transport: async () => ({ status: 200, body: noulAnswers({ "within-cap": 0.1, "too-slow": 0.1 }) }),
    env: { TYPESAFE_API_KEY: SECRET },
    sleep: async () => {},
  });
  expect(perRule.answers.map((answer) => [answer.id, answer.disposition])).toEqual([
    ["too-slow", "advisory-warning"],
    ["within-cap", "ok"],
  ]);
  // The question asks the numerical predicate itself, so a low Noul on a failing rule is a real disagreement.
  const mixedQuestion = projectJevState(mixed.artifact, mixed.rubric, SECRET).questions["too-slow"];
  expect(mixedQuestion?.instructions.includes("fail the rule")).toBe(true);
  expect(mixedQuestion?.type === "noul" && mixedQuestion.criteria?.true).toBe("The recorded reading fails the rule");
  // A warning on one rule is not masked by an abstention on another.
  const masked = await adviseWithJev({
    ...mixed,
    numerical: mixedNumerical,
    requestedModel: "jev-1.13.0",
    dryRun: false,
    transport: async () => ({ status: 200, body: noulAnswers({ "too-slow": 0.1, "within-cap": 0.5 }) }),
    env: { TYPESAFE_API_KEY: SECRET },
    sleep: async () => {},
  });
  expect(masked.answers.map((answer) => answer.disposition)).toEqual(["advisory-warning", "abstain"]);
  expect(masked.status).toBe("advisory-warning");
  // Every numerical rule keeps its own question. A repeated or prototype id is refused before any send.
  for (const [rules, reason] of [
    [[rule({ id: "dup" }), rule({ id: "dup", threshold: 5 })], "duplicate-question-id"],
    [[rule({ id: "__proto__" })], "unsafe-question-id"],
    // A question id is a request property name, so one that holds a path or the key is refused, not sent.
    [[rule({ id: "/home/alice/rules.json" })], "unsafe-question-id"],
    [[rule({ id: `rule-${SECRET}` })], "unsafe-question-id"],
  ] as const) {
    const odd = parsed(3, "rubric-19-ids", "seed-19", rules);
    const oddNumerical = evaluateRules(odd);
    expect(oddNumerical.numerical.results.length).toBe(rules.length);
    let sent = 0;
    const refused = await adviseWithJev({
      ...odd,
      numerical: oddNumerical,
      requestedModel: "jev-1.13.0",
      dryRun: false,
      transport: async () => {
        sent += 1;
        return { status: 200, body: noulBody(0.9) };
      },
      env: { TYPESAFE_API_KEY: SECRET },
      sleep: async () => {},
    });
    expect(sent).toBe(0);
    expect(refused.status).toBe("failed");
    expect(refused.reason).toBe(reason);
    expect(refused.numericalUnchanged).toBe(true);
  }
  const keyed = parsed(3, "rubric-19-keys", "seed-19", [rule({ id: "constructor" })]);
  const keyedQuestions = projectJevState(keyed.artifact, keyed.rubric, SECRET).questions;
  expect(Object.keys(keyedQuestions)).toEqual(["constructor"]);
})();
}

/**
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-opt-in-live Dry-run and a missing key do not send. The fetch transport targets the documented endpoint.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-opt-in-live #7fc28bd Re-read the section, then ran this function: an oversized request was refused before the plan, live and dry, with no planned request, the mock fetch saw the official URL, the live smoke stayed off, and the dry-run bundle names jev.judge.output.schema.json, whose required parts are the rules report, the advisory, and _meta, md printed the endpoint and planned requests and honored --out, a cache naming an input by path, symlink, or hard link, or the output through a symlinked directory or a dangling symlink, was refused, and csv was refused.
 * @evidence ./jev.schema.ts#jevOptInLive Reads the opt-in marker.
 * @evidenceReview ./jev.schema.ts#jevOptInLive #25ccdf0 The declaration is mock-unless-opt-in.
 * @evidence ./jev.schema.ts#JEV_ENDPOINT Reads the documented endpoint.
 * @evidenceReview ./jev.schema.ts#JEV_ENDPOINT #34d2752 The endpoint is the System One URL.
 * @evidence ./jev.ts#jevLiveTransport Reads the transport marker.
 * @evidenceReview ./jev.ts#jevLiveTransport #7e44d88 The declaration is injected-or-fetch.
 * @evidence ./jev.ts#createFetchTransport Posts the built body to the endpoint through the given fetch.
 * @evidenceReview ./jev.ts#createFetchTransport #79a6fde Re-read the streamed fetch transport: the mock sees the endpoint and bearer header, successful bodies stay within 1 MiB, oversized bodies are cancelled without retry, and error bodies are discarded before buffering.
 */
export function staysOptIn(): Promise<void> {
  return (async (): Promise<void> => {
  expect(jevOptInLive).toBe("mock-unless-opt-in");
  expect(jevLiveTransport).toBe("injected-or-fetch");
  expect(JEV_ENDPOINT).toBe("https://api.typesafe.ai/v1/systemone");
  expect(fixture.endpoint).toBe(JEV_ENDPOINT);
  const input = parsed();
  const numerical = evaluateRules(input);
  let calls = 0;
  const planned = await adviseWithJev({
    ...input,
    numerical,
    requestedModel: "jev-latest",
    dryRun: true,
    transport: async () => {
      calls += 1;
      return { status: 200, body: noulBody(0.9) };
    },
    env: { TYPESAFE_API_KEY: SECRET },
  });
  expect(calls).toBe(0);
  expect(planned.status).toBe("skipped");
  expect(planned.plannedRequests).toBe(1);
  // An oversized request is refused before the plan, live or dry, and plans no request.
  for (const dryRun of [true, false]) {
    const oversized = await adviseWithJev({
      ...input,
      numerical,
      requestedModel: "jev-latest",
      dryRun,
      maxInputChars: 10,
      transport: async () => {
        calls += 1;
        return { status: 200, body: noulBody(0.9) };
      },
      env: { TYPESAFE_API_KEY: SECRET },
    });
    expect(oversized).toMatchObject({ status: "failed", reason: "input-too-large", plannedRequests: 0, attempts: 0 });
  }
  expect(calls).toBe(0);
  expect(planned.endpoint).toBe(JEV_ENDPOINT);
  const missing = await adviseWithJev({
    ...input,
    numerical,
    requestedModel: "jev-latest",
    dryRun: false,
    transport: async () => {
      calls += 1;
      return { status: 200, body: noulBody(0.9) };
    },
    env: {},
  });
  expect(calls).toBe(0);
  expect(missing.status).toBe("unavailable");
  expect(missing.reason).toBe("missing-api-key");
  expect(missing.plannedRequests).toBe(0);
  let seenUrl = "";
  let seenAuth = "";
  let seenBody = "";
  const transport = createFetchTransport(async (url, init) => {
    seenUrl = String(url);
    seenAuth = new Headers(init?.headers).get("Authorization") ?? "";
    seenBody = String(init?.body ?? "");
    return new Response(noulBody(0.9), { status: 200 });
  });
  const live = await adviseWithJev({
    ...input,
    numerical,
    requestedModel: "jev-1.13.0",
    dryRun: false,
    transport,
    env: { TYPESAFE_API_KEY: SECRET },
    sleep: async () => {},
  });
  expect(live.status).toBe("ok");
  expect(seenUrl).toBe(fixture.endpoint);
  expect(seenAuth).toBe(`Bearer ${SECRET}`);
  expect(seenBody.includes(SECRET)).toBe(false);
  expect(live.usage).toEqual({ inputTokens: 11, outputTokens: 3 });
  const dir = await createTempDir("idlekit-jev-cli");
  const analysis = resolve(dir, "analysis.json");
  const rubricPath = resolve(dir, "rubric.json");
  await Bun.write(analysis, artifact(3));
  await Bun.write(rubricPath, rubric());
  // In process, through the same writer as the CLI. The sealed evidence sandbox has no `bun` on PATH to spawn.
  const outPath = resolve(dir, "planned.json");
  await runJudge(
    { rubric: rubricPath, provider: "jev", format: "json", "dry-run": true, out: outPath },
    analysis,
    { env: { TYPESAFE_API_KEY: "" } },
  );
  const written = await readText(outPath);
  const json = JSON.parse(written) as {
    numericalReport: { provider: string; numerical: { pass: boolean } };
    advisory: { status: string; dryRun: boolean; endpoint: string };
  };
  expect(json.numericalReport.provider).toBe("rules");
  expect(json.numericalReport.numerical.pass).toBe(false);
  expect(json.advisory.status).toBe("skipped");
  expect(json.advisory.dryRun).toBe(true);
  expect(json.advisory.endpoint).toBe(JEV_ENDPOINT);
  expect(written.includes(SECRET)).toBe(false);
  // The advertised schemaRef names the bundle schema, not the advisory alone. output-schema.test.ts validates against it.
  const meta = (json as unknown as { _meta: { schemaRef: string } })._meta;
  expect(meta.schemaRef).toBe("docs/schemas/jev.judge.output.schema.json");
  const bundleSchema = JSON.parse(
    readFileSync(new URL("../../../../../../docs/schemas/jev.judge.output.schema.json", import.meta.url), "utf8"),
  ) as { required: string[]; properties: Record<string, { $ref?: string }> };
  expect(bundleSchema.required).toEqual(["numericalReport", "advisory", "_meta"]);
  // Markdown shows the dry-run plan, as json does.
  const printed: string[] = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = ((body: string, callback: (error?: Error) => void) => {
    printed.push(body);
    callback();
    return true;
  }) as typeof process.stdout.write;
  try {
    await runJudge({ rubric: rubricPath, provider: "jev", format: "md", "dry-run": true }, analysis, { env: {} });
  } finally {
    process.stdout.write = originalWrite;
  }
  expect(printed.some((line) => line.includes(`- Endpoint: ${JEV_ENDPOINT}`))).toBe(true);
  expect(printed.some((line) => line.includes("- Planned requests: 0"))).toBe(true);
  // A cache that is an input file would overwrite that input after a success, so it is refused too.
  for (const input of [analysis, rubricPath]) {
    await expect(
      runJudge({ rubric: rubricPath, provider: "jev", format: "json", cache: input }, analysis, { env: {} }),
    ).rejects.toThrow("names an input file");
  }
  // A symlink or a hard link to an input is the same file, so it is refused as a cache too.
  const symlinked = resolve(dir, "cache-link.json");
  const canLinkFiles = fileSymlink(analysis, symlinked);
  const hardLinked = resolve(dir, "cache-hard.json");
  linkSync(rubricPath, hardLinked);
  for (const alias of [...(canLinkFiles ? [symlinked] : []), hardLinked]) {
    await expect(
      runJudge({ rubric: rubricPath, provider: "jev", format: "json", cache: alias }, analysis, { env: {} }),
    ).rejects.toThrow("names an input file");
  }
  // A missing cache and output file reached through a symlinked directory are still the same file.
  const realDir = resolve(dir, "real");
  mkdirSync(realDir, { recursive: true });
  const aliasDir = resolve(dir, "alias");
  symlinkSync(realDir, aliasDir, process.platform === "win32" ? "junction" : "dir");
  await expect(
    runJudge(
      {
        rubric: rubricPath,
        provider: "jev",
        format: "json",
        cache: resolve(aliasDir, "report.json"),
        out: resolve(realDir, "report.json"),
      },
      analysis,
      { env: {} },
    ),
  ).rejects.toThrow("same file");
  // A dangling symlink whose target is the output file is the same file too.
  const danglingTarget = resolve(realDir, "later.json");
  const dangling = resolve(dir, "dangling.json");
  if (fileSymlink(danglingTarget, dangling)) {
    await expect(
      runJudge({ rubric: rubricPath, provider: "jev", format: "json", cache: dangling, out: danglingTarget }, analysis, { env: {} }),
    ).rejects.toThrow("same file");
  }
  // md honors --out like json does.
  const mdOut = resolve(dir, "plan.md");
  await runJudge({ rubric: rubricPath, provider: "jev", format: "md", "dry-run": true, out: mdOut }, analysis, { env: {} });
  expect(await readText(mdOut)).toContain(`- Endpoint: ${JEV_ENDPOINT}`);
  // A cache that is also the output file would be overwritten by the bundle, so the pair is refused.
  await expect(
    runJudge(
      { rubric: rubricPath, provider: "jev", format: "json", cache: resolve(dir, "same.json"), out: resolve(dir, "same.json") },
      analysis,
      { env: {} },
    ),
  ).rejects.toThrow("same file");
  // csv cannot hold the two nested reports, so the Jev provider refuses it before reading any input.
  await expect(
    runJudge({ rubric: rubricPath, provider: "jev", format: "csv", "dry-run": true }, analysis, { env: {} }),
  ).rejects.toThrow("csv cannot hold");
  expect(bundleSchema.properties.advisory?.$ref).toBe(jevSchemaId());
  expect(Object.keys(json).sort()).toEqual(["_meta", "advisory", "numericalReport"]);
  await removePath(dir);
})();
}

describe("jev judge provider", () => {
  it("keeps raw numerical verdicts when redaction collapses different identities", async () => {
    const base = parsed();
    for (const definition of ["/private/b.json", "/private/a.json"]) {
      const input = {
        ...base,
        artifact: { ...base.artifact, metrics: base.artifact.metrics.map((metric) => ({ ...metric, meaning: "/private/a.json" })) },
        rubric: { ...base.rubric, rules: base.rubric.rules.map((item) => ({ ...item, definition })) },
      };
      const numerical = evaluateRules(input);
      const verdict = definition.endsWith("b.json") ? "inconclusive" : "fail";
      expect(numerical.numerical.results[0]!.verdict).toBe(verdict);
      const projection = projectJevState(input.artifact, input.rubric, SECRET);
      expect((projection.state.rules as { numericalVerdict: string }[])[0]!.numericalVerdict).toBe(verdict);
      expect(JSON.stringify(projection)).not.toContain("/private/");
      const fake = transportOf(() => ({ status: 200, body: noulBody(0.9) }));
      const result = await adviseWithJev({ ...input, numerical, requestedModel: "jev-1.13.0", dryRun: false, env: { TYPESAFE_API_KEY: SECRET }, transport: fake.transport });
      expect(result.status).toBe(verdict === "inconclusive" ? "abstain" : "ok");
    }
  });
  it("retains provider retry delays and uses bounded SDK backoff", async () => {
    const input = parsed();
    const future = new Date(Date.now() + 4000).toUTCString();
    for (const [headers, expected] of [
      [new Headers({ "Retry-After": "2" }), 2000],
      [new Headers({ "retry-after-ms": "1250", "Retry-After": "5" }), 1250],
      [new Headers({ "Retry-After": "Wed, 21 Oct 2015 07:28:00 GMT" }), 0],
      [new Headers({ "Retry-After": "bad" }), undefined],
    ] as const) {
      const response = await createFetchTransport(async () => new Response("discarded", { status: 429, headers }))({ url: JEV_ENDPOINT, body: "{}", headers: {}, signal: new AbortController().signal });
      expect((response as { retryAfterMs?: number }).retryAfterMs).toBe(expected);
    }
    const dated = await createFetchTransport(async () => new Response("", { status: 503, headers: { "Retry-After": future } }))({ url: JEV_ENDPOINT, body: "{}", headers: {}, signal: new AbortController().signal });
    expect((dated as { retryAfterMs?: number }).retryAfterMs).toBeGreaterThanOrEqual(2000);
    expect((dated as { retryAfterMs?: number }).retryAfterMs).toBeLessThanOrEqual(4000);
    for (const [hint, expected] of [[1250, 1250], [0, 0], [60000, 60000], [60001, 500], [-1, 500], [NaN, 500], [undefined, 500]] as const) {
      let calls = 0;
      const waits: number[] = [];
      const result = await adviseWithJev({ ...input, numerical: evaluateRules(input), requestedModel: "jev-1.13.0", dryRun: false, maxRetries: 1, env: { TYPESAFE_API_KEY: SECRET },
        transport: async () => ++calls === 1 ? { status: 429, body: "", retryAfterMs: hint } : { status: 200, body: noulBody(0.9) },
        sleep: async (ms) => { waits.push(ms); },
      });
      expect(result.status).toBe("ok");
      expect(waits).toEqual([expected]);
    }
  });
  it("rejects non-file cache and output targets before calling Jev", async () => {
    const dir = await createTempDir("jev-invalid-target-");
    try {
      const analysis = resolve(dir, "analysis.json");
      const rubricPath = resolve(dir, "rubric.json");
      const parentFile = resolve(dir, "parent-file");
      await Bun.write(analysis, artifact(3));
      await Bun.write(rubricPath, rubric());
      await Bun.write(parentFile, "keep");
      const mock = transportOf(() => ({ status: 200, body: noulBody(0.9) }));
      for (const target of [dir, resolve(parentFile, "child.json")]) {
        for (const flag of ["cache", "out"] as const) {
          await expect(runJudge({ rubric: rubricPath, provider: "jev", format: "json", [flag]: target }, analysis,
            { env: { TYPESAFE_API_KEY: SECRET }, transport: mock.transport })).rejects.toThrow(`--${flag}`);
        }
      }
      expect(mock.calls).toBe(0);
      expect(await readText(parentFile)).toBe("keep");
    } finally { await removePath(dir); }
  });
  it("waits for a large Jev Markdown write callback under backpressure", async () => {
    const dir = await createTempDir("jev-markdown-pipe-");
    const originalWrite = process.stdout.write;
    const originalLog = console.log;
    let releaseWrite: (() => void) | undefined;
    let captured = "";
    let announced!: () => void;
    const started = new Promise<void>((resolve) => { announced = resolve; });
    process.stdout.write = ((body: string, callback: (error?: Error) => void) => {
      captured = body;
      releaseWrite = () => callback();
      announced();
      return false;
    }) as typeof process.stdout.write;
    console.log = () => { announced(); };
    try {
      const analysis = resolve(dir, "analysis.json");
      const rubricPath = resolve(dir, "rubric.json");
      const base = JSON.parse(rubric());
      base.rules = Array.from({ length: 4000 }, (_, index) => ({ ...base.rules[0], id: `rule-${index}` }));
      await Bun.write(analysis, artifact(3));
      await Bun.write(rubricPath, JSON.stringify(base));
      let finished = false;
      const writing = runJudge({ rubric: rubricPath, provider: "jev", format: "md", "dry-run": true }, analysis,
        { env: {} }).then(() => { finished = true; });
      await started;
      expect(releaseWrite).toBeDefined();
      expect(finished).toBe(false);
      expect(captured.length).toBeGreaterThan(260_000);
      expect(captured).toContain("# Rules judge");
      expect(captured).toContain("- Planned requests: 0");
      expect(captured.endsWith("None.\n")).toBe(true);
      releaseWrite!();
      await writing;
      expect(finished).toBe(true);
    } finally {
      releaseWrite?.();
      process.stdout.write = originalWrite;
      console.log = originalLog;
      await removePath(dir);
    }
  });
  it("accepts an alias-valued response and caches it only inside the alias TTL", async () => {
    const dir = await createTempDir("jev-alias-response-");
    try {
      const input = parsed(3);
      const transport = transportOf(() => ({ status: 200, body: noulBody(0.9, "jev-latest") }));
      const args = { ...input, numerical: evaluateRules(input), requestedModel: "jev-latest", dryRun: false,
        cachePath: resolve(dir, "cache.json"), env: { TYPESAFE_API_KEY: SECRET }, transport: transport.transport };
      const first = await adviseWithJev({ ...args, nowMs: 0 });
      expect(first).toMatchObject({ status: "ok", resolvedModel: "jev-latest", cache: "miss", aliasPolicy: "ttl-24h" });
      expect((await adviseWithJev({ ...args, nowMs: JEV_ALIAS_TTL_MS - 1 })).cache).toBe("hit");
      expect((await adviseWithJev({ ...args, nowMs: JEV_ALIAS_TTL_MS })).cache).toBe("miss");
      expect(transport.calls).toBe(2);
    } finally { await removePath(dir); }
  });
  it("includes probability and weighted-score tolerance boundaries", () => {
    const questions = { choice: { type: "choice" as const, instructions: "Choose", criteria: { yes: "yes", no: "no" } } };
    for (const p of [0.49, 0.51]) {
      const body = { model: "jev-latest", answers: { choice: { type: "choice", choice: "yes", confidence: 0.7, probabilities: { yes: p, no: p } } }, usage: { input_tokens: 1, output_tokens: 1 } };
      expect(readJevWire(JSON.stringify(body), questions).ok).toBe(true);
      body.answers.choice.probabilities = { yes: p + 0.001, no: p + 0.001 };
      expect(readJevWire(JSON.stringify(body), questions).ok).toBe(p < 0.5);
    }
    const scoreQuestion = { score: { type: "score" as const, instructions: "Rate", criteria: ["low", "high"] } };
    const body = { model: "jev-latest", answers: { score: { type: "score", score: 0.52, confidence: 0.7, legend: { "0": "low", "1": "high" }, probabilities: { "0": 0.5, "1": 0.5 } } }, usage: { input_tokens: 1, output_tokens: 1 } };
    expect(readJevWire(JSON.stringify(body), scoreQuestion).ok).toBe(true);
    body.answers.score.score = 0.48;
    expect(readJevWire(JSON.stringify(body), scoreQuestion).ok).toBe(true);
    body.answers.score.score = 0.479;
    expect(readJevWire(JSON.stringify(body), scoreQuestion).ok).toBe(false);
  });
  it("evicts expired aliases and bounds persisted cache entries", async () => {
    const dir = await createTempDir("jev-cache-bound-");
    try {
      const path = resolve(dir, "cache.json");
      const entries: JevCacheEntry[] = Array.from({ length: 260 }, (_, index) => ({ key: `pinned-${index}`,
        requestedModel: "jev-1.13.0", resolvedModel: "jev-1.13.0", rubricVersion: "r1", storedAtMs: index, advisoryJson: "{}" }));
      entries.push({ ...entries[0]!, key: "expired-alias", requestedModel: "jev-latest", resolvedModel: "jev-latest", storedAtMs: 0 });
      await Bun.write(path, serializeJevCache(entries));
      const input = parsed(3);
      const result = await adviseWithJev({ ...input, numerical: evaluateRules(input), requestedModel: "jev-1.13.0", dryRun: false,
        cachePath: path, nowMs: JEV_ALIAS_TTL_MS, env: { TYPESAFE_API_KEY: SECRET },
        transport: async () => ({ status: 200, body: noulBody(0.9) }) });
      expect(result.status).toBe("ok");
      const stored = parseJevCache(await readText(path));
      expect(stored).toHaveLength(256);
      expect(stored.some((entry) => entry.key === "expired-alias")).toBe(false);
      expect(stored.some((entry) => entry.key === "pinned-0")).toBe(false);
      expect(stored.some((entry) => entry.key === "pinned-259")).toBe(true);
      expect(stored.at(-1)?.advisoryJson).toBe(JSON.stringify(result));
    } finally { await removePath(dir); }
  });
  it("rejects a Choice winner below another requested option", () => {
    const questions = { choice: { type: "choice" as const, instructions: "Choose", criteria: { yes: "yes", no: "no" } } };
    const body = { model: "jev-1.13.0", answers: { choice: { type: "choice", choice: "no", confidence: 0.7, probabilities: { yes: 0.9, no: 0.1 } } }, usage: { input_tokens: 1, output_tokens: 1 } };
    expect(readJevWire(JSON.stringify(body), questions).ok).toBe(false);
    body.answers.choice.choice = "yes";
    expect(readJevWire(JSON.stringify(body), questions).ok).toBe(true);
    body.answers.choice.probabilities = { yes: 0.5, no: 0.5 };
    expect(readJevWire(JSON.stringify(body), questions).ok).toBe(true);
  });
  it("rejects newline-joined probability keys as separate requested options", () => {
    const questions = { choice: { type: "choice" as const, instructions: "Choose", criteria: { yes: "yes", no: "no" } } };
    const body = { model: "jev-1.13.0", answers: { choice: { type: "choice", choice: "yes", confidence: 0.7, probabilities: { "no\nyes": 1 } } }, usage: { input_tokens: 1, output_tokens: 1 } };
    expect(readJevWire(JSON.stringify(body), questions).ok).toBe(false);
  });
  it("refuses blank question IDs before live or planned transport", async () => {
    for (const id of ["", " ", "\t\n"]) {
      const input = parsed(3, "blank-id", "seed-19", [rule({ id })]);
      for (const dryRun of [false, true]) {
        const fake = transportOf(() => ({ status: 200, body: noulBody(0.9) }));
        const result = await adviseWithJev({ ...input, numerical: evaluateRules(input), env: { TYPESAFE_API_KEY: SECRET }, requestedModel: "jev-1.13.0", dryRun, transport: fake.transport });
        expect(result.reason).toBe("unsafe-question-id");
        expect(result.plannedRequests).toBe(0);
        expect(result.attempts).toBe(0);
        expect(fake.calls).toBe(0);
      }
    }
  });
  it("binds Score legends and weighted values to the requested criteria", () => {
    const questions = { rating: { type: "score" as const, instructions: "Rate", criteria: ["low", "medium", "high"] } };
    const answer = { type: "score", score: 1.7, confidence: 0.6, legend: { "0": "low", "1": "medium", "2": "high" }, probabilities: { "0": 0.1, "1": 0.1, "2": 0.8 } };
    const read = (change: Record<string, unknown>) => readJevWire(JSON.stringify({ model: "jev-1.13.0", answers: { rating: { ...answer, ...change } }, usage: { input_tokens: 1, output_tokens: 1 } }), questions);
    expect(read({}).ok).toBe(true);
    expect(read({ score: 1.699999999 }).ok).toBe(true);
    expect(read({ score: 1.71 }).ok).toBe(true);
    for (const change of [
      { legend: { "0": "high", "1": "medium", "2": "low" } },
      { legend: { "1": "low", "2": "medium", "3": "high" }, probabilities: { "1": 0.1, "2": 0.1, "3": 0.8 } },
      { score: 0.5 }, { score: -0.1 }, { score: 2.1 }, { score: 1.731 },
    ]) expect(read(change).ok).toBe(false);
  });
  it("redacts absolute paths after punctuation while preserving web URL punctuation", () => {
    for (const delimiter of ["->", ")", "]", "!", "?", "_", "#", "&", "+", "|", "*"]) {
      const input = parsed(3, "punctuation", `report${delimiter}/home/alice/key.json`);
      expect(JSON.stringify(projectJevState(input.artifact, input.rubric, SECRET).state)).not.toContain("/home/alice/key.json");
      expect(isSafeJevReport(evaluateRules(input), SECRET)).toBe(false);
    }
    for (const url of ["https://example.com/a)/b?next=/reference", "https://[::1]/path", "https://example.com/a!/_b"]) {
      const input = parsed(3, "url", url);
      expect(JSON.stringify(projectJevState(input.artifact, input.rubric, SECRET).state)).toContain(url);
      expect(isSafeJevReport(evaluateRules(input), SECRET)).toBe(true);
    }
  });
  it("misses a legacy state-only cache and binds question wording", async () => {
    const dir = await createTempDir("j");
    try {
      const input = parsed();
      const numerical = evaluateRules(input);
      const projection = projectJevState(input.artifact, input.rubric, SECRET);
      const common = { numericalDigest: numerical.advisoryDigest, rubricVersion: input.rubric.rubricVersion,
        requestedModel: "jev-1.13.0", adapterVersion: jevAlgorithmVersion() };
      const cachePath = resolve(dir, "cache.json");
      const mock = transportOf(() => ({ status: 200, body: noulBody(0.9) }));
      const args = { ...input, numerical, requestedModel: common.requestedModel, dryRun: false, cachePath,
        transport: mock.transport, env: { TYPESAFE_API_KEY: SECRET } };
      await adviseWithJev(args);
      const entry = parseJevCache(await readText(cachePath))[0]!;
      await Bun.write(cachePath, serializeJevCache([{ ...entry, key: jevCacheKey({ ...common, projection: projection.state }) }]));
      expect((await adviseWithJev(args)).cache).toBe("miss");
      expect(mock.calls).toBe(2);
      const key = jevCacheKey({ ...common, projection: { state: projection.state, questions: projection.questions } });
      expect(parseJevCache(await readText(cachePath)).some((item) => item.key === key)).toBe(true);
      const changed = { ...projection.questions, "first-reset": { ...projection.questions["first-reset"]!, instructions: "changed question" } };
      expect(jevCacheKey({ ...common, projection: { state: projection.state, questions: changed } })).not.toBe(key);
      expect((await adviseWithJev(args)).cache).toBe("hit");
    } finally { await removePath(dir); }
  });
  it("retains validated paid usage when a resolved model is rejected", async () => {
    const input = parsed();
    for (const model of ["another-model", SECRET, "/home/alice/model"]) {
      const mock = transportOf(() => ({ status: 200, body: noulBody(0.9, model) }));
      const result = await adviseWithJev({ ...input, numerical: evaluateRules(input), requestedModel: "jev-1.13.0", dryRun: false,
        transport: mock.transport, env: { TYPESAFE_API_KEY: SECRET } });
      expect(result).toMatchObject({ status: "failed", resolvedModel: null, usage: { inputTokens: 11, outputTokens: 3 } });
      expect(JSON.stringify(result)).not.toContain(model);
      expect(mock.calls).toBe(1);
    }
  });
  it("redacts forward-slash UNC paths while preserving full web URLs", () => {
    for (const path of ["//server/share/secret.json", "See //server/share/secret.json for input", "//secret.json", "///tmp/secret.json", "FILE:///home/alice/secret.json"]) {
      const input = parsed(3, "unc", path);
      const projection = JSON.stringify(projectJevState(input.artifact, input.rubric, SECRET).state);
      expect(projection).not.toContain(path);
      expect(projection).toContain("[redacted]");
      expect(isSafeJevReport(evaluateRules(input), SECRET)).toBe(false);
    }
    for (const url of ["https://example.com/share/report.json", "http://example.com/share/report.json", "HTTPS://example.com/share/report.json"]) {
      const input = parsed(3, "web", url);
      expect(JSON.stringify(projectJevState(input.artifact, input.rubric, SECRET).state)).toContain(url);
      expect(isSafeJevReport(evaluateRules(input), SECRET)).toBe(true);
    }
  });
  it("refuses padded resolved model identifiers before saving an alias response", async () => {
    const input = parsed();
    for (const model of [" jev-latest ", " jev-1.13.0 ", "   "]) {
      const mock = transportOf(() => ({ status: 200, body: noulBody(0.9, model) }));
      const result = await adviseWithJev({ ...input, numerical: evaluateRules(input), requestedModel: "jev-latest", dryRun: false,
        transport: mock.transport, env: { TYPESAFE_API_KEY: SECRET } });
      expect(result).toMatchObject({ status: "failed", reason: "model-mismatch", resolvedModel: null });
      expect(mock.calls).toBe(1);
    }
  });
  it("rechecks persisted cache metadata and rejects extra report fields", async () => {
    const dir = await createTempDir("j");
    try {
      const input = parsed();
      const mock = transportOf(() => ({ status: 200, body: noulBody(0.9) }));
      const cachePath = resolve(dir, "cache.json");
      const args = { ...input, numerical: evaluateRules(input), requestedModel: "jev-latest", dryRun: false,
        cachePath, nowMs: 10, transport: mock.transport, env: { TYPESAFE_API_KEY: SECRET } };
      await adviseWithJev(args);
      const entry = parseJevCache(await readText(cachePath))[0]!;
      const advisory = JSON.parse(entry.advisoryJson) as JevAdvisoryV1;
      const invalid: JevAdvisoryV1[] = [
        ...["/home/alice/private", SECRET, "", "   ", " jev-latest ", " jev-1.13.0 "].map((resolvedModel) => ({ ...advisory, resolvedModel })),
        { ...advisory, endpoint: "/home/alice/private" },
        { ...advisory, endpoint: "https://other.example/v1" },
        { ...advisory, aliasPolicy: "pinned" },
        { ...advisory, rawState: "FULL-STATE-MARKER" } as JevAdvisoryV1,
        { ...advisory, answers: [Object.assign({}, advisory.answers[0]!, { rawState: "FULL-STATE-MARKER" })] },
      ];
      for (const corrupted of invalid) {
        expect(validateJevAdvisory(corrupted).success).toBe(true);
        await Bun.write(cachePath, serializeJevCache([{ ...entry, resolvedModel: corrupted.resolvedModel!, advisoryJson: JSON.stringify(corrupted) }]));
        const result = await adviseWithJev(args);
        expect(result.cache).toBe("miss");
        expect(JSON.stringify(result)).not.toContain("FULL-STATE-MARKER");
        expect(result.endpoint).toBe(JEV_ENDPOINT);
        expect(result.resolvedModel).toBe("jev-1.13.0");
      }
      expect(mock.calls).toBe(1 + invalid.length);
      expect((await adviseWithJev(args)).cache).toBe("hit");
    } finally { await removePath(dir); }
  });
  it("refuses deep output aliases beneath a dangling directory link", async () => {
    const dir = await createTempDir("j");
    try {
      const target = resolve(dir, "later");
      const alias = resolve(dir, "alias");
      symlinkSync(target, alias, process.platform === "win32" ? "junction" : "dir");
      const suffix = [...Array<string>(35).fill("x"), "report.json"];
      await expect(runJudge({ rubric: "unused", provider: "jev", format: "json",
        cache: resolve(alias, ...suffix), out: resolve(target, ...suffix) }, "unused", { env: {} })).rejects.toThrow("same file");
    } finally { await removePath(dir); }
  });
  it("rejects cached answers and summaries that do not match the current questions", async () => {
    const dir = await createTempDir("j");
    try {
      const input = parsed();
      const mock = transportOf(() => ({ status: 200, body: noulBody(0.9) }));
      const cachePath = resolve(dir, "cache.json");
      const args = { ...input, numerical: evaluateRules(input), requestedModel: "jev-1.13.0", dryRun: false,
        cachePath, transport: mock.transport, env: { TYPESAFE_API_KEY: SECRET } };
      await adviseWithJev(args);
      const entries = parseJevCache(await readText(cachePath));
      const original = JSON.parse(entries[0]!.advisoryJson) as JevAdvisoryV1;
      const answer = original.answers[0]!;
      const invalid: JevAdvisoryV1[] = [
        { ...original, answers: [{ ...answer, id: "another-rule" }] },
        { ...original, answers: [{ id: answer.id, type: "choice", choice: "yes", confidence: 1, noul: null, score: null, disposition: "ok" }] },
        { ...original, answers: [] },
        { ...original, answers: [answer, answer] },
        { ...original, answers: [{ ...answer, disposition: "abstain" }] },
        { ...original, status: "abstain", reason: "abstain" },
        { ...original, reason: "another-summary" },
      ];
      for (const advisory of invalid) {
        expect(validateJevAdvisory(advisory).success).toBe(true);
        await Bun.write(cachePath, serializeJevCache([{ ...entries[0]!, advisoryJson: JSON.stringify(advisory) }]));
        expect((await adviseWithJev(args)).cache).toBe("miss");
      }
      expect(mock.calls).toBe(1 + invalid.length);
      expect((await adviseWithJev(args)).cache).toBe("hit");
      expect(mock.calls).toBe(1 + invalid.length);
    } finally { await removePath(dir); }
  });
  it("instructs abstention for unsupported between bounds", () => {
    for (const upperThreshold of [null, 1]) {
      const input = parsed(3, "bounds", "seed-19", [rule({ operator: "between", threshold: 2, upperThreshold })]);
      expect(evaluateRules(input).numerical.results[0]!.verdict).toBe("unsupported");
      expect(projectJevState(input.artifact, input.rubric, SECRET).questions["first-reset"]!.instructions)
        .toContain("between rule lacks ordered finite bounds, answer 0.5");
    }
  });
  it("refuses empty model names before planning or sending and trims valid names", async () => {
    const input = parsed();
    const mock = transportOf(() => ({ status: 200, body: noulBody(0.9) }));
    for (const requestedModel of ["", "   "]) {
      for (const dryRun of [false, true]) {
        expect(await adviseWithJev({ ...input, numerical: evaluateRules(input), requestedModel, dryRun,
          transport: mock.transport, env: { TYPESAFE_API_KEY: SECRET } })).toMatchObject({
          status: "failed", reason: "invalid-model", plannedRequests: 0, attempts: 0,
        });
      }
      await expect(runJudge({ rubric: "unused", provider: "jev", format: "json", model: requestedModel }, "unused"))
        .rejects.toThrow("nonempty model");
    }
    expect(mock.calls).toBe(0);
    const trimmed = await adviseWithJev({ ...input, numerical: evaluateRules(input), requestedModel: " jev-1.13.0 ", dryRun: false,
      transport: mock.transport, env: { TYPESAFE_API_KEY: SECRET } });
    expect(trimmed).toMatchObject({ status: "ok", requestedModel: "jev-1.13.0" });
    expect(mock.calls).toBe(1);
  });
  it("caches requests beneath more than 32 missing directories", async () => {
    const dir = await createTempDir("j");
    try {
      const input = parsed();
      const mock = transportOf(() => ({ status: 200, body: noulBody(0.9) }));
      const args = { ...input, numerical: evaluateRules(input), requestedModel: "jev-1.13.0", dryRun: false,
        cachePath: resolve(dir, ...Array<string>(35).fill("x"), "c"), transport: mock.transport, env: { TYPESAFE_API_KEY: SECRET } };
      expect((await adviseWithJev(args)).cache).toBe("miss");
      expect((await adviseWithJev(args)).cache).toBe("hit");
      expect(mock.calls).toBe(1);
    } finally { await removePath(dir); }
  });
  it("instructs abstention for an unsupported missing policy", () => {
    const input = parsed(3, "missing-policy", "seed-19", [rule({ missingPolicy: "unsupported" })]);
    const projection = projectJevState(input.artifact, input.rubric, SECRET);
    expect(projection.questions["first-reset"]!.instructions).toContain("inconclusive and unsupported mean 0.5");
    expect(projection.questions["first-reset"]!.instructions).not.toContain("pass means 0");
  });
  it("bounds streamed response bytes and discards error bodies", async () => {
    const input = parsed();
    for (const status of [200, 401, 429, 503]) {
      let pulled = 0;
      let cancelled = false;
      const whitespace = new TextEncoder().encode(" ".repeat(65_536));
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulled += 1;
          if (pulled <= 32) controller.enqueue(whitespace);
          else { controller.enqueue(new TextEncoder().encode(noulBody(0.9))); controller.close(); }
        },
        cancel() { cancelled = true; },
      });
      const transport = createFetchTransport(async () => new Response(stream, { status }));
      const advised = await adviseWithJev({ ...input, numerical: evaluateRules(input), requestedModel: "jev-1.13.0",
        dryRun: false, maxRetries: 0, transport, env: { TYPESAFE_API_KEY: SECRET } });
      expect(advised.reason).toBe(status === 200 ? "response-too-large" : status === 401 ? "authentication" : status === 429 ? "rate-limit" : "upstream");
      expect(cancelled).toBe(true);
      expect(pulled).toBeLessThanOrEqual(status === 200 ? 18 : 2);
      expect(advised.attempts).toBe(1);
    }
  });
  it("withholds signs and records the effective numerical identity", () => {
    const input = parsed(1, "identity", "seed-19", [rule({ engineId: "number", algorithmVersion: "other" })]);
    for (const observed of [
      { ...input.artifact, observationCoverage: "incomplete" as const },
      { ...input.artifact, metrics: input.artifact.metrics.map((metric) => ({ ...metric, reading: "estimated" as const, sign: "positive" as const })) },
    ]) {
      const projection = projectJevState(observed, input.rubric, SECRET);
      const row = (projection.state as { metrics: readonly Record<string, unknown>[] }).metrics[0]!;
      expect(row.sign).toBeNull();
      expect(row).toMatchObject({ engineId: "unspecified", scenarioVersion: "unspecified", specVersion: "unspecified",
        pluginVersion: "unspecified", seed: "unspecified", algorithmVersion: "analysis-artifact-v1" });
      expect(projection.questions["first-reset"]!.instructions).toContain("identity");
      expect(projection.questions["first-reset"]!.instructions).toContain("0.5");
    }
  });
  it("rejects unsafe numerical bundle metadata before transport or output", async () => {
    const dir = await createTempDir("idlekit-jev-bundle-secret");
    try {
      const analysis = resolve(dir, "analysis.json");
      const rubricPath = resolve(dir, "rubric.json");
      const out = resolve(dir, "answer.json");
      const cache = resolve(dir, "cache.json");
      const mock = transportOf(() => ({ status: 200, body: noulBody(0.9) }));
      for (const [version, assumption] of [[SECRET, "seed-19"], ["/home/private/rubric.json", "seed-19"], ["rubric-19", SECRET], ["rubric-19", "C:\\private\\input.json"]]) {
        await Bun.write(analysis, artifact(3, assumption));
        await Bun.write(rubricPath, rubric(version));
        await expect(runJudge({ rubric: rubricPath, provider: "jev", format: "json", out, cache }, analysis,
          { env: { TYPESAFE_API_KEY: SECRET }, transport: mock.transport })).rejects.toThrow("Unsafe Jev numerical report");
        expect(existsSync(out)).toBe(false);
        expect(existsSync(cache)).toBe(false);
      }
      expect(mock.calls).toBe(0);
    } finally { await removePath(dir); }
  });
  it("coalesces identical cold-cache requests", async () => {
    const dir = await createTempDir("idlekit-jev-same-key");
    try {
      const input = parsed();
      const mock = transportOf(async () => { await Bun.sleep(25); return { status: 200, body: noulBody(0.9) }; });
      const args = { ...input, numerical: evaluateRules(input), requestedModel: "jev-1.13.0", dryRun: false,
        cachePath: resolve(dir, "cache.json"), transport: mock.transport, env: { TYPESAFE_API_KEY: SECRET } };
      const results = await Promise.all([adviseWithJev(args), adviseWithJev(args)]);
      expect(mock.calls).toBe(1);
      expect(results.map((item) => item.cache).sort()).toEqual(["hit", "miss"]);
      expect(results.find((item) => item.cache === "hit")).toMatchObject({ attempts: 0, plannedRequests: 0, usage: null });
    } finally { await removePath(dir); }
  });
  it("rejects nested cache and output targets before transport", async () => {
    const dir = await createTempDir("idlekit-jev-nested-target");
    try {
      const analysis = resolve(dir, "analysis.json");
      const rubricPath = resolve(dir, "rubric.json");
      await Bun.write(analysis, artifact(3));
      await Bun.write(rubricPath, rubric());
      const mock = transportOf(() => ({ status: 200, body: noulBody(0.9) }));
      const parent = resolve(dir, "result");
      const child = resolve(parent, "report.json");
      for (const [cache, out] of [[parent, child], [child, parent]]) {
        await expect(runJudge({ rubric: rubricPath, provider: "jev", format: "json", cache, out }, analysis,
          { env: { TYPESAFE_API_KEY: SECRET }, transport: mock.transport })).rejects.toThrow("ancestor");
        expect(existsSync(parent)).toBe(false);
      }
      expect(mock.calls).toBe(0);
    } finally { await removePath(dir); }
  });
  it("projects the numerical effective method for every rule", () => {
    const input = parsed(1.5, "shared-method", "seed-19", [rule({ id: "exact", method: "exact" }), rule({ id: "analytic", method: "analytic" })]);
    const observed = { ...input.artifact, metrics: input.artifact.metrics.map((metric) => ({ ...metric, method: undefined })) };
    const numerical = evaluateRules({ ...input, artifact: observed });
    const state = projectJevState(observed, input.rubric, SECRET).state as { metrics: readonly Record<string, unknown>[] };
    for (const check of numerical.numerical.results) {
      expect(check.verdict).toBe("pass");
      expect(state.metrics.find((metric) => metric.ruleId === check.id)?.method).toBe(input.rubric.rules.find((rule) => rule.id === check.id)?.method);
    }
  });
  it("recovers an orphaned cache lock and preserves a live lock", async () => {
    const dir = await createTempDir("idlekit-jev-stale-lock");
    const cachePath = resolve(dir, "cache.json");
    const lockPath = `${cachePath}.lock`;
    const input = parsed();
    const mock = transportOf(() => ({ status: 200, body: noulBody(0.9) }));
    const args = { ...input, numerical: evaluateRules(input), requestedModel: "jev-1.13.0", dryRun: false,
      cachePath, transport: mock.transport, env: { TYPESAFE_API_KEY: SECRET } };
    try {
      mkdirSync(lockPath);
      const old = new Date(Date.now() - 120_000);
      utimesSync(lockPath, old, old);
      expect((await adviseWithJev(args)).status).toBe("ok");
      expect(parseJevCache(await readText(cachePath))).toHaveLength(1);
      const release = await lockfile.lock(cachePath, { realpath: false, stale: 60_000, update: 10_000 });
      try {
        const other = parsed(3, "live-lock");
        expect((await adviseWithJev({ ...args, ...other, numerical: evaluateRules(other) })).status).toBe("ok");
        expect(existsSync(lockPath)).toBe(true);
        expect(parseJevCache(await readText(cachePath))).toHaveLength(1);
      } finally { await release(); }
      expect(mock.calls).toBe(2);
    } finally { await removePath(dir); }
  }, 10_000);
  it("renders per-rule Jev answers after a live Markdown request", async () => {
    const dir = await createTempDir("idlekit-jev-live-md");
    try {
      const analysis = resolve(dir, "analysis.json");
      const rubricPath = resolve(dir, "rubric.json");
      const out = resolve(dir, "answer.md");
      await Bun.write(analysis, artifact(3));
      await Bun.write(rubricPath, rubric());
      const mock = transportOf(() => ({ status: 200, body: noulBody(0.1) }));
      await runJudge({ rubric: rubricPath, provider: "jev", format: "md", out }, analysis,
        { env: { TYPESAFE_API_KEY: SECRET }, transport: mock.transport });
      const markdown = await readText(out);
      expect(markdown).toContain("first-reset: noul=0.1; advisory-warning");
      expect(mock.calls).toBe(1);
    } finally { await removePath(dir); }
  });
  it("checks case aliases for missing outputs using the actual directory", async () => {
    const dir = await createTempDir("idlekit-jev-case");
    try {
      const cache = resolve(dir, "new-cache.json");
      const out = resolve(dir, "NEW-CACHE.JSON");
      // The host filesystem determines whether these names collide. The marker is not a cache or output.
      const marker = resolve(dir, "case-marker");
      await Bun.write(marker, "");
      const folded = existsSync(resolve(dir, "CASE-MARKER"));
      const attempt = runJudge({ rubric: resolve(dir, "absent-rubric.json"), provider: "jev", format: "json", cache, out }, resolve(dir, "absent-analysis.json"));
      await expect(attempt).rejects.toThrow(folded ? "same file" : "Invalid judge input");
      expect(existsSync(cache)).toBe(false);
      expect(existsSync(out)).toBe(false);
    } finally { await removePath(dir); }
  });
  it("withholds a point when numerical observation coverage is unavailable", () => {
    const input = parsed(1.5);
    for (const observed of [
      ...(["incomplete", "unknown", "disabled"] as const).map((observationCoverage) => ({ ...input.artifact, observationCoverage })),
      { ...input.artifact, capabilities: { ...input.artifact.capabilities, metrics: "unsupported" as const } },
    ]) {
      const numerical = evaluateRules({ ...input, artifact: observed });
      expect(numerical.numerical.results[0]?.evidence.value).toBeNull();
      const state = projectJevState(observed, input.rubric, SECRET).state as { metrics: readonly Record<string, unknown>[] };
      expect(state.metrics[0]?.value).toBeNull();
    }
  });
  it("projects the numerical unit for each rule that shares a metric", () => {
    const input = parsed(1.5, "shared-unit", "seed-19", [rule({ id: "hours", unit: "h" }), rule({ id: "seconds", unit: "s" })]);
    const numerical = evaluateRules(input);
    const state = projectJevState(input.artifact, input.rubric, SECRET).state as { metrics: readonly Record<string, unknown>[] };
    expect(state.metrics).toHaveLength(2);
    for (const check of numerical.numerical.results) {
      expect(state.metrics.find((metric) => metric.ruleId === check.id)?.unit).toBe(check.evidence.unit);
    }
  });
  it("rejects token counts outside the advisory uint32 contract", () => {
    const input = parsed();
    const questions = projectJevState(input.artifact, input.rubric, SECRET).questions;
    for (const field of ["input_tokens", "output_tokens"] as const) {
      const body = JSON.parse(noulBody(0.9));
      body.usage[field] = 4294967296;
      expect(readJevWire(JSON.stringify(body), questions).ok).toBe(false);
      body.usage[field] = 4294967295;
      expect(readJevWire(JSON.stringify(body), questions).ok).toBe(true);
    }
  });
  it("rejects a Choice answer outside the requested choices", () => {
    const questions = { decision: { type: "choice" as const, instructions: "Choose", criteria: { yes: "yes", no: "no" } } };
    const body = {
      model: "jev-1.13.0",
      answers: { decision: { type: "choice", choice: "not-an-option", confidence: 1, probabilities: { yes: 1, no: 0 } } },
      usage: { input_tokens: 1, output_tokens: 1 },
    };
    expect(readJevWire(JSON.stringify(body), questions).ok).toBe(false);
    body.answers.decision.choice = "yes";
    expect(readJevWire(JSON.stringify(body), questions).ok).toBe(true);
  });
  it("keeps both entries from concurrent advice requests", async () => {
    const dir = await createTempDir("idlekit-jev-concurrent");
    const cachePath = resolve(dir, "cache.json");
    const inputs = [parsed(3, "concurrent-a"), parsed(3, "concurrent-b")];
    const mock = transportOf(() => ({ status: 200, body: noulBody(0.9) }));
    try {
      const results = await Promise.all(inputs.map((input) => adviseWithJev({
        ...input, numerical: evaluateRules(input), requestedModel: "jev-1.13.0", dryRun: false,
        cachePath, transport: mock.transport, env: { TYPESAFE_API_KEY: SECRET },
      })));
      expect(results.map((result) => result.status)).toEqual(["ok", "ok"]);
      const entries = parseJevCache(await readText(cachePath));
      expect(entries).toHaveLength(2);
      expect(new Set(entries.map((entry) => entry.rubricVersion))).toEqual(new Set(["concurrent-a", "concurrent-b"]));
      expect(mock.calls).toBe(2);
    } finally {
      await removePath(dir);
    }
  });
  it("plans no request for a keyless dry run", async () => {
    const input = parsed();
    const mock = transportOf(() => ({ status: 200, body: noulBody(0.9) }));
    const result = await adviseWithJev({
      ...input, numerical: evaluateRules(input), requestedModel: "jev-1.13.0", dryRun: true,
      env: {}, transport: mock.transport,
    });
    expect(result.status).toBe("skipped");
    expect(result.plannedRequests).toBe(0);
    expect(mock.calls).toBe(0);
  });
  it("reports no current token usage when serving a cached answer", async () => {
    const dir = await createTempDir("idlekit-jev-current-usage");
    const input = parsed();
    const mock = transportOf(() => ({ status: 200, body: noulBody(0.9) }));
    const args = { ...input, numerical: evaluateRules(input), requestedModel: "jev-1.13.0", dryRun: false,
      cachePath: resolve(dir, "cache.json"), transport: mock.transport, env: { TYPESAFE_API_KEY: SECRET } };
    try {
      expect((await adviseWithJev(args)).usage).toEqual({ inputTokens: 11, outputTokens: 3 });
      const hit = await adviseWithJev(args);
      expect(hit.cache).toBe("hit");
      expect(hit.usage).toBeNull();
      expect(hit.attempts).toBe(0);
      expect(mock.calls).toBe(1);
    } finally {
      await removePath(dir);
    }
  });
  it("keeps default commands off the network", keepsDefaultCommandsOffNetwork);
  it("validates wire shapes", validatesWireShapes);
  it("bounds http failures", boundsHttpFailures);
  it("separates cache identity", separatesCacheIdentity);
  it("keeps secrets out of records", keepsSecretsOutOfRecords);
  it("keeps numerical verdicts", keepsNumericalVerdicts);
  it("stays opt-in", staysOptIn);
});
