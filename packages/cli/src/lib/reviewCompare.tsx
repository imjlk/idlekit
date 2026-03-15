/** @jsxImportSource @opentui/react */
import { useRuntime } from "@bunli/runtime/app";
import { createElement } from "react";
import { useKeyboard } from "@opentui/react";
import { runSelfCliJson } from "../runtime/selfCli";

type CompareMetric =
  | "endMoney"
  | "endNetWorth"
  | "etaToTargetWorth"
  | "droppedRate"
  | "timeToMilestone"
  | "visibleChangesPerMinute"
  | "maxNoRewardGapSec";

type CompareBundle = "economy" | "design" | "full";

export type ReviewCompareFlags = Readonly<{
  plugin: string;
  "allow-plugin": boolean;
  "plugin-root": string;
  "plugin-sha256": string;
  "plugin-trust-file": string;
  duration?: number;
  step?: number;
  strategy?: string;
  fast: boolean;
  "target-worth"?: string;
  "milestone-key"?: string;
  "session-pattern"?: string;
  days?: number;
  draws?: number;
  "max-duration": number;
  seed?: number;
  metric?: CompareMetric;
  bundle?: CompareBundle;
}>;

type CompareSingle = Readonly<{
  metric: CompareMetric;
  better: "a" | "b" | "tie";
  detail?: {
    source?: string;
  };
  insights?: {
    drivers?: ReadonlyArray<{
      key: string;
      winner: "a" | "b";
      summary: string;
    }>;
  };
  measured?: {
    a?: Record<string, unknown>;
    b?: Record<string, unknown>;
  };
}>;

type CompareBundleOutput = Readonly<{
  bundle: CompareBundle;
  milestoneKey?: string;
  results: ReadonlyArray<CompareSingle>;
  summary: {
    winners: {
      a: number;
      b: number;
      tie: number;
    };
  };
}>;

export type ReviewCompareOutput = CompareSingle | CompareBundleOutput;
export type ReviewCompareRunner = (args: readonly string[]) => ReviewCompareOutput;

function pluginArgs(flags: ReviewCompareFlags): string[] {
  const args: string[] = [];
  if (flags.plugin) args.push("--plugin", flags.plugin);
  if (flags["allow-plugin"]) args.push("--allow-plugin", "true");
  if (flags["plugin-root"]) args.push("--plugin-root", flags["plugin-root"]);
  if (flags["plugin-sha256"]) args.push("--plugin-sha256", flags["plugin-sha256"]);
  if (flags["plugin-trust-file"]) args.push("--plugin-trust-file", flags["plugin-trust-file"]);
  return args;
}

export function buildReviewCompareArgs(aPath: string, bPath: string, flags: ReviewCompareFlags): string[] {
  const args = ["compare", aPath, bPath, ...pluginArgs(flags), "--format", "json"];
  if (flags.metric) {
    args.push("--metric", flags.metric);
  } else {
    args.push("--bundle", flags.bundle ?? "design");
  }
  if (flags.duration !== undefined) args.push("--duration", String(flags.duration));
  if (flags.step !== undefined) args.push("--step", String(flags.step));
  if (flags.strategy) args.push("--strategy", flags.strategy);
  if (flags.fast) args.push("--fast", "true");
  if (flags["target-worth"]) args.push("--target-worth", flags["target-worth"]);
  if (flags["milestone-key"]) args.push("--milestone-key", flags["milestone-key"]);
  if (flags["session-pattern"]) args.push("--session-pattern", flags["session-pattern"]);
  if (flags.days !== undefined) args.push("--days", String(flags.days));
  if (flags.draws !== undefined) args.push("--draws", String(flags.draws));
  if (flags["max-duration"] !== undefined) args.push("--max-duration", String(flags["max-duration"]));
  if (flags.seed !== undefined) args.push("--seed", String(flags.seed));
  return args;
}

export function loadReviewCompareData(
  aPath: string,
  bPath: string,
  flags: ReviewCompareFlags,
  runner: ReviewCompareRunner = runSelfCliJson,
): ReviewCompareOutput {
  return runner(buildReviewCompareArgs(aPath, bPath, flags));
}

function sectionLines(title: string, lines: readonly string[]) {
  return createElement(
    "box",
    {
      border: true,
      padding: 1,
      style: { flexDirection: "column", gap: 0 },
    },
    createElement("text", { key: `${title}-title`, content: title, fg: "#93c5fd" }),
    ...lines.map((line, index) => createElement("text", { key: `${title}-${index}`, content: line })),
  );
}

function normalizeResults(output: ReviewCompareOutput): readonly CompareSingle[] {
  return "results" in output ? output.results : [output];
}

function winnerSummary(output: ReviewCompareOutput): string[] {
  if ("results" in output) {
    return [
      `Bundle: ${output.bundle}`,
      `Winner counts -> A: ${output.summary.winners.a}, B: ${output.summary.winners.b}, Tie: ${output.summary.winners.tie}`,
      `Milestone key: ${output.milestoneKey ?? "n/a"}`,
    ];
  }
  return [
    `Metric: ${output.metric}`,
    `Winner: ${output.better.toUpperCase()}`,
    `Source: ${output.detail?.source ?? "n/a"}`,
  ];
}

function metricLines(results: readonly CompareSingle[]): string[] {
  return results.map((result) => `${result.metric}: ${result.better.toUpperCase()} (${result.detail?.source ?? "n/a"})`);
}

function driverLines(results: readonly CompareSingle[]): string[] {
  const drivers = results.flatMap((result) =>
    (result.insights?.drivers ?? []).map((driver) => `${driver.key}: ${driver.winner.toUpperCase()} - ${driver.summary}`),
  );
  return drivers.length > 0 ? drivers.slice(0, 8) : ["No comparison drivers emitted."];
}

function measuredLines(results: readonly CompareSingle[]): string[] {
  return results.slice(0, 4).flatMap((result) => {
    const aFields = Object.entries(result.measured?.a ?? {}).slice(0, 2).map(([key, value]) => `A ${result.metric}.${key}: ${String(value)}`);
    const bFields = Object.entries(result.measured?.b ?? {}).slice(0, 2).map(([key, value]) => `B ${result.metric}.${key}: ${String(value)}`);
    return [...aFields, ...bFields];
  });
}

function nextStepLines(): string[] {
  return [
    "- tweak scenario B and rerun review compare",
    "- compare --bundle full --format json for artifact-friendly output",
    "- tune <scenario-a> --tune <spec.json> --format json",
  ];
}

function CompareReviewDashboard(props: {
  aPath: string;
  bPath: string;
  output: ReviewCompareOutput;
}) {
  const { exit } = useRuntime();
  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      exit();
      return;
    }
    if (key.name === "escape" || key.name === "q") {
      exit();
    }
  });

  const results = normalizeResults(props.output);

  return createElement(
    "box",
    {
      style: { flexDirection: "column", gap: 1, padding: 1 },
    },
    sectionLines("Header", [
      `Scenario A: ${props.aPath}`,
      `Scenario B: ${props.bPath}`,
      "Press q or Esc to exit.",
    ]),
    sectionLines("Winner Summary", winnerSummary(props.output)),
    sectionLines("Metric Table", metricLines(results)),
    sectionLines("Drivers", driverLines(results)),
    sectionLines("Measured Snapshots", measuredLines(results)),
    sectionLines("Next Steps", nextStepLines()),
  );
}

export function createReviewCompareElement(args: {
  aPath: string;
  bPath: string;
  output: ReviewCompareOutput;
}) {
  return createElement(CompareReviewDashboard, args);
}
