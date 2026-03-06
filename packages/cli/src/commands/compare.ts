import { defineCommand, option } from "@bunli/core";
import {
  compareScenarios,
  compileScenario,
  createNumberEngine,
  deepClonePreservingPrototype,
  parseMoney,
  runScenario,
  validateScenarioV1,
} from "@idlekit/core";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { z } from "zod";
import { betterFromCmp, formatEtaLabel, toComparableEta } from "./_shared/compareEval";
import { loadRegistriesFromFlags, pluginOptions } from "./_shared/plugin";
import { buildOutputMeta } from "../io/outputMeta";
import { writeCommandReplayArtifact } from "../io/replayPolicy";
import { readScenarioFile } from "../io/readScenario";
import { writeOutput } from "../io/writeOutput";

const strategySchema = z.enum(["greedy", "planner", "scripted"]).optional();

function assertValidScenario(
  label: "A" | "B",
  valid: ReturnType<typeof validateScenarioV1>,
): NonNullable<ReturnType<typeof validateScenarioV1>["scenario"]> {
  if (!valid.ok || !valid.scenario) {
    throw new Error(`Scenario ${label} invalid: ${valid.issues.map((i) => i.message).join("; ")}`);
  }
  return valid.scenario;
}

function compileComparableScenario(args: {
  scenario: any;
  E: ReturnType<typeof createNumberEngine>;
  loaded: Awaited<ReturnType<typeof loadRegistriesFromFlags>>;
  flags: {
    strategy?: string;
    step?: number;
    duration?: number;
    fast: boolean;
    seed?: number;
  };
}) {
  const compiled = compileScenario<number, string, Record<string, unknown>>({
    E: args.E,
    scenario: args.scenario,
    registry: args.loaded.modelRegistry,
    strategyRegistry: args.loaded.strategyRegistry,
    opts: { allowSuffixNotation: true },
  });

  const overrideStrategy = (() => {
    if (!args.flags.strategy) return compiled.strategy;
    const factory = args.loaded.strategyRegistry.get(args.flags.strategy);
    if (!factory) throw new Error(`Unknown strategy: ${args.flags.strategy}`);
    return factory.create(factory.defaultParams ?? {}) as typeof compiled.strategy;
  })();

  return {
    ...compiled,
    ctx: {
      ...compiled.ctx,
      seed: args.flags.seed ?? compiled.ctx.seed,
    },
    strategy: overrideStrategy,
    run: {
      ...compiled.run,
      eventLog: {
        enabled: false,
        maxEvents: 0,
      },
      stepSec: args.flags.step ?? compiled.run.stepSec,
      durationSec: args.flags.duration ?? compiled.run.durationSec,
      fast: args.flags.fast
        ? { enabled: true as const, kind: "log-domain" as const, disableMoneyEvents: true }
        : compiled.run.fast,
    },
  };
}

function measureScenario(args: {
  compiled: ReturnType<typeof compileComparableScenario>;
  E: ReturnType<typeof createNumberEngine>;
  targetWorth?: string;
  maxDuration: number;
}) {
  const runInput = {
    ...args.compiled,
    initial: deepClonePreservingPrototype(args.compiled.initial),
  };
  const run = runScenario(runInput);
  const endWorth = runInput.model.netWorth?.(runInput.ctx, run.end) ?? run.end.wallet.money;

  let etaSeconds: number | undefined;
  let etaReached: boolean | undefined;
  if (args.targetWorth) {
    const target = parseMoney(args.E, args.targetWorth, {
      unit: runInput.ctx.unit,
      suffix: { kind: "alphaInfinite", minLen: 2 },
    }).amount;

    const reachedFn = (s: typeof run.end) =>
      args.E.cmp((runInput.model.netWorth?.(runInput.ctx, s) ?? s.wallet.money).amount, target) >= 0;

    const etaRun = runScenario({
      ...runInput,
      initial: deepClonePreservingPrototype(args.compiled.initial),
      run: {
        ...runInput.run,
        durationSec: args.maxDuration,
        trace: undefined,
        until: reachedFn,
      },
    });

    etaReached = reachedFn(etaRun.end);
    etaSeconds = etaReached ? etaRun.end.t - etaRun.start.t : Number.POSITIVE_INFINITY;
  }

  return {
    run,
    endMoney: run.end.wallet.money.amount,
    endNetWorth: endWorth.amount,
    droppedRate: run.stats?.money.droppedRate ?? 0,
    etaToTargetWorth: etaSeconds,
    etaReached,
  };
}

export default defineCommand({
  name: "compare",
  description: "Compare two scenarios via measured simulation metrics",
  options: {
    ...pluginOptions(),
    duration: option(z.coerce.number().optional(), { description: "Override durationSec" }),
    step: option(z.coerce.number().optional(), { description: "Override stepSec" }),
    strategy: option(strategySchema, { description: "Override strategy id (greedy|planner|scripted)" }),
    fast: option(z.coerce.boolean().default(false), { description: "Enable fast(log-domain) mode" }),
    "target-worth": option(z.string().optional(), {
      description: "Required for etaToTargetWorth metric, optional otherwise",
    }),
    "max-duration": option(z.coerce.number().default(86400), {
      description: "Max duration for etaToTargetWorth metric simulation",
    }),
    seed: option(z.coerce.number().optional(), { description: "Deterministic seed passed to ctx.seed" }),
    "run-id": option(z.string().optional(), {
      description: "Optional run identifier used in output metadata",
    }),
    "artifact-out": option(z.string().optional(), { description: "Write replay artifact JSON to path" }),
    metric: option(
      z.enum(["endMoney", "endNetWorth", "etaToTargetWorth", "droppedRate"]).default("endNetWorth"),
      { description: "Comparison metric" },
    ),
    out: option(z.string().optional(), { description: "Output path" }),
    format: option(z.enum(["json", "md", "csv"]).default("json"), { description: "Output format" }),
  },
  async handler({ flags, positional }) {
    const aPath = positional[0];
    const bPath = positional[1];
    if (!aPath || !bPath) {
      throw new Error(
        "Usage: idk compare <A> <B> [--metric ...] [--plugin ...] [--target-worth <NumStr>]",
      );
    }

    const [aInput, bInput] = await Promise.all([readScenarioFile(aPath), readScenarioFile(bPath)]);
    const loaded = await loadRegistriesFromFlags(flags);

    const aScenario = assertValidScenario("A", validateScenarioV1(aInput, loaded.modelRegistry));
    const bScenario = assertValidScenario("B", validateScenarioV1(bInput, loaded.modelRegistry));

    if (flags.metric === "etaToTargetWorth" && !flags["target-worth"]) {
      throw new Error("metric=etaToTargetWorth requires --target-worth <NumStr>");
    }

    const E = createNumberEngine();

    const aCompiled = compileComparableScenario({
      scenario: aScenario,
      E,
      loaded,
      flags,
    });
    const bCompiled = compileComparableScenario({
      scenario: bScenario,
      E,
      loaded,
      flags,
    });

    const ma = measureScenario({
      compiled: aCompiled,
      E,
      targetWorth: flags["target-worth"],
      maxDuration: flags["max-duration"],
    });
    const mb = measureScenario({
      compiled: bCompiled,
      E,
      targetWorth: flags["target-worth"],
      maxDuration: flags["max-duration"],
    });

    const result = compareScenarios({
      a: aScenario,
      b: bScenario,
      metric: flags.metric,
      measured: {
        a: {
          endMoney: E.absLog10(ma.endMoney),
          endNetWorth: E.absLog10(ma.endNetWorth),
          droppedRate: ma.droppedRate,
          etaToTargetWorth: toComparableEta(ma.etaToTargetWorth, flags["max-duration"]),
        },
        b: {
          endMoney: E.absLog10(mb.endMoney),
          endNetWorth: E.absLog10(mb.endNetWorth),
          droppedRate: mb.droppedRate,
          etaToTargetWorth: toComparableEta(mb.etaToTargetWorth, flags["max-duration"]),
        },
      },
      measuredDecision: (metric) => {
        switch (metric) {
          case "endMoney":
            return betterFromCmp(E.cmp(ma.endMoney, mb.endMoney));
          case "endNetWorth":
            return betterFromCmp(E.cmp(ma.endNetWorth, mb.endNetWorth));
          case "droppedRate":
            return betterFromCmp(ma.droppedRate < mb.droppedRate ? 1 : ma.droppedRate > mb.droppedRate ? -1 : 0);
          case "etaToTargetWorth": {
            const aEta = toComparableEta(ma.etaToTargetWorth, flags["max-duration"]);
            const bEta = toComparableEta(mb.etaToTargetWorth, flags["max-duration"]);
            if (aEta === undefined || bEta === undefined) return undefined;
            return betterFromCmp(aEta < bEta ? 1 : aEta > bEta ? -1 : 0);
          }
          default:
            return undefined;
        }
      },
    });

    const runId = flags["run-id"] ?? randomUUID();
    const outputMeta = buildOutputMeta({
      command: "compare",
      runId,
      seed: flags.seed ?? aCompiled.ctx.seed,
      scenarioPath: [aPath, bPath],
      scenarios: {
        a: aScenario,
        b: bScenario,
      },
    });
    const output = {
      metric: flags.metric,
      better: result.better,
      detail: result.detail,
      measured: {
        a: {
          endMoney: E.toString(ma.endMoney),
          endNetWorth: E.toString(ma.endNetWorth),
          droppedRate: ma.droppedRate,
          etaToTargetWorth:
            ma.etaToTargetWorth === undefined
              ? undefined
              : formatEtaLabel(ma.etaToTargetWorth, !!ma.etaReached),
        },
        b: {
          endMoney: E.toString(mb.endMoney),
          endNetWorth: E.toString(mb.endNetWorth),
          droppedRate: mb.droppedRate,
          etaToTargetWorth:
            mb.etaToTargetWorth === undefined
              ? undefined
              : formatEtaLabel(mb.etaToTargetWorth, !!mb.etaReached),
        },
      },
    };

    if (flags["artifact-out"]) {
      const aAbs = resolve(process.cwd(), aPath);
      const bAbs = resolve(process.cwd(), bPath);
      await writeCommandReplayArtifact({
        outPath: flags["artifact-out"],
        command: "compare",
        positional: [aAbs, bAbs],
        flags,
        forcedFlags: {
          "run-id": runId,
          seed: flags.seed ?? aCompiled.ctx.seed,
          format: "json",
        },
        result: output,
        meta: outputMeta,
      });
    }

    await writeOutput({
      format: flags.format,
      outPath: flags.out,
      data: output,
      meta: outputMeta,
    });
  },
});
