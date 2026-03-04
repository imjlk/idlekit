import type { ObjectiveFactory } from "../registry";
import type { ParamSpace } from "../tuneSpec";
import type { StrategyTuner, TuneReport } from "../tuner";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleSpace(rng: () => number, space: ParamSpace): unknown {
  switch (space.kind) {
    case "bool":
      return rng() < 0.5;
    case "int": {
      const v = Math.floor(space.min + rng() * (space.max - space.min + 1));
      return Math.max(space.min, Math.min(space.max, v));
    }
    case "number": {
      const u = rng();
      if (space.scale === "log") {
        const min = Math.max(1e-12, space.min);
        const max = Math.max(min, space.max);
        const x = Math.log(min) + u * (Math.log(max) - Math.log(min));
        return Math.exp(x);
      }
      return space.min + u * (space.max - space.min);
    }
    case "choice": {
      const idx = Math.floor(rng() * space.values.length);
      return space.values[Math.max(0, Math.min(space.values.length - 1, idx))];
    }
  }
}

function setByPath(obj: any, path: string, value: unknown): any {
  const parts = path.split(".").filter(Boolean);
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i]!;
    cur[k] ??= {};
    cur = cur[k];
  }
  cur[parts[parts.length - 1]!] = value;
  return obj;
}

function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

function schemaIssues(result: unknown): string[] {
  if (!result || typeof result !== "object") return ["invalid schema result"];

  const r = result as any;
  if (typeof r.success === "boolean") {
    if (r.success) return [];
    if (!Array.isArray(r.issues)) return ["schema validation failed: missing issues"];
    return r.issues.map((i: any) => String(i?.message ?? "schema validation failed"));
  }

  if (Array.isArray(r.issues)) {
    return r.issues.map((i: any) => String(i?.message ?? "schema validation failed"));
  }

  return ["invalid schema result shape"];
}

function validateObjectiveParams(factory: ObjectiveFactory, params: unknown): void {
  if (!factory.paramsSchema) return;
  const issues = schemaIssues(factory.paramsSchema["~standard"].validate(params));
  if (issues.length > 0) {
    throw new Error(`Invalid objective params: ${issues.join("; ")}`);
  }
}

export const RandomSearchTunerV1: StrategyTuner = {
  id: "randomSearch.v1",
  tune: ({ baseScenario, tuneSpec, strategyRegistry, objectiveRegistry, runCandidate }) => {
    const objectiveFactory = objectiveRegistry.get(tuneSpec.objective.id);
    if (!objectiveFactory) throw new Error(`Unknown objective: ${tuneSpec.objective.id}`);

    const stratFactory = strategyRegistry.get(tuneSpec.strategy.id);
    if (!stratFactory) throw new Error(`Unknown strategy: ${tuneSpec.strategy.id}`);

    validateObjectiveParams(objectiveFactory, tuneSpec.objective.params ?? objectiveFactory.defaultParams ?? {});

    if (stratFactory.paramsSchema) {
      const baseParams = tuneSpec.strategy.baseParams ?? stratFactory.defaultParams ?? {};
      const issues = schemaIssues(stratFactory.paramsSchema["~standard"].validate(baseParams));
      if (issues.length > 0) {
        throw new Error(`Invalid strategy baseParams: ${issues.join("; ")}`);
      }
    }

    const topK = tuneSpec.runner.topK ?? 20;
    const rng = mulberry32((tuneSpec.runner.seeds[0] ?? 1) ^ 0xc0ffee);

    const evalOne = (params: unknown, overrides?: { stepSec?: number; durationSec?: number; fast?: boolean }) => {
      return runCandidate({
        scenario: baseScenario,
        params,
        seeds: tuneSpec.runner.seeds,
        overrides,
      });
    };

    const candidates: Array<{ params: unknown; score: number; seedScores: number[] }> = [];

    const sampleParams = () => {
      const p = deepClone(tuneSpec.strategy.baseParams ?? stratFactory.defaultParams ?? {});
      for (const s of tuneSpec.strategy.space) {
        setByPath(p, s.path, sampleSpace(rng, s.space));
      }
      return p;
    };

    const stages = tuneSpec.runner.stages?.length ? tuneSpec.runner.stages : [{ budget: tuneSpec.runner.budget }];
    let pool: Array<unknown> = [];

    const stageSummaries: Array<{ stageIndex: number; tried: number; kept: number; bestScore: number }> = [];

    for (let si = 0; si < stages.length; si++) {
      const st = stages[si]!;
      const local: typeof candidates = [];

      const localBudget = st.budget;
      for (let i = 0; i < localBudget; i++) {
        const params = pool.length ? pool[Math.floor(rng() * pool.length)] : sampleParams();
        const mutated = pool.length
          ? (() => {
              const p = deepClone(params);
              const dim = tuneSpec.strategy.space[Math.floor(rng() * tuneSpec.strategy.space.length)];
              if (dim) setByPath(p, dim.path, sampleSpace(rng, dim.space));
              return p;
            })()
          : params;

        const r = evalOne(mutated, {
          stepSec: tuneSpec.runner.overrideStepSec,
          durationSec: st.durationSec ?? tuneSpec.runner.overrideDurationSec,
          fast: st.fast,
        });

        local.push({ params: mutated, score: r.score, seedScores: [...r.seedScores] });
      }

      local.sort((a, b) => b.score - a.score);
      const keep = st.keepTopK ?? Math.min(topK, local.length);
      pool = local.slice(0, keep).map((x) => x.params);

      stageSummaries.push({
        stageIndex: si,
        tried: local.length,
        kept: pool.length,
        bestScore: local[0]?.score ?? Number.NEGATIVE_INFINITY,
      });

      candidates.push(...local);
    }

    candidates.sort((a, b) => b.score - a.score);
    const top = candidates.slice(0, topK);
    const best =
      top[0] ??
      ({
        params: tuneSpec.strategy.baseParams ?? stratFactory.defaultParams ?? {},
        score: Number.NEGATIVE_INFINITY,
        seedScores: [],
      } as const);

    const report: TuneReport = {
      objectiveId: tuneSpec.objective.id,
      strategyId: tuneSpec.strategy.id,
      best,
      top,
      tried: candidates.length,
      stages: stageSummaries,
      notes: ["RandomSearch v1 + optional multi-stage + simple mutation"],
    };

    return report;
  },
};
