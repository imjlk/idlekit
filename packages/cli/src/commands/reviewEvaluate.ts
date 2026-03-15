import { defineCommand, option, type RenderArgs } from "@bunli/core";
import { z } from "zod";
import { pluginOptions, type PluginOptionFlags } from "./_shared/plugin";
import { usageError } from "../errors";
import {
  createReviewEvaluateElement,
  loadReviewEvaluateData,
  resolveReviewEvaluateImagePlan,
  type ReviewEvaluateFlags,
} from "../lib/reviewEvaluate";

const strategySchema = z.enum(["greedy", "planner", "scripted"]).optional();
const sessionPatternSchema = z
  .enum(["always-on", "short-bursts", "twice-daily", "offline-heavy", "weekend-marathon"])
  .optional();

type Flags = PluginOptionFlags &
  ReviewEvaluateFlags &
  Readonly<{
    "session-pattern"?: z.infer<typeof sessionPatternSchema>;
    days?: number;
    draws?: number;
    seed?: number;
    strategy?: z.infer<typeof strategySchema>;
    fast: boolean;
    step?: number;
    horizons: string;
  }>;

function ensureInteractiveReview(terminal: { isInteractive: boolean; isCI: boolean }, command: string): void {
  if (terminal.isInteractive && !terminal.isCI) return;
  throw usageError(`${command} requires an interactive terminal.`, "Use `idk evaluate ... --format md|json` for automation-friendly output.");
}

export function renderReviewEvaluate(
  args: RenderArgs<Flags>,
  loadData: (scenarioPath: string, flags: Flags) => ReturnType<typeof loadReviewEvaluateData> = loadReviewEvaluateData,
) {
  const scenarioPath = args.positional[0];
  if (!scenarioPath) {
    throw usageError("Usage: idk review evaluate <scenario>");
  }
  const output = loadData(scenarioPath, args.flags as Flags);
  const imagePlan = resolveReviewEvaluateImagePlan({
    output,
    image: args.image,
  });
  return createReviewEvaluateElement({
    output,
    image: args.image,
    imagePlan,
  });
}

export default defineCommand({
  name: "evaluate",
  description: "Interactive evaluate dashboard for human design review",
  tui: {
    renderer: {
      bufferMode: "standard",
    },
  },
  options: {
    ...pluginOptions(),
    "session-pattern": option(sessionPatternSchema, {
      description: "Session pattern override for review data",
    }),
    days: option(z.coerce.number().int().positive().optional(), {
      description: "Session-pattern day count override",
    }),
    draws: option(z.coerce.number().int().positive().optional(), {
      description: "Monte Carlo draw count override",
    }),
    seed: option(z.coerce.number().optional(), { description: "Deterministic seed override" }),
    strategy: option(strategySchema, { description: "Override strategy id (greedy|planner|scripted)" }),
    fast: option(z.coerce.boolean().default(false), { description: "Enable fast mode for evaluate child runs" }),
    step: option(z.coerce.number().positive().optional(), { description: "Override stepSec for evaluate child runs" }),
    horizons: option(z.string().default("30m,2h,24h,7d,30d,90d"), {
      description: "LTV horizons override",
    }),
  },
  handler({ flags, positional, terminal }) {
    if (!positional[0]) {
      throw usageError("Usage: idk review evaluate <scenario>");
    }
    ensureInteractiveReview(terminal, "idk review evaluate");
  },
  render(args) {
    return renderReviewEvaluate(args as RenderArgs<Flags>);
  },
});
