function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function cell(value: unknown): string {
  if (typeof value !== "string" && (typeof value !== "number" || !Number.isFinite(value))) return "n/a";
  return String(value).replaceAll("|", "\\|").replace(/[\r\n]+/g, " ");
}

/** Format the existing measured results without recomputing or aggregating their decisions. */
export function renderCompareMarkdown(args: {
  aPath: string;
  bPath: string;
  results: readonly Record<string, unknown>[];
  milestoneKey?: string;
}): string {
  const lines = [
    "# Scenario Comparison", "",
    `- A: \`${cell(args.aPath)}\``, `- B: \`${cell(args.bPath)}\``,
    ...(args.milestoneKey ? [`- Milestone key: \`${cell(args.milestoneKey)}\``] : []),
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
    const value = (item: unknown) => typeof item === "number" && Number.isFinite(item) && seconds ? `${cell(item)}s` : cell(item);
    const better = result.better === "a" || result.better === "b" ? result.better.toUpperCase()
      : result.better === "tie" ? "tie" : "undetermined";
    lines.push(`| ${cell(metric)} | ${value(a)} | ${value(b)} | ${higher ? "higher" : lower ? "lower" : "n/a"} | ${better} |`);
    if (result.better === "a" || result.better === "b") preferences[result.better].push(metric);
  }
  lines.push("", "## Strategy tradeoffs", "");
  for (const side of ["a", "b"] as const) {
    if (preferences[side].length) lines.push(`- ${side.toUpperCase()} is preferred on: ${preferences[side].map(cell).join(", ")}.`);
  }
  if (!preferences.a.length && !preferences.b.length) lines.push("- The selected metrics do not prefer either scenario.");
  lines.push("- Each preference applies to its metric. Assess the costs and benefits across the full bundle before choosing a strategy.");
  for (const result of args.results) {
    const insights = record(result.insights);
    for (const kind of ["improved", "regressed", "warnings"] as const) {
      const entries = insights[kind];
      if (Array.isArray(entries)) {
        for (const entry of entries) {
          if (typeof entry === "string") lines.push(`- ${cell(result.metric)} / ${kind}: ${cell(entry)}`);
        }
      }
    }
  }
  if (args.results.some((result) => result.metric === "timeToMilestone")) {
    lines.push("- Time-to-milestone scores can include an unreached penalty beyond the session horizon; that penalty is not an observed milestone time.");
  }
  return `${lines.join("\n")}\n`;
}
