import {
  createGreedyStrategy,
  formatMoney,
  runScenario,
  type Action,
  type CompiledScenario,
  type Model,
  type SimContext,
  type SimState,
} from "../../packages/core/src/index";
import { createFixedPointEngine, fp } from "./fixedPointEngine";

type U = "COIN";
type Vars = {
  owned: number;
};

const E = createFixedPointEngine();
const unit = { code: "COIN" as U, symbol: "C" };

const ctx: SimContext<bigint, U, Vars> = {
  E,
  unit,
  tickPolicy: {
    mode: "accumulate",
    maxLogGap: 14,
  },
};

function state(amount: bigint, owned: number): SimState<bigint, U, Vars> {
  return {
    t: 0,
    wallet: {
      money: { unit, amount },
      bucket: 0n,
    },
    maxMoneyEver: { unit, amount },
    prestige: {
      count: 0,
      points: 0n,
      multiplier: fp("1"),
    },
    vars: { owned },
  };
}

const model: Model<bigint, U, Vars> = {
  id: "fixed.linear",
  version: 1,
  income(_ctx, s) {
    const base = fp("1");
    const perOwned = fp("0.5");
    const income = E.add(base, E.mul(perOwned, s.vars.owned));
    return { unit, amount: income };
  },
  actions(_ctx, s) {
    const buy: Action<bigint, U, Vars> = {
      id: "buy.generator",
      kind: "buy",
      label: "Buy generator",
      canApply: () => true,
      cost: () => ({ unit, amount: fp(String(10 + s.vars.owned * 2)) }),
      equivalentCost: () => ({ unit, amount: fp(String(10 + s.vars.owned * 2)) }),
      bulk: () => [
        {
          size: 1,
          cost: { unit, amount: fp(String(10 + s.vars.owned * 2)) },
          equivalentCost: { unit, amount: fp(String(10 + s.vars.owned * 2)) },
          deltaIncomePerSec: { unit, amount: fp("0.5") },
        },
        {
          size: 5,
          cost: { unit, amount: fp(String((10 + s.vars.owned * 2) * 5)) },
          equivalentCost: { unit, amount: fp(String((10 + s.vars.owned * 2) * 5)) },
          deltaIncomePerSec: { unit, amount: fp("2.5") },
        },
      ],
      apply: (_ctx2, next, bulkSize = 1) => ({
        ...next,
        vars: {
          ...next.vars,
          owned: next.vars.owned + bulkSize,
        },
      }),
    };

    return [buy];
  },
  netWorth(_ctx, s) {
    const inventoryValue = fp(String(s.vars.owned * 12));
    return {
      unit,
      amount: E.add(s.wallet.money.amount, inventoryValue),
    };
  },
};

const strategy = createGreedyStrategy<bigint, U, Vars>({
  schemaVersion: 1,
  objective: "minPayback",
  maxPicksPerStep: 1,
  bulk: { mode: "bestQuote" },
});

const scenario: CompiledScenario<bigint, U, Vars> = {
  ctx,
  model,
  initial: state(fp("20"), 0),
  strategy,
  run: {
    stepSec: 1,
    durationSec: 120,
    trace: {
      everySteps: 10,
      keepActionsLog: true,
    },
  },
};

const run = runScenario(scenario);
const endWorth = model.netWorth?.(ctx, run.end) ?? run.end.wallet.money;

console.log("Adapter pattern example completed");
console.log(`- End time: ${run.end.t}s`);
console.log(`- End money: ${formatMoney(E, run.end.wallet.money, { showUnit: true, trimTrailingZeros: true })}`);
console.log(`- End netWorth: ${formatMoney(E, endWorth, { showUnit: true, trimTrailingZeros: true })}`);
console.log(`- Owned generators: ${run.end.vars.owned}`);
console.log(`- Actions applied: ${run.actionsLog?.length ?? 0}`);
