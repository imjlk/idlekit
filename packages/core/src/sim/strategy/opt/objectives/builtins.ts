import type { ObjectiveFactory } from "../registry";

export const builtinObjectiveFactories: readonly ObjectiveFactory[] = [
  {
    id: "endNetWorthLog10",
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
    id: "pointsPerHour",
    create: () => ({
      id: "pointsPerHour",
      score: ({ scenario, run }) => {
        const { E } = scenario.ctx;
        const sec = Math.max(1, run.end.t - run.start.t);
        const p = E.toNumber(run.end.prestige.points);
        return (p / sec) * 3600;
      },
    }),
  },
];
