import { z } from "zod";
import type { ScenarioV1 } from "@idlekit/core";
import { formatEngineNumber, type EngineParamType, type EngineParamsV1 } from "./engineParams";

export const IMPORT_MAPPING_FORMAT = "idlekit.import-mapping";
export const IMPORT_MAPPING_SCHEMA_REF = "docs/schemas/import-mapping.v1.schema.json";

export const TIME_UNITS = { sec: 1, min: 60, hour: 3600, day: 86400 } as const;
export type TimeUnit = keyof typeof TIME_UNITS;
export const DEFAULT_SUFFIXES: Readonly<Record<string, number>> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };

const timeUnitSchema = z.enum(["sec", "min", "hour", "day"]);
const paramTypeSchema = z.enum(["amount", "number", "integer", "boolean", "string"]);
const scalarSchema = z.union([z.string(), z.number(), z.boolean()]);

const fieldFromSchema = z
  .object({
    from: z.string().min(1),
    timeUnit: timeUnitSchema.optional(),
    scale: z.number().positive().optional(),
    type: paramTypeSchema.optional(),
  })
  .strict();
const fieldValueSchema = z.object({ value: scalarSchema, type: paramTypeSchema.optional() }).strict();
const fieldSchema = z.union([fieldFromSchema, fieldValueSchema]);
export type FieldMapping = z.infer<typeof fieldSchema>;

export const importMappingSchema = z
  .object({
    $schema: z.string().optional(),
    format: z.literal(IMPORT_MAPPING_FORMAT),
    formatVersion: z.literal(1),
    source: z
      .object({
        rows: z.string().min(1).optional(),
        where: z.record(z.string(), scalarSchema).optional(),
      })
      .strict()
      .optional(),
    units: z
      .object({
        suffixes: z.record(z.string(), z.number().positive()).optional(),
        timeUnit: timeUnitSchema.optional(),
      })
      .strict()
      .optional(),
    scenario: z
      .object({
        id: z.string().min(1),
        title: z.string().optional(),
        description: z.string().optional(),
        unit: z.object({ code: z.string().min(1), symbol: z.string().optional() }).strict(),
        clock: z
          .object({ stepSec: z.number().positive(), durationSec: z.number().positive().optional() })
          .strict(),
        policy: z
          .object({ mode: z.enum(["drop", "accumulate"]), maxLogGap: z.number().optional() })
          .strict()
          .optional(),
        strategy: z.object({ id: z.string().min(1), params: z.unknown().optional() }).strict().optional(),
      })
      .strict(),
    model: z
      .object({
        id: z.string().min(1).default("linear"),
        version: z.number().int().positive().default(1),
        params: z.record(z.string(), fieldSchema).default({}),
      })
      .strict()
      .default({ id: "linear", version: 1, params: {} }),
    curves: z
      .object({
        level: z.string().min(1),
        cost: z.string().min(1).optional(),
        income: z.string().min(1).optional(),
        timeUnit: timeUnitSchema.optional(),
      })
      .strict()
      .optional(),
    initial: z
      .object({
        wallet: fieldSchema.optional(),
        owned: fieldSchema.optional(),
        prestigeMultiplier: fieldSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type ImportMapping = z.infer<typeof importMappingSchema>;

export type ParamProvenance = "field" | "value" | "fit" | "default";

export type CurveFit = Readonly<{
  kind: "geometric" | "linear";
  rows: number;
  base: string;
  growth?: number;
  perUnit?: string;
  r2: number;
  maxRelError: number;
}>;

export type ImportReport = Readonly<{
  ok: true;
  mode: "mapping" | "engine-params";
  scenarioId: string;
  model: string;
  rowsRead: number;
  rowsSelected: number;
  params: readonly Readonly<{ key: string; value: string | number | boolean; source: ParamProvenance; from?: string }>[];
  fits: Readonly<{ cost?: CurveFit; income?: CurveFit }>;
  warnings: readonly string[];
}>;

export type ImportResult = Readonly<{ scenario: ScenarioV1; report: ImportReport }>;

/** Linear model fields: their wire type and whether they are a rate the time unit converts. */
const LINEAR_FIELDS: Readonly<Record<string, { type: EngineParamType; rate: boolean; fallback: string | number }>> = {
  incomePerSec: { type: "amount", rate: true, fallback: "1" },
  buyCostBase: { type: "amount", rate: false, fallback: "10" },
  buyCostGrowth: { type: "number", rate: false, fallback: 1.15 },
  buyIncomeDelta: { type: "amount", rate: true, fallback: "1" },
};

// ---------------------------------------------------------------- table input

/** RFC 4180 CSV with a header row. Quoted cells may hold commas, quotes, and newlines. */
export function parseCsv(text: string): Record<string, string>[] {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]!;
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell.length === 0) quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && body[i + 1] === "\n") i += 1;
      row.push(cell);
      records.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (quoted) throw new Error("CSV ends inside a quoted cell.");
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    records.push(row);
  }
  const nonEmpty = records.filter((r) => r.some((c) => c.trim().length > 0));
  const header = nonEmpty[0]?.map((h) => h.trim());
  if (!header || header.length === 0) throw new Error("CSV has no header row.");
  return nonEmpty.slice(1).map((r, index) => {
    if (r.length > header.length) throw new Error(`CSV row ${index + 2} has more cells than the header.`);
    const out: Record<string, string> = {};
    header.forEach((key, column) => {
      out[key] = (r[column] ?? "").trim();
    });
    return out;
  });
}

function getPath(input: unknown, path: string): unknown {
  let current: unknown = input;
  for (const part of path.split(".")) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current) && /^\d+$/.test(part)) current = current[Number(part)];
    else if (typeof current === "object") current = (current as Record<string, unknown>)[part];
    else return undefined;
  }
  return current;
}

/** Rows a mapping reads: CSV rows, or `source.rows` inside a JSON or YAML document, or the document itself. */
export function selectRows(table: unknown, mapping: ImportMapping): { all: unknown[]; selected: unknown[] } {
  let all: unknown[];
  if (Array.isArray(table) && mapping.source?.rows === undefined) all = table;
  else if (mapping.source?.rows !== undefined) {
    const rows = getPath(table, mapping.source.rows);
    if (!Array.isArray(rows)) throw new Error(`source.rows '${mapping.source.rows}' does not name an array.`);
    all = rows;
  } else all = [table];
  const where = mapping.source?.where;
  const selected = where
    ? all.filter((row) => Object.entries(where).every(([key, expected]) => String(getPath(row, key)) === String(expected)))
    : all;
  if (selected.length === 0) throw new Error("No source row matches source.where.");
  return { all, selected };
}

// ---------------------------------------------------------------- values

const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

type Quantity = Readonly<{ exact?: string; value: number }>;

/** Read `1,500`, `2.5K`, `1e400`, or a number. `exact` keeps a decimal string that needed no conversion. */
export function parseQuantity(raw: unknown, suffixes: Readonly<Record<string, number>>, label: string): Quantity {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) throw new Error(`${label}: value must be finite.`);
    return { value: raw };
  }
  if (typeof raw !== "string") throw new Error(`${label}: expected a number, received ${JSON.stringify(raw)}.`);
  const text = raw.replace(/[,_\s]/g, "");
  if (DECIMAL.test(text)) return { exact: text, value: Number(text) };
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)([A-Za-z]+)$/.exec(text);
  if (match) {
    const suffix = match[2]!;
    const factor =
      suffixes[suffix] ??
      Object.entries(suffixes).find(([key]) => key.toLowerCase() === suffix.toLowerCase())?.[1];
    if (factor !== undefined) return { value: Number(match[1]) * factor };
    throw new Error(`${label}: unknown unit suffix '${suffix}' in '${raw}'. Add it to units.suffixes.`);
  }
  throw new Error(`${label}: '${raw}' is not a number.`);
}

function amountText(quantity: Quantity, factor: number): string {
  if (factor === 1 && quantity.exact !== undefined) {
    // Keep exact decimal text, including values past the float64 range.
    return quantity.exact.replace(/^\+/, "");
  }
  return formatEngineNumber(quantity.value * factor);
}

function typedValue(args: {
  raw: unknown;
  type: EngineParamType;
  factor: number;
  suffixes: Readonly<Record<string, number>>;
  label: string;
}): string | number | boolean {
  const { raw, type, factor, suffixes, label } = args;
  if (type === "string") return String(raw);
  if (type === "boolean") {
    if (typeof raw === "boolean") return raw;
    const text = String(raw).trim().toLowerCase();
    if (["true", "1", "yes"].includes(text)) return true;
    if (["false", "0", "no"].includes(text)) return false;
    throw new Error(`${label}: '${String(raw)}' is not a boolean.`);
  }
  const quantity = parseQuantity(raw, suffixes, label);
  if (type === "amount") return amountText(quantity, factor);
  const value = Number((quantity.value * factor).toPrecision(15));
  if (type === "integer") {
    if (!Number.isInteger(value)) throw new Error(`${label}: '${String(raw)}' is not an integer.`);
    return value;
  }
  return value;
}

function inferMappedType(raw: unknown): EngineParamType {
  if (typeof raw === "boolean") return "boolean";
  if (typeof raw === "number") return "number";
  return "amount";
}

// ---------------------------------------------------------------- fits

function linearRegression(xs: readonly number[], ys: readonly number[]): { slope: number; intercept: number; r2: number } {
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i]! - meanX;
    const dy = ys[i]! - meanY;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (sxx === 0) throw new Error("Curve fit needs at least two distinct levels.");
  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;
  const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);
  return { slope, intercept, r2 };
}

function maxRelError(actual: readonly number[], predicted: readonly number[]): number {
  let worst = 0;
  for (let i = 0; i < actual.length; i += 1) {
    const a = actual[i]!;
    const p = predicted[i]!;
    const denom = Math.max(Math.abs(a), Number.MIN_VALUE);
    worst = Math.max(worst, a === p ? 0 : Math.abs(a - p) / denom);
  }
  return worst;
}

function roundRatio(value: number): number {
  return Number(value.toPrecision(12));
}

/** Fit `cost(n) = base * growth^n` by least squares on ln(cost). */
export function fitGeometric(levels: readonly number[], values: readonly number[]): CurveFit {
  if (values.some((v) => !(v > 0))) throw new Error("Geometric cost fit needs positive costs.");
  const { slope, intercept, r2 } = linearRegression(levels, values.map((v) => Math.log(v)));
  const growth = roundRatio(Math.exp(slope));
  const base = Number(Math.exp(intercept).toPrecision(12));
  const predicted = levels.map((n) => base * Math.pow(growth, n));
  return {
    kind: "geometric",
    rows: levels.length,
    base: formatEngineNumber(base),
    growth,
    r2: roundRatio(r2),
    maxRelError: roundRatio(maxRelError(values, predicted)),
  };
}

/** Fit `income(n) = base + perUnit * n` by least squares. */
export function fitLinear(levels: readonly number[], values: readonly number[]): CurveFit {
  const { slope, intercept, r2 } = linearRegression(levels, values);
  const perUnit = Number(slope.toPrecision(12));
  const base = Number(intercept.toPrecision(12));
  const predicted = levels.map((n) => base + perUnit * n);
  return {
    kind: "linear",
    rows: levels.length,
    base: formatEngineNumber(base),
    perUnit: formatEngineNumber(perUnit),
    r2: roundRatio(r2),
    maxRelError: roundRatio(maxRelError(values, predicted)),
  };
}

// ---------------------------------------------------------------- scenario build

function buildScenario(args: {
  mapping: ImportMapping;
  params: Record<string, unknown>;
  wallet: string;
  owned: number;
  prestigeMultiplier: string;
}): ScenarioV1 {
  const { mapping } = args;
  const s = mapping.scenario;
  return {
    schemaVersion: 1,
    meta: {
      id: s.id,
      ...(s.title !== undefined ? { title: s.title } : {}),
      ...(s.description !== undefined ? { description: s.description } : {}),
      tags: ["imported"],
    },
    unit: { code: s.unit.code, ...(s.unit.symbol !== undefined ? { symbol: s.unit.symbol } : {}) },
    policy: s.policy ?? { mode: "accumulate", maxLogGap: 14 },
    model: { id: mapping.model.id, version: mapping.model.version, params: args.params },
    initial: {
      t: 0,
      wallet: { unit: s.unit.code, amount: args.wallet, bucket: "0" },
      vars: { owned: args.owned },
      prestige: { count: 0, points: "0", multiplier: args.prestigeMultiplier },
    },
    clock: { stepSec: s.clock.stepSec, ...(s.clock.durationSec !== undefined ? { durationSec: s.clock.durationSec } : {}) },
    strategy: s.strategy ?? { id: "greedy" },
  };
}

/** Convert a game economy table to ScenarioV1 with a mapping. The caller validates the result. */
export function importScenarioWithMapping(table: unknown, mapping: ImportMapping): ImportResult {
  const suffixes = { ...DEFAULT_SUFFIXES, ...(mapping.units?.suffixes ?? {}) };
  const defaultRateUnit: TimeUnit = mapping.units?.timeUnit ?? "sec";
  const isLinear = mapping.model.id === "linear" && mapping.model.version === 1;
  const { all, selected } = selectRows(table, mapping);
  const record = selected[0];
  const warnings: string[] = [];
  const params: Record<string, unknown> = {};
  const provenance: { key: string; value: string | number | boolean; source: ParamProvenance; from?: string }[] = [];

  const resolveField = (key: string, field: FieldMapping, fallbackType: EngineParamType, rate: boolean) => {
    const label = `model.params.${key}`;
    if ("value" in field) {
      const type = field.type ?? (fallbackType === "string" ? inferMappedType(field.value) : fallbackType);
      return { value: typedValue({ raw: field.value, type, factor: 1, suffixes, label }), source: "value" as const };
    }
    const raw = getPath(record, field.from);
    if (raw === undefined || raw === "") throw new Error(`${label}: source field '${field.from}' is missing.`);
    const type = field.type ?? (fallbackType === "string" ? inferMappedType(raw) : fallbackType);
    const unit = field.timeUnit ?? (rate ? defaultRateUnit : "sec");
    const factor = (field.scale ?? 1) / TIME_UNITS[unit];
    return { value: typedValue({ raw, type, factor, suffixes, label }), source: "field" as const, from: field.from };
  };

  for (const [key, field] of Object.entries(mapping.model.params)) {
    const meta = isLinear ? LINEAR_FIELDS[key] : undefined;
    if (isLinear && !meta) throw new Error(`model.params.${key} is not a linear model parameter.`);
    const resolved = resolveField(key, field, meta?.type ?? "string", meta?.rate ?? false);
    params[key] = resolved.value;
    provenance.push({ key, ...resolved });
  }

  const fits: { cost?: CurveFit; income?: CurveFit } = {};
  if (mapping.curves) {
    if (!isLinear) throw new Error("curves fit the built-in linear model only. Map the parameters of a plugin model with model.params.");
    const c = mapping.curves;
    const points = selected.map((row, index) => {
      const level = parseQuantity(getPath(row, c.level), suffixes, `row ${index + 1} ${c.level}`).value;
      return { row, level };
    });
    points.sort((a, b) => a.level - b.level);
    const levels = points.map((p) => p.level);
    if (c.cost) {
      const costs = points.map((p, i) => parseQuantity(getPath(p.row, c.cost!), suffixes, `row ${i + 1} ${c.cost}`).value);
      fits.cost = fitGeometric(levels, costs);
      if (params.buyCostBase === undefined) {
        params.buyCostBase = fits.cost.base;
        provenance.push({ key: "buyCostBase", value: fits.cost.base, source: "fit", from: c.cost });
      }
      if (params.buyCostGrowth === undefined) {
        params.buyCostGrowth = fits.cost.growth!;
        provenance.push({ key: "buyCostGrowth", value: fits.cost.growth!, source: "fit", from: c.cost });
      }
      if (fits.cost.maxRelError > 0.05) {
        warnings.push(`Cost column '${c.cost}' deviates up to ${(fits.cost.maxRelError * 100).toFixed(1)}% from a geometric curve. The linear model cannot reproduce it exactly; consider a plugin model.`);
      }
    }
    if (c.income) {
      const factor = 1 / TIME_UNITS[c.timeUnit ?? defaultRateUnit];
      const incomes = points.map((p, i) => parseQuantity(getPath(p.row, c.income!), suffixes, `row ${i + 1} ${c.income}`).value * factor);
      fits.income = fitLinear(levels, incomes);
      if (params.incomePerSec === undefined) {
        params.incomePerSec = fits.income.base;
        provenance.push({ key: "incomePerSec", value: fits.income.base, source: "fit", from: c.income });
      }
      if (params.buyIncomeDelta === undefined) {
        params.buyIncomeDelta = fits.income.perUnit!;
        provenance.push({ key: "buyIncomeDelta", value: fits.income.perUnit!, source: "fit", from: c.income });
      }
      if (fits.income.maxRelError > 0.05) {
        warnings.push(`Income column '${c.income}' deviates up to ${(fits.income.maxRelError * 100).toFixed(1)}% from a straight line. The linear model cannot reproduce it exactly; consider a plugin model.`);
      }
    }
  }

  if (isLinear) {
    for (const [key, meta] of Object.entries(LINEAR_FIELDS)) {
      if (params[key] !== undefined) continue;
      params[key] = meta.fallback;
      provenance.push({ key, value: meta.fallback, source: "default" });
      warnings.push(`model.params.${key} is not mapped; the linear default ${meta.fallback} is used.`);
    }
  }

  const initialField = (field: FieldMapping | undefined, type: EngineParamType, fallback: string | number, label: string) => {
    if (!field) return fallback;
    if ("value" in field) return typedValue({ raw: field.value, type, factor: 1, suffixes, label });
    const raw = getPath(record, field.from);
    if (raw === undefined || raw === "") throw new Error(`${label}: source field '${field.from}' is missing.`);
    return typedValue({ raw, type, factor: field.scale ?? 1, suffixes, label });
  };
  const wallet = String(initialField(mapping.initial?.wallet, "amount", "0", "initial.wallet"));
  const owned = Number(initialField(mapping.initial?.owned, "integer", 0, "initial.owned"));
  const prestigeMultiplier = String(initialField(mapping.initial?.prestigeMultiplier, "amount", "1", "initial.prestigeMultiplier"));
  if (owned < 0) throw new Error("initial.owned must not be negative.");

  const ordered: Record<string, unknown> = {};
  for (const key of Object.keys(params).sort()) ordered[key] = params[key];
  const scenario = buildScenario({ mapping, params: ordered, wallet, owned, prestigeMultiplier });
  return {
    scenario,
    report: {
      ok: true,
      mode: "mapping",
      scenarioId: mapping.scenario.id,
      model: `${mapping.model.id}@${mapping.model.version}`,
      rowsRead: all.length,
      rowsSelected: selected.length,
      params: provenance.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
      fits,
      warnings,
    },
  };
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let current = target;
  for (const part of parts.slice(0, -1)) {
    const next = current[part];
    if (!next || typeof next !== "object" || Array.isArray(next)) current[part] = {};
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]!] = value;
}

/** Turn an exported `idlekit.engine-params` document back into a scenario. */
export function importScenarioFromEngineParams(doc: EngineParamsV1, overrides: { id?: string } = {}): ImportResult {
  const params: Record<string, unknown> = {};
  for (const param of doc.parameters) setPath(params, param.key, param.value);
  const id = overrides.id ?? doc.source.scenarioId ?? "imported-engine-params";
  const scenario: ScenarioV1 = {
    schemaVersion: 1,
    meta: {
      id,
      ...(doc.source.title !== undefined ? { title: doc.source.title } : {}),
      tags: ["imported"],
    },
    unit: { ...doc.unit },
    policy: { ...doc.policy },
    model: { id: doc.model.id, version: doc.model.version, params },
    initial: {
      t: doc.initial.t,
      wallet: { unit: doc.unit.code, amount: doc.initial.wallet, bucket: "0" },
      vars: { ...doc.initial.vars },
      prestige: { ...doc.initial.prestige },
    },
    clock: { ...doc.clock },
    strategy: doc.strategy ? { ...doc.strategy } : { id: "greedy" },
  };
  return {
    scenario,
    report: {
      ok: true,
      mode: "engine-params",
      scenarioId: id,
      model: `${doc.model.id}@${doc.model.version}`,
      rowsRead: 1,
      rowsSelected: 1,
      params: doc.parameters.map((p) => ({ key: p.key, value: p.value, source: "field" as const, from: p.key })),
      fits: {},
      warnings: [],
    },
  };
}
