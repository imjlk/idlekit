import {
  createStreamRng,
  type Model,
  type ModelFactory,
} from "../../packages/core/src/index";

export type FeedbackVars = {
  sampled: boolean;
  payout: boolean;
  delaySec: number;
};

const feedbackFactory: ModelFactory = {
  id: "seeded-feedback",
  version: 1,
  create(params: unknown) {
    if (typeof params !== "object" || params === null || !("payoutProbability" in params)) {
      throw new Error("seeded-feedback requires payoutProbability between 0 and 1");
    }
    const probability = params.payoutProbability;
    if (
      typeof probability !== "number" ||
      !Number.isFinite(probability) ||
      probability < 0 ||
      probability > 1
    ) {
      throw new Error("seeded-feedback requires payoutProbability between 0 and 1");
    }
    const model: Model<unknown, string, FeedbackVars> = {
      id: "seeded-feedback",
      version: 1,
      clocks: { respondsTo: ["reward"] },
      income: (ctx, state) => ({
        unit: ctx.unit,
        amount: ctx.E.from(state.vars.payout && state.t >= state.vars.delaySec ? 1 : 0),
      }),
      evolve(ctx, state) {
        if (state.vars.sampled) return state;
        if (ctx.seed === undefined) throw new Error("seeded-feedback requires a run seed");
        // Each draw gets its own seed. Chosen values live in state, not a shared closure.
        const rng = createStreamRng("execution", ctx.seed);
        return {
          ...state,
          vars: {
            sampled: true,
            payout: rng.next() < probability,
            delaySec: 10 * (1 + Math.floor(rng.next() * 4)),
          },
        };
      },
      actions: () => [],
      netWorth: (_ctx, state) => state.wallet.money,
    };
    return model;
  },
};

export default { models: [feedbackFactory] };
