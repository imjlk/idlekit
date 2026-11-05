import type { EngineParameter, EngineParamsV1 } from "./engineParams";

export const ENGINE_TARGETS = ["generic", "godot", "unity"] as const;
export type EngineTarget = (typeof ENGINE_TARGETS)[number];
export const ENGINE_FILE_FORMATS = ["json", "tres", "csv"] as const;
export type EngineFileFormat = (typeof ENGINE_FILE_FORMATS)[number];
export const CSV_TABLES = ["auto", "levels", "parameters"] as const;
export type CsvTable = (typeof CSV_TABLES)[number];

export const DEFAULT_GODOT_SCRIPT_PATH = "res://addons/idlekit/idlekit_economy.gd";

const SUPPORTED: Readonly<Record<EngineTarget, readonly EngineFileFormat[]>> = {
  generic: ["json"],
  godot: ["tres", "json"],
  unity: ["json", "csv"],
};

export function defaultFileFormat(target: EngineTarget): EngineFileFormat {
  return SUPPORTED[target][0]!;
}

export function supportedFileFormats(target: EngineTarget): readonly EngineFileFormat[] {
  return SUPPORTED[target];
}

/** A finite float64 view of an amount string, or `undefined` when the value does not fit. */
function toFloat(value: string | number | boolean): number | undefined {
  if (typeof value === "boolean") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

// ---------------------------------------------------------------- Godot

function godotString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n")}"`;
}

/** Godot reads `1.0` as float and `1` as int. Typed float properties always get a decimal point. */
function godotFloat(value: number): string {
  if (Number.isNaN(value)) return "nan";
  if (!Number.isFinite(value)) return value > 0 ? "inf" : "-inf";
  const text = String(value);
  // Godot parses literals without "." or exponent as int64, so integral values always get a decimal point.
  return /[.eE]/.test(text) ? text : `${text}.0`;
}

function godotValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isSafeInteger(value) ? String(value) : godotFloat(value);
  if (typeof value === "string") return godotString(value);
  if (Array.isArray(value)) return `[${value.map((x) => godotValue(x)).join(", ")}]`;
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return "{}";
  return `{\n${entries.map(([k, v]) => `${godotString(k)}: ${godotValue(v)}`).join(",\n")}\n}`;
}

/** Amount parameters become floats when they fit, so GDScript reads them without parsing. */
function parameterValue(param: EngineParameter): unknown {
  if (param.type === "amount") return toFloat(param.value) ?? String(param.value);
  if (param.type === "number") return toFloat(param.value) ?? param.value;
  return param.value;
}

function parametersDictionary(doc: EngineParamsV1): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const param of doc.parameters) out[param.key] = parameterValue(param);
  return out;
}

function packedFloats(values: readonly number[]): string {
  return `PackedFloat64Array(${values.map((x) => godotFloat(x)).join(", ")})`;
}

/**
 * Godot 4 text resource (`format=3`). The script at `scriptPath` declares the exported
 * properties; `examples/engine-integration/godot/addons/idlekit/idlekit_economy.gd` is the reference script.
 */
export function emitGodotTres(doc: EngineParamsV1, scriptPath = DEFAULT_GODOT_SCRIPT_PATH): string {
  const rows = doc.levels?.rows ?? [];
  const lines = [
    `[gd_resource type="Resource" script_class="IdlekitEconomy" load_steps=2 format=3]`,
    "",
    `[ext_resource type="Script" path=${godotString(scriptPath)} id="1_idlekit"]`,
    "",
    "[resource]",
    `script = ExtResource("1_idlekit")`,
    `format_version = ${doc.formatVersion}`,
    `scenario_id = ${godotString(doc.source.scenarioId ?? "")}`,
    `title = ${godotString(doc.source.title ?? "")}`,
    `scenario_hash = ${godotString(doc.source.scenarioHash)}`,
    `unit_code = ${godotString(doc.unit.code)}`,
    `unit_symbol = ${godotString(doc.unit.symbol ?? "")}`,
    `model_id = ${godotString(doc.model.id)}`,
    `model_version = ${doc.model.version}`,
    `step_sec = ${godotFloat(doc.clock.stepSec)}`,
    `duration_sec = ${godotFloat(doc.clock.durationSec ?? 0)}`,
    `initial_wallet = ${godotFloat(toFloat(doc.initial.wallet) ?? 0)}`,
    `initial_vars = ${godotValue(doc.initial.vars)}`,
    `prestige_multiplier = ${godotFloat(toFloat(doc.initial.prestige.multiplier) ?? 1)}`,
    `parameters = ${godotValue(parametersDictionary(doc))}`,
    `curves = ${godotValue(doc.curves.map((curve) => ({ ...curve })))}`,
    `level_variable = ${godotString(doc.levels?.variable ?? "")}`,
    `cost_table = ${packedFloats(rows.map((row) => Number(row.cost)))}`,
    `income_table = ${packedFloats(rows.map((row) => Number(row.incomePerSec)))}`,
    "",
  ];
  return lines.join("\n");
}

/** Plain JSON for `JSON.parse_string` in GDScript: snake_case keys, floats where they fit. */
export function emitGodotJson(doc: EngineParamsV1): string {
  const rows = doc.levels?.rows ?? [];
  const body = {
    format_version: doc.formatVersion,
    scenario_id: doc.source.scenarioId ?? "",
    title: doc.source.title ?? "",
    scenario_hash: doc.source.scenarioHash,
    unit_code: doc.unit.code,
    unit_symbol: doc.unit.symbol ?? "",
    model_id: doc.model.id,
    model_version: doc.model.version,
    step_sec: doc.clock.stepSec,
    duration_sec: doc.clock.durationSec ?? 0,
    initial_wallet: toFloat(doc.initial.wallet) ?? 0,
    initial_vars: doc.initial.vars,
    prestige_multiplier: toFloat(doc.initial.prestige.multiplier) ?? 1,
    parameters: parametersDictionary(doc),
    curves: doc.curves,
    level_variable: doc.levels?.variable ?? "",
    cost_table: rows.map((row) => Number(row.cost)),
    income_table: rows.map((row) => Number(row.incomePerSec)),
  };
  return `${JSON.stringify(body, null, 2)}\n`;
}

// ---------------------------------------------------------------- Unity

/**
 * JSON shaped for `JsonUtility.FromJsonOverwrite`: no dictionaries, every field present,
 * one type per field. Each amount carries a float (`value`) and the exact text (`text`).
 */
export function emitUnityJson(doc: EngineParamsV1): string {
  const body = {
    formatVersion: doc.formatVersion,
    scenarioId: doc.source.scenarioId ?? "",
    title: doc.source.title ?? "",
    scenarioHash: doc.source.scenarioHash,
    unitCode: doc.unit.code,
    unitSymbol: doc.unit.symbol ?? "",
    modelId: doc.model.id,
    modelVersion: doc.model.version,
    stepSec: doc.clock.stepSec,
    durationSec: doc.clock.durationSec ?? 0,
    initialWallet: toFloat(doc.initial.wallet) ?? 0,
    initialWalletText: doc.initial.wallet,
    prestigeMultiplier: toFloat(doc.initial.prestige.multiplier) ?? 1,
    parameters: doc.parameters.map((param) => ({
      key: param.key,
      type: param.type,
      role: param.role ?? "other",
      text: String(param.value),
      value: toFloat(param.value) ?? (param.value === true ? 1 : 0),
    })),
    curves: doc.curves.map((curve) => ({
      id: curve.id,
      kind: curve.kind,
      variable: curve.variable,
      baseText: curve.base,
      base: toFloat(curve.base) ?? 0,
      growth: curve.growth ?? 1,
      perUnitText: curve.perUnit ?? "0",
      perUnit: toFloat(curve.perUnit ?? "0") ?? 0,
      formula: curve.formula,
    })),
    levelVariable: doc.levels?.variable ?? "",
    levels: (doc.levels?.rows ?? []).map((row) => ({
      level: row.level,
      cost: Number(row.cost),
      costText: row.cost,
      totalCost: Number(row.totalCost),
      incomePerSec: Number(row.incomePerSec),
    })),
  };
  return `${JSON.stringify(body, null, 2)}\n`;
}

function csvCell(value: unknown): string {
  const raw = value === undefined || value === null ? "" : String(value);
  return /[",\n\r]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
}

function csvRows(rows: readonly (readonly unknown[])[]): string {
  return `${rows.map((row) => row.map((cell) => csvCell(cell)).join(",")).join("\n")}\n`;
}

/** One CSV table for a Unity importer: the level table when there is one, else the parameter table. */
export function emitUnityCsv(doc: EngineParamsV1, table: CsvTable = "auto"): string {
  const useLevels = table === "levels" || (table === "auto" && (doc.levels?.rows.length ?? 0) > 0);
  if (useLevels) {
    if (!doc.levels) throw new Error(`Model ${doc.model.id}@${doc.model.version} has no level table to export.`);
    return csvRows([
      ["level", "cost", "totalCost", "incomePerSec"],
      ...doc.levels.rows.map((row) => [row.level, row.cost, row.totalCost, row.incomePerSec]),
    ]);
  }
  return csvRows([
    ["key", "type", "role", "value"],
    ...doc.parameters.map((param) => [param.key, param.type, param.role ?? "other", param.value]),
  ]);
}

export function emitEngineFile(args: {
  doc: EngineParamsV1;
  target: EngineTarget;
  fileFormat: EngineFileFormat;
  csvTable?: CsvTable;
  godotScriptPath?: string;
}): string {
  const { doc, target, fileFormat } = args;
  if (!SUPPORTED[target].includes(fileFormat)) {
    throw new Error(`Target ${target} does not support ${fileFormat}. Use one of: ${SUPPORTED[target].join(", ")}.`);
  }
  if (target === "generic") return `${JSON.stringify(doc, null, 2)}\n`;
  if (target === "godot") return fileFormat === "tres" ? emitGodotTres(doc, args.godotScriptPath) : emitGodotJson(doc);
  return fileFormat === "csv" ? emitUnityCsv(doc, args.csvTable) : emitUnityJson(doc);
}
