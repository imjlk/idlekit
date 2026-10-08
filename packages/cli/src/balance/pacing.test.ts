import { describe, expect, test } from "bun:test";
import { PACING_LIMITS, planPacingRuns, runPacingChecks, type PacingConfig, type PacingEvaluator } from "./pacing";

function config(overrides: Partial<PacingConfig> = {}): PacingConfig {
  return {
    horizonSec: 60,
    seeds: [2, 0],
    strategy: "test-strategy",
    targets: [{ metric: "unlock", unit: "seconds", min: 0, max: 30 }],
    ...overrides,
  };
}

describe("pacing plan", () => {
  test("baseline and one-at-a-time numeric overlays have canonical order", () => {
    const input = config({
      seeds: [9, 1, 4],
      targets: [{ metric: "z", unit: "coins", min: 0 }, { metric: "a", unit: "seconds", max: 60 }],
      parameters: { "worker/rate": 2, "asset.cost": 10 },
      sensitivity: [
        { path: "worker/rate", values: [3, 2, 1] },
        { path: "asset.cost", values: [12, 8] },
      ],
    });
    const plan = planPacingRuns(input);
    expect(plan.seeds).toEqual([1, 4, 9]);
    expect(plan.targets.map((target) => target.metric)).toEqual(["a", "z"]);
    expect(plan.variants).toEqual([
      { id: "baseline", patches: { "asset.cost": 10, "worker/rate": 2 } },
      { id: "asset.cost=8", patches: { "asset.cost": 8, "worker/rate": 2 } },
      { id: "asset.cost=12", patches: { "asset.cost": 12, "worker/rate": 2 } },
      { id: "worker/rate=1", patches: { "asset.cost": 10, "worker/rate": 1 } },
      { id: "worker/rate=3", patches: { "asset.cost": 10, "worker/rate": 3 } },
    ]);
    expect(plan.runs).toHaveLength(15);
    expect(plan.runs.slice(0, 3)).toEqual([1, 4, 9].map((seed) => ({
      seed, horizonSec: 60, strategy: "test-strategy", variantId: "baseline",
    })));
    expect(input.seeds).toEqual([9, 1, 4]);
    expect(planPacingRuns({
      ...input, seeds: [4, 9, 1], targets: [...input.targets].reverse(),
      parameters: { "asset.cost": 10, "worker/rate": 2 },
      sensitivity: [...input.sensitivity!].reverse().map((entry) => ({ ...entry, values: [...entry.values].reverse() })),
    })).toEqual(plan);
    expect(JSON.stringify(planPacingRuns(input))).toBe(JSON.stringify(plan));
  });

  test("baseline values in sensitivity do not cause duplicate baseline runs", () => {
    expect(planPacingRuns(config({ parameters: { rate: 0 }, sensitivity: [{ path: "rate", values: [-0] }] })).variants)
      .toEqual([{ id: "baseline", patches: { rate: 0 } }]);
  });

  test.each([0, -1, NaN, Infinity, -Infinity, PACING_LIMITS.maxHorizonSec + 1])("rejects horizon %s", (horizonSec) => {
    expect(() => planPacingRuns(config({ horizonSec }))).toThrow("horizonSec");
  });

  test("accepts fractional horizons and a valid uint32 seed boundary", () => {
    expect(planPacingRuns(config({ horizonSec: 0.5, seeds: [0xffff_ffff] })).horizonSec).toBe(0.5);
    expect(planPacingRuns(config({ horizonSec: PACING_LIMITS.maxHorizonSec })).horizonSec).toBe(PACING_LIMITS.maxHorizonSec);
  });

  test.each([[], [-1], [0.5], [0x1_0000_0000], [NaN], [Infinity], [1, 1], [0, -0]].map((seeds) => [seeds] as const))("rejects invalid seeds %j", (seeds) => {
    expect(() => planPacingRuns(config({ seeds }))).toThrow("seed");
  });

  test("rejects over-limit seed, target and parameter collections", () => {
    expect(() => planPacingRuns(config({ seeds: Array.from({ length: PACING_LIMITS.maxSeeds + 1 }, (_, i) => i) })))
      .toThrow("seeds");
    expect(() => planPacingRuns(config({ targets: Array.from({ length: PACING_LIMITS.maxTargets + 1 }, (_, i) => ({ metric: `m${i}`, unit: "s", min: 0 })) })))
      .toThrow("targets");
    expect(() => planPacingRuns(config({ parameters: Object.fromEntries(Array.from({ length: PACING_LIMITS.maxParameters + 1 }, (_, i) => [`p${i}`, i])) })))
      .toThrow("too many parameters");
  });

  test.each(["", " ", " strategy", "a\nb", "a".repeat(PACING_LIMITS.maxTextLength + 1)])("rejects invalid strategy %j", (strategy) => {
    expect(() => planPacingRuns(config({ strategy }))).toThrow("strategy");
  });

  test("requires explicit run fields and rejects unknown fields", () => {
    for (const key of ["horizonSec", "seeds", "strategy", "targets"]) {
      const input: Record<string, unknown> = { ...config() };
      delete input[key];
      expect(() => planPacingRuns(input)).toThrow(key);
    }
    expect(() => planPacingRuns({ ...config(), seed: 1 })).toThrow("config.seed");
    expect(() => planPacingRuns(null)).toThrow("config");
    expect(() => planPacingRuns([])).toThrow("config");
  });

  test("targets require meaningful finite, inclusive bounds and explicit units", () => {
    for (const target of [
      { metric: "m", unit: "s" },
      { metric: "m", unit: "s", min: 2, max: 1 },
      { metric: "m", unit: "s", min: NaN },
      { metric: "m", unit: "s", max: Infinity },
      { metric: "m", unit: "", max: 1 },
      { metric: "", unit: "s", max: 1 },
      { metric: "m", max: 1 },
      { metric: "m", unit: "s", max: "1" },
      { metric: "m", unit: "s", max: null },
      { metric: "m", unit: "s", max: 1, mx: 2 },
    ]) expect(() => planPacingRuns({ ...config(), targets: [target] })).toThrow();
    expect(() => planPacingRuns(config({ targets: [] }))).toThrow("targets");
    expect(() => planPacingRuns(config({ targets: [
      { metric: "m", unit: "s", min: 0 }, { metric: "m", unit: "s", max: 1 },
    ] }))).toThrow("duplicate target metric");
    expect(planPacingRuns(config({ targets: [{ metric: "m", unit: "seconds", min: 0, max: 0 }] })).targets)
      .toEqual([{ metric: "m", unit: "seconds", min: 0, max: 0 }]);
  });

  test.each(["__proto__", "constructor", "x.prototype.y", "a/__proto__", "a:constructor", "x[0]", "x();", "../x", "a..b"])("rejects unsafe parameter ID %s", (path) => {
    expect(() => planPacingRuns(config({ parameters: { [path]: 1 } }))).toThrow("safe parameter ID");
  });

  test("only explicit finite numeric parameters can be swept", () => {
    expect(() => planPacingRuns({ ...config(), sensitivity: null })).toThrow("sensitivity");
    expect(() => planPacingRuns(config({ sensitivity: [{ path: "rate", values: [1] }] }))).toThrow("not declared");
    expect(() => planPacingRuns(config({ parameters: { rate: Infinity } }))).toThrow("finite");
    expect(() => planPacingRuns(config({ parameters: { rate: 1 }, sensitivity: [{ path: "rate", values: [NaN] }] }))).toThrow("finite");
    expect(() => planPacingRuns(config({ parameters: { rate: 1 }, sensitivity: [{ path: "rate", values: [] }] }))).toThrow("values");
    expect(() => planPacingRuns(config({ parameters: { rate: 1 }, sensitivity: [{ path: "rate", values: [2, 2] }] }))).toThrow("unique");
    expect(() => planPacingRuns(config({ parameters: { rate: 1 }, sensitivity: [{ path: "rate", values: [2] }, { path: "rate", values: [3] }] }))).toThrow("duplicate sensitivity path");
  });

  test("custom limits may only lower positive hard ceilings", () => {
    for (const key of ["maxRuns", "maxResults", "maxHorizonSec"] as const) {
      for (const value of [0, -1, 1.5, Infinity, NaN, PACING_LIMITS[key] + 1]) {
        expect(() => planPacingRuns(config({ limits: { [key]: value } }))).toThrow(`limits.${key}`);
      }
    }
    expect(() => planPacingRuns(config({ limits: { maxHorizonSec: 59 } }))).toThrow("horizonSec");
    expect(() => planPacingRuns({ ...config(), limits: { maxRun: 4 } })).toThrow("limits.maxRun");
  });

  test("enforces variant cap before allocating run descriptors", () => {
    expect(() => planPacingRuns(config({
      seeds: [0], parameters: { rate: -1 }, sensitivity: [{ path: "rate", values: Array.from({ length: PACING_LIMITS.maxVariants }, (_, i) => i) }],
    }))).toThrow("variant count");
  });
});

describe("pacing evaluation", () => {
  test("inclusive targets preserve genuine zero and negative metrics", async () => {
    const report = await runPacingChecks(config({ targets: [
      { metric: "zero", unit: "seconds", min: 0, max: 0 },
      { metric: "min", unit: "coins", min: -2 },
      { metric: "max", unit: "coins", max: 4 },
    ] }), () => ({ zero: 0, min: -2, max: 4 }));
    expect(report.ok).toBe(true);
    expect(report.status).toBe("pass");
    expect(report.summary).toEqual({ totalRuns: 2, totalResults: 6, pass: 6, breach: 0, unreached: 0, error: 0 });
    expect(report.runs[0]!.results.find((result) => result.metric === "zero")!.value).toBe(0);
  });

  test("breaches both lower and upper bounds without inventing a game-specific pass", async () => {
    const report = await runPacingChecks(config({ seeds: [0], targets: [
      { metric: "tooSoon", unit: "seconds", min: 10 },
      { metric: "tooLate", unit: "seconds", max: 20 },
      { metric: "customScore", unit: "designer-points", min: -4, max: 7 },
    ] }), () => ({ tooSoon: 9, tooLate: 21, customScore: 0 }));
    expect(report.status).toBe("breach");
    expect(report.ok).toBe(false);
    expect(report.summary.breach).toBe(2);
    expect(report.summary.pass).toBe(1);
    expect(report.runs[0]!.status).toBe("breach");
  });

  test("null is unreached, missing is an error, and neither becomes zero", async () => {
    const report = await runPacingChecks(config({ seeds: [0], targets: [
      { metric: "zero", unit: "s", max: 1 },
      { metric: "never", unit: "s", max: 1 },
      { metric: "missing", unit: "s", max: 1 },
    ] }), () => ({ zero: 0, never: null }));
    expect(report.status).toBe("error");
    expect(report.summary).toEqual({ totalRuns: 1, totalResults: 3, pass: 1, breach: 0, unreached: 1, error: 1 });
    expect(report.runs[0]!.results.map(({ metric, value, status }) => ({ metric, value, status }))).toEqual([
      { metric: "missing", value: null, status: "error" },
      { metric: "never", value: null, status: "unreached" },
      { metric: "zero", value: 0, status: "pass" },
    ]);
  });

  test("unreached alone cannot produce an overall pass", async () => {
    const report = await runPacingChecks(config(), () => ({ unlock: null }));
    expect(report.status).toBe("unreached");
    expect(report.ok).toBe(false);
  });

  test.each([NaN, Infinity, -Infinity, undefined, "0", false])("invalid result %s is an error", async (value) => {
    const report = await runPacingChecks(config(), (() => ({ unlock: value })) as PacingEvaluator);
    expect(report.summary.error).toBe(2);
    expect(report.runs[0]!.results[0]!.value).toBe(null);
    expect(JSON.stringify(report)).not.toContain("NaN");
  });

  test.each([null, undefined, [], 3, "bad"].map((metrics) => [metrics] as const))("invalid evaluator return %s fails each target", async (metrics) => {
    const report = await runPacingChecks(config(), (() => metrics) as unknown as PacingEvaluator);
    expect(report.summary.error).toBe(2);
  });

  test("inherited values cannot satisfy named metrics", async () => {
    const report = await runPacingChecks(config(), () => Object.create({ unlock: 0 }) as Record<string, number>);
    expect(report.status).toBe("error");
  });

  test("thrown callbacks are recorded and the bounded sweep continues", async () => {
    const seen: number[] = [];
    const report = await runPacingChecks(config(), async ({ seed }) => {
      seen.push(seed);
      if (seed === 0) throw new Error("model failed");
      return { unlock: 20 };
    });
    expect(seen).toEqual([0, 2]);
    expect(report.runs.map((run) => run.status)).toEqual(["error", "pass"]);
    expect(report.runs[0]!.results[0]!.message).toBe("Evaluator failed: model failed");
  });

  test("errors are bounded and thrown non-Error values are supported", async () => {
    const report = await runPacingChecks(config(), () => { throw "x".repeat(1_000); });
    expect(report.runs[0]!.results[0]!.message!.length).toBeLessThanOrEqual(520);
    const unusual = await runPacingChecks(config(), () => { throw { something: true }; });
    expect(unusual.runs[0]!.results[0]!.message).toContain("unknown evaluator error");
  });

  test("the same canonical sweep produces byte-identical reports and call order", async () => {
    const input = config({ parameters: { rate: 2 }, sensitivity: [{ path: "rate", values: [3, 1] }] });
    const seen: string[] = [];
    const evaluator: PacingEvaluator = async (run, patches) => {
      expect(Object.isFrozen(run)).toBe(true);
      expect(Object.isFrozen(patches)).toBe(true);
      seen.push(`${run.variantId}:${run.seed}`);
      await Promise.resolve();
      return { unlock: 60 / patches.rate! + run.seed };
    };
    const first = await runPacingChecks(input, evaluator);
    const second = await runPacingChecks({ ...input, seeds: [0, 2], sensitivity: [{ path: "rate", values: [1, 3] }] }, evaluator);
    const expectedOrder = ["baseline:0", "baseline:2", "rate=1:0", "rate=1:2", "rate=3:0", "rate=3:2"];
    expect(seen).toEqual([...expectedOrder, ...expectedOrder]);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.summary.totalRuns).toBe(6);
    expect(first.summary.totalResults).toBe(6);
  });

  test("run and result caps fail before the first callback, including hard limits", async () => {
    let calls = 0;
    const evaluator: PacingEvaluator = () => { calls += 1; return { unlock: 0 }; };
    for (const input of [
      config({ limits: { maxRuns: 1 } }),
      config({ limits: { maxResults: 1 } }),
      config({ seeds: Array.from({ length: 501 }, (_, i) => i), parameters: { rate: 1 }, sensitivity: [{ path: "rate", values: [2] }] }),
      config({ seeds: Array.from({ length: 1_000 }, (_, i) => i), targets: Array.from({ length: 11 }, (_, i) => ({ metric: `m${i}`, unit: "s", min: 0 })) }),
    ]) await expect(runPacingChecks(input, evaluator)).rejects.toThrow(/(run count|result count)/);
    expect(calls).toBe(0);
    const atLimit = await runPacingChecks(config({ limits: { maxRuns: 2, maxResults: 2 } }), evaluator);
    expect(atLimit.summary.totalResults).toBe(2);
    expect(calls).toBe(2);
  });

  test("target and plan snapshots cannot change during an async callback", async () => {
    const mutable = { horizonSec: 60, seeds: [0, 1], strategy: "test", targets: [{ metric: "unlock", unit: "s", max: 30 }], parameters: { rate: 2 } };
    const report = await runPacingChecks(mutable, async () => {
      mutable.targets[0]!.max = 100;
      mutable.seeds.push(3);
      mutable.parameters.rate = 5;
      return { unlock: 40 };
    });
    expect(report.summary.totalRuns).toBe(2);
    expect(report.summary.breach).toBe(2);
    expect(report.variants[0]!.patches).toEqual({ rate: 2 });
  });
});
