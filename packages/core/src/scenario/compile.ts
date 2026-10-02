import type { Engine } from "../engine/types";
import type { Unit } from "../money/types";
import { parseMoney } from "../notation/parseMoney";
import { cloneRunState } from "../sim/runFactory";
import type { CompiledScenario, Model } from "../sim/types";
import type { StrategyRegistry } from "../sim/strategy/registry";
import type { ModelRegistry } from "./registry";
import type { ScenarioV1 } from "./types";

export type CompileOptions = Readonly<{
  allowSuffixNotation?: boolean;
  // Fallback to legacy Function-based evaluator when safe parser rejects expression.
  // Default false for security reasons.
  allowUnsafeUntilExpr?: boolean;
}>;

type ExprOp = "<" | "<=" | "==" | "!=" | ">=" | ">";
type ExprTerm = Readonly<{
  path: string;
  op: ExprOp;
  rawRight: string;
}>;

const UNTIL_NUMBER_PATHS = new Set<string>(["t", "prestige.count"]);
const UNTIL_BOOLEAN_PATHS = new Set<string>([]);
const UNTIL_AMOUNT_PATHS = new Set<string>([
  "money",
  "wallet.money",
  "wallet.money.amount",
  "bucket",
  "wallet.bucket",
  "maxMoneyEver",
  "maxMoneyEver.amount",
  "prestige.points",
  "prestige.multiplier",
]);

function unsafeCompileUntilExpr(expr: string): (s: any) => boolean {
  const fn = new Function("s", `return Boolean(${expr});`) as (s: any) => boolean;
  return (s: any) => {
    try {
      return fn(s);
    } catch {
      return false;
    }
  };
}

function parseUntilTerms(expr: string): ExprTerm[][] {
  const disj = expr
    .split("||")
    .map((x) => x.trim())
    .filter(Boolean);
  if (disj.length === 0) throw new Error("untilExpr is empty");

  const termRegex = /^([A-Za-z_][A-Za-z0-9_.]*)\s*(<=|>=|==|!=|<|>)\s*([^\s&|]+)$/;
  const allTerms: ExprTerm[][] = [];

  for (const clause of disj) {
    const conj = clause
      .split("&&")
      .map((x) => x.trim())
      .filter(Boolean);
    if (conj.length === 0) throw new Error(`Invalid untilExpr clause: ${clause}`);

    const terms: ExprTerm[] = [];
    for (const raw of conj) {
      const m = termRegex.exec(raw);
      if (!m) {
        throw new Error(`Invalid term: '${raw}'. Use '<path> <op> <value>' with &&/|| only.`);
      }

      const path = m[1]!;
      const op = m[2]! as ExprOp;
      const rawRight = m[3]!;
      terms.push({ path, op, rawRight });
    }
    allTerms.push(terms);
  }

  return allTerms;
}

function readPath(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== "object") return undefined;
  const parts = path.split(".");
  let cur: any = obj;
  for (const part of parts) {
    if (!part || part === "__proto__" || part === "prototype" || part === "constructor") return undefined;
    cur = cur?.[part];
    if (cur === undefined || cur === null) break;
  }
  return cur;
}

function resolveUntilLeft(state: any, path: string): unknown {
  switch (path) {
    case "t":
      return state.t;
    case "money":
    case "wallet.money":
    case "wallet.money.amount":
      return state.wallet?.money?.amount;
    case "bucket":
    case "wallet.bucket":
      return state.wallet?.bucket;
    case "maxMoneyEver":
    case "maxMoneyEver.amount":
      return state.maxMoneyEver?.amount;
    case "prestige.points":
      return state.prestige?.points;
    case "prestige.count":
      return state.prestige?.count;
    case "prestige.multiplier":
      return state.prestige?.multiplier;
    default:
      if (path.startsWith("vars.")) {
        return readPath(state.vars, path.slice("vars.".length));
      }
      return readPath(state, path);
  }
}

function parseRightAsAmount<N, U extends string>(args: {
  E: Engine<N>;
  unit: Unit<U>;
  rawRight: string;
  allowSuffixNotation: boolean;
}): N {
  const hasSuffix = /[A-DF-Za-df-z]/.test(args.rawRight);
  if (hasSuffix && args.allowSuffixNotation) {
    return parseMoney(args.E, args.rawRight, {
      unit: args.unit,
      suffix: { kind: "alphaInfinite", minLen: 2 },
    }).amount;
  }

  return args.E.from(args.rawRight);
}

function compareByOp(cmp: -1 | 0 | 1, op: ExprOp): boolean {
  switch (op) {
    case "<":
      return cmp < 0;
    case "<=":
      return cmp <= 0;
    case "==":
      return cmp === 0;
    case "!=":
      return cmp !== 0;
    case ">=":
      return cmp >= 0;
    case ">":
      return cmp > 0;
  }
}

function prevalidateUntilTerm<N, U extends string>(args: {
  term: ExprTerm;
  E: Engine<N>;
  unit: Unit<U>;
  allowSuffixNotation: boolean;
}): void {
  const { term } = args;
  if (UNTIL_NUMBER_PATHS.has(term.path)) {
    const n = Number(term.rawRight);
    if (!Number.isFinite(n)) {
      throw new Error(`untilExpr numeric comparison requires finite number: ${term.rawRight}`);
    }
    return;
  }

  if (UNTIL_BOOLEAN_PATHS.has(term.path)) {
    if (term.rawRight !== "true" && term.rawRight !== "false") {
      throw new Error(`untilExpr boolean comparison requires true/false: ${term.rawRight}`);
    }
    return;
  }

  if (UNTIL_AMOUNT_PATHS.has(term.path)) {
    const parsed = parseRightAsAmount({
      E: args.E,
      unit: args.unit,
      rawRight: term.rawRight,
      allowSuffixNotation: args.allowSuffixNotation,
    });
    if (!args.E.isFinite(parsed)) {
      throw new Error(`untilExpr amount comparison requires a finite amount: ${term.rawRight}`);
    }
  }
}

function matchesUntilTerm<N, U extends string>(args: {
  state: any;
  term: ExprTerm;
  E: Engine<N>;
  unit: Unit<U>;
  allowSuffixNotation: boolean;
}): boolean {
  const left = resolveUntilLeft(args.state, args.term.path);
  if (left === undefined) return false;
  const { term } = args;

  if (UNTIL_NUMBER_PATHS.has(term.path)) {
    if (typeof left !== "number" || !Number.isFinite(left)) return false;
    const rightNum = Number(term.rawRight);
    if (!Number.isFinite(rightNum)) return false;
    const cmp: -1 | 0 | 1 = left === rightNum ? 0 : left < rightNum ? -1 : 1;
    return compareByOp(cmp, term.op);
  }

  if (UNTIL_BOOLEAN_PATHS.has(term.path)) {
    if (typeof left !== "boolean") return false;
    if (term.rawRight !== "true" && term.rawRight !== "false") return false;
    const rightBool = term.rawRight === "true";
    const cmp: -1 | 0 | 1 = left === rightBool ? 0 : left ? 1 : -1;
    return compareByOp(cmp, term.op);
  }

  if (UNTIL_AMOUNT_PATHS.has(term.path)) {
    let rightAmount: N;
    try {
      rightAmount = parseRightAsAmount({
        E: args.E,
        unit: args.unit,
        rawRight: term.rawRight,
        allowSuffixNotation: args.allowSuffixNotation,
      });
    } catch {
      return false;
    }
    if (!args.E.isFinite(rightAmount)) return false;
    const cmp = args.E.cmp(args.E.from(left as never), rightAmount);
    return compareByOp(cmp, term.op);
  }

  if (typeof left === "number") {
    const rightNum = Number(term.rawRight);
    if (!Number.isFinite(rightNum)) return false;
    const cmp: -1 | 0 | 1 = left === rightNum ? 0 : left < rightNum ? -1 : 1;
    return compareByOp(cmp, term.op);
  }

  if (typeof left === "boolean") {
    if (term.rawRight !== "true" && term.rawRight !== "false") return false;
    const rightBool = term.rawRight === "true";
    const cmp: -1 | 0 | 1 = left === rightBool ? 0 : left ? 1 : -1;
    return compareByOp(cmp, term.op);
  }

  if (typeof left === "string") {
    if (term.op !== "==" && term.op !== "!=") return false;
    return term.op === "==" ? left === term.rawRight : left !== term.rawRight;
  }

  let rightAmount: N;
  try {
    rightAmount = parseRightAsAmount({
      E: args.E,
      unit: args.unit,
      rawRight: term.rawRight,
      allowSuffixNotation: args.allowSuffixNotation,
    });
  } catch {
    return false;
  }
  const cmp = args.E.cmp(args.E.from(left as never), rightAmount);
  return compareByOp(cmp, term.op);
}

function compileUntilExpr<N, U extends string>(args: {
  expr: string | undefined;
  E: Engine<N>;
  unit: Unit<U>;
  allowSuffixNotation: boolean;
  allowUnsafe: boolean;
}): ((s: any) => boolean) | undefined {
  const { expr, E, unit } = args;
  if (!expr || expr.trim().length === 0) return undefined;

  try {
    const parsed = parseUntilTerms(expr);
    for (const conjunction of parsed) {
      for (const term of conjunction) {
        prevalidateUntilTerm({
          term,
          E,
          unit,
          allowSuffixNotation: args.allowSuffixNotation,
        });
      }
    }

    return (state: any) => {
      for (const conjunction of parsed) {
        let matched = true;
        for (const term of conjunction) {
          if (
            !matchesUntilTerm({
              state,
              term,
              E,
              unit,
              allowSuffixNotation: args.allowSuffixNotation,
            })
          ) {
            matched = false;
            break;
          }
        }
        if (matched) return true;
      }
      return false;
    };
  } catch (error) {
    if (args.allowUnsafe) {
      return unsafeCompileUntilExpr(expr);
    }

    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Invalid untilExpr '${expr}'. Supported grammar: <path> <op> <value> with &&/||. Reason: ${reason}`,
    );
  }
}

function standardIssues(result: unknown): string[] {
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

export type StrategyParamsMode = "legacy-raw" | "validated";

/**
 * Internal `StandardSchema` adapter. This is not the external Standard Schema package.
 * `legacy-raw` checks the schema and still passes the caller object to `create`.
 * `validated` passes `result.value`, which may be coerced or defaulted.
 *
 * @evidence docs/requirements/active/cli-resolved-run.md#req-pr07-resolved-run Amount comparisons use parseMoney. Strategy params stay legacy-raw unless validated is requested.
 * @evidenceReview docs/requirements/active/cli-resolved-run.md#req-pr07-resolved-run #01b9284 Re-read the section: legacy-raw keeps the caller object, and an amount path does not use Number(rawRight).
 */
export function strategyCreateParams(args: {
  raw: unknown;
  schema?: { "~standard": { validate: (input: unknown) => unknown } };
  mode?: StrategyParamsMode;
}): Readonly<{ mode: StrategyParamsMode; params: unknown }> {
  const mode = args.mode ?? "legacy-raw";
  if (!args.schema) return { mode, params: args.raw };
  const result = args.schema["~standard"].validate(args.raw) as {
    success?: boolean;
    value?: unknown;
    issues?: unknown;
  };
  if (result?.success !== true) {
    throw new Error(`Invalid strategy params: ${standardIssues(result).join("; ")}`);
  }
  return { mode, params: mode === "validated" ? result.value : args.raw };
}

/** Check model params like `strategyCreateParams` in `legacy-raw` mode. The caller object is returned. */
export function modelCreateParams(args: {
  raw: unknown;
  schema?: { "~standard": { validate: (input: unknown) => unknown } };
}): unknown {
  if (!args.schema) return args.raw;
  const result = args.schema["~standard"].validate(args.raw) as { success?: boolean };
  if (result?.success !== true) {
    throw new Error(`Invalid model params: ${standardIssues(result).join("; ")}`);
  }
  return args.raw;
}

function buildUnit<U extends string>(args: {
  scenario: ScenarioV1;
  unitFactory?: (code: string) => Unit<U>;
}): Unit<U> {
  return args.unitFactory
    ? args.unitFactory(args.scenario.unit.code)
    : ({ code: args.scenario.unit.code as U, symbol: args.scenario.unit.symbol } as Unit<U>);
}

function parseScenarioMoney<N, U extends string>(args: {
  E: Engine<N>;
  unit: Unit<U>;
  raw: string;
  allowSuffixNotation: boolean;
}) {
  return parseMoney(args.E, args.raw, {
    unit: args.unit,
    suffix: args.allowSuffixNotation ? { kind: "alphaInfinite", minLen: 2 } : undefined,
  });
}

function buildInitialState<N, U extends string, Vars>(args: {
  E: Engine<N>;
  scenario: ScenarioV1;
  unit: Unit<U>;
  allowSuffixNotation: boolean;
}) {
  const { E, scenario, unit, allowSuffixNotation } = args;
  const walletMoney = parseScenarioMoney({
    E,
    unit,
    raw: scenario.initial.wallet.amount,
    allowSuffixNotation,
  });

  const bucket = scenario.initial.wallet.bucket
    ? parseScenarioMoney({
        E,
        unit,
        raw: scenario.initial.wallet.bucket,
        allowSuffixNotation,
      }).amount
    : E.zero();

  const maxMoneyEver = scenario.initial.maxMoneyEver
    ? parseScenarioMoney({
        E,
        unit,
        raw: scenario.initial.maxMoneyEver,
        allowSuffixNotation,
      })
    : walletMoney;

  const points = scenario.initial.prestige?.points
    ? parseScenarioMoney({
        E,
        unit,
        raw: scenario.initial.prestige.points,
        allowSuffixNotation,
      }).amount
    : E.zero();

  const multiplier = scenario.initial.prestige?.multiplier
    ? parseScenarioMoney({
        E,
        unit,
        raw: scenario.initial.prestige.multiplier,
        allowSuffixNotation,
      }).amount
    : E.from(1);

  return cloneRunState({
    t: scenario.initial.t ?? 0,
    wallet: {
      money: walletMoney,
      bucket,
    },
    maxMoneyEver,
    prestige: {
      count: scenario.initial.prestige?.count ?? 0,
      points,
      multiplier,
    },
    vars: (scenario.initial.vars ?? ({} as Vars)) as Vars,
  });
}

function buildStrategy<N, U extends string, Vars>(args: {
  scenario: ScenarioV1;
  strategyRegistry?: StrategyRegistry;
}) {
  const { scenario, strategyRegistry } = args;
  if (!scenario.strategy) return undefined;
  if (!strategyRegistry) {
    throw new Error(`StrategyRegistry is required to compile strategy: ${scenario.strategy.id}`);
  }

  const factory = strategyRegistry.get(scenario.strategy.id);
  if (!factory) {
    throw new Error(`Unknown strategy: ${scenario.strategy.id}`);
  }

  const rawParams = scenario.strategy.params ?? factory.defaultParams ?? {};
  const resolved = strategyCreateParams({
    raw: rawParams,
    schema: factory.paramsSchema,
    mode: "legacy-raw",
  });

  return factory.create(resolved.params) as CompiledScenario<N, U, Vars>["strategy"];
}

function buildContext<N, U extends string, Vars>(args: {
  E: Engine<N>;
  unit: Unit<U>;
  scenario: ScenarioV1;
}) {
  return {
    E: args.E,
    unit: args.unit,
    stepSec: args.scenario.clock.stepSec,
    tickPolicy: {
      mode: args.scenario.policy.mode,
      maxLogGap: args.scenario.policy.maxLogGap,
    },
  };
}

function buildRunConfig<N, U extends string>(args: {
  scenario: ScenarioV1;
  E: Engine<N>;
  unit: Unit<U>;
  allowSuffixNotation: boolean;
  allowUnsafeUntilExpr: boolean;
}) {
  const { scenario } = args;
  const hasDuration = typeof scenario.clock.durationSec === "number";
  const hasUntilExpr = typeof scenario.clock.untilExpr === "string" && scenario.clock.untilExpr.trim().length > 0;
  if (hasDuration && !(scenario.clock.durationSec! > 0)) {
    throw new Error("clock.durationSec must be > 0 when provided");
  }
  if (!hasDuration && !hasUntilExpr) {
    throw new Error("clock requires at least one stop condition: durationSec or untilExpr");
  }

  return {
    stepSec: scenario.clock.stepSec,
    durationSec: scenario.clock.durationSec,
    until: compileUntilExpr({
      expr: scenario.clock.untilExpr,
      E: args.E,
      unit: args.unit,
      allowSuffixNotation: args.allowSuffixNotation,
      allowUnsafe: args.allowUnsafeUntilExpr,
    }),
    trace: scenario.outputs?.report?.includeTrace
      ? {
          everySteps: scenario.outputs.report.traceEverySteps ?? 1,
          keepActionsLog: true,
        }
      : undefined,
    fast: scenario.sim?.fast
      ? {
          enabled: true,
          kind: "log-domain" as const,
          disableMoneyEvents: true,
        }
      : undefined,
    eventLog: scenario.sim?.eventLog,
    offline: scenario.sim?.offline,
  };
}

export function compileScenario<N, U extends string, Vars>(args: {
  E: Engine<N>;
  scenario: ScenarioV1;
  registry: ModelRegistry;
  strategyRegistry?: StrategyRegistry;
  unitFactory?: (code: string) => Unit<U>;
  opts?: CompileOptions;
}): CompiledScenario<N, U, Vars> {
  const { E, scenario, registry, strategyRegistry } = args;

  const modelFactory = registry.get(scenario.model.id, scenario.model.version);
  if (!modelFactory) {
    throw new Error(`Model not found: ${scenario.model.id}@${scenario.model.version}`);
  }

  const unit = buildUnit({ scenario, unitFactory: args.unitFactory });
  const allowSuffix = args.opts?.allowSuffixNotation ?? true;

  const model = modelFactory.create(scenario.model.params) as Model<N, U, Vars>;
  const strategy = buildStrategy<N, U, Vars>({ scenario, strategyRegistry });
  const initial = buildInitialState<N, U, Vars>({
    E,
    scenario,
    unit,
    allowSuffixNotation: allowSuffix,
  });
  const ctx = buildContext<N, U, Vars>({ E, unit, scenario });
  const run = buildRunConfig<N, U>({
    scenario,
    E,
    unit,
    allowSuffixNotation: allowSuffix,
    allowUnsafeUntilExpr: args.opts?.allowUnsafeUntilExpr ?? false,
  });

  return {
    ctx,
    model,
    initial,
    design: scenario.design,
    analysis: scenario.analysis,
    constraints: scenario.constraints,
    run,
    strategy,
  };
}
