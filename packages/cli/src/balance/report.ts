import type { PacingReport, PacingTargetResult } from "./pacing";
import type { SheetBundleStatus } from "./sheet";

function cell(value: string | number): string {
  return String(value).replaceAll("|", "\\|").replace(/[\r\n]/g, " ");
}

function explain(result: PacingTargetResult): string {
  if (result.status === "breach" && result.value !== null) {
    if (result.min !== undefined && result.value < result.min) return `below the minimum by ${result.min - result.value} ${result.unit}`;
    if (result.max !== undefined && result.value > result.max) return `above the maximum by ${result.value - result.max} ${result.unit}`;
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
