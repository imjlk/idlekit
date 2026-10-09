import type { Strategy } from "./types";
import { singleBuySize, stepOnce } from "../step";
import type { StepOnceFn } from "../stepTypes";
import { parseMoney } from "../../notation/parseMoney";
import { constraintsWithAnchor, decidePrestigeCooldown } from "../constraints";
import { cloneRunState } from "../runFactory";
import type { Action, BulkQuote, Model, SimContext, SimState } from "../types";
import type { PlannerStrategyParamsV1 } from "./params";
import {
  actionOccurrence,
  quotedDecisionSize,
  rankableQuotes,
  stableActions,
  stableBulkQuotes,
} from "./stability";

/**
 * Planner MUST use stepOnce for rollouts.
 * Do NOT re-implement simulator tick/payment logic inside planner.
 */
export type PlannerDeps<N, U extends string, Vars> = Readonly<{
  stepOnce: StepOnceFn<N, U, Vars>;
}>;

type Decision<N, U extends string, Vars> = Readonly<{
  action: Action<N, U, Vars>;
  bulkSize?: number;
  occurrence?: number;
}>;

type FirstChoice<N, U extends string, Vars> =
  | { readonly kind: "unset" }
  | { readonly kind: "wait" }
  | { readonly kind: "act"; readonly decision: Decision<N, U, Vars> };

type PlannerNode<N, U extends string, Vars> = Readonly<{
  state: SimState<N, U, Vars>;
  first: FirstChoice<N, U, Vars>;
  reachedTargetAtSec?: number;
  /** Cooldown anchor on this branch. A reset simulated in the rollout moves it. */
  lastResetT?: number;
  score: number;
}>;

const horizonCap = 32;
const beamCap = 8;
const branchCap = 8;
const rolloutBudget = 256;

/**
 * Search record. This beam search does not prove a global optimum.
 * TC-05 has not registered this DTO.
 *
 * @evidence docs/requirements/active/planner-rollout.md#req-pr04-planner-rollout A capped beam search records that it is not a global optimum.
 * @evidenceReview docs/requirements/active/planner-rollout.md#req-pr04-planner-rollout #35741cf Re-read the section: globallyOptimal stays false, and a budget stop is not an optimum.
 */
export const plannerSearchContract = "idlekit.planner-search" as const;

export type PlannerSearchReport = Readonly<{
  contract: typeof plannerSearchContract;
  version: 1;
  globallyOptimal: false;
  stopped: "horizon" | "budget";
  clamped: boolean;
  rollouts: number;
  rolloutBudget: number;
  horizonSteps: number;
  beamWidth: number;
  maxBranchingActions: number;
}>;

export type PlannerStrategy<N, U extends string, Vars> = Strategy<N, U, Vars> & {
  plannerReport: () => PlannerSearchReport;
};

function chooseFirst<N, U extends string, Vars>(
  current: FirstChoice<N, U, Vars>,
  decision: Decision<N, U, Vars> | undefined,
): FirstChoice<N, U, Vars> {
  if (current.kind !== "unset") return current;
  if (!decision) return { kind: "wait" };
  return { kind: "act", decision };
}

function choiceId<N, U extends string, Vars>(choice: FirstChoice<N, U, Vars>): string {
  if (choice.kind === "wait") return "~wait";
  if (choice.kind === "act") return choice.decision.action.id;
  return "~unset";
}

function choiceBulk<N, U extends string, Vars>(choice: FirstChoice<N, U, Vars>): number {
  if (choice.kind !== "act") return 1;
  return choice.decision.bulkSize ?? 1;
}

function worthAmount<N, U extends string, Vars>(
  ctx: SimContext<N, U, Vars>,
  model: Model<N, U, Vars>,
  state: SimState<N, U, Vars>,
  series: "netWorth" | "money",
): N {
  if (series === "netWorth") {
    return (model.netWorth?.(ctx, state) ?? state.wallet.money).amount;
  }
  return state.wallet.money.amount;
}

function parseTargetOrThrow<N, U extends string, Vars>(
  params: PlannerStrategyParamsV1,
  ctx: SimContext<N, U, Vars>,
): N | undefined {
  if (params.objective !== "minTimeToTargetWorth") return undefined;
  if (!params.targetWorth) {
    throw new Error("planner objective=minTimeToTargetWorth requires targetWorth");
  }
  try {
    return parseMoney(ctx.E, params.targetWorth, {
      unit: ctx.unit,
      suffix: { kind: "alphaInfinite", minLen: 2 },
    }).amount;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "parse failed";
    throw new Error(`invalid planner targetWorth '${params.targetWorth}': ${reason}`);
  }
}

function scoreQuote<N, U extends string, Vars>(
  params: PlannerStrategyParamsV1,
  ctx: SimContext<N, U, Vars>,
  quote: BulkQuote<N, U>,
): number {
  const equivalentAmount = quote.equivalentCost?.amount;
  const costAmount = quote.cost?.amount;
  const deltaAmount = quote.deltaIncomePerSec?.amount;
  const useCostAmount = equivalentAmount ?? costAmount;

  if (params.objective === "maximizePrestigePerHour") {
    return deltaAmount ? ctx.E.absLog10(deltaAmount) : Number.NEGATIVE_INFINITY;
  }

  if (params.objective === "minTimeToTargetWorth") {
    if (!deltaAmount || !useCostAmount) return Number.NEGATIVE_INFINITY;
    return -(ctx.E.absLog10(useCostAmount) - ctx.E.absLog10(deltaAmount));
  }

  const horizonSteps = Math.max(1, params.horizonSteps);
  const delta = deltaAmount ? ctx.E.absLog10(deltaAmount) + Math.log10(horizonSteps) : Number.NEGATIVE_INFINITY;
  const cost = useCostAmount ? ctx.E.absLog10(useCostAmount) : Number.NEGATIVE_INFINITY;
  if (!Number.isFinite(delta)) return Number.isFinite(cost) ? -cost : Number.NEGATIVE_INFINITY;
  if (!Number.isFinite(cost)) return delta;
  return delta - cost;
}

function listedBulkQuotes<N, U extends string>(
  raw: readonly BulkQuote<N, U>[] | null | undefined,
): raw is readonly BulkQuote<N, U>[] {
  return Array.isArray(raw) && raw.length > 0;
}

function selectBulkQuote<N, U extends string, Vars>(
  params: PlannerStrategyParamsV1,
  action: Action<N, U, Vars>,
  ctx: SimContext<N, U, Vars>,
  state: SimState<N, U, Vars>,
): BulkQuote<N, U> | undefined {
  const raw = action.bulk?.(ctx, state);
  const listed = listedBulkQuotes(raw);
  const stable = listed
    ? stableBulkQuotes(raw)
    : [
        {
          size: 1,
          cost: action.cost(ctx, state),
          equivalentCost: action.equivalentCost?.(ctx, state),
        },
      ];
  let singleCost = stable[0]!.cost;
  if (listed && stable.some((quote) => quote.size === singleBuySize)) {
    singleCost = action.cost(ctx, state);
  }
  const usable = rankableQuotes(ctx, state, stable, singleCost);
  if (usable.length === 0) return undefined;

  if ((params.bulk?.mode ?? "bestQuote") === "size1") {
    return usable.find((quote) => quote.size === singleBuySize);
  }

  let best = usable[0]!;
  let bestScore = scoreQuote(params, ctx, best);
  for (let i = 1; i < usable.length; i++) {
    const quote = usable[i]!;
    const score = scoreQuote(params, ctx, quote);
    if (score > bestScore) {
      best = quote;
      bestScore = score;
    }
  }
  return best;
}

function buildStepCandidates<N, U extends string, Vars>(
  params: PlannerStrategyParamsV1,
  ctx: SimContext<N, U, Vars>,
  model: Model<N, U, Vars>,
  state: SimState<N, U, Vars>,
  maxBranchingActions: number,
): readonly Decision<N, U, Vars>[] {
  const raw = model.actions(ctx, state);
  const actions = stableActions(raw).filter((action) => {
    if (!action.canApply(ctx, state)) return false;
    if (action.kind !== "prestige") return true;
    return decidePrestigeCooldown({
      nowT: state.t,
      minIntervalSec: ctx.constraints?.minPrestigeIntervalSec,
      lastResetT: ctx.constraints?.lastPrestigeResetT,
    }).allowed;
  });
  const decisions = actions.flatMap((action) => {
    const quote = selectBulkQuote(params, action, ctx, state);
    if (!quote) return [];
    const score = scoreQuote(params, ctx, quote);
    return [
      {
        score: Number.isFinite(score) ? score : Number.NEGATIVE_INFINITY,
        decision: {
          action,
          bulkSize: quotedDecisionSize(quote.size),
          occurrence: actionOccurrence(raw, action),
        } satisfies Decision<N, U, Vars>,
      },
    ];
  });

  decisions.sort((a, b) => {
    if (a.score !== b.score) return a.score > b.score ? -1 : 1;
    if (a.decision.action.id !== b.decision.action.id) {
      return a.decision.action.id < b.decision.action.id ? -1 : 1;
    }
    const ab = a.decision.bulkSize ?? 1;
    const bb = b.decision.bulkSize ?? 1;
    if (ab !== bb) return ab - bb;
    return 0;
  });

  return decisions.slice(0, maxBranchingActions).map((x) => x.decision);
}

function scoreNode<N, U extends string, Vars>(
  params: PlannerStrategyParamsV1,
  ctx: SimContext<N, U, Vars>,
  model: Model<N, U, Vars>,
  node: PlannerNode<N, U, Vars>,
  elapsedSec: number,
  target?: N,
): number {
  if (params.objective === "maximizePrestigePerHour") {
    const pointsLog = ctx.E.absLog10(node.state.prestige.points);
    const hours = Math.max(1e-12, elapsedSec / 3600);
    return pointsLog - Math.log10(hours);
  }

  const series = params.series ?? "netWorth";
  const worth = worthAmount(ctx, model, node.state, series);
  const worthLog = ctx.E.absLog10(worth);
  if (params.objective !== "minTimeToTargetWorth" || !target) return worthLog;

  if (node.reachedTargetAtSec !== undefined) {
    return 1_000_000 - node.reachedTargetAtSec;
  }
  return worthLog - ctx.E.absLog10(target) - 1_000_000;
}

function compareNodes<N, U extends string, Vars>(
  a: PlannerNode<N, U, Vars>,
  b: PlannerNode<N, U, Vars>,
): number {
  if (a.score !== b.score) return b.score - a.score;

  const aid = choiceId(a.first);
  const bid = choiceId(b.first);
  if (aid !== bid) return aid < bid ? -1 : 1;

  return choiceBulk(a.first) - choiceBulk(b.first);
}

export function createPlannerStrategy<N, U extends string, Vars>(
  params: PlannerStrategyParamsV1,
  deps?: PlannerDeps<N, U, Vars>,
): PlannerStrategy<N, U, Vars> {
  const d: PlannerDeps<N, U, Vars> = deps ?? ({ stepOnce } as PlannerDeps<N, U, Vars>);
  let report: PlannerSearchReport = {
    contract: plannerSearchContract,
    version: 1,
    globallyOptimal: false,
    stopped: "horizon",
    clamped: false,
    rollouts: 0,
    rolloutBudget,
    horizonSteps: 0,
    beamWidth: 0,
    maxBranchingActions: 0,
  };

  return {
    id: "planner",
    plannerReport: () => report,
    decide(ctx, model, state) {
      const requestedHorizon = Math.max(1, params.horizonSteps);
      const requestedBeam = Math.max(1, params.beamWidth ?? 1);
      const requestedBranch = Math.max(1, params.maxBranchingActions ?? 8);
      const horizonSteps = Math.min(horizonCap, requestedHorizon);
      const beamWidth = Math.min(beamCap, requestedBeam);
      const maxBranchingActions = Math.min(branchCap, requestedBranch);
      const clamped =
        horizonSteps !== requestedHorizon || beamWidth !== requestedBeam || maxBranchingActions !== requestedBranch;
      const previewStepSec = Math.max(1e-9, ctx.stepSec ?? 1);
      const previewFast = params.useFastPreview
        ? { enabled: true as const, kind: "log-domain" as const, disableMoneyEvents: true }
        : undefined;
      const previewCtx: SimContext<N, U, Vars> = {
        ...ctx,
        emit: undefined,
        constraints: ctx.constraints,
      };
      const target = parseTargetOrThrow(params, ctx);
      const series = params.series ?? "netWorth";
      const reachedNow =
        target && ctx.E.cmp(worthAmount(ctx, model, state, series), target) >= 0 ? 0 : undefined;
      const initial: PlannerNode<N, U, Vars> = {
        state,
        first: { kind: "unset" },
        reachedTargetAtSec: reachedNow,
        lastResetT: ctx.constraints?.lastPrestigeResetT,
        score: 0,
      };

      let beam: PlannerNode<N, U, Vars>[] = [
        { ...initial, score: scoreNode(params, ctx, model, initial, 0, target) },
      ];
      let rollouts = 0;
      let stopped: "horizon" | "budget" = "horizon";

      for (let depth = 0; depth < horizonSteps; depth++) {
        const nextBeam: PlannerNode<N, U, Vars>[] = [];
        let hitBudget = false;
        for (const node of beam) {
          const view = cloneRunState(node.state);
          const nodeConstraints = constraintsWithAnchor(ctx.constraints, node.lastResetT);
          const nodeCtx: SimContext<N, U, Vars> = { ...previewCtx, constraints: nodeConstraints };
          const candidates = buildStepCandidates(params, nodeCtx, model, view, maxBranchingActions);
          const all: readonly (Decision<N, U, Vars> | undefined)[] = [undefined, ...candidates];
          for (const decision of all) {
            if (rollouts >= rolloutBudget) {
              hitBudget = true;
              break;
            }
            rollouts += 1;
            const step = d.stepOnce({
              ctx: nodeCtx,
              model,
              state: cloneRunState(node.state),
              dt: previewStepSec,
              decisions: decision ? [decision] : [],
              constraints: nodeConstraints,
              fast: previewFast,
            });

            const elapsedSec = (depth + 1) * previewStepSec;
            let reachedTargetAtSec = node.reachedTargetAtSec;
            if (reachedTargetAtSec === undefined && target) {
              const amount = worthAmount(ctx, model, step.next, series);
              if (ctx.E.cmp(amount, target) >= 0) reachedTargetAtSec = elapsedSec;
            }

            const candidateNode: PlannerNode<N, U, Vars> = {
              state: step.next,
              first: chooseFirst(node.first, decision),
              reachedTargetAtSec,
              lastResetT: step.prestigeResetT ?? node.lastResetT,
              score: 0,
            };
            nextBeam.push({
              ...candidateNode,
              score: scoreNode(params, ctx, model, candidateNode, elapsedSec, target),
            });
          }
          if (hitBudget) break;
        }

        if (hitBudget) {
          stopped = "budget";
          break;
        }
        nextBeam.sort(compareNodes);
        beam = nextBeam.slice(0, beamWidth);
      }

      report = {
        contract: plannerSearchContract,
        version: 1,
        globallyOptimal: false,
        stopped,
        clamped,
        rollouts,
        rolloutBudget,
        horizonSteps,
        beamWidth,
        maxBranchingActions,
      };

      const best = [...beam].sort(compareNodes)[0];
      if (!best || best.first.kind !== "act") return [];
      return [best.first.decision];
    },
  };
}
