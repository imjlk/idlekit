import {
  analyzeGrowth,
  compileScenario,
  createModelRegistry,
  createNumberEngine,
  defineModelFactory,
  runScenario,
  validateScenarioV1,
} from "@idlekit/core";

type Vars = { owned: number };

const linearFactory = defineModelFactory<number, "COIN", Vars>({
  id: "linear",
  version: 1,
  create() {
    return {
      id: "linear",
      version: 1,
      income(ctx, state) {
        return {
          unit: ctx.unit,
          amount: ctx.E.add(1, Number(state.vars.owned ?? 0)),
        };
      },
      actions() {
        return [];
      },
    };
  },
});

const registry = createModelRegistry([linearFactory]);

const scenario = {
  schemaVersion: 1,
  unit: { code: "COIN" },
  policy: { mode: "drop" },
  model: { id: "linear", version: 1 },
  initial: {
    wallet: { unit: "COIN", amount: "0" },
    vars: { owned: 0 },
  },
  clock: { stepSec: 1, durationSec: 60 },
};

const validated = validateScenarioV1(scenario, registry);
if (!validated.ok || !validated.scenario) {
  throw new Error(`scenario should validate: ${JSON.stringify(validated.issues)}`);
}

const E = createNumberEngine();
const compiled = compileScenario({
  E,
  scenario: validated.scenario,
  registry,
});
const run = runScenario(compiled);
const growth = analyzeGrowth({ run, series: "money", windowSec: 10 });

console.log(
  JSON.stringify({
    endMoney: E.toString(run.end.wallet.money.amount),
    growthSlopePerHourLog10: growth.slopePerHourLog10,
  }),
);
