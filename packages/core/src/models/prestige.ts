import { z } from "zod";
import type { Engine } from "../engine/types";
import { defineModelFactory, type ModelFactory } from "../scenario/registry";
import type { Action, Model, PrestigeSpec, SimContext, SimState } from "../sim/types";
import { createGeneratorCore, exponentialParamsSchema, type ExponentialVars } from "./exponential";
import { amountOf, finiteAmount, nonNegativeAmount, optionalObjectSchema, pow10 } from "./shared";

export const PRESTIGE_MODEL_ID = "prestige" as const;
export const PRESTIGE_RESET_ACTION_ID = "prestige.reset" as const;

const rootFormula = z.object({
  kind: z.literal("root"),
  /** Points at exactly the requirement. */
  scale: z.number().finite().positive().default(1),
  /** gained = floor(scale * (measure / requirement)^exponent). */
  exponent: z.number().finite().positive().max(1).default(0.5),
});

const log10Formula = z.object({
  kind: z.literal("log10"),
  /** gained = floor(scale * (log10(measure / requirement) + 1)). */
  scale: z.number().finite().positive().default(1),
});

export const prestigeRulesSchema = z.object({
  /** The run's net worth must reach this amount before a reset is offered. */
  requirement: nonNegativeAmount.refine((value) => Number(value) > 0, "requirement must be > 0").default("1e6"),
  formula: z.discriminatedUnion("kind", [rootFormula, log10Formula]).default({ kind: "root", scale: 1, exponent: 0.5 }),
  /** Multiplier gained per total prestige point. */
  multiplierPerPoint: z.number().finite().nonnegative().default(0.1),
  /** additive: 1 + perPoint * points. compound: (1 + perPoint)^points. */
  multiplierMode: z.enum(["additive", "compound"]).default("additive"),
  /** Seconds a run must last before its reset is offered. The scenario cooldown still applies on top. */
  minRunSec: z.number().finite().nonnegative().default(0),
  /** A reset that would gain fewer points is not offered. */
  minGain: z.number().int().positive().default(1),
  /** Wallet after a reset. */
  starterCash: nonNegativeAmount.default("0"),
  /** Generator levels kept through a reset. */
  keepLevels: z.number().int().nonnegative().default(0),
});

export const prestigeParamsSchema = z.object({
  generator: exponentialParamsSchema.default(exponentialParamsSchema.parse({})),
  prestige: prestigeRulesSchema.default(prestigeRulesSchema.parse({})),
});

export type PrestigeParams = z.output<typeof prestigeParamsSchema>;
export type PrestigeParamsInput = z.input<typeof prestigeParamsSchema>;
export type PrestigeRules = PrestigeParams["prestige"];

export const prestigeVarsSchema = z
  .object({
    level: z.number().int().nonnegative().default(0),
    /** `t` at which the current run started. Missing means the scenario start, which counts as `0`. */
    runStartT: z.number().finite().nonnegative().default(0),
  })
  .partial();

export type PrestigeVars = ExponentialVars & Readonly<{ runStartT?: number }>;

export type PrestigeGainPreview<N> = Readonly<{
  /** Whether the measure has reached the requirement and the gain is at least `minGain`. Run time is not checked. */
  eligible: boolean;
  gainedPoints: N;
  nextPoints: N;
  nextMultiplier: N;
}>;

export function parsePrestigeParams(raw: unknown): PrestigeParams {
  return prestigeParamsSchema.parse(raw ?? {});
}

/** Points a reset grants at `measure` under these rules. Below the requirement it is zero. */
export function prestigePointsFor<N>(E: Engine<N>, rules: PrestigeRules, measure: N): N {
  const requirement = amountOf(E, rules.requirement, PRESTIGE_MODEL_ID, "prestige.requirement");
  if (!E.isFinite(measure) || E.cmp(measure, requirement) < 0) return E.zero();
  const ratioLog10 = Math.max(0, E.absLog10(measure) - E.absLog10(requirement));
  if (rules.formula.kind === "log10") {
    const gained = Math.floor(rules.formula.scale * (ratioLog10 + 1) + 1e-9);
    return E.from(gained);
  }
  const gainLog10 = Math.log10(rules.formula.scale) + rules.formula.exponent * ratioLog10;
  // Below 1e15 an integer is exact in a Number. Above it the floor is lost in the engine's precision anyway.
  if (gainLog10 < 15) return E.from(Math.floor(Math.pow(10, gainLog10) + 1e-9));
  return pow10(E, gainLog10);
}

/** The prestige multiplier for a total of `points`. */
export function prestigeMultiplierFor<N>(E: Engine<N>, rules: PrestigeRules, points: N): N {
  if (rules.multiplierMode === "additive") {
    return finiteAmount(E, E.add(E.from(1), E.mul(points, rules.multiplierPerPoint)), PRESTIGE_MODEL_ID, "multiplier");
  }
  if (rules.multiplierPerPoint === 0 || E.cmp(points, E.zero()) <= 0) return E.from(1);
  const pointsNumber = Math.pow(10, E.absLog10(points));
  return finiteAmount(E, pow10(E, pointsNumber * Math.log10(1 + rules.multiplierPerPoint)), PRESTIGE_MODEL_ID, "multiplier");
}

/**
 * What a reset at `measure` would grant from `currentPoints`. A design-time hook for tables and for checking
 * reset-policy results by hand. It does not read run time, cooldown, or engine constraints.
 */
export function previewPrestigeGain<N>(
  E: Engine<N>,
  params: PrestigeParamsInput | PrestigeParams,
  measure: N,
  currentPoints: N = E.zero(),
): PrestigeGainPreview<N> {
  const rules = prestigeParamsSchema.parse(params).prestige;
  const gainedPoints = prestigePointsFor(E, rules, measure);
  const nextPoints = E.add(currentPoints, gainedPoints);
  return {
    eligible: E.cmp(gainedPoints, E.from(rules.minGain)) >= 0,
    gainedPoints,
    nextPoints,
    nextMultiplier: prestigeMultiplierFor(E, rules, nextPoints),
  };
}

/**
 * Built-in `prestige` model: the `exponential` generator plus a first-class reset.
 *
 * The model lists one `prestige.reset` action (kind `prestige`) and a matching `Model.prestige` spec.
 * `resetAdapterFor` picks the action, so `executeResetCycles` and `analyzeResetPolicies` apply exactly one reset
 * per boundary, and the reward they read is `state.prestige.points`.
 * The action has no cost and no income quote, so `greedy` never resets on its own. Reset timing is the
 * caller's: a reset-cycle policy, `idk prestige-cycle`, a scripted strategy, or a plugin strategy.
 */
export function createPrestigeModel<N, U extends string = string>(
  params: PrestigeParamsInput = {},
): Model<N, U, PrestigeVars> {
  const parsed = prestigeParamsSchema.parse(params);
  const rules = parsed.prestige;
  const core = createGeneratorCore(PRESTIGE_MODEL_ID, parsed.generator);

  const netWorth = (ctx: SimContext<N, U, PrestigeVars>, state: SimState<N, U, PrestigeVars>): N =>
    finiteAmount(ctx.E, ctx.E.add(state.wallet.money.amount, core.investedValue(ctx.E, core.levelOf(state))), PRESTIGE_MODEL_ID, "net worth");

  const runStartOf = (state: SimState<N, U, PrestigeVars>): number => {
    const raw = Number(state.vars?.runStartT ?? 0);
    return Number.isFinite(raw) && raw >= 0 ? raw : 0;
  };

  const gainAt = (ctx: SimContext<N, U, PrestigeVars>, state: SimState<N, U, PrestigeVars>): N =>
    prestigePointsFor(ctx.E, rules, netWorth(ctx, state));

  const ready = (ctx: SimContext<N, U, PrestigeVars>, state: SimState<N, U, PrestigeVars>): boolean => {
    if (state.t - runStartOf(state) < rules.minRunSec) return false;
    return ctx.E.cmp(gainAt(ctx, state), ctx.E.from(rules.minGain)) >= 0;
  };

  const resetState = (
    ctx: SimContext<N, U, PrestigeVars>,
    state: SimState<N, U, PrestigeVars>,
    gained: N,
  ): SimState<N, U, PrestigeVars> => {
    const E = ctx.E;
    const starter = amountOf(E, rules.starterCash, PRESTIGE_MODEL_ID, "prestige.starterCash");
    const nextPoints = finiteAmount(E, E.add(state.prestige.points, gained), PRESTIGE_MODEL_ID, "prestige points");
    return {
      ...state,
      wallet: {
        ...state.wallet,
        money: { ...state.wallet.money, amount: starter },
        bucket: E.zero(),
      },
      maxMoneyEver: { ...state.maxMoneyEver, amount: starter },
      prestige: {
        count: Number(state.prestige.count ?? 0) + 1,
        points: nextPoints,
        multiplier: prestigeMultiplierFor(E, rules, nextPoints),
      },
      vars: {
        ...(state.vars ?? {}),
        level: Math.min(rules.keepLevels, core.levelOf(state)),
        runStartT: state.t,
      },
    };
  };

  const resetAction = (ctx: SimContext<N, U, PrestigeVars>): Action<N, U, PrestigeVars> => ({
    id: PRESTIGE_RESET_ACTION_ID,
    kind: "prestige",
    label: "Prestige Reset",
    canApply: (_ctx, state) => ready(ctx, state),
    cost: () => null,
    apply: (applyCtx, state) => resetState(applyCtx, state, gainAt(applyCtx, state)),
  });

  const spec: PrestigeSpec<N, U, PrestigeVars> = {
    pointsFrom: (ctx, state) => gainAt(ctx, state),
    multiplierFrom: (ctx, points) => prestigeMultiplierFor(ctx.E, rules, points),
    resetState,
  };

  return {
    id: PRESTIGE_MODEL_ID,
    version: 1,
    income: (ctx, state) => core.realizedIncome(ctx, state),
    actions: (ctx) => [core.buyAction(ctx), resetAction(ctx)],
    prestige: spec,
    netWorth: (ctx, state) => ({ unit: ctx.unit, amount: netWorth(ctx, state) }),
    analytic: (ctx, state) => (core.stochastic ? null : core.analytic(ctx, state)),
    milestones(ctx, prev, next) {
      const out = core.milestones(ctx, prev, next);
      if (next.prestige.count === prev.prestige.count && !ready(ctx, prev) && ready(ctx, next)) {
        out.push("prestige.reset-available");
      }
      return out;
    },
  };
}

/** Built-in `prestige@1`. */
export function createPrestigeFactory(): ModelFactory {
  return defineModelFactory<unknown, string, PrestigeVars>({
    id: PRESTIGE_MODEL_ID,
    version: 1,
    paramsSchema: optionalObjectSchema(prestigeParamsSchema),
    varsSchema: optionalObjectSchema(prestigeVarsSchema),
    create: (raw) => createPrestigeModel(parsePrestigeParams(raw)),
  });
}
