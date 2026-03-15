import { defineCommand, option, type RenderArgs } from "@bunli/core";
import { z } from "zod";
import { pluginOptions, type PluginOptionFlags } from "./_shared/plugin";
import { usageError } from "../errors";
import {
  createReviewCompareElement,
  loadReviewCompareData,
  type ReviewCompareFlags,
} from "../lib/reviewCompare";

const strategySchema = z.enum(["greedy", "planner", "scripted"]).optional();
const compareMetricSchema = z.enum([
  "endMoney",
  "endNetWorth",
  "etaToTargetWorth",
  "droppedRate",
  "timeToMilestone",
  "visibleChangesPerMinute",
  "maxNoRewardGapSec",
]);
const compareBundleSchema = z.enum(["economy", "design", "full"]).optional();
const sessionPatternSchema = z
  .enum(["always-on", "short-bursts", "twice-daily", "offline-heavy", "weekend-marathon"])
  .optional();

type Flags = PluginOptionFlags & ReviewCompareFlags & Readonly<{
  duration?: number;
  step?: number;
  strategy?: z.infer<typeof strategySchema>;
  fast: boolean;
  "target-worth"?: string;
  "milestone-key"?: string;
  "session-pattern"?: z.infer<typeof sessionPatternSchema>;
  days?: number;
  draws?: number;
  "max-duration": number;
  seed?: number;
  metric?: z.infer<typeof compareMetricSchema>;
  bundle?: z.infer<typeof compareBundleSchema>;
}>;

function ensureInteractiveReview(terminal: { isInteractive: boolean; isCI: boolean }, command: string): void {
  if (terminal.isInteractive && !terminal.isCI) return;
  throw usageError(`${command} requires an interactive terminal.`, "Use `idk compare ... --format json` for automation-friendly output.");
}

export function renderReviewCompare(
  args: RenderArgs<Flags>,
  loadData: (aPath: string, bPath: string, flags: Flags) => ReturnType<typeof loadReviewCompareData> = loadReviewCompareData,
) {
  const aPath = args.positional[0];
  const bPath = args.positional[1];
  if (!aPath || !bPath) {
    throw usageError("Usage: idk review compare <A> <B>");
  }
  const output = loadData(aPath, bPath, args.flags as Flags);
  return createReviewCompareElement({
    aPath,
    bPath,
    output,
  });
}

export default defineCommand({
  name: "compare",
  description: "Interactive compare dashboard for human design review",
  tui: {
    renderer: {
      bufferMode: "standard",
    },
  },
  options: {
    ...pluginOptions(),
    duration: option(z.coerce.number().optional(), { description: "Override durationSec" }),
    step: option(z.coerce.number().optional(), { description: "Override stepSec" }),
    strategy: option(strategySchema, { description: "Override strategy id (greedy|planner|scripted)" }),
    fast: option(z.coerce.boolean().default(false), { description: "Enable fast(log-domain) mode" }),
    "target-worth": option(z.string().optional(), {
      description: "Required for etaToTargetWorth metric, optional otherwise",
    }),
    "milestone-key": option(z.string().optional(), {
      description: "Milestone key override for design bundles or timeToMilestone metric",
    }),
    "session-pattern": option(sessionPatternSchema, {
      description: "Session pattern override for design metrics",
    }),
    days: option(z.coerce.number().int().positive().optional(), {
      description: "Session-pattern day count for design metrics",
    }),
    draws: option(z.coerce.number().int().positive().optional(), {
      description: "Monte Carlo draw count for design metrics",
    }),
    "max-duration": option(z.coerce.number().default(86400), {
      description: "Max duration for etaToTargetWorth metric simulation",
    }),
    seed: option(z.coerce.number().optional(), { description: "Deterministic seed" }),
    metric: option(compareMetricSchema.optional(), { description: "Single comparison metric" }),
    bundle: option(compareBundleSchema, { description: "Bundle of comparison metrics" }),
  },
  handler({ positional, terminal }) {
    if (!positional[0] || !positional[1]) {
      throw usageError("Usage: idk review compare <A> <B>");
    }
    ensureInteractiveReview(terminal, "idk review compare");
  },
  render(args) {
    return renderReviewCompare(args as RenderArgs<Flags>);
  },
});
