import type { ObjectiveFactory } from "../registry";
import { ObjectiveEmptyObjectSchema } from "./params";

export const builtinObjectiveFactories: readonly ObjectiveFactory[] = [
  {
    id: "endMoneyLog10",
    defaultParams: {},
    paramsSchema: ObjectiveEmptyObjectSchema,
    create: () => ({
      id: "endMoneyLog10",
      score: ({ scenario, run }) => {
        const { E } = scenario.ctx;
        return E.absLog10(run.end.wallet.money.amount);
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
        return E.absLog10(worth.amount);
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
        return E.absLog10(worth.amount) - Math.log10(Math.max(1e-12, hours));
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
        return E.absLog10(run.end.prestige.points) - Math.log10(Math.max(1e-12, hours));
      },
    }),
  },
];
