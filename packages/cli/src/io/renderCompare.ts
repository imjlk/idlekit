function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function plain(value: unknown): string {
  if (typeof value !== "string" && (typeof value !== "number" || !Number.isFinite(value))) return "n/a";
  return String(value).replace(/[\r\n]+/g, " ");
}

function cell(value: unknown): string {
  return plain(value).replaceAll("|", "\\|");
}

function inlineCode(value: string): string {
  const text = plain(value);
  const ticks = "`".repeat(Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length)) + 1);
  return `${ticks} ${text} ${ticks}`;
}

/** Format the existing measured results without recomputing or aggregating their decisions. */
export function renderCompareMarkdown(args: {
  aPath: string;
  bPath: string;
  results: readonly Record<string, unknown>[];
  milestoneKey?: string;
  warnings?: readonly string[];
}): string {
  const lines = [
    "# Scenario Comparison", "",
    `- A: ${inlineCode(args.aPath)}`, `- B: ${inlineCode(args.bPath)}`,
    ...(args.milestoneKey ? [`- Milestone key: ${inlineCode(args.milestoneKey)}`] : []),
    "", "| Metric | A | B | Preference | Better on this metric |",
    "| --- | --- | --- | --- | --- |",
  ];
  const preferences: Record<"a" | "b", string[]> = { a: [], b: [] };
  for (const result of args.results) {
    const metric = typeof result.metric === "string" ? result.metric : "unknown";
    const measured = record(result.measured);
    const a = record(measured.a)[metric];
    const b = record(measured.b)[metric];
    const higher = ["endMoney", "endNetWorth", "visibleChangesPerMinute"].includes(metric);
    const lower = ["droppedRate", "etaToTargetWorth", "timeToMilestone", "maxNoRewardGapSec"].includes(metric);
    const seconds = ["etaToTargetWorth", "timeToMilestone", "maxNoRewardGapSec"].includes(metric);
    const value = (item: unknown) => seconds &&
      (typeof item === "number" || (typeof item === "string" && item.trim().length > 0)) && Number.isFinite(Number(item))
      ? `${cell(item)}s` : cell(item);
    const better = result.better === "a" || result.better === "b" ? result.better.toUpperCase()
      : result.better === "tie" ? "tie" : "undetermined";
    lines.push(`| ${cell(metric)} | ${value(a)} | ${value(b)} | ${higher ? "higher" : lower ? "lower" : "n/a"} | ${better} |`);
    if (result.better === "a" || result.better === "b") preferences[result.better].push(metric);
  }
  lines.push("", "## Strategy tradeoffs", "");
  for (const side of ["a", "b"] as const) {
    if (preferences[side].length) lines.push(`- ${side.toUpperCase()} is preferred on: ${preferences[side].map(plain).join(", ")}.`);
  }
  if (!preferences.a.length && !preferences.b.length) lines.push("- The selected metrics do not prefer either scenario.");
  lines.push("- Each preference applies to its metric. Assess the costs and benefits across the full bundle before choosing a strategy.");
  const notes = new Set((args.warnings ?? []).map((warning) => `warnings: ${plain(warning)}`));
  for (const result of args.results) {
    const insights = record(result.insights);
    for (const kind of ["improved", "regressed", "warnings"] as const) {
      const entries = insights[kind];
      if (Array.isArray(entries)) {
        for (const entry of entries) {
          if (typeof entry === "string") notes.add(`${kind}: ${plain(entry)}`);
        }
      }
    }
  }
  if (notes.size) lines.push("", "## Comparison notes", "", ...[...notes].map((note) => `- ${note}`));
  if (args.results.some((result) => result.metric === "timeToMilestone")) {
    lines.push("- Time-to-milestone scores can include an unreached penalty beyond the session horizon; that penalty is not an observed milestone time.");
  }
  return `${lines.join("\n")}\n`;
}
