import { extname, resolve } from "path";
import {
  COHORT_BATCH_SCHEMA_VERSION, validateCohortBatch,
  type CohortActivityRow, type CohortBatch, type CohortBatchEntry, type ObservedCohort,
} from "@idlekit/core";
import { usageError } from "../errors";
import { readTextFile } from "../runtime/bun";
import { parseCsvRows } from "./csv";

/**
 * Standard batch CSV columns. `cohort_id`, `observed_through_day`, `user_id` and `day`
 * are required; `variant`, `install_date`, `active` and money columns are optional.
 * Cohort-level columns must hold one value per cohort.
 */
export const COHORT_BATCH_CSV_COLUMNS = Object.freeze([
  "cohort_id", "variant", "install_date", "observed_through_day", "user_id", "day",
  "active", "iap_revenue", "ad_revenue", "acquisition_cost",
] as const);

const REQUIRED_CSV = ["cohort_id", "observed_through_day", "user_id", "day"] as const;

function csvNumber(raw: string, line: number, column: string, allowEmpty = false): number | undefined {
  const input = raw.trim();
  if (!input) {
    if (allowEmpty) return undefined;
    throw usageError(`Cohort batch CSV line ${line} column ${column} is empty`);
  }
  const value = Number(input);
  if (!Number.isFinite(value)) throw usageError(`Cohort batch CSV line ${line} column ${column} is not a finite number: ${raw}`);
  return value;
}

function csvBoolean(raw: string, line: number): boolean | undefined {
  const input = raw.trim();
  if (!input) return undefined;
  if (/^(1|true|yes|y)$/i.test(input)) return true;
  if (/^(0|false|no|n)$/i.test(input)) return false;
  throw usageError(`Cohort batch CSV line ${line} column active must be true/false, yes/no, or 1/0`);
}

/** Parse the standardized long-format cohort batch CSV into a batch document. */
export function parseCohortBatchCsv(raw: string): CohortBatch {
  const table = parseCsvRows(raw);
  if (table.length < 2) throw usageError("Cohort batch CSV requires a header and at least one data row");
  const headers = table[0]!.map(header => header.trim().toLowerCase());
  if (new Set(headers).size !== headers.length) throw usageError("Cohort batch CSV has duplicate headers");
  for (const header of headers) {
    if (!(COHORT_BATCH_CSV_COLUMNS as readonly string[]).includes(header)) throw usageError(`Cohort batch CSV has an unknown column ${header}; expected ${COHORT_BATCH_CSV_COLUMNS.join(", ")}`);
  }
  for (const column of REQUIRED_CSV) if (!headers.includes(column)) throw usageError(`Cohort batch CSV requires a ${column} column`);
  const cohorts = new Map<string, { variant: string; installDate: string; observedThroughDay: number; rows: CohortActivityRow[] }>();
  for (let index = 1; index < table.length; index++) {
    const line = index + 1;
    const cells = table[index]!;
    if (cells.length !== headers.length) throw usageError(`Cohort batch CSV line ${line} has the wrong number of columns`);
    const cell = (column: string) => cells[headers.indexOf(column)] ?? "";
    const id = cell("cohort_id").trim();
    if (!id) throw usageError(`Cohort batch CSV line ${line} has an empty cohort_id`);
    const observedThroughDay = csvNumber(cell("observed_through_day"), line, "observed_through_day")!;
    const variant = headers.includes("variant") ? cell("variant").trim() : "";
    const installDate = headers.includes("install_date") ? cell("install_date").trim() : "";
    const existing = cohorts.get(id);
    if (existing && (existing.observedThroughDay !== observedThroughDay || existing.variant !== variant || existing.installDate !== installDate)) {
      throw usageError(`Cohort batch CSV line ${line}: cohort ${id} must use one observed_through_day, variant and install_date`);
    }
    const cohort = existing ?? { variant, installDate, observedThroughDay, rows: [] };
    const userId = cell("user_id").trim();
    if (!userId) throw usageError(`Cohort batch CSV line ${line} has an empty user_id`);
    const row: { -readonly [K in keyof CohortActivityRow]: CohortActivityRow[K] } = { userId, day: csvNumber(cell("day"), line, "day")! };
    if (headers.includes("active")) { const active = csvBoolean(cell("active"), line); if (active !== undefined) row.active = active; }
    // A present money column is measured on every row; an omitted column is unmeasured.
    if (headers.includes("iap_revenue")) row.iapRevenue = csvNumber(cell("iap_revenue"), line, "iap_revenue");
    if (headers.includes("ad_revenue")) row.adRevenue = csvNumber(cell("ad_revenue"), line, "ad_revenue");
    if (headers.includes("acquisition_cost")) { const cost = csvNumber(cell("acquisition_cost"), line, "acquisition_cost", true); if (cost !== undefined) row.acquisitionCost = cost; }
    cohort.rows.push(row);
    cohorts.set(id, cohort);
  }
  return {
    schemaVersion: COHORT_BATCH_SCHEMA_VERSION,
    cohorts: [...cohorts.entries()].map(([id, cohort]): CohortBatchEntry => ({
      id, observedThroughDay: cohort.observedThroughDay, rows: cohort.rows,
      ...(cohort.variant ? { variant: cohort.variant } : {}),
      ...(cohort.installDate ? { installDate: cohort.installDate } : {}),
    })),
  };
}

export type LoadedCohortBatch = Readonly<{ sources: readonly string[]; batch: CohortBatch; cohorts: readonly ObservedCohort[] }>;

/** True when a parsed JSON document is a cohort batch rather than a calibrate row array. */
export function isCohortBatchDocument(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value) && "cohorts" in value;
}

export async function readCohortBatchDocument(path: string, format: "auto" | "csv" | "json" = "auto"): Promise<CohortBatch> {
  const abs = resolve(path);
  const raw = await readTextFile(abs);
  const kind = format === "auto" ? (extname(abs).toLowerCase() === ".csv" ? "csv" : "json") : format;
  if (kind === "csv") return parseCohortBatchCsv(raw);
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch (error) { throw usageError(`Cohort batch JSON ${abs} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`); }
  return parsed as CohortBatch;
}

/**
 * Read one or more batch files, merge their cohorts (ids must stay unique) and
 * validate everything at once. Issues carry the source file and JSON path.
 */
export async function loadCohortBatches(paths: readonly string[], format: "auto" | "csv" | "json" = "auto"): Promise<LoadedCohortBatch> {
  if (paths.length === 0) throw usageError("At least one cohort batch file is required");
  const sources = paths.map(path => resolve(path));
  const documents = await Promise.all(paths.map(path => readCohortBatchDocument(path, format)));
  const issues: string[] = [];
  for (const [index, document] of documents.entries()) {
    const result = validateCohortBatch(document);
    if (!result.ok) issues.push(...result.issues.map(issue => `${sources[index]} ${issue.path}: ${issue.message}`));
  }
  if (issues.length) throw usageError(`Invalid cohort batch:\n${issues.join("\n")}`);
  const batch: CohortBatch = { schemaVersion: COHORT_BATCH_SCHEMA_VERSION, cohorts: documents.flatMap(document => document.cohorts) };
  const merged = validateCohortBatch(batch);
  if (!merged.ok) throw usageError(`Invalid merged cohort batch:\n${merged.issues.map(issue => `${issue.path}: ${issue.message}`).join("\n")}`);
  return { sources, batch, cohorts: merged.cohorts };
}

export function selectCohort(loaded: LoadedCohortBatch, id: string | undefined): ObservedCohort {
  if (id === undefined) {
    if (loaded.cohorts.length !== 1) throw usageError(`--cohort is required when the batch has ${loaded.cohorts.length} cohorts (${loaded.cohorts.map(cohort => cohort.id).join(", ")})`);
    return loaded.cohorts[0]!;
  }
  const cohort = loaded.cohorts.find(entry => entry.id === id);
  if (!cohort) throw usageError(`Cohort ${id} is not in the batch (${loaded.cohorts.map(entry => entry.id).join(", ")})`);
  return cohort;
}
