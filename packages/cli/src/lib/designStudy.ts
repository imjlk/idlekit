import {
  compileScenario,
  createNumberEngine,
  deriveMonetizationConfig,
  estimateLtvPerUser,
  logicalDrawSeed,
  progressionFactor,
  validateScenarioV1,
  type CompiledScenario,
  type DesignParameterV1,
  type ModelRegistry,
  type ScenarioV1,
  type SessionPatternId,
  type StrategyRegistry,
} from "@idlekit/core";
import { parseMoney } from "@idlekit/money";
import { z } from "zod";
import { usageError } from "../errors";
import {
  collectExperienceSnapshot,
  firstMilestoneTime,
  milestoneTime,
  resolveExperienceSeries,
  resolveSessionPatternSpec,
  type ExperienceSnapshot,
} from "./experience";

/*
 * Design study spec shared by `idk sensitivity` and `idk optimize`.
 *
 * A parameter is a dotted path into the scenario JSON with a numeric range. Each candidate patches a copy of the
 * scenario, validates and compiles it again, and runs one experience session per draw with logical draw seeds.
 * Every objective reduces the draws to a mean metric and contributes `weight * term` to a score that is minimized.
 */

const sessionPatternIds = ["always-on", "short-bursts", "twice-daily", "offline-heavy", "weekend-marathon"] as const;

const pathSegment = /^[A-Za-z0-9_$-]+$/;
const forbiddenSegments = new Set(["__proto__", "prototype", "constructor"]);

const parameterSchema = z
  .object({
    path: z.string().min(1).max(200),
    min: z.number().finite(),
    max: z.number().finite(),
    scale: z.enum(["linear", "log"]).default("linear"),
    integer: z.boolean().default(false),
  })
  .strict()
  .refine((p) => p.max > p.min, { message: "max must be greater than min" })
  .refine((p) => p.scale !== "log" || p.min > 0, { message: "a log scale needs min > 0" })
  .refine((p) => p.path.split(".").every((segment) => pathSegment.test(segment) && !forbiddenSegments.has(segment)), {
    message: "path segments must be [A-Za-z0-9_$-] and not __proto__, prototype, or constructor",
  });

const weight = z.number().finite().positive().default(1);

const objectiveSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("milestoneTime"), milestoneKey: z.string().min(1).optional(), weight }).strict(),
  z
    .object({
      kind: z.literal("sessionPacing"),
      targetVisibleChangesPerMinute: z.number().finite().positive(),
      maxNoRewardGapSec: z.number().finite().positive(),
      weight,
    })
    .strict(),
  z.object({ kind: z.literal("endNetWorthLog10"), weight }).strict(),
  z.object({ kind: z.literal("ltv"), horizonDays: z.number().finite().positive().optional(), weight }).strict(),
]);

export const designStudySpecSchema = z
  .object({
    schemaVersion: z.literal(1),
    parameters: z.array(parameterSchema).min(1).max(32),
    objectives: z.array(objectiveSchema).min(1).max(8),
    evaluation: z
      .object({
        sessionPattern: z.enum(sessionPatternIds).optional(),
        days: z.number().int().positive().max(365).optional(),
        draws: z.number().int().positive().max(64).default(1),
      })
      .strict()
      .default({ draws: 1 }),
  })
  .strict()
  .refine((spec) => new Set(spec.parameters.map((p) => p.path)).size === spec.parameters.length, {
    message: "parameter paths must be unique",
  });

export type DesignStudySpec = z.output<typeof designStudySpecSchema>;
export type DesignObjectiveSpec = DesignStudySpec["objectives"][number];

export function parseDesignStudySpec(input: unknown): DesignStudySpec {
  const parsed = designStudySpecSchema.safeParse(input);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => `${issue.path.join(".") || "/"}: ${issue.message}`).join("; ");
    throw usageError(`Invalid design study spec: ${detail}`);
  }
  return parsed.data;
}

export function designParameters(spec: DesignStudySpec): DesignParameterV1[] {
  return spec.parameters.map((p) => ({ id: p.path, min: p.min, max: p.max, scale: p.scale, integer: p.integer }));
}

/** Objective keys in spec order; a repeated kind gets `#n`. */
export function objectiveKeys(spec: DesignStudySpec): string[] {
  const seen = new Map<string, number>();
  return spec.objectives.map((objective) => {
    const count = (seen.get(objective.kind) ?? 0) + 1;
    seen.set(objective.kind, count);
    return count === 1 ? objective.kind : `${objective.kind}#${count}`;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Recognize native numeric text and scenario money notation without imposing the Number engine's range. */
function isNumericDesignString(value: string): boolean {
  // Native numeric strings include trailing decimal points accepted by built-in model schemas.
  const text = value.trim();
  if (text !== "" && !Number.isNaN(Number(text)) && !["Infinity", "+Infinity", "-Infinity"].includes(text)) return true;
  try {
    parseMoney(createNumberEngine(), value, { unit: { code: "design" } });
    return true;
  } catch {
    return false;
  }
}

/** Resolve a writable numeric leaf, allowing only existing canonical array indexes and own properties. */
function designPathTarget(scenario: ScenarioV1, path: string): { parent: Record<string, unknown>; leaf: string } {
  const segments = path.split(".");
  if (segments.some(segment => forbiddenSegments.has(segment) || !pathSegment.test(segment))) throw usageError(`Refusing design path ${path}`);
  let cursor: unknown = scenario;
  for (const [index, segment] of segments.entries()) {
    if (Array.isArray(cursor)) {
      if (!/^(0|[1-9]\d*)$/.test(segment) || !Number.isSafeInteger(Number(segment)) || Number(segment) >= cursor.length || !Object.hasOwn(cursor, segment)) {
        throw usageError(`Design path ${path} requires an existing array index at ${segment}`);
      }
    } else if (!isRecord(cursor)) {
      throw usageError(`Design path ${path} does not exist in the scenario (missing object at ${segments[index - 1]})`);
    }
    const parent = cursor as Record<string, unknown>;
    const current = Object.hasOwn(parent, segment) ? parent[segment] : undefined;
    if (index === segments.length - 1) {
      if (current !== undefined && typeof current !== "number" && (typeof current !== "string" || !isNumericDesignString(current))) {
        throw usageError(`Design path ${path} is not a number or numeric string`);
      }
      return { parent, leaf: segment };
    }
    cursor = current;
  }
  throw usageError(`Invalid design path ${path}`);
}

/** Validate paths once before spending a search or sensitivity budget. Missing object leaves remain supported. */
export function assertDesignParameterPaths(scenario: ScenarioV1, spec: DesignStudySpec): void {
  for (const parameter of spec.parameters) designPathTarget(scenario, parameter.path);
}

/**
 * Copy `scenario` with each numeric path set. Parents must exist; missing object leaves may be created.
 * A numeric-string leaf stays a string, so `"15"` becomes `"18.5"`.
 */
export function patchScenario(scenario: ScenarioV1, values: Readonly<Record<string, number>>): ScenarioV1 {
  const copy = structuredClone(scenario);
  for (const [path, value] of Object.entries(values)) {
    const { parent, leaf } = designPathTarget(copy, path);
    parent[leaf] = typeof parent[leaf] === "string" ? String(value) : value;
  }
  return copy;
}

export type DesignEvaluation = Readonly<{
  /** Weighted score to minimize; null when the candidate failed. */
  score: number | null;
  /** Mean metric per objective key. */
  metrics: Readonly<Record<string, number>>;
  /** Draws where a milestone objective was not reached and read the horizon + 1. */
  censoredDraws: number;
  error?: string;
}>;

export type DesignEvaluatorContext = Readonly<{
  scenario: ScenarioV1;
  spec: DesignStudySpec;
  modelRegistry: ModelRegistry;
  strategyRegistry: StrategyRegistry;
  seed: number;
}>;

function compileCandidate(ctx: DesignEvaluatorContext, scenario: ScenarioV1): CompiledScenario<number, string, any> {
  const valid = validateScenarioV1(scenario, ctx.modelRegistry, ctx.strategyRegistry);
  if (!valid.ok || !valid.scenario) {
    throw new Error(`candidate scenario is invalid: ${valid.issues.map((issue) => issue.message).join("; ")}`);
  }
  return compileScenario<number, string, any>({
    E: createNumberEngine(),
    scenario: valid.scenario,
    registry: ctx.modelRegistry,
    strategyRegistry: ctx.strategyRegistry,
    opts: { allowSuffixNotation: true },
  });
}

function objectiveMetric(
  objective: DesignObjectiveSpec,
  snapshot: ExperienceSnapshot,
  args: Readonly<{ horizonSec: number; startWorthLog10: number; scenario: ScenarioV1; days: number }>,
): { value: number; censored: boolean } {
  switch (objective.kind) {
    case "milestoneTime": {
      const reached = objective.milestoneKey
        ? milestoneTime(snapshot.milestones, objective.milestoneKey)
        : firstMilestoneTime(snapshot.milestones);
      return reached === undefined ? { value: args.horizonSec + 1, censored: true } : { value: reached, censored: false };
    }
    case "sessionPacing": {
      const pace = snapshot.perceived.visibleChangesPerMinute;
      const miss = Math.abs(Math.log10((pace + 1e-9) / objective.targetVisibleChangesPerMinute));
      const gap = Math.max(0, snapshot.perceived.maxNoRewardGapSec / objective.maxNoRewardGapSec - 1);
      return { value: miss + gap, censored: false };
    }
    case "endNetWorthLog10":
      return { value: snapshot.endNetWorthLog10, censored: false };
    case "ltv": {
      const config = deriveMonetizationConfig(args.scenario);
      const progression = progressionFactor(args.startWorthLog10, snapshot.endNetWorthLog10, config.revenue.progressionLogSpan);
      const estimate = estimateLtvPerUser({ config, horizonDays: objective.horizonDays ?? args.days, progression });
      return { value: estimate.cumulativeLtvPerUser, censored: false };
    }
  }
}

/** Term added to the minimized score: times use log10(sec + 1); maximized metrics are negated. */
export function objectiveTerm(objective: DesignObjectiveSpec, metric: number): number {
  switch (objective.kind) {
    case "milestoneTime":
      return Math.log10(metric + 1);
    case "sessionPacing":
      return metric;
    case "endNetWorthLog10":
    case "ltv":
      return -metric;
  }
}

export function createDesignEvaluator(ctx: DesignEvaluatorContext): (values: Readonly<Record<string, number>>) => DesignEvaluation {
  const keys = objectiveKeys(ctx.spec);
  const evaluation = ctx.spec.evaluation;
  return (values) => {
    try {
      const candidate = patchScenario(ctx.scenario, values);
      const sums = new Array<number>(keys.length).fill(0);
      let censoredDraws = 0;
      for (let draw = 0; draw < evaluation.draws; draw += 1) {
        // A new compile per draw, so a stateful model or strategy closure is never shared across draws.
        const compiled = compileCandidate(ctx, candidate);
        const pattern = resolveSessionPatternSpec({
          scenario: compiled,
          sessionPatternId: evaluation.sessionPattern as SessionPatternId | undefined,
          days: evaluation.days,
        });
        const seed = evaluation.draws === 1 ? ctx.seed : logicalDrawSeed(ctx.seed, draw);
        const { snapshot } = collectExperienceSnapshot({
          scenario: compiled,
          sessionPattern: pattern,
          seed,
          series: resolveExperienceSeries(compiled),
        });
        const startWorth = compiled.model.netWorth?.(compiled.ctx, compiled.initial) ?? compiled.initial.wallet.money;
        const args = {
          horizonSec: pattern.days * 86400,
          startWorthLog10: compiled.ctx.E.absLog10(startWorth.amount),
          scenario: candidate,
          days: pattern.days,
        };
        let censored = false;
        ctx.spec.objectives.forEach((objective, index) => {
          const metric = objectiveMetric(objective, snapshot, args);
          if (metric.censored) censored = true;
          sums[index]! += metric.value;
        });
        if (censored) censoredDraws += 1;
      }
      const metrics: Record<string, number> = {};
      let score = 0;
      ctx.spec.objectives.forEach((objective, index) => {
        const mean = sums[index]! / evaluation.draws;
        metrics[keys[index]!] = mean;
        score += objective.weight * objectiveTerm(objective, mean);
      });
      return { score: Number.isFinite(score) ? score : null, metrics, censoredDraws };
    } catch (error) {
      return { score: null, metrics: {}, censoredDraws: 0, error: error instanceof Error ? error.message : String(error) };
    }
  };
}

export function formatNumber(value: number | null | undefined, digits = 4): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  return Number(value.toPrecision(digits)).toString();
}

export async function readDesignStudySpec(path: string): Promise<DesignStudySpec> {
  const { readTextFile } = await import("../runtime/bun");
  const { extname, resolve } = await import("path");
  const abs = resolve(path);
  const raw = await readTextFile(abs).catch((error: unknown) => {
    throw usageError(`Cannot read design study spec ${abs}: ${error instanceof Error ? error.message : String(error)}`);
  });
  let parsed: unknown;
  try {
    if (extname(abs).toLowerCase() === ".yaml" || extname(abs).toLowerCase() === ".yml") {
      const YAML = (await import("yaml")).default;
      parsed = YAML.parse(raw);
    } else {
      parsed = JSON.parse(raw);
    }
  } catch (error) {
    throw usageError(`Design study spec ${abs} is not valid JSON or YAML: ${error instanceof Error ? error.message : String(error)}`);
  }
  return parseDesignStudySpec(parsed);
}
