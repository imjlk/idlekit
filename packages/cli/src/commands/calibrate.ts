import { defineCommand, option } from "@bunli/core";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { z } from "zod";
import { writeOutput } from "../io/writeOutput";
import { calibrateMonetization, type TelemetryRow } from "../lib/ltvModel";

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        cur += '"';
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
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

function parseCsvTelemetry(raw: string): TelemetryRow[] {
  const lines = raw
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    throw new Error("CSV telemetry requires a header and at least one data row");
  }

  const headers = splitCsvLine(lines[0] ?? "").map(normalizeHeader);
  const rows: TelemetryRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i] ?? "");
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

    const day = Number(dayRaw);
    const iapRevenue = Number(iapRaw);
    const adRevenue = Number(adRaw);
    const acquisitionCost = acqRaw !== undefined && acqRaw.length > 0 ? Number(acqRaw) : undefined;
    const active =
      activeRaw === undefined
        ? true
        : /^(1|true|yes|y)$/i.test(activeRaw);

    if (!Number.isFinite(day) || !Number.isFinite(iapRevenue) || !Number.isFinite(adRevenue)) {
      throw new Error(`Invalid numeric value in csv row ${i + 1}`);
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

function parseJsonTelemetry(raw: string): TelemetryRow[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("JSON telemetry must be an array");
  }

  const rows: TelemetryRow[] = [];
  for (const [idx, row] of parsed.entries()) {
    if (!row || typeof row !== "object") {
      throw new Error(`JSON telemetry row ${idx} must be an object`);
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
      throw new Error(`Invalid numeric value in json row ${idx}`);
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
      throw new Error("Usage: idk calibrate <telemetry.csv|json> [--input-format auto|csv|json]");
    }

    const abs = resolve(process.cwd(), telemetryPath);
    const raw = await readFile(abs, "utf8");
    const format = flags["input-format"] === "auto" ? extname(abs).toLowerCase() : flags["input-format"];
    const rows =
      format === ".csv" || format === "csv"
        ? parseCsvTelemetry(raw)
        : parseJsonTelemetry(raw);

    const calibrated = calibrateMonetization(rows);
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
    });
  },
});
