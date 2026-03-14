import {
  createNumberEngine,
  defineModelFactory,
  type ModelFactory,
  type ObjectiveFactory,
  type StandardSchema,
  type StrategyFactory,
} from "../../packages/core/src/index";

type PluginModelParams = {
  baseIncome?: string;
  producerIncome?: string;
  producerBaseCost?: string;
  producerCostGrowth?: number;
  upgradeBaseCost?: string;
  upgradeGrowth?: number;
  upgradeIncomeBoost?: number;
  gemExchangeCost?: string;
};

type PluginVars = {
  producers?: number;
  upgrades?: number;
  gems?: number;
};

type ProducerFirstParams = {
  schemaVersion?: 1;
  allowUpgrade?: boolean;
  preferUpgradeAtProducers?: number;
};

type ObjectiveParams = {
  gemsWeight?: number;
};

type StandardIssue = Readonly<{ path?: string; message: string }>;

function ok<T>(value: T): Readonly<{ success: true; value: T }> {
  return { success: true, value };
}

function fail<T>(issues: StandardIssue[]): Readonly<{ success: false; issues: StandardIssue[] }> {
  return { success: false, issues };
}

function asRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  return input as Record<string, unknown>;
}

const PluginModelParamsSchema: StandardSchema<PluginModelParams> = {
  "~standard": {
    validate(input) {
      const x = asRecord(input);
      const issues: StandardIssue[] = [];

      if (x.baseIncome !== undefined && typeof x.baseIncome !== "string") {
        issues.push({ path: "baseIncome", message: "must be string" });
      }
      if (x.producerIncome !== undefined && typeof x.producerIncome !== "string") {
        issues.push({ path: "producerIncome", message: "must be string" });
      }
      if (x.producerBaseCost !== undefined && typeof x.producerBaseCost !== "string") {
        issues.push({ path: "producerBaseCost", message: "must be string" });
      }
      if (x.producerCostGrowth !== undefined && typeof x.producerCostGrowth !== "number") {
        issues.push({ path: "producerCostGrowth", message: "must be number" });
      }
      if (x.upgradeBaseCost !== undefined && typeof x.upgradeBaseCost !== "string") {
        issues.push({ path: "upgradeBaseCost", message: "must be string" });
      }
      if (x.upgradeGrowth !== undefined && typeof x.upgradeGrowth !== "number") {
        issues.push({ path: "upgradeGrowth", message: "must be number" });
      }
      if (x.upgradeIncomeBoost !== undefined && typeof x.upgradeIncomeBoost !== "number") {
        issues.push({ path: "upgradeIncomeBoost", message: "must be number" });
      }
      if (x.gemExchangeCost !== undefined && typeof x.gemExchangeCost !== "string") {
        issues.push({ path: "gemExchangeCost", message: "must be string" });
      }

      return issues.length > 0 ? fail(issues) : ok(x as PluginModelParams);
    },
  },
};

const PluginVarsSchema: StandardSchema<PluginVars> = {
  "~standard": {
    validate(input) {
      const x = asRecord(input);
      const issues: StandardIssue[] = [];

      const checkVar = (key: keyof PluginVars) => {
        const v = x[key as string];
        if (v === undefined) return;
        if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
          issues.push({ path: String(key), message: "must be non-negative integer" });
        }
      };

      checkVar("producers");
      checkVar("upgrades");
      checkVar("gems");

      return issues.length > 0 ? fail(issues) : ok(x as PluginVars);
    },
  },
};

const ProducerFirstParamsSchema: StandardSchema<ProducerFirstParams> = {
  "~standard": {
    validate(input) {
      const x = asRecord(input);
      const issues: StandardIssue[] = [];

      if (x.schemaVersion !== undefined && x.schemaVersion !== 1) {
        issues.push({ path: "schemaVersion", message: "must be 1" });
      }
      if (x.allowUpgrade !== undefined && typeof x.allowUpgrade !== "boolean") {
        issues.push({ path: "allowUpgrade", message: "must be boolean" });
      }
      if (
        x.preferUpgradeAtProducers !== undefined &&
        (typeof x.preferUpgradeAtProducers !== "number" || !Number.isInteger(x.preferUpgradeAtProducers) || x.preferUpgradeAtProducers < 0)
      ) {
        issues.push({ path: "preferUpgradeAtProducers", message: "must be non-negative integer" });
      }

      return issues.length > 0 ? fail(issues) : ok(x as ProducerFirstParams);
    },
  },
};

const ObjectiveParamsSchema: StandardSchema<ObjectiveParams> = {
  "~standard": {
    validate(input) {
      const x = asRecord(input);
      if (x.gemsWeight !== undefined && (typeof x.gemsWeight !== "number" || !(x.gemsWeight > 0))) {
        return fail([{ path: "gemsWeight", message: "must be positive number" }]);
      }
      return ok(x as ObjectiveParams);
    },
  },
};

function geometricCost(base: number, growth: number, start: number, count: number): number {
  if (count <= 0) return 0;
  if (growth === 1) return base * count;
  const startFactor = Math.pow(growth, start);
  return (base * startFactor * (Math.pow(growth, count) - 1)) / (growth - 1);
}

function createPluginModelFactory(): ModelFactory {
  return defineModelFactory<number, string, PluginVars>({
    id: "plugin.generators",
    version: 1,
    paramsSchema: PluginModelParamsSchema,
    varsSchema: PluginVarsSchema,
    create(rawParams) {
      const p: Required<PluginModelParams> = {
        baseIncome: "1",
        producerIncome: "1.2",
        producerBaseCost: "8",
        producerCostGrowth: 1.12,
        upgradeBaseCost: "120",
        upgradeGrowth: 1.8,
        upgradeIncomeBoost: 0.2,
        gemExchangeCost: "500",
        ...(rawParams ?? {}),
      };

      return {
        id: "plugin.generators",
        version: 1,
        income(ctx: any, state: any) {
          const vars = (state.vars ?? {}) as PluginVars;
          const producers = Number(vars.producers ?? 0);
          const upgrades = Number(vars.upgrades ?? 0);

          const base = ctx.E.from(p.baseIncome);
          const perProducer = ctx.E.from(p.producerIncome);
          const fromProducers = ctx.E.mul(perProducer, producers);
          const rawIncome = ctx.E.add(base, fromProducers);
          const boost = 1 + upgrades * p.upgradeIncomeBoost;
          return {
            unit: ctx.unit,
            amount: ctx.E.mul(rawIncome, boost),
          };
        },
        actions(ctx: any, state: any) {
          const vars = (state.vars ?? {}) as PluginVars;
          const producers = Number(vars.producers ?? 0);
          const upgrades = Number(vars.upgrades ?? 0);

          const producerBase = Number(p.producerBaseCost);
          const producerGrowth = Number(p.producerCostGrowth);
          const upgradeBase = Number(p.upgradeBaseCost);
          const upgradeGrowth = Number(p.upgradeGrowth);
          const producerIncome = Number(p.producerIncome);

          const producerCostOne = producerBase * Math.pow(producerGrowth, producers);
          const upgradeCost = upgradeBase * Math.pow(upgradeGrowth, upgrades);
          const gemExchangeCost = Number(p.gemExchangeCost);

          const buyProducer = {
            id: "buy.producer",
            kind: "buy",
            label: "Buy Producer",
            canApply() {
              return true;
            },
            cost() {
              return {
                unit: ctx.unit,
                amount: ctx.E.from(String(producerCostOne)),
              };
            },
            equivalentCost() {
              return {
                unit: ctx.unit,
                amount: ctx.E.from(String(producerCostOne)),
              };
            },
            bulk() {
              const sizes = [1, 10, 25];
              return sizes.map((size) => {
                const total = geometricCost(producerBase, producerGrowth, producers, size);
                return {
                  size,
                  cost: { unit: ctx.unit, amount: ctx.E.from(String(total)) },
                  equivalentCost: { unit: ctx.unit, amount: ctx.E.from(String(total)) },
                  deltaIncomePerSec: {
                    unit: ctx.unit,
                    amount: ctx.E.from(String(size * producerIncome)),
                  },
                };
              });
            },
            apply(_ctx: any, nextState: any, bulkSize = 1) {
              const nextVars = (nextState.vars ?? {}) as PluginVars;
              return {
                ...nextState,
                vars: {
                  ...nextVars,
                  producers: Number(nextVars.producers ?? 0) + bulkSize,
                },
              };
            },
          };

          const buyUpgrade = {
            id: "buy.upgrade",
            kind: "buy",
            label: "Buy Upgrade",
            canApply() {
              return true;
            },
            cost() {
              return {
                unit: ctx.unit,
                amount: ctx.E.from(String(upgradeCost)),
              };
            },
            equivalentCost() {
              return {
                unit: ctx.unit,
                amount: ctx.E.from(String(upgradeCost)),
              };
            },
            apply(_ctx: any, nextState: any) {
              const nextVars = (nextState.vars ?? {}) as PluginVars;
              return {
                ...nextState,
                vars: {
                  ...nextVars,
                  upgrades: Number(nextVars.upgrades ?? 0) + 1,
                },
              };
            },
          };

          const exchangeGem = {
            id: "exchange.gem",
            kind: "custom",
            label: "Exchange Gem",
            canApply() {
              return true;
            },
            cost() {
              return {
                unit: ctx.unit,
                amount: ctx.E.from(String(gemExchangeCost)),
              };
            },
            equivalentCost() {
              return {
                unit: ctx.unit,
                amount: ctx.E.from(String(gemExchangeCost)),
              };
            },
            apply(_ctx: any, nextState: any) {
              const nextVars = (nextState.vars ?? {}) as PluginVars;
              return {
                ...nextState,
                vars: {
                  ...nextVars,
                  gems: Number(nextVars.gems ?? 0) + 1,
                },
              };
            },
          };

          return [buyProducer, buyUpgrade, exchangeGem];
        },
        netWorth(ctx: any, state: any) {
          const vars = (state.vars ?? {}) as PluginVars;
          const producers = Number(vars.producers ?? 0);
          const upgrades = Number(vars.upgrades ?? 0);
          const gems = Number(vars.gems ?? 0);

          const producerValue = geometricCost(
            Number(p.producerBaseCost),
            Number(p.producerCostGrowth),
            0,
            producers,
          );
          const upgradeValue = geometricCost(
            Number(p.upgradeBaseCost),
            Number(p.upgradeGrowth),
            0,
            upgrades,
          );
          const gemValue = gems * Number(p.gemExchangeCost);
          const implied = producerValue + upgradeValue + gemValue;

          return {
            unit: ctx.unit,
            amount: ctx.E.add(state.wallet.money.amount, ctx.E.from(String(implied))),
          };
        },
        milestones(_ctx: any, prev: any, next: any) {
          const before = (prev.vars ?? {}) as PluginVars;
          const after = (next.vars ?? {}) as PluginVars;
          const milestones: string[] = [];

          if (Number(before.upgrades ?? 0) < 1 && Number(after.upgrades ?? 0) >= 1) {
            milestones.push("progress.first-upgrade");
          }
          if (Number(before.upgrades ?? 0) < 2 && Number(after.upgrades ?? 0) >= 2) {
            milestones.push("progress.first-automation");
          }
          if (Number(before.gems ?? 0) < 1 && Number(after.gems ?? 0) >= 1) {
            milestones.push("system.first-core");
          }
          if (Number(before.producers ?? 0) < 5 && Number(after.producers ?? 0) >= 5) {
            milestones.push("system.fabricator-line-online");
          }

          return milestones;
        },
      };
    },
  });
}

const producerFirstStrategyFactory: StrategyFactory = {
  id: "plugin.producerFirst",
  defaultParams: {
    schemaVersion: 1,
    allowUpgrade: true,
    preferUpgradeAtProducers: 12,
  } satisfies ProducerFirstParams,
  paramsSchema: ProducerFirstParamsSchema,
  create(rawParams) {
    const p: ProducerFirstParams = {
      schemaVersion: 1,
      allowUpgrade: true,
      preferUpgradeAtProducers: 12,
      ...(rawParams ?? {}),
    };

    return {
      id: "plugin.producerFirst",
      decide(ctx: any, model: any, state: any) {
        const actions = model.actions(ctx, state) as any[];
        const producers = Number((state.vars as PluginVars | undefined)?.producers ?? 0);

        const producer = actions.find((a) => a.id === "buy.producer");
        const upgrade = actions.find((a) => a.id === "buy.upgrade");

        const canAfford = (action: any): boolean => {
          if (!action) return false;
          if (!action.canApply(ctx, state)) return false;
          const cost = action.cost(ctx, state);
          if (!cost) return true;
          if (cost.unit.code !== state.wallet.money.unit.code) return false;
          return ctx.E.cmp(state.wallet.money.amount, cost.amount) >= 0;
        };

        const preferUpgrade = p.allowUpgrade && producers >= (p.preferUpgradeAtProducers ?? 12);
        if (preferUpgrade && canAfford(upgrade)) {
          return [{ action: upgrade }];
        }

        if (canAfford(producer)) {
          return [{ action: producer }];
        }

        if (!preferUpgrade && p.allowUpgrade && canAfford(upgrade)) {
          return [{ action: upgrade }];
        }

        return [];
      },
    };
  },
};

const gemsAndWorthObjectiveFactory: ObjectiveFactory = {
  id: "plugin.gemsAndWorthLog10",
  defaultParams: {
    gemsWeight: 2,
  } satisfies ObjectiveParams,
  paramsSchema: ObjectiveParamsSchema,
  create(rawParams) {
    const p: ObjectiveParams = {
      gemsWeight: 2,
      ...(rawParams ?? {}),
    };

    return {
      id: "plugin.gemsAndWorthLog10",
      score({ scenario, run }) {
        const E = scenario.ctx.E;
        const worth = scenario.model.netWorth?.(scenario.ctx as any, run.end as any) ?? run.end.wallet.money;
        const gems = Number((run.end.vars as PluginVars | undefined)?.gems ?? 0);
        const bonus = Math.log10(Math.max(1, 1 + gems * (p.gemsWeight ?? 2)));
        return E.absLog10(worth.amount) + bonus;
      },
    };
  },
};

export const models: readonly ModelFactory[] = [createPluginModelFactory()];
export const strategies: readonly StrategyFactory[] = [producerFirstStrategyFactory];
export const objectives: readonly ObjectiveFactory[] = [gemsAndWorthObjectiveFactory];

const plugin = { models, strategies, objectives };
export default plugin;

if (import.meta.main) {
  const E = createNumberEngine();
  console.log("custom-econ-plugin loaded");
  console.log(`- Engine sample parse: ${E.toString(E.from("1e3"))}`);
  console.log(`- Models: ${models.map((x) => `${x.id}@${x.version}`).join(", ")}`);
  console.log(`- Strategies: ${strategies.map((x) => x.id).join(", ")}`);
  console.log(`- Objectives: ${objectives.map((x) => x.id).join(", ")}`);
}
