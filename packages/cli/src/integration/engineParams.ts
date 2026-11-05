import {
  compileScenario,
  createNumberEngine,
  type ModelRegistry,
  type ScenarioV1,
  type SimState,
} from "@idlekit/core";

export const ENGINE_PARAMS_FORMAT = "idlekit.engine-params";
export const ENGINE_PARAMS_FORMAT_VERSION = 1;
export const ENGINE_PARAMS_SCHEMA_REF = "docs/schemas/engine-params.v1.schema.json";

export type EngineParamType = "amount" | "number" | "integer" | "boolean" | "string";

export type EngineParameter = Readonly<{
  /** Dotted path inside `scenario.model.params`. */
  key: string;
  type: EngineParamType;
  /** Amounts stay decimal strings so a value past the float64 range survives the export. */
  value: string | number | boolean;
  role?: "income" | "cost" | "growth" | "other";
}>;

export type EngineCurve = Readonly<{
  id: string;
  kind: "geometric" | "linear";
  /** State variable the curve is indexed by, for example `owned`. */
  variable: string;
  /** Value at variable 0, as a decimal string. */
  base: string;
  /** Geometric ratio per step of the variable. */
  growth?: number;
  /** Linear increase per step of the variable, as a decimal string. */
  perUnit?: string;
  /** Human-readable formula with the variable as `n`. */
  formula: string;
}>;

export type EngineLevelRow = Readonly<{
  level: number;
  /** Price of the next unit at this level. */
  cost: string;
  /** Sum of every price from level 0 to this level, exclusive. */
  totalCost: string;
  /** Income per second at this level, with the initial prestige multiplier. */
  incomePerSec: string;
}>;

export type EngineParamsV1 = Readonly<{
  format: typeof ENGINE_PARAMS_FORMAT;
  formatVersion: typeof ENGINE_PARAMS_FORMAT_VERSION;
  source: Readonly<{
    scenarioId?: string;
    title?: string;
    scenarioHash: string;
    cliVersion: string;
  }>;
  unit: Readonly<{ code: string; symbol?: string }>;
  model: Readonly<{ id: string; version: number }>;
  clock: Readonly<{ stepSec: number; durationSec?: number; untilExpr?: string }>;
  /** idlekit money policy. Engines may ignore it; `idk import scenario` restores it. */
  policy: Readonly<{ mode: "drop" | "accumulate"; maxLogGap?: number }>;
  /** Strategy of the design-time run. Engines may ignore it; `idk import scenario` restores it. */
  strategy?: Readonly<{ id: string; params?: unknown }>;
  initial: Readonly<{
    t: number;
    wallet: string;
    vars: Readonly<Record<string, unknown>>;
    prestige: Readonly<{ count: number; points: string; multiplier: string }>;
  }>;
  parameters: readonly EngineParameter[];
  curves: readonly EngineCurve[];
  levels?: Readonly<{
    variable: string;
    actionId: string;
    rows: readonly EngineLevelRow[];
  }>;
  notes: readonly string[];
}>;

const LINEAR_DEFAULTS = {
  incomePerSec: "1",
  buyCostBase: "10",
  buyCostGrowth: 1.15,
  buyIncomeDelta: "1",
} as const;

const LINEAR_PARAM_META: Readonly<Record<keyof typeof LINEAR_DEFAULTS, { type: EngineParamType; role: EngineParameter["role"] }>> = {
  incomePerSec: { type: "amount", role: "income" },
  buyCostBase: { type: "amount", role: "cost" },
  buyCostGrowth: { type: "number", role: "growth" },
  buyIncomeDelta: { type: "amount", role: "income" },
};

/** Trim float noise such as `18.816000000000003` without changing a value that needs all digits. */
export function formatEngineNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`Non-finite value cannot be exported: ${value}`);
  if (Object.is(value, -0)) return "0";
  return String(Number(value.toPrecision(15)));
}

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
}

function inferType(value: unknown): EngineParamType {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  if (typeof value === "string" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) return "amount";
  return "string";
}

function flattenParams(input: unknown, prefix = ""): EngineParameter[] {
  const out: EngineParameter[] = [];
  const keys = Object.keys(asRecord(input)).sort();
  for (const key of keys) {
    const value = asRecord(input)[key];
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out.push(...flattenParams(value, path));
    } else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out.push({ key: path, type: inferType(value), value });
    } else if (value !== undefined && value !== null) {
      out.push({ key: path, type: "string", value: JSON.stringify(value) });
    }
  }
  return out;
}

function linearParameters(params: unknown): { resolved: typeof LINEAR_DEFAULTS; parameters: EngineParameter[] } {
  const raw = asRecord(params);
  const resolved = {
    incomePerSec: String(raw.incomePerSec ?? LINEAR_DEFAULTS.incomePerSec),
    buyCostBase: String(raw.buyCostBase ?? LINEAR_DEFAULTS.buyCostBase),
    buyCostGrowth: Number(raw.buyCostGrowth ?? LINEAR_DEFAULTS.buyCostGrowth),
    buyIncomeDelta: String(raw.buyIncomeDelta ?? LINEAR_DEFAULTS.buyIncomeDelta),
  } as unknown as typeof LINEAR_DEFAULTS;
  const parameters = (Object.keys(LINEAR_DEFAULTS) as (keyof typeof LINEAR_DEFAULTS)[]).map((key) => ({
    key,
    type: LINEAR_PARAM_META[key].type,
    role: LINEAR_PARAM_META[key].role,
    value: resolved[key],
  }));
  return { resolved, parameters };
}

function linearLevels(args: {
  scenario: ScenarioV1;
  registry: ModelRegistry;
  levels: number;
}): EngineLevelRow[] {
  const E = createNumberEngine();
  const compiled = compileScenario<number, string, Record<string, unknown>>({
    E,
    // Only the model is needed for the level table; drop the strategy so no
    // strategy registry is required.
    scenario: { ...args.scenario, strategy: undefined },
    registry: args.registry,
    opts: { allowSuffixNotation: true },
  });
  const rows: EngineLevelRow[] = [];
  let totalCost = 0;
  for (let level = 0; level < args.levels; level += 1) {
    const state: SimState<number, string, Record<string, unknown>> = {
      ...compiled.initial,
      vars: { ...compiled.initial.vars, owned: level },
    };
    const action = compiled.model.actions(compiled.ctx, state).find((x) => x.id === "buy.generator");
    const cost = action?.cost(compiled.ctx, state)?.amount;
    const income = compiled.model.income(compiled.ctx, state).amount;
    if (cost === undefined || !Number.isFinite(cost) || !Number.isFinite(income)) break;
    rows.push({
      level,
      cost: formatEngineNumber(cost),
      totalCost: formatEngineNumber(totalCost),
      incomePerSec: formatEngineNumber(income),
    });
    totalCost += cost;
    if (!Number.isFinite(totalCost)) break;
  }
  return rows;
}

/**
 * Build the engine-neutral intermediate document. It reads only the validated scenario and,
 * for the built-in `linear` model, prices levels with the same model code the simulator runs.
 */
export function buildEngineParams(args: {
  scenario: ScenarioV1;
  registry: ModelRegistry;
  scenarioHash: string;
  cliVersion: string;
  levels: number;
}): EngineParamsV1 {
  const { scenario } = args;
  const notes: string[] = [];
  const isLinear = scenario.model.id === "linear" && scenario.model.version === 1;
  let parameters: EngineParameter[];
  let curves: EngineCurve[] = [];
  let levels: EngineParamsV1["levels"];

  if (isLinear) {
    const linear = linearParameters(scenario.model.params);
    parameters = linear.parameters;
    const p = linear.resolved;
    curves = [
      {
        id: "buy.generator.cost",
        kind: "geometric",
        variable: "owned",
        base: p.buyCostBase,
        growth: p.buyCostGrowth,
        formula: `cost(n) = ${p.buyCostBase} * ${p.buyCostGrowth}^n`,
      },
      {
        id: "income",
        kind: "linear",
        variable: "owned",
        base: p.incomePerSec,
        perUnit: p.buyIncomeDelta,
        formula: `incomePerSec(n) = (${p.incomePerSec} + ${p.buyIncomeDelta} * n) * prestigeMultiplier`,
      },
    ];
    if (args.levels > 0) {
      const rows = linearLevels({ scenario, registry: args.registry, levels: args.levels });
      if (rows.length < args.levels) {
        notes.push(`Level table stops at ${rows.length} rows: later values exceed the float64 range.`);
      }
      levels = { variable: "owned", actionId: "buy.generator", rows };
    }
  } else {
    parameters = flattenParams(scenario.model.params);
    notes.push(
      `Model ${scenario.model.id}@${scenario.model.version} is not built in. Parameters are exported as declared; curves and level tables are not derived.`,
    );
  }

  const initial = scenario.initial;
  return {
    format: ENGINE_PARAMS_FORMAT,
    formatVersion: ENGINE_PARAMS_FORMAT_VERSION,
    source: {
      ...(scenario.meta?.id !== undefined ? { scenarioId: scenario.meta.id } : {}),
      ...(scenario.meta?.title !== undefined ? { title: scenario.meta.title } : {}),
      scenarioHash: args.scenarioHash,
      cliVersion: args.cliVersion,
    },
    unit: { code: scenario.unit.code, ...(scenario.unit.symbol !== undefined ? { symbol: scenario.unit.symbol } : {}) },
    model: { id: scenario.model.id, version: scenario.model.version },
    clock: {
      stepSec: scenario.clock.stepSec,
      ...(scenario.clock.durationSec !== undefined ? { durationSec: scenario.clock.durationSec } : {}),
      ...(scenario.clock.untilExpr !== undefined ? { untilExpr: scenario.clock.untilExpr } : {}),
    },
    policy: {
      mode: scenario.policy.mode,
      ...(scenario.policy.maxLogGap !== undefined ? { maxLogGap: scenario.policy.maxLogGap } : {}),
    },
    ...(scenario.strategy
      ? {
          strategy: {
            id: scenario.strategy.id,
            ...(scenario.strategy.params !== undefined ? { params: scenario.strategy.params } : {}),
          },
        }
      : {}),
    initial: {
      t: initial.t ?? 0,
      wallet: initial.wallet.amount,
      vars: { ...asRecord(initial.vars) },
      prestige: {
        count: initial.prestige?.count ?? 0,
        points: initial.prestige?.points ?? "0",
        multiplier: initial.prestige?.multiplier ?? "1",
      },
    },
    parameters,
    curves,
    ...(levels ? { levels } : {}),
    notes,
  };
}

export function isEngineParamsDocument(input: unknown): input is EngineParamsV1 {
  const x = asRecord(input);
  return x.format === ENGINE_PARAMS_FORMAT;
}
