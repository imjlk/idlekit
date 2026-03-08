import { defineCommand, option } from "@bunli/core";
import { extname, resolve } from "path";
import { z } from "zod";
import { cliError, usageError } from "../errors";
import { buildOutputMeta } from "../io/outputMeta";
import { writeOutput } from "../io/writeOutput";
import { calibrateMonetization, type TelemetryRow } from "../lib/ltvModel";
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

export function parseCsvTelemetry(raw: string): TelemetryRow[] {
  const rows2d = parseCsvRows(raw);
  if (rows2d.length < 2) {
    throw cliError("CLI_USAGE", "CSV telemetry requires a header and at least one data row");
  }

  const headers = (rows2d[0] ?? []).map(normalizeHeader);
  const rows: TelemetryRow[] = [];

  for (let i = 1; i < rows2d.length; i++) {
    const cols = rows2d[i] ?? [];
    const rec: Record<string, string> = {};
    headers.forEach((h, idx) => {
      rec[h] = cols[idx] ?? "";
    });

    const userId =
      pick(rec, ["user_id", "userid", "user", "id"]) ??
      `anon-${i}`;
    const dayRaw = pick(rec, ["day", "day_index", "days_since_install"]) ?? "0";
    const iapRaw = pick(rec, ["iap_revenue", "revenue", "iap", "purchase_revenue"]) ?? "0";
    const adRaw = pick(rec, ["ad_revenue", "adrevenue", "ads"]) ?? "0";
    const activeRaw = pick(rec, ["active", "is_active"]);
    const acqRaw = pick(rec, ["acquisition_cost", "ua_cost", "cpi"]);

    const day = parseNumeric(dayRaw, i + 1, "day")!;
    const iapRevenue = parseNumeric(iapRaw, i + 1, "revenue")!;
    const adRevenue = parseNumeric(adRaw, i + 1, "ad_revenue")!;
    const acquisitionCost = acqRaw !== undefined ? parseNumeric(acqRaw, i + 1, "acquisition_cost", { allowEmpty: true }) : undefined;
    const active =
      activeRaw === undefined
        ? true
        : /^(1|true|yes|y)$/i.test(activeRaw);

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

function parseJsonTelemetry(raw: string): TelemetryRow[] {
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
    const userId = String(r.userId ?? r.user_id ?? r.user ?? r.id ?? `anon-${idx}`);
    const day = Number(r.day ?? r.dayIndex ?? r.daysSinceInstall ?? 0);
    const iapRevenue = Number(r.iapRevenue ?? r.iap_revenue ?? r.revenue ?? 0);
    const adRevenue = Number(r.adRevenue ?? r.ad_revenue ?? 0);
    const acquisitionCost =
      r.acquisitionCost !== undefined || r.acquisition_cost !== undefined || r.cpi !== undefined
        ? Number(r.acquisitionCost ?? r.acquisition_cost ?? r.cpi)
        : undefined;
    const active = r.active === undefined ? true : Boolean(r.active);

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
    out: option(z.string().optional(), { description: "Output path" }),
    format: option(z.enum(["json", "md", "csv"]).default("json"), { description: "Output format" }),
  },
  async handler({ flags, positional }) {
    const telemetryPath = positional[0];
    if (!telemetryPath) {
      throw usageError("Usage: idk calibrate <telemetry.csv|json> [--input-format auto|csv|json]");
    }

    const abs = resolve(process.cwd(), telemetryPath);
    const raw = await readTextFile(abs);
    const format = flags["input-format"] === "auto" ? extname(abs).toLowerCase() : flags["input-format"];
    const rows =
      format === ".csv" || format === "csv"
        ? parseCsvTelemetry(raw)
        : parseJsonTelemetry(raw);

    const calibrated = calibrateMonetization(rows);
    const outputMeta = buildOutputMeta({
      command: "calibrate",
      telemetry: rows,
    });
    await writeOutput({
      format: flags.format,
      outPath: flags.out,
      data:
        flags.format === "json"
          ? {
              ok: true,
              source: abs,
              sample: {
                rows: rows.length,
                users: calibrated.diagnostics.users,
              },
              monetization: calibrated.monetization,
              diagnostics: calibrated.diagnostics,
              scenarioPatch: {
                monetization: calibrated.monetization,
              },
            }
          : [
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
