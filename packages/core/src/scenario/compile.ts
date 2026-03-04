import type { Engine } from "../engine/types";
import type { Unit } from "../money/types";
import { parseMoney } from "../notation/parseMoney";
import type { CompiledScenario, Model } from "../sim/types";
import type { StrategyRegistry } from "../sim/strategy/registry";
import type { ModelRegistry } from "./registry";
import type { ScenarioV1 } from "./types";

export type CompileOptions = Readonly<{
  allowSuffixNotation?: boolean;
}>;

function compileUntilExpr(expr: string | undefined): ((s: any) => boolean) | undefined {
  if (!expr || expr.trim().length === 0) return undefined;
  const fn = new Function("s", `return Boolean(${expr});`) as (s: any) => boolean;
  return (s: any) => {
    try {
      return fn(s);
    } catch {
      return false;
    }
  };
}

export function compileScenario<N, U extends string, Vars>(args: {
  E: Engine<N>;
  scenario: ScenarioV1;
  registry: ModelRegistry;
  strategyRegistry?: StrategyRegistry;
  unitFactory?: (code: string) => Unit<U>;
  opts?: CompileOptions;
}): CompiledScenario<N, U, Vars> {
  const { E, scenario, registry, strategyRegistry } = args;

  const modelFactory = registry.get(scenario.model.id, scenario.model.version);
  if (!modelFactory) {
    throw new Error(`Model not found: ${scenario.model.id}@${scenario.model.version}`);
  }

  const unit = args.unitFactory
    ? args.unitFactory(scenario.unit.code)
    : ({ code: scenario.unit.code as U, symbol: scenario.unit.symbol } as Unit<U>);

  const allowSuffix = args.opts?.allowSuffixNotation ?? true;

  const walletMoney = parseMoney(E, scenario.initial.wallet.amount, {
    unit,
    suffix: allowSuffix ? { kind: "alphaInfinite", minLen: 2 } : undefined,
  });

  const bucket = scenario.initial.wallet.bucket
    ? parseMoney(E, scenario.initial.wallet.bucket, {
        unit,
        suffix: allowSuffix ? { kind: "alphaInfinite", minLen: 2 } : undefined,
      }).amount
    : E.zero();

  const maxMoneyEver = scenario.initial.maxMoneyEver
    ? parseMoney(E, scenario.initial.maxMoneyEver, {
        unit,
        suffix: allowSuffix ? { kind: "alphaInfinite", minLen: 2 } : undefined,
      })
    : walletMoney;

  const points = scenario.initial.prestige?.points
    ? parseMoney(E, scenario.initial.prestige.points, {
        unit,
        suffix: allowSuffix ? { kind: "alphaInfinite", minLen: 2 } : undefined,
      }).amount
    : E.zero();

  const multiplier = scenario.initial.prestige?.multiplier
    ? parseMoney(E, scenario.initial.prestige.multiplier, {
        unit,
        suffix: allowSuffix ? { kind: "alphaInfinite", minLen: 2 } : undefined,
      }).amount
    : E.from(1);

  const model = modelFactory.create(scenario.model.params) as Model<N, U, Vars>;

  let strategy: CompiledScenario<N, U, Vars>["strategy"] | undefined;
  if (scenario.strategy) {
    if (!strategyRegistry) {
      throw new Error(`StrategyRegistry is required to compile strategy: ${scenario.strategy.id}`);
    }

    const factory = strategyRegistry.get(scenario.strategy.id);
    if (!factory) {
      throw new Error(`Unknown strategy: ${scenario.strategy.id}`);
    }

    if (factory.paramsSchema) {
      const result = factory.paramsSchema["~standard"].validate(scenario.strategy.params ?? {});
      const hasSuccess = !!result && typeof result === "object" && "success" in result;
      if (hasSuccess) {
        const r = result as { success: boolean; issues?: Array<{ message: string }> };
        if (!r.success) {
          const issues = (r.issues ?? []).map((x) => x.message).join("; ");
          throw new Error(`Invalid strategy params: ${issues || "unknown issues"}`);
        }
      } else {
        const r = result as { issues?: Array<{ message: string }> };
        if (Array.isArray(r.issues) && r.issues.length > 0) {
          const issues = r.issues.map((x) => x.message).join("; ");
          throw new Error(`Invalid strategy params: ${issues}`);
        }
      }
    }

    strategy = factory.create(scenario.strategy.params ?? {}) as CompiledScenario<N, U, Vars>["strategy"];
  }

  const initial = {
    t: scenario.initial.t ?? 0,
    wallet: {
      money: walletMoney,
      bucket,
    },
    maxMoneyEver,
    prestige: {
      count: scenario.initial.prestige?.count ?? 0,
      points,
      multiplier,
    },
    vars: (scenario.initial.vars ?? ({} as Vars)) as Vars,
  };

  const ctx = {
    E,
    unit,
    tickPolicy: {
      mode: scenario.policy.mode,
      maxLogGap: scenario.policy.maxLogGap,
    },
    collectMoneyEvents: true,
  };

  const run = {
    stepSec: scenario.clock.stepSec,
    durationSec: scenario.clock.durationSec,
    until: compileUntilExpr(scenario.clock.untilExpr),
    trace: scenario.outputs?.report?.includeTrace
      ? {
          everySteps: scenario.outputs.report.traceEverySteps ?? 1,
          keepActionsLog: true,
        }
      : undefined,
    fast: scenario.sim?.fast
      ? {
          enabled: true,
          kind: "log-domain" as const,
          disableMoneyEvents: true,
        }
      : undefined,
  };

  return {
    ctx,
    model,
    initial,
    constraints: scenario.constraints,
    run,
    strategy,
  };
}
