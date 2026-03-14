import type { ObjectiveFactory } from "../registry";
import { parseMoney } from "../../../../notation/parseMoney";
import {
  ObjectiveEmptyObjectSchema,
  ObjectiveEtaToWorthParamsSchema,
  ObjectivePacingParamsSchema,
  type ObjectiveEtaToWorthParams,
  type ObjectivePacingParams,
} from "./params";

function safeAbsLog10<N>(E: { absLog10: (x: N) => number }, x: N): number {
  const v = E.absLog10(x);
  return Number.isFinite(v) ? v : -300;
}

export const builtinObjectiveFactories: readonly ObjectiveFactory[] = [
  {
    id: "endMoneyLog10",
    defaultParams: {},
    paramsSchema: ObjectiveEmptyObjectSchema,
    create: () => ({
      id: "endMoneyLog10",
      score: ({ scenario, run }) => {
        const { E } = scenario.ctx;
        return safeAbsLog10(E, run.end.wallet.money.amount);
      },
    }),
  },
  {
    id: "endNetWorthLog10",
    defaultParams: {},
    paramsSchema: ObjectiveEmptyObjectSchema,
    create: () => ({
      id: "endNetWorthLog10",
      score: ({ scenario, run }) => {
        const { E } = scenario.ctx;
        const worth = scenario.model.netWorth?.(scenario.ctx as any, run.end as any) ?? run.end.wallet.money;
        return safeAbsLog10(E, worth.amount);
      },
    }),
  },
  {
    id: "netWorthPerHourLog10",
    defaultParams: {},
    paramsSchema: ObjectiveEmptyObjectSchema,
    create: () => ({
      id: "netWorthPerHourLog10",
      score: ({ scenario, run }) => {
        const { E } = scenario.ctx;
        const sec = Math.max(1, run.end.t - run.start.t);
        const hours = sec / 3600;
        const worth = scenario.model.netWorth?.(scenario.ctx as any, run.end as any) ?? run.end.wallet.money;
        return safeAbsLog10(E, worth.amount) - Math.log10(Math.max(1e-12, hours));
      },
    }),
  },
  {
    id: "prestigePointsPerHourLog10",
    defaultParams: {},
    paramsSchema: ObjectiveEmptyObjectSchema,
    create: () => ({
      id: "prestigePointsPerHourLog10",
      score: ({ scenario, run }) => {
        const { E } = scenario.ctx;
        const sec = Math.max(1, run.end.t - run.start.t);
        const hours = sec / 3600;
        return safeAbsLog10(E, run.end.prestige.points) - Math.log10(Math.max(1e-12, hours));
      },
    }),
  },
  {
    id: "growthLog10PerHour",
    defaultParams: {},
    paramsSchema: ObjectiveEmptyObjectSchema,
    create: () => ({
      id: "growthLog10PerHour",
      score: ({ scenario, run }) => {
        const { E } = scenario.ctx;
        const sec = Math.max(1, run.end.t - run.start.t);
        const startWorth = scenario.model.netWorth?.(scenario.ctx as any, run.start as any) ?? run.start.wallet.money;
        const endWorth = scenario.model.netWorth?.(scenario.ctx as any, run.end as any) ?? run.end.wallet.money;
        const deltaLog = safeAbsLog10(E, endWorth.amount) - safeAbsLog10(E, startWorth.amount);
        return deltaLog / (sec / 3600);
      },
    }),
  },
  {
    id: "etaToTargetWorthNegSec",
    defaultParams: {
      targetWorth: "1e6",
      unreachedPenaltySec: 1_000_000_000,
    } satisfies ObjectiveEtaToWorthParams,
    paramsSchema: ObjectiveEtaToWorthParamsSchema,
    create: (raw: ObjectiveEtaToWorthParams | undefined) => {
      const params: ObjectiveEtaToWorthParams = {
        targetWorth: raw?.targetWorth ?? "1e6",
        unreachedPenaltySec: raw?.unreachedPenaltySec ?? 1_000_000_000,
      };
      return {
        id: "etaToTargetWorthNegSec",
        score: ({ scenario, run }) => {
          const { E } = scenario.ctx;
          const threshold = parseMoney(E, params.targetWorth, {
            unit: scenario.ctx.unit,
            suffix: { kind: "alphaInfinite", minLen: 2 },
          }).amount;
          const endWorth = scenario.model.netWorth?.(scenario.ctx as any, run.end as any) ?? run.end.wallet.money;
          const reached = E.cmp(endWorth.amount, threshold) >= 0;
          if (!reached) return -(params.unreachedPenaltySec ?? 1_000_000_000);
          return -(run.end.t - run.start.t);
        },
      };
    },
  },
  {
    id: "pacingBalancedLog10",
    defaultParams: {
      targetActionsPerHour: 120,
      actionRateWeight: 1,
      droppedRateWeight: 2,
    } satisfies ObjectivePacingParams,
    paramsSchema: ObjectivePacingParamsSchema,
    create: (raw: ObjectivePacingParams | undefined) => {
      const params: ObjectivePacingParams = {
        targetActionsPerHour: raw?.targetActionsPerHour ?? 120,
        actionRateWeight: raw?.actionRateWeight ?? 1,
        droppedRateWeight: raw?.droppedRateWeight ?? 2,
      };
      return {
        id: "pacingBalancedLog10",
        score: ({ scenario, run }) => {
          const { E } = scenario.ctx;
          const sec = Math.max(1, run.end.t - run.start.t);
          const hours = sec / 3600;
          const worth = scenario.model.netWorth?.(scenario.ctx as any, run.end as any) ?? run.end.wallet.money;
          const worthLog = safeAbsLog10(E, worth.amount);

          const targetActionsPerHour = params.targetActionsPerHour ?? 120;
          const actionsApplied = run.stats?.actions.applied ?? 0;
          const actualActionsPerHour = actionsApplied / Math.max(1e-9, hours);
          const actionPenalty = Math.abs(
            Math.log10((actualActionsPerHour + 1) / Math.max(1, targetActionsPerHour + 1)),
          );

          const droppedRate = run.stats?.money.droppedRate ?? 0;
          const actionRateWeight = params.actionRateWeight ?? 1;
          const droppedRateWeight = params.droppedRateWeight ?? 2;

          return worthLog - actionRateWeight * actionPenalty - droppedRateWeight * droppedRate;
        },
      };
    },
  },
];
