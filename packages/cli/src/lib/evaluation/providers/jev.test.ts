import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "fs";
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
  type JevTransport,
} from "./jev";
import { jevAlgorithmVersion, jevJsonSchema, jevSchemaId, validateJevAdvisory } from "@idlekit/core";
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
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-wire-shapes #0654a74 Re-read the section, then ran this function: a bad shape, a Noul outside 0 to 1, and malformed JSON fail.
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
 * @evidenceReview ./jev.schema.ts#readJevWire #9298447 Re-read readJevWire after the Noul range check: the three fixture shapes and Noul 0 and 1 pass; a Noul with confidence, Noul -0.1 and 1.1, an unknown id, a bad probability set, and malformed JSON fail.
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
 * @evidenceReview ./jev.ts#adviseWithJev #f5e0f6a Re-read adviseWithJev after the fail-open cache write: the retry loop is unchanged; 401 and 403 send once, 429 stops after three attempts, 500 twice then 200 recovers, and an abort is a timeout.
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
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-cache-identity #9eb76ef Re-read the section, then ran this function: jev-latest was fetched again after the TTL, a changed between upper bound missed, and an unwritable cache path sent once and kept the advisory.
 * @evidence ./jev.ts#adviseWithJev Writes the cache after a valid answer and fails open when it cannot.
 * @evidenceReview ./jev.ts#adviseWithJev #f5e0f6a Re-read the cache write: a path under a regular file sent one request and returned the ok advisory.
 * @evidence ./jev.schema.ts#jevCacheIdentity Reads the cache marker.
 * @evidenceReview ./jev.schema.ts#jevCacheIdentity #75b32a2 The declaration is alias-is-not-pinned.
 * @evidence ../cache.ts#JEV_ALIAS_TTL_MS Reads the alias TTL.
 * @evidenceReview ../cache.ts#JEV_ALIAS_TTL_MS #454de67 The TTL is one day.
 * @evidence ../cache.ts#jevCacheKey Binds the projection, numerical digest, rubric, model, and adapter.
 * @evidenceReview ../cache.ts#jevCacheKey #8b24520 The same parts give the same key, and a different rubric or model gives a different one.
 * @evidence ../cache.ts#jevCacheHit Decides a hit for a pinned id or an alias inside the TTL.
 * @evidenceReview ../cache.ts#jevCacheHit #3dbb2e7 A pinned id hits only its stored model, an alias hits inside one day, and an alias stored as an alias misses.
 * @evidence ../cache.ts#serializeJevCache Writes the stored entries.
 * @evidenceReview ../cache.ts#serializeJevCache #07d024a The serialized entries read back unchanged.
 * @evidence ../cache.ts#parseJevCache Reads back only well-formed entries.
 * @evidenceReview ../cache.ts#parseJevCache #3fb2e65 A round trip keeps the entry and an entry without advisoryJson is dropped.
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
  expect(jevCacheHit({ ...entry, resolvedModel: "jev-latest" }, "jev-latest", 0)).toBe(false);
  expect(jevCacheHit(undefined, "jev-1.13.0", 0)).toBe(false);
  expect(parseJevCache(serializeJevCache([entry]))).toEqual([entry]);
  expect(parseJevCache(JSON.stringify({ entries: [entry, { key: "broken" }] }))).toEqual([entry]);
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
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-secret-boundary #51c2518 Re-read the section, then ran this function: the secret and each local path form were absent, including a file name with a space, and the metric meaning and an amount decimal reached the projection.
 * @evidence ./jev.schema.ts#jevSecretBoundary Reads the redaction marker.
 * @evidenceReview ./jev.schema.ts#jevSecretBoundary #fe921f9 The declaration is redacted-projection.
 * @evidence ./jev.ts#projectJevState Projects metrics, assumptions, and rules without the key or a local path.
 * @evidenceReview ./jev.ts#projectJevState #d7d766c Re-read projectJevState, redactPaths, and pathEnd: an assumption carrying the key is dropped; POSIX, home, Windows drive, UNC, file URI, embedded, and spaced paths are replaced through the file they name while a web URL stays; warnings are not sent; metrics carry meaning, version, method, unit, and an amount decimal, rules carry the upper threshold, and each question asks whether the reading fails its rule.
 */
export function keepsSecretsOutOfRecords(): Promise<void> {
  return (async (): Promise<void> => {
  expect(jevSecretBoundary).toBe("redacted-projection");
  const assumption = `${SECRET} /Users/secret/plugin.ts`;
  const input = parsed(3, "rubric-19", assumption);
  const numerical = evaluateRules(input);
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
  // An amount reading carries its decimal, not `value`, and the projection keeps it.
  const firstMetric = input.artifact.metrics[0]!;
  const amountArtifact = {
    ...input.artifact,
    metrics: [{ ...firstMetric, domain: "amount" as const, sign: "positive" as const, amount: { unit: "COIN", decimal: "12.5" } }],
  };
  const amounts = projectJevState(amountArtifact, input.rubric, SECRET).state as { metrics: readonly Record<string, unknown>[] };
  expect(amounts.metrics[0]).toMatchObject({ amount: { decimal: "12.5", unit: "COIN" }, sign: "positive", unit: "COIN" });
  await removePath(dir);
})();
}

/**
 * @evidence docs/requirements/active/jev-judge-provider.md#req-pr19-numerical-unchanged A disagreeing answer does not flip the numerical pass bit.
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-numerical-unchanged #83c1349 Re-read the section, then ran this function: low confidence abstained, the fail stayed a fail, each question asked whether its reading fails the rule, a mixed rubric warned only on its failing rule, that warning outranked an abstention, and repeated or __proto__ ids failed before any send.
 * @evidence ./jev.schema.ts#jevNumericalUnchanged Reads the verdict marker.
 * @evidenceReview ./jev.schema.ts#jevNumericalUnchanged #1105bbe The declaration is verdict-stays.
 * @evidence ./jev.ts#jevAnswerDisposition Maps one answer to ok, abstain, or an advisory warning.
 * @evidenceReview ./jev.ts#jevAnswerDisposition #86d8040 Re-read jevAnswerDisposition with the per-rule stance: Choice confidence 0.2 and Noul 0.5 abstain, a Noul of 0.05 against a failing rule is a warning, and the same Noul with no rule verdict is ok.
 * @evidence ./jev.ts#adviseWithJev Compares each answer with its own rule and refuses a rubric whose ids cannot stay separate questions.
 * @evidenceReview ./jev.ts#adviseWithJev #f5e0f6a Re-read adviseWithJev, summarize, and reportStatus: in a mixed rubric a low Noul warns only on the failing rule, the warning outranks an abstention, and a repeated id or __proto__ fails before any send.
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
  expect(jevAnswerDisposition({ type: "noul", noul: 0.05 }, null)).toBe("ok");
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
 * @evidenceReview docs/requirements/active/jev-judge-provider.md#req-pr19-opt-in-live #c295136 Re-read the section, then ran this function: the mock fetch saw the official URL, the live smoke stayed off, and the dry-run bundle names jev.judge.output.schema.json, whose required parts are the rules report and the advisory.
 * @evidence ./jev.schema.ts#jevOptInLive Reads the opt-in marker.
 * @evidenceReview ./jev.schema.ts#jevOptInLive #25ccdf0 The declaration is mock-unless-opt-in.
 * @evidence ./jev.schema.ts#JEV_ENDPOINT Reads the documented endpoint.
 * @evidenceReview ./jev.schema.ts#JEV_ENDPOINT #34d2752 The endpoint is the System One URL.
 * @evidence ./jev.ts#jevLiveTransport Reads the transport marker.
 * @evidenceReview ./jev.ts#jevLiveTransport #7e44d88 The declaration is injected-or-fetch.
 * @evidence ./jev.ts#createFetchTransport Posts the built body to the endpoint through the given fetch.
 * @evidenceReview ./jev.ts#createFetchTransport #8ce5022 The mock fetch saw the endpoint, the bearer header, and a body without the key.
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
  expect(bundleSchema.required).toEqual(["numericalReport", "advisory"]);
  expect(bundleSchema.properties.advisory?.$ref).toBe(jevSchemaId());
  expect(Object.keys(json).sort()).toEqual(["_meta", "advisory", "numericalReport"]);
  await removePath(dir);
})();
}

describe("jev judge provider", () => {
  it("keeps default commands off the network", keepsDefaultCommandsOffNetwork);
  it("validates wire shapes", validatesWireShapes);
  it("bounds http failures", boundsHttpFailures);
  it("separates cache identity", separatesCacheIdentity);
  it("keeps secrets out of records", keepsSecretsOutOfRecords);
  it("keeps numerical verdicts", keepsNumericalVerdicts);
  it("stays opt-in", staysOptIn);
});
