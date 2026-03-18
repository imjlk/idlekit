/** @jsxImportSource @opentui/react */
import { detectImageCapability, renderImage } from "@bunli/runtime/image";
import { useRuntime } from "@bunli/runtime/app";
import type { ResolvedTuiImageOptions } from "@bunli/core";
import { createElement, useEffect, useState } from "react";
import { useKeyboard } from "@opentui/react";
import { cliError } from "../errors";
import { runSelfCliJson } from "../runtime/selfCli";
import { encodeLineChartPng, log10FromNumberish } from "./reviewCharts";

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
  horizons?: string;
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

type ReviewCompareOverlay = Readonly<{
  growthSegments: ReadonlyArray<{ tTo: number; slope: number }>;
  ltvSummary?: Record<string, { endNetWorth?: string }>;
}>;

type ReviewCompareChart = Readonly<{
  title: string;
  bytes: Uint8Array;
}>;

export type ReviewCompareImagePlan = Readonly<{
  status: string;
  charts: readonly ReviewCompareChart[];
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

function buildOverlayArgs(scenarioPath: string, flags: ReviewCompareFlags): string[] {
  const args = [
    "evaluate",
    scenarioPath,
    ...pluginArgs(flags),
    "--format",
    "json",
    "--horizons",
    flags.horizons ?? "30m,2h,24h,7d,30d,90d",
  ];
  if (flags["session-pattern"]) args.push("--session-pattern", flags["session-pattern"]);
  if (flags.days !== undefined) args.push("--days", String(flags.days));
  if (flags.draws !== undefined) args.push("--draws", String(flags.draws));
  if (flags.seed !== undefined) args.push("--seed", String(flags.seed));
  if (flags.strategy) args.push("--strategy", flags.strategy);
  if (flags.fast) args.push("--fast", "true");
  if (flags.step !== undefined) args.push("--step", String(flags.step));
  return args;
}

function loadOverlay(scenarioPath: string, flags: ReviewCompareFlags): ReviewCompareOverlay {
  const output = runSelfCliJson<any>(buildOverlayArgs(scenarioPath, flags));
  return {
    growthSegments: (output.experience?.growth?.segments ?? []).map((segment: any) => ({
      tTo: Number(segment.tTo ?? 0),
      slope: Number(segment.slope ?? 0),
    })),
    ltvSummary: output.ltv?.summary,
  };
}

function orderedLtvPoints(summary?: Record<string, { endNetWorth?: string }>): Array<{ x: number; y: number }> {
  const keys = ["at30m", "at2h", "at24h", "at7d", "at30d", "at90d"];
  return keys
    .map((key, index) => {
      const endNetWorth = summary?.[key]?.endNetWorth;
      if (!endNetWorth) return undefined;
      return { x: index, y: log10FromNumberish(endNetWorth) };
    })
    .filter((value): value is { x: number; y: number } => Boolean(value));
}

function buildCompareCharts(a: ReviewCompareOverlay, b: ReviewCompareOverlay): readonly ReviewCompareChart[] {
  const charts: ReviewCompareChart[] = [];
  if (a.growthSegments.length > 0 || b.growthSegments.length > 0) {
    charts.push({
      title: "Growth overlay",
      bytes: encodeLineChartPng({
        title: "Growth overlay",
        series: [
          { color: [56, 189, 248], points: a.growthSegments.map((segment) => ({ x: segment.tTo, y: segment.slope })) },
          { color: [244, 114, 182], points: b.growthSegments.map((segment) => ({ x: segment.tTo, y: segment.slope })) },
        ],
      }),
    });
  }
  const aLtv = orderedLtvPoints(a.ltvSummary);
  const bLtv = orderedLtvPoints(b.ltvSummary);
  if (aLtv.length > 0 || bLtv.length > 0) {
    charts.push({
      title: "Worth overlay",
      bytes: encodeLineChartPng({
        title: "Worth overlay",
        series: [
          { color: [167, 139, 250], points: aLtv },
          { color: [251, 191, 36], points: bLtv },
        ],
      }),
    });
  }
  return charts;
}

export function resolveReviewCompareImagePlan(args: {
  aPath: string;
  bPath: string;
  flags: ReviewCompareFlags;
  image: ResolvedTuiImageOptions;
  env?: NodeJS.ProcessEnv;
  stdout?: NodeJS.WriteStream;
  overlayLoader?: (scenarioPath: string, flags: ReviewCompareFlags) => ReviewCompareOverlay;
  eager?: boolean;
}): ReviewCompareImagePlan {
  if (args.image.mode === "off") {
    return { status: "Image preview disabled (--image-mode off).", charts: [] };
  }

  const capability = detectImageCapability({ env: args.env, stdout: args.stdout });
  if (!capability.supported) {
    if (args.image.mode === "on") {
      throw cliError("CLI_USAGE", "Image preview is not available in this terminal.", {
        hint: "Use --image-mode auto or --image-mode off when Kitty-compatible preview is unavailable.",
        detail: capability.reason,
      });
    }
    return {
      status: `Image preview unavailable (${capability.reason ?? "capability-missing"}). Falling back to text dashboard.`,
      charts: [],
    };
  }

  if (!args.eager) {
    return {
      status: "Image preview ready. Loading overlay charts after first render.",
      charts: [],
    };
  }

  const overlayLoader = args.overlayLoader ?? loadOverlay;
  const aOverlay = overlayLoader(args.aPath, args.flags);
  const bOverlay = overlayLoader(args.bPath, args.flags);
  const charts = buildCompareCharts(aOverlay, bOverlay);
  return {
    status: charts.length > 0 ? "Image preview ready." : "No overlay chart data available.",
    charts,
  };
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
    const aFields = Object.entries(result.measured?.a ?? {})
      .slice(0, 2)
      .map(([key, value]) => `A ${result.metric}.${key}: ${String(value)}`);
    const bFields = Object.entries(result.measured?.b ?? {})
      .slice(0, 2)
      .map(([key, value]) => `B ${result.metric}.${key}: ${String(value)}`);
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
  image: ResolvedTuiImageOptions;
  imagePlan: ReviewCompareImagePlan;
  loadImagePlan?: () => ReviewCompareImagePlan;
}) {
  const { exit } = useRuntime();
  const [imageStatus, setImageStatus] = useState(props.imagePlan.status);
  const [charts, setCharts] = useState<readonly ReviewCompareChart[]>(props.imagePlan.charts);

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

  useEffect(() => {
    let cancelled = false;
    if (!props.loadImagePlan) return;
    void (async () => {
      try {
        const plan = await Promise.resolve(props.loadImagePlan());
        if (cancelled) return;
        setCharts(plan.charts);
        setImageStatus(plan.status);
        for (const chart of plan.charts) {
          const result = await renderImage(
            { kind: "bytes", bytes: chart.bytes, mimeType: "image/png" },
            {
              mode: props.image.mode,
              protocol: props.image.protocol,
              width: props.image.width ?? 70,
              height: props.image.height ?? 18,
            },
          );
          if (cancelled) return;
          setImageStatus(`${chart.title}: ${result.rendered ? "rendered" : `skipped (${result.reason ?? "unknown"})`}`);
        }
      } catch (error) {
        if (cancelled) return;
        setImageStatus(`Image preview error: ${error instanceof Error ? error.message : String(error)}`);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [props.image.mode, props.image.protocol, props.image.width, props.image.height, props.loadImagePlan]);

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
    sectionLines("Image Preview", [imageStatus, ...charts.map((chart) => `- ${chart.title}`)]),
    sectionLines("Next Steps", nextStepLines()),
  );
}

export function createReviewCompareElement(args: {
  aPath: string;
  bPath: string;
  output: ReviewCompareOutput;
  image: ResolvedTuiImageOptions;
  imagePlan: ReviewCompareImagePlan;
  loadImagePlan?: () => ReviewCompareImagePlan;
}) {
  return createElement(CompareReviewDashboard, args);
}
