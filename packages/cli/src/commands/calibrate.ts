import { defineCommand, option } from "../runtime/command";
import { extname, resolve } from "path";
import { z } from "zod";
import { cliError, usageError } from "../errors";
import { buildOutputMeta } from "../io/outputMeta";
import { writeOutput } from "../io/writeOutput";
import { readScenarioFile } from "../io/readScenario";
import { calibrateMonetization, type TelemetryRow } from "../lib/ltvModel";
import { compareRetention, observeCohort, observedRetentionRates, planRetentionPatch, renderCohortMarkdown } from "../lib/cohortObservation";
import { readTextFile } from "../runtime/bun";

function parseCsvRows(raw: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (ch === '"') {
      const next = raw[i + 1];
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (ch === "," && !inQuotes) {
      row.push(cell.trim());
      cell = "";
      continue;
    }

    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && raw[i + 1] === "\n") i += 1;
      row.push(cell.trim());
      cell = "";
      if (row.some((x) => x.length > 0)) rows.push(row);
      row = [];
      continue;
    }

    cell += ch;
  }

  if (inQuotes) {
    throw cliError("CLI_USAGE", "CSV parse error: unterminated quoted field");
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim());
    if (row.some((x) => x.length > 0)) rows.push(row);
  }

  return rows;
}

function normalizeHeader(s: string): string {
  return s.trim().toLowerCase();
}

function pick(obj: Record<string, string>, aliases: string[]): string | undefined {
  for (const key of aliases) {
    if (obj[key] !== undefined) return obj[key];
  }
  return undefined;
}

function parseNumeric(raw: string, row: number, field: string, opts?: { allowEmpty?: boolean }): number | undefined {
  const input = raw.trim();
  if (input.length === 0) {
    if (opts?.allowEmpty) return undefined;
    throw cliError("CLI_USAGE", `Invalid numeric value in csv row ${row} field '${field}': empty`);
  }
  const normalized = input.replaceAll(",", "");
  const n = Number(normalized);
  if (!Number.isFinite(n)) {
    throw cliError("CLI_USAGE", `Invalid numeric value in csv row ${row} field '${field}': ${raw}`);
  }
  return n;
}

function parseActive(value: unknown, strict: boolean): boolean {
  if (value === undefined) return true;
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && (value === 0 || value === 1)) return value === 1;
  if (typeof value === "string") {
    if (/^(1|true|yes|y)$/i.test(value)) return true;
    if (/^(0|false|no|n)$/i.test(value)) return false;
  }
  if (strict) throw usageError("Observed cohort active must be true/false, yes/no, or 1/0");
  return typeof value === "string" ? /^(1|true|yes|y)$/i.test(value) : Boolean(value);
}

export function parseCsvTelemetry(raw: string, strictCohort = false): TelemetryRow[] {
  const rows2d = parseCsvRows(raw);
  if (rows2d.length < 2) {
    throw cliError("CLI_USAGE", "CSV telemetry requires a header and at least one data row");
  }

  const headers = (rows2d[0] ?? []).map(normalizeHeader);
  if (strictCohort && new Set(headers).size !== headers.length) throw usageError("Observed cohort CSV has duplicate headers");
  const rows: TelemetryRow[] = [];

  for (let i = 1; i < rows2d.length; i++) {
    const cols = rows2d[i] ?? [];
    if (strictCohort && cols.length !== headers.length) throw usageError(`Observed cohort CSV row ${i + 1} has the wrong number of columns`);
    const rec: Record<string, string> = {};
    headers.forEach((h, idx) => {
      rec[h] = cols[idx] ?? "";
    });

    const userInput = pick(rec, ["user_id", "userid", "user", "id"]);
    const dayInput = pick(rec, ["day", "day_index", "days_since_install"]);
    if (strictCohort && (!userInput?.trim() || !dayInput?.trim())) throw usageError("Observed cohort requires explicit user_id and day fields");
    const userId = userInput ?? `anon-${i}`;
    const dayRaw = dayInput ?? "0";
    const iapRaw = pick(rec, ["iap_revenue", "revenue", "iap", "purchase_revenue"]) ?? "0";
    const adRaw = pick(rec, ["ad_revenue", "adrevenue", "ads"]) ?? "0";
    const activeRaw = pick(rec, ["active", "is_active"]);
    const acqRaw = pick(rec, ["acquisition_cost", "ua_cost", "cpi"]);

    const day = parseNumeric(dayRaw, i + 1, "day")!;
    const iapRevenue = parseNumeric(iapRaw, i + 1, "revenue")!;
    const adRevenue = parseNumeric(adRaw, i + 1, "ad_revenue")!;
    const acquisitionCost = acqRaw !== undefined ? parseNumeric(acqRaw, i + 1, "acquisition_cost", { allowEmpty: true }) : undefined;
    const active = parseActive(activeRaw, strictCohort);

    rows.push({
      userId,
      day,
      iapRevenue,
      adRevenue,
      acquisitionCost,
      active,
    });
  }

  return rows;
}

export function parseJsonTelemetry(raw: string, strictCohort = false): TelemetryRow[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw cliError("CLI_USAGE", "JSON telemetry must be an array");
  }

  const rows: TelemetryRow[] = [];
  for (const [idx, row] of parsed.entries()) {
    if (!row || typeof row !== "object") {
      throw cliError("CLI_USAGE", `JSON telemetry row ${idx} must be an object`);
    }
    const r = row as Record<string, unknown>;
    const userInput = r.userId ?? r.user_id ?? r.user ?? r.id;
    const dayInput = r.day ?? r.dayIndex ?? r.daysSinceInstall;
    if (strictCohort && (typeof userInput !== "string" || !userInput.trim() || typeof dayInput !== "number")) throw usageError("Observed cohort JSON requires explicit string userId and numeric day fields");
    if (strictCohort) for (const key of ["iapRevenue", "iap_revenue", "revenue", "adRevenue", "ad_revenue", "acquisitionCost", "acquisition_cost", "cpi"]) {
      if (r[key] !== undefined && typeof r[key] !== "number") throw usageError(`Observed cohort JSON ${key} must be numeric`);
    }
    const userId = String(userInput ?? `anon-${idx}`);
    const day = Number(dayInput ?? 0);
    const iapRevenue = Number(r.iapRevenue ?? r.iap_revenue ?? r.revenue ?? 0);
    const adRevenue = Number(r.adRevenue ?? r.ad_revenue ?? 0);
    const acquisitionCost =
      r.acquisitionCost !== undefined || r.acquisition_cost !== undefined || r.cpi !== undefined
        ? Number(r.acquisitionCost ?? r.acquisition_cost ?? r.cpi)
        : undefined;
    const active = parseActive(r.active, strictCohort);

    if (!Number.isFinite(day) || !Number.isFinite(iapRevenue) || !Number.isFinite(adRevenue)) {
      throw cliError("CLI_USAGE", `Invalid numeric value in json row ${idx}`);
    }

    rows.push({
      userId,
      day,
      iapRevenue,
      adRevenue,
      acquisitionCost,
      active,
    });
  }

  return rows;
}

export default defineCommand({
  name: "calibrate",
  description: "Calibrate monetization parameters from telemetry rows (CSV/JSON)",
  options: {
    "input-format": option(z.enum(["auto", "csv", "json"]).default("auto"), {
      description: "Telemetry file format",
    }),
    "observed-through-day": option(z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(), {
      description: "Complete activity cutoff for one install cohort; requires day 0 records for every installed user",
    }),
    scenario: option(z.string().optional(), { description: "Compare observed retention with this scenario's explicit assumptions (requires --observed-through-day)" }),
    out: option(z.string().optional(), { description: "Output path" }),
    format: option(z.enum(["json", "md", "csv"]).default("json"), { description: "Output format" }),
  },
  async handler({ flags, positional }) {
    const telemetryPath = positional[0];
    if (!telemetryPath || positional.length !== 1) {
      throw usageError("Usage: idk calibrate <telemetry.csv|json> [--input-format auto|csv|json]");
    }
    if (flags.scenario && flags["observed-through-day"] === undefined) throw usageError("--scenario requires --observed-through-day for a mature cohort comparison");

    const abs = resolve(process.cwd(), telemetryPath);
    const raw = await readTextFile(abs);
    const format = flags["input-format"] === "auto" ? extname(abs).toLowerCase() : flags["input-format"];
    const rows =
      format === ".csv" || format === "csv"
        ? parseCsvTelemetry(raw, flags["observed-through-day"] !== undefined)
        : parseJsonTelemetry(raw, flags["observed-through-day"] !== undefined);

    let observation: ReturnType<typeof observeCohort> | undefined;
    if (flags["observed-through-day"] !== undefined) {
      try { observation = observeCohort(rows, flags["observed-through-day"]); }
      catch (error) { throw usageError(error instanceof Error ? error.message : String(error)); }
    }
    const calibrated = calibrateMonetization(rows);
    const retentionRates = observation ? observedRetentionRates(observation) : undefined;
    const scenario = flags.scenario ? await readScenarioFile(flags.scenario) : undefined;
    const rate = z.number().min(0).max(1).optional();
    const parsedScenario = scenario === undefined ? undefined : z.object({
      schemaVersion: z.literal(1),
      monetization: z.object({ retention: z.object({ d1: rate, d7: rate, d30: rate, d90: rate }).passthrough().optional() }).passthrough().optional(),
    }).passthrough().safeParse(scenario);
    if (parsedScenario && !parsedScenario.success) throw usageError(`Invalid scenario retention assumptions: ${parsedScenario.error.message}`);
    const comparison = observation && parsedScenario?.success ? compareRetention(observation, parsedScenario.data.monetization?.retention ?? {}) : undefined;
    const patch = observation ? planRetentionPatch(observation, parsedScenario?.success ? parsedScenario.data.monetization?.retention : undefined) : undefined;
    const monetization = observation ? {
      ...calibrated.monetization,
      retention: { longTailDailyDecay: calibrated.monetization?.retention?.longTailDailyDecay, ...patch?.retention },
    } : calibrated.monetization;
    const outputMeta = buildOutputMeta({
      command: "calibrate",
      telemetry: observation ? { rows, observedThroughDay: observation.observedThroughDay } : rows,
      scenario,
      scenarioPath: flags.scenario ? resolve(flags.scenario) : undefined,
    });
    await writeOutput({
      format: flags.format,
      outPath: flags.out,
      protectedInputs: [abs, ...(flags.scenario ? [resolve(flags.scenario)] : [])],
      data:
        flags.format === "json"
          ? {
              ok: true,
              source: abs,
              sample: {
                rows: rows.length,
                users: calibrated.diagnostics.users,
              },
              monetization,
              diagnostics: observation ? { ...calibrated.diagnostics, retention: retentionRates, observedThroughDay: observation.observedThroughDay } : calibrated.diagnostics,
              ...(observation ? { observation } : {}),
              ...(comparison ? { comparison } : {}),
              ...(patch ? { patchStatus: patch.status, patchWarnings: patch.warnings } : {}),
              scenarioPatch: observation ? { monetization: { retention: patch!.retention } } : {
                monetization: calibrated.monetization,
              },
            }
          : observation ? flags.format === "md" ? renderCohortMarkdown(observation, comparison, patch!) : observation.retention.map((row, index) => ({
              day: row.day, users: row.users, activeUsers: row.activeUsers, observedRate: row.rate,
              interval95Min: row.interval95?.min ?? null,
              interval95Max: row.interval95?.max ?? null,
              assumption: comparison?.[index]?.assumption ?? null,
              differencePercentagePoints: comparison?.[index]?.differencePercentagePoints ?? null,
              status: comparison?.[index]?.status ?? row.status,
              patchStatus: patch!.status,
              patchWarnings: patch!.warnings.join(" "),
            })) : [
              {
                source: abs,
                rows: rows.length,
                users: calibrated.diagnostics.users,
                d1: (calibrated.monetization?.retention?.d1 ?? 0).toFixed(4),
                d7: (calibrated.monetization?.retention?.d7 ?? 0).toFixed(4),
                d30: (calibrated.monetization?.retention?.d30 ?? 0).toFixed(4),
                d90: (calibrated.monetization?.retention?.d90 ?? 0).toFixed(4),
                payerConversion: (calibrated.monetization?.revenue?.payerConversion ?? 0).toFixed(4),
                arppuDaily: (calibrated.monetization?.revenue?.arppuDaily ?? 0).toFixed(4),
                adArpDau: (calibrated.monetization?.revenue?.adArpDau ?? 0).toFixed(4),
                cpi: (calibrated.monetization?.acquisition?.cpi ?? 0).toFixed(4),
              },
            ],
      meta: outputMeta,
    });
  },
});
