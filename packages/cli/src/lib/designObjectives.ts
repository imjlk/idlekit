import {
  simulateMonteCarlo,
  type ObjectiveFactory,
  zodStandardSchema,
  type SessionPatternId,
} from "@idlekit/core";
import { z } from "zod";
import {
  collectExperienceSnapshot,
  milestoneTime,
  resolveExperienceDraws,
  resolveExperienceQuantiles,
  resolveExperienceSeries,
  resolveSessionPatternSpec,
  snapshotFromSession,
} from "./experience";

const SessionPatternIdSchema = z.enum([
  "always-on",
  "short-bursts",
  "twice-daily",
  "offline-heavy",
  "weekend-marathon",
]);

const DesignObjectiveParamsSchema = zodStandardSchema(
  z.object({
    sessionPattern: SessionPatternIdSchema.optional(),
    days: z.number().int().positive().optional(),
    draws: z.number().int().positive().optional(),
    quantiles: z.array(z.number().min(0).max(1)).nonempty().optional(),
    milestoneKey: z.string().min(1).optional(),
  }),
);

type DesignObjectiveParams = Readonly<{
  sessionPattern?: SessionPatternId;
  days?: number;
  draws?: number;
  quantiles?: readonly number[];
  milestoneKey?: string;
}>;

function q50(summary: Readonly<Record<string, number>>, fallback: number): number {
  return summary.q50 ?? fallback;
}

function evaluateVisibleProgress<N, U extends string, Vars>(args: {
  scenario: Parameters<NonNullable<ObjectiveFactory["create"]>>[0] extends never ? never : any;
  params: DesignObjectiveParams;
}): number {
  const pattern = resolveSessionPatternSpec({
    scenario: args.scenario,
    sessionPatternId: args.params.sessionPattern,
    days: args.params.days,
  });
  const draws = resolveExperienceDraws(args.scenario, args.params.draws);
  const series = resolveExperienceSeries(args.scenario);

  const scoreOfSnapshot = (snapshot: ReturnType<typeof collectExperienceSnapshot<any, any, any>>["snapshot"]): number => {
    const progress = Math.log10(snapshot.perceived.visibleChangesPerMinute + 1);
    const noRewardPenalty = Math.log10(snapshot.perceived.maxNoRewardGapSec + 1);
    const feedbackPenalty = Math.log10((snapshot.perceived.avgPostPurchaseFeedbackSec ?? 0) + 1);
    return progress - noRewardPenalty - feedbackPenalty;
  };

  if (draws <= 1) {
    return scoreOfSnapshot(
      collectExperienceSnapshot({
        scenario: args.scenario,
        sessionPattern: pattern,
        seed: args.scenario.ctx.seed,
        series,
      }).snapshot,
    );
  }

  const summary = simulateMonteCarlo({
    scenario: args.scenario,
    sessionPattern: pattern,
    draws,
    seed: args.scenario.ctx.seed ?? 1,
    metrics: ({ scenario, session }) => scoreOfSnapshot(snapshotFromSession({ scenario, session: session!, series })),
  });
  return summary.results.reduce((sum, entry) => sum + entry.metrics, 0) / Math.max(1, summary.results.length);
}

function evaluateMilestoneTime<N, U extends string, Vars>(args: {
  scenario: any;
  params: DesignObjectiveParams;
}): number {
  const pattern = resolveSessionPatternSpec({
    scenario: args.scenario,
    sessionPatternId: args.params.sessionPattern,
    days: args.params.days,
  });
  const draws = resolveExperienceDraws(args.scenario, args.params.draws);
  const series = resolveExperienceSeries(args.scenario);
  const milestoneKey = args.params.milestoneKey;

  const readMilestone = (snapshot: ReturnType<typeof collectExperienceSnapshot<any, any, any>>["snapshot"]): number => {
    if (milestoneKey) {
      return milestoneTime(snapshot.milestones, milestoneKey) ?? Number.POSITIVE_INFINITY;
    }
    return snapshot.milestones.firstMilestoneSec ?? Number.POSITIVE_INFINITY;
  };

  if (draws <= 1) {
    return readMilestone(
      collectExperienceSnapshot({
        scenario: args.scenario,
        sessionPattern: pattern,
        seed: args.scenario.ctx.seed,
        series,
      }).snapshot,
    );
  }

  const summary = simulateMonteCarlo({
    scenario: args.scenario,
    sessionPattern: pattern,
    draws,
    seed: args.scenario.ctx.seed ?? 1,
    metrics: ({ scenario, session }) => readMilestone(snapshotFromSession({ scenario, session: session!, series })),
  });
  const samples = summary.results.map((entry) => entry.metrics).filter(Number.isFinite);
  if (samples.length === 0) return Number.POSITIVE_INFINITY;
  const quantiles = resolveExperienceQuantiles(args.scenario, args.params.quantiles);
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * (quantiles.includes(0.5) ? 0.5 : 0.5))));
  return sorted[idx] ?? Number.POSITIVE_INFINITY;
}

function evaluateExperienceBalanced<N, U extends string, Vars>(args: {
  scenario: any;
  params: DesignObjectiveParams;
}): number {
  const pattern = resolveSessionPatternSpec({
    scenario: args.scenario,
    sessionPatternId: args.params.sessionPattern,
    days: args.params.days,
  });
  const draws = resolveExperienceDraws(args.scenario, args.params.draws);
  const series = resolveExperienceSeries(args.scenario);

  const scoreOfSnapshot = (
    snapshot: ReturnType<typeof collectExperienceSnapshot<any, any, any>>["snapshot"],
    droppedRate: number,
  ): number => {
    const visibleScore = Math.log10(snapshot.perceived.visibleChangesPerMinute + 1);
    const noRewardPenalty = Math.log10(snapshot.perceived.maxNoRewardGapSec + 1);
    return snapshot.endNetWorthLog10 + visibleScore - noRewardPenalty - droppedRate * 2;
  };

  if (draws <= 1) {
    const { session, snapshot } = collectExperienceSnapshot({
      scenario: args.scenario,
      sessionPattern: pattern,
      seed: args.scenario.ctx.seed,
      series,
    });
    return scoreOfSnapshot(snapshot, session.run.stats?.money.droppedRate ?? 0);
  }

  const summary = simulateMonteCarlo({
    scenario: args.scenario,
    sessionPattern: pattern,
    draws,
    seed: args.scenario.ctx.seed ?? 1,
    metrics: ({ scenario, session }) => {
      const snapshot = snapshotFromSession({ scenario, session: session!, series });
      return scoreOfSnapshot(snapshot, session?.run.stats?.money.droppedRate ?? 0);
    },
  });
  return summary.results.reduce((sum, entry) => sum + entry.metrics, 0) / Math.max(1, summary.results.length);
}

export const designObjectiveFactories: readonly ObjectiveFactory[] = [
  {
    id: "timeToMilestoneNegSec",
    defaultParams: {},
    paramsSchema: DesignObjectiveParamsSchema,
    create: (params?: DesignObjectiveParams) => ({
      id: "timeToMilestoneNegSec",
      score: ({ scenario }) => {
        const sec = evaluateMilestoneTime({ scenario, params: params ?? {} });
        return Number.isFinite(sec) ? -sec : -1_000_000_000;
      },
    }),
  },
  {
    id: "visibleProgressScore",
    defaultParams: {},
    paramsSchema: DesignObjectiveParamsSchema,
    create: (params?: DesignObjectiveParams) => ({
      id: "visibleProgressScore",
      score: ({ scenario }) => evaluateVisibleProgress({ scenario, params: params ?? {} }),
    }),
  },
  {
    id: "experienceBalancedLog10",
    defaultParams: {},
    paramsSchema: DesignObjectiveParamsSchema,
    create: (params?: DesignObjectiveParams) => ({
      id: "experienceBalancedLog10",
      score: ({ scenario }) => evaluateExperienceBalanced({ scenario, params: params ?? {} }),
    }),
  },
];
