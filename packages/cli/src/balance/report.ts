import type { PacingReport, PacingTargetResult } from "./pacing";
import type { SheetBundleStatus } from "./sheet";
import { comparePacingValues } from "./pacingAmount";

function cell(value: string | number): string {
  return String(value).replaceAll("|", "\\|").replace(/[\r\n]/g, " ");
}

/** Decimal places in a number's shortest spelling, counting a negative exponent. */
function decimals(value: number): number {
  const [mantissa = "", exponent = "0"] = String(value).split("e");
  return Math.max(0, (mantissa.split(".")[1]?.length ?? 0) - Number(exponent));
}

/**
 * The gap at the operands' own precision, so 1.2 - 1 reads 0.2 rather than binary rounding noise. The last
 * decimal place becomes a count of significant digits, so a gap of 1e-200 keeps its exponent.
 */
function gap(larger: number, smaller: number): number {
  const difference = larger - smaller;
  if (!Number.isFinite(difference) || difference === 0) return difference;
  const lastPlace = Math.max(decimals(larger), decimals(smaller));
  const digits = lastPlace + Math.floor(Math.log10(Math.abs(difference))) + 1;
  return Number(difference.toPrecision(Math.min(17, Math.max(1, digits))));
}

function explain(result: PacingTargetResult): string {
  if (result.status === "breach" && result.value !== null) {
    if (result.min !== undefined && comparePacingValues(result.value, result.min) < 0) return typeof result.min === "number" && typeof result.value === "number"
      ? `below the minimum by ${gap(result.min, result.value)} ${result.unit}` : `below the minimum ${result.min} ${result.unit}`;
    if (result.max !== undefined && comparePacingValues(result.value, result.max) > 0) return typeof result.max === "number" && typeof result.value === "number"
      ? `above the maximum by ${gap(result.value, result.max)} ${result.unit}` : `above the maximum ${result.max} ${result.unit}`;
  }
  if (result.status === "pass") return "within the inclusive target bounds";
  return result.message ?? (result.status === "unreached" ? "not reached within the horizon" : "measurement unavailable");
}

export function renderBalanceReport(report: PacingReport, generationPath: string): string {
  const lines = [
    "# Balance targets",
    "",
    `Result: **${report.status}**. Simulated ${report.horizonSec} seconds using strategy ${cell(report.strategy)}; seeds ${report.seeds.join(", ")}.`,
    "A target is a design constraint on this model under these conditions. End net worth is modeled asset value; it can differ from spendable wallet money.",
    "",
    "| Variant | Seed | Metric | Measured | Target | Status | Explanation |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const entry of report.runs) for (const result of entry.results) {
    const target = [result.min === undefined ? undefined : `minimum ${result.min} ${result.unit}`, result.max === undefined ? undefined : `maximum ${result.max} ${result.unit}`].filter(Boolean).join(", ");
    const measured = result.value === null ? "unavailable" : `${result.value} ${result.unit}`;
    lines.push(`| ${cell(entry.run.variantId)} | ${entry.run.seed} | ${cell(result.metric)} | ${cell(measured)} | ${cell(target)} | ${result.status} | ${cell(explain(result))} |`);
  }
  lines.push("", report.ok ? "All declared targets passed." : "A target breached, was not reached, or could not be measured. The command exits 1; inspect the rows before changing the design.", "", `Saved generation: ${cell(generationPath)}`, "The generation contains exact values in results.json and reproduction inputs in provenance.json. Passing targets does not establish fun or player retention.");
  return lines.join("\n");
}

export function renderBalanceFreshness(result: SheetBundleStatus): string {
  return ["# Balance result freshness", "", `State: **${result.state}**. This checks saved inputs and artifacts; it does not check target success. Run balance without --check to evaluate the targets.`, ...result.staleReasons.map(reason => `- ${cell(reason)}`)].join("\n");
}
