/** @jsxImportSource @opentui/react */
import { detectImageCapability, renderImage } from "@bunli/runtime/image";
import { useRuntime } from "@bunli/runtime/app";
import type { ResolvedTuiImageOptions } from "@bunli/core";
import { createElement, useEffect, useMemo, useState } from "react";
import { useKeyboard } from "@opentui/react";
import { cliError } from "../errors";
import { runSelfCliJson } from "../runtime/selfCli";
import { encodeLineChartPng, log10FromNumberish } from "./reviewCharts";

type ReviewEvaluateOutput = Readonly<{
  scenario: string;
  run: {
    id: string;
    seed: number;
  };
  simulate: {
    endMoney: string;
    endNetWorth: string;
    durationSec: number;
    stats?: {
      money?: {
        droppedRate?: number;
      };
    };
  };
  experience: {
    design: {
      intent?: string;
      sessionPattern: {
        id: string;
      };
    };
    session: {
      activeBlocks: number;
      totalActiveSec: number;
      totalOfflineSec: number;
    };
    growth?: {
      segments?: ReadonlyArray<{
        tFrom: number;
        tTo: number;
        slope: number;
        regime: string;
      }>;
      bottlenecks?: ReadonlyArray<{
        t: number;
        reason: string;
      }>;
    };
    milestones: {
      milestones: ReadonlyArray<{
        key: string;
        firstSeenSec: number;
      }>;
      firstMilestoneSec?: number;
      firstActionSec?: number;
      firstPrestigeSec?: number;
    };
    perceived: {
      firstVisibleChangeSec?: number;
      visibleChangesPerMinute: number;
      maxNoRewardGapSec: number;
      avgPostPurchaseFeedbackSec?: number;
      p95PostPurchaseFeedbackSec?: number;
      visibleChangeCount: number;
      activeSeconds: number;
    };
    monteCarlo?: {
      draws: number;
      endNetWorthLog10?: {
        mean: number;
      };
    };
  };
  ltv: {
    summary?: Record<string, { endNetWorth?: string; economyValueProxy?: number }>;
    horizons?: readonly string[];
  };
}>;

export type ReviewEvaluateRunner = (args: readonly string[]) => ReviewEvaluateOutput;

export type ReviewEvaluateFlags = Readonly<{
  plugin: string;
  "allow-plugin": boolean;
  "plugin-root": string;
  "plugin-sha256": string;
  "plugin-trust-file": string;
  "session-pattern"?: string;
  days?: number;
  draws?: number;
  seed?: number;
  strategy?: string;
  fast: boolean;
  step?: number;
  horizons: string;
}>;

type ReviewChart = Readonly<{
  title: string;
  bytes: Uint8Array;
}>;

type ReviewEvaluateImagePlan = Readonly<{
  status: string;
  charts: readonly ReviewChart[];
}>;

function pluginArgs(flags: ReviewEvaluateFlags): string[] {
  const args: string[] = [];
  if (flags.plugin) args.push("--plugin", flags.plugin);
  if (flags["allow-plugin"]) args.push("--allow-plugin", "true");
  if (flags["plugin-root"]) args.push("--plugin-root", flags["plugin-root"]);
  if (flags["plugin-sha256"]) args.push("--plugin-sha256", flags["plugin-sha256"]);
  if (flags["plugin-trust-file"]) args.push("--plugin-trust-file", flags["plugin-trust-file"]);
  return args;
}

export function buildReviewEvaluateArgs(scenarioPath: string, flags: ReviewEvaluateFlags): string[] {
  const args = ["evaluate", scenarioPath, ...pluginArgs(flags), "--format", "json"];
  if (flags["session-pattern"]) args.push("--session-pattern", flags["session-pattern"]);
  if (flags.days !== undefined) args.push("--days", String(flags.days));
  if (flags.draws !== undefined) args.push("--draws", String(flags.draws));
  if (flags.seed !== undefined) args.push("--seed", String(flags.seed));
  if (flags.strategy) args.push("--strategy", flags.strategy);
  if (flags.fast) args.push("--fast", "true");
  if (flags.step !== undefined) args.push("--step", String(flags.step));
  if (flags.horizons) args.push("--horizons", flags.horizons);
  return args;
}

export function loadReviewEvaluateData(
  scenarioPath: string,
  flags: ReviewEvaluateFlags,
  runner: ReviewEvaluateRunner = runSelfCliJson,
): ReviewEvaluateOutput {
  return runner(buildReviewEvaluateArgs(scenarioPath, flags));
}

function orderedHorizonRows(output: ReviewEvaluateOutput): Array<{ label: string; value: string }> {
  const preferred = ["at30m", "at2h", "at24h", "at7d", "at30d", "at90d"];
  return preferred
    .map((key) => {
      const entry = output.ltv.summary?.[key];
      if (!entry?.endNetWorth) return undefined;
      return {
        label: key,
        value: entry.endNetWorth,
      };
    })
    .filter((value): value is { label: string; value: string } => Boolean(value));
}

function buildGrowthChart(output: ReviewEvaluateOutput): ReviewChart | undefined {
  const segments = output.experience.growth?.segments ?? [];
  if (segments.length === 0) return undefined;
  const bytes = encodeLineChartPng({
    title: "Growth slope",
    series: [
      {
        color: [56, 189, 248],
        points: segments.map((segment) => ({
          x: segment.tTo,
          y: segment.slope,
        })),
      },
    ],
  });
  return {
    title: "Growth slope curve",
    bytes,
  };
}

function buildWorthChart(output: ReviewEvaluateOutput): ReviewChart | undefined {
  const horizons = orderedHorizonRows(output);
  if (horizons.length === 0) return undefined;
  const bytes = encodeLineChartPng({
    title: "Worth curve",
    series: [
      {
        color: [167, 139, 250],
        points: horizons.map((row, index) => ({
          x: index,
          y: log10FromNumberish(row.value),
        })),
      },
    ],
  });
  return {
    title: "Long-horizon worth curve",
    bytes,
  };
}

export function resolveReviewEvaluateImagePlan(args: {
  output: ReviewEvaluateOutput;
  image: ResolvedTuiImageOptions;
  env?: NodeJS.ProcessEnv;
  stdout?: NodeJS.WriteStream;
}): ReviewEvaluateImagePlan {
  if (args.image.mode === "off") {
    return {
      status: "Image preview disabled (--image-mode off).",
      charts: [],
    };
  }

  const capability = detectImageCapability({
    env: args.env,
    stdout: args.stdout,
  });

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

  const charts = [buildGrowthChart(args.output), buildWorthChart(args.output)].filter(
    (chart): chart is ReviewChart => Boolean(chart),
  );

  return {
    status: charts.length > 0 ? "Image preview ready." : "No chart data available for image preview.",
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

function nextStepLines(output: ReviewEvaluateOutput): string[] {
  return [
    `- review compare ${output.scenario} <variant.json>`,
    `- compare ${output.scenario} <variant.json> --bundle design --format json`,
    `- tune ${output.scenario} --tune <spec.json> --format json`,
  ];
}

function metricOrNa(value: unknown): string {
  return value === undefined || value === null ? "n/a" : String(value);
}

function EvaluateReviewDashboard(props: {
  output: ReviewEvaluateOutput;
  image: ResolvedTuiImageOptions;
  imagePlan: ReviewEvaluateImagePlan;
}) {
  const { exit } = useRuntime();
  const [imageStatus, setImageStatus] = useState(props.imagePlan.status);

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      exit();
      return;
    }
    if (key.name === "escape" || key.name === "q") {
      exit();
    }
  });

  useEffect(() => {
    let cancelled = false;
    if (props.imagePlan.charts.length === 0) return;

    void (async () => {
      try {
        for (const chart of props.imagePlan.charts) {
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
  }, [props.image.mode, props.image.protocol, props.image.width, props.image.height, props.imagePlan]);

  const headerLines = [
    `Scenario: ${props.output.scenario}`,
    `Run ID: ${props.output.run.id}`,
    `Seed: ${props.output.run.seed}`,
    `Intent: ${props.output.experience.design.intent ?? "n/a"}`,
    `Session: ${props.output.experience.design.sessionPattern.id}`,
    "Press q or Esc to exit.",
  ];

  const simulateLines = [
    `End money: ${props.output.simulate.endMoney}`,
    `End net worth: ${props.output.simulate.endNetWorth}`,
    `Duration sec: ${props.output.simulate.durationSec}`,
    `Dropped rate: ${metricOrNa(props.output.simulate.stats?.money?.droppedRate)}`,
  ];

  const perceived = props.output.experience.perceived;
  const experienceLines = [
    `Visible changes/min: ${perceived.visibleChangesPerMinute.toFixed(2)}`,
    `First visible change sec: ${metricOrNa(perceived.firstVisibleChangeSec)}`,
    `Max no-reward gap sec: ${perceived.maxNoRewardGapSec.toFixed(2)}`,
    `Avg purchase feedback sec: ${metricOrNa(perceived.avgPostPurchaseFeedbackSec?.toFixed(2))}`,
    `P95 purchase feedback sec: ${metricOrNa(perceived.p95PostPurchaseFeedbackSec?.toFixed(2))}`,
    `Active blocks: ${props.output.experience.session.activeBlocks}`,
  ];

  const milestoneLines = props.output.experience.milestones.milestones.length > 0
    ? props.output.experience.milestones.milestones.slice(0, 6).map(
        (milestone) => `${milestone.key}: ${milestone.firstSeenSec.toFixed(1)}s`,
      )
    : ["No milestones emitted."];

  const ltvLines = orderedHorizonRows(props.output).map((row) => `${row.label}: ${row.value}`);
  if (ltvLines.length === 0) {
    ltvLines.push("No long-horizon summary available.");
  }

  const imageLines = [imageStatus];
  if (props.imagePlan.charts.length > 0) {
    imageLines.push(...props.imagePlan.charts.map((chart) => `- ${chart.title}`));
  }

  return createElement(
    "box",
    {
      style: { flexDirection: "column", gap: 1, padding: 1 },
    },
    sectionLines("Header", headerLines),
    sectionLines("Simulate Summary", simulateLines),
    sectionLines("Experience Summary", experienceLines),
    sectionLines("Milestones", milestoneLines),
    sectionLines("LTV Summary", ltvLines),
    sectionLines("Image Preview", imageLines),
    sectionLines("Next Steps", nextStepLines(props.output)),
  );
}

export function createReviewEvaluateElement(args: {
  output: ReviewEvaluateOutput;
  image: ResolvedTuiImageOptions;
  imagePlan: ReviewEvaluateImagePlan;
}) {
  return createElement(EvaluateReviewDashboard, args);
}
