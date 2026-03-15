import type { PromptApi, TerminalInfo } from "@bunli/core";
import { validateScenarioV1, type ModelRegistry } from "@idlekit/core";
import { basename, resolve } from "path";
import { scenarioInvalidError, usageError } from "../errors";
import { fileExists, writeTextFile } from "../runtime/bun";
import { inferredTuneWizardPath } from "./setup";

const OBJECTIVE_OPTIONS = [
  {
    value: "endNetWorthLog10",
    label: "End Net Worth",
    hint: "Optimize late-run total value.",
  },
  {
    value: "experienceBalancedLog10",
    label: "Experience Balanced",
    hint: "Balance worth and perceived progression.",
  },
  {
    value: "visibleProgressScore",
    label: "Visible Progress",
    hint: "Favor frequent visible number changes.",
  },
  {
    value: "pacingBalancedLog10",
    label: "Pacing Balanced",
    hint: "Short-session pacing objective.",
  },
  {
    value: "timeToMilestoneNegSec",
    label: "Milestone Speed",
    hint: "Reach the first milestone sooner.",
  },
] as const;

type PromptLike = Pick<PromptApi, "intro" | "outro" | "select" | "text" | "confirm">;

function defaultObjective(intent?: string, strategyId?: string): string {
  if (strategyId === "planner") return "endNetWorthLog10";
  if (intent === "frequent-progression") return "pacingBalancedLog10";
  if (intent === "scale-fantasy") return "endNetWorthLog10";
  return "experienceBalancedLog10";
}

function validatePositiveInt(label: string) {
  return (value: string) => {
    const numeric = Number(value);
    if (!Number.isInteger(numeric) || numeric <= 0) return `${label} must be a positive integer.`;
    return true;
  };
}

function createStrategySpace(strategyId: string) {
  if (strategyId === "greedy") {
    return [
      { path: "maxPicksPerStep", space: { kind: "int", min: 1, max: 3 } },
      { path: "bulk.mode", space: { kind: "choice", values: ["size1", "bestQuote", "maxAffordable"] } },
      { path: "netWorth.horizonSec", space: { kind: "int", min: 300, max: 1200 } },
      { path: "netWorth.useFastPreview", space: { kind: "bool" } },
    ];
  }
  if (strategyId === "planner") {
    return [
      { path: "horizonSteps", space: { kind: "int", min: 4, max: 8 } },
      { path: "beamWidth", space: { kind: "int", min: 1, max: 3 } },
      { path: "maxBranchingActions", space: { kind: "int", min: 4, max: 8 } },
      { path: "useFastPreview", space: { kind: "bool" } },
    ];
  }
  throw usageError(`tune --wizard currently supports greedy/planner strategies only (got '${strategyId}').`);
}

export async function runTuneWizard(args: {
  prompt: PromptLike;
  terminal: TerminalInfo;
  scenarioPath: string;
  scenarioInput: unknown;
  modelRegistry: ModelRegistry;
  outPath?: string;
  force: boolean;
}): Promise<Readonly<{ tunePath: string; tuneSpec: unknown }>> {
  if (!args.terminal.isInteractive || args.terminal.isCI) {
    throw usageError("tune --wizard requires an interactive terminal.", "Use --tune <path> with an explicit spec in non-interactive environments.");
  }

  const valid = validateScenarioV1(args.scenarioInput, args.modelRegistry);
  if (!valid.ok || !valid.scenario) {
    throw scenarioInvalidError(valid.issues);
  }

  const scenario = valid.scenario as any;
  const strategyId = String(scenario.strategy?.id ?? "greedy");
  const suggestedOut = resolve(args.outPath?.trim() || inferredTuneWizardPath(args.scenarioPath));

  args.prompt.intro(`Tune wizard for ${basename(args.scenarioPath)}`);
  const answers = await Promise.all([
    args.prompt.select("Objective", {
      options: OBJECTIVE_OPTIONS.map((entry) => ({ ...entry })),
      default: defaultObjective(scenario.design?.intent, strategyId),
    }),
    args.prompt.text("Search budget", {
      default: "10",
      validate: validatePositiveInt("Search budget"),
    }),
    args.prompt.text("Override duration (sec)", {
      default: String(scenario.clock?.durationSec ?? 1800),
      validate: validatePositiveInt("Override duration"),
    }),
    args.prompt.text("Tune spec output path", {
      default: suggestedOut,
    }),
  ]);

  const [objectiveId, budgetRaw, durationRaw, tunePathRaw] = answers;
  const tunePath = resolve(String(tunePathRaw));
  if ((await fileExists(tunePath)) && !args.force) {
    throw usageError(`Output file already exists: ${tunePath}`, "Pass --force true to overwrite the generated tune spec.");
  }

  const budget = Number(budgetRaw);
  const durationSec = Number(durationRaw);
  const halfBudget = Math.max(1, Math.floor(budget / 2));
  const tuneSpec = {
    schemaVersion: 1,
    meta: {
      id: `${scenario.meta?.id ?? basename(args.scenarioPath, ".json")}-tune`,
      title: `${scenario.meta?.title ?? basename(args.scenarioPath, ".json")} TuneSpec`,
      description: `Wizard-generated TuneSpec for ${scenario.meta?.id ?? basename(args.scenarioPath)}`,
      tags: ["wizard", "tune"],
    },
    strategy: {
      id: strategyId,
      baseParams: scenario.strategy?.params ?? {},
      space: createStrategySpace(strategyId),
    },
    objective: {
      id: String(objectiveId),
      params: objectiveId === "timeToMilestoneNegSec" ? { milestoneKey: "progress.first-upgrade" } : {},
    },
    runner: {
      seeds: [7, 13, 29],
      budget,
      overrideDurationSec: durationSec,
      topK: 4,
      stages: [
        {
          budget: halfBudget,
          durationSec: Math.max(300, Math.min(durationSec, Math.floor(durationSec / 2))),
          keepTopK: 4,
          fast: true,
        },
        {
          budget: Math.max(1, budget - halfBudget),
          durationSec,
          keepTopK: 4,
          fast: true,
        },
      ],
    },
  };

  await writeTextFile(tunePath, `${JSON.stringify(tuneSpec, null, 2)}\n`);
  args.prompt.outro(`Wrote TuneSpec to ${tunePath}`);

  return {
    tunePath,
    tuneSpec,
  };
}
