import { defineCommand, option } from "../runtime/command";
import { validateScenarioV1 } from "@idlekit/core";
import { z } from "zod";
import { loadRegistriesFromFlags, pluginOptions } from "./_shared/plugin";
import { scenarioInvalidError, usageError } from "../errors";
import { prepareResolvedRun } from "../lib/runConfiguration";
import {
  collectExperienceSnapshot,
  renderExperienceMarkdown,
  resolveExperienceDraws,
  resolveExperienceQuantiles,
  resolveExperienceSeries,
  resolveSessionPatternId,
  resolveSessionPatternSpec,
  summarizeExperienceMonteCarlo,
} from "../lib/experience";
import { buildOutputMeta, deriveDeterministicRunId } from "../io/outputMeta";
import { writeCommandReplayArtifact } from "../io/replayPolicy";
import { readScenarioFile } from "../io/readScenario";
import { writeOutput } from "../io/writeOutput";

export default defineCommand({
  name: "experience",
  description: "Evaluate design-facing progression, milestones, session pattern, and perceived feedback",
  options: {
    ...pluginOptions(),
    "session-pattern": option(
      z.enum(["always-on", "short-bursts", "twice-daily", "offline-heavy", "weekend-marathon"]).optional(),
      { description: "Session pattern id" },
    ),
    days: option(z.coerce.number().int().positive().optional(), { description: "Days to simulate for the session pattern" }),
    draws: option(z.coerce.number().int().positive().optional(), { description: "Monte Carlo draw count (1 = deterministic)" }),
    strategy: option(z.string().min(1).optional(), {
      description: "Registered strategy id. Builtins remain greedy, planner, and scripted.",
    }),
    engine: option(z.string().min(1).optional(), {
      description: "Execution engine. Default number. scenario.engine is metadata. breakInfinity is explicit. breakEternity is unsupported.",
    }),
    seed: option(z.coerce.number().optional(), { description: "Deterministic seed" }),
    out: option(z.string().optional(), { description: "Output path" }),
    format: option(z.enum(["json", "md"]).default("json"), { description: "Output format" }),
    "run-id": option(z.string().optional(), { description: "Optional run identifier used in output metadata" }),
    "artifact-out": option(z.string().optional(), { description: "Write replay artifact JSON to path" }),
  },
  async handler({ flags, positional }) {
    const scenarioPath = positional[0];
    if (!scenarioPath) {
      throw usageError(
        "Usage: idk experience <scenario> [--session-pattern <id>] [--days <n>] [--draws <n>] [--seed <n>]",
      );
    }

    const input = await readScenarioFile(scenarioPath);
    const loaded = await loadRegistriesFromFlags(flags);
    const valid = validateScenarioV1(input, loaded.modelRegistry);
    if (!valid.ok || !valid.scenario) {
      throw scenarioInvalidError(valid.issues);
    }

    const unseeded = prepareResolvedRun({
      scenario: valid.scenario,
      modelRegistry: loaded.modelRegistry,
      strategyRegistry: loaded.strategyRegistry,
      pluginDigest: loaded.pluginDigest,
      engineRequest: flags.engine,
      strategyOverride: flags.strategy,
      sessionId: flags["session-pattern"],
      days: flags.days,
    });
    const experienceInputs = { draws: resolveExperienceDraws(unseeded.definition, flags.draws) };
    const seed =
      flags.seed ??
      unseeded.defaultSeed(
        // The seed input of a run without flags.
        {
          command: "experience",
          scenario: valid.scenario,
          options: { sessionPattern: undefined, days: undefined, draws: undefined },
        },
        [
          {
            stage: "experience",
            inputs: experienceInputs,
            defaults: { draws: resolveExperienceDraws(unseeded.definition) },
          },
        ],
      );
    const prepared = unseeded.withSeed(seed);
    const opened = prepared.open("experience", `experience:${seed}`, experienceInputs);
    const seededScenario = opened.scenario;

    const sessionPattern = resolveSessionPatternSpec({
      scenario: seededScenario,
      sessionPatternId: resolveSessionPatternId(flags["session-pattern"]),
      days: flags.days,
    });
    const draws = resolveExperienceDraws(seededScenario, flags.draws);
    const series = resolveExperienceSeries(seededScenario);
    const quantiles = resolveExperienceQuantiles(seededScenario);

    const { session, snapshot } = collectExperienceSnapshot({
      scenario: seededScenario,
      sessionPattern,
      seed,
      series,
    });

    // The deterministic session advanced seededScenario's model and strategy. Monte Carlo opens
    // its own stage and builds a new model and strategy for every draw from the registries.
    const monteCarloStage =
      draws > 1 ? prepared.open("experience", `experience:${seed}:monte-carlo`, experienceInputs) : undefined;
    const monteCarlo = monteCarloStage
      ? summarizeExperienceMonteCarlo({
          scenario: monteCarloStage.scenario,
          registries: monteCarloStage.isolation.registries,
          isolation: monteCarloStage.isolation.options,
          sessionPattern,
          draws,
          seed,
          quantiles,
          series,
        })
      : undefined;

    const runId =
      flags["run-id"] ??
      deriveDeterministicRunId({
        command: "experience",
        seed,
        scope: { effectiveRunHash: opened.hash },
      });

    const mode = draws > 1 ? ("monte-carlo" as const) : ("deterministic" as const);

    const output = {
      mode,
      design: {
        intent: valid.scenario.design?.intent,
        sessionPattern,
        series,
        draws,
        quantiles,
      },
      end: {
        t: session.end.t,
        money: snapshot.endMoney,
        netWorth: snapshot.endNetWorth,
        prestige: {
          count: session.end.prestige.count,
          points: seededScenario.ctx.E.toString(session.end.prestige.points),
          multiplier: seededScenario.ctx.E.toString(session.end.prestige.multiplier),
        },
      },
      session: snapshot.session,
      growth: snapshot.growth,
      milestones: snapshot.milestones,
      perceived: snapshot.perceived,
      monteCarlo,
    };

    const outputMeta = buildOutputMeta({
      command: "experience",
      effectiveRunHash: opened.hash,
      effectiveEngine: prepared.engine.effectiveId,
      stageScope: { experience: opened.plan.stage.applies },
      runId,
      seed,
      scenarioPath,
      scenario: valid.scenario,
      pluginDigest: loaded.pluginDigest,
    });

    if (flags["artifact-out"]) {
      await writeCommandReplayArtifact({
        outPath: flags["artifact-out"],
        command: "experience",
        positional: [scenarioPath],
        flags,
        forcedFlags: {
          seed,
          "run-id": runId,
          format: "json",
        },
        result: output,
        meta: outputMeta,
      });
    }

    await writeOutput({
      format: flags.format,
      outPath: flags.out,
      data:
        flags.format === "md"
          ? renderExperienceMarkdown({
              scenarioPath,
              intent: valid.scenario.design?.intent,
              mode,
              snapshot,
              monteCarlo,
            })
          : output,
      meta: outputMeta,
    });
  },
});
