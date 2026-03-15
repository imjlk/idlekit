import type { PromptApi, TerminalInfo } from "@bunli/core";
import { usageError } from "../errors";
import {
  buildInitTemplatePlan,
  resolveTemplatePreset,
  TEMPLATE_PRESETS,
  TEMPLATE_TRACKS,
  type TemplateIntent,
  type TemplatePreset,
  type TemplateSessionPatternId,
  type TemplateTrack,
  type TemplateWizardOverrides,
} from "../templates/scenario";

const INTENT_OPTIONS = [
  {
    label: "Frequent Progression",
    value: "frequent-progression",
    hint: "Short loops with frequent visible gains.",
  },
  {
    label: "Scale Fantasy",
    value: "scale-fantasy",
    hint: "Long-run growth with big late-game jumps.",
  },
  {
    label: "Strategic Optimization",
    value: "strategic-optimization",
    hint: "Choice-driven pacing and upgrade planning.",
  },
] as const satisfies ReadonlyArray<{ label: string; value: TemplateIntent; hint: string }>;

const SESSION_OPTIONS = [
  {
    label: "Always On",
    value: "always-on",
    hint: "Continuous active play for pacing checks.",
  },
  {
    label: "Short Bursts",
    value: "short-bursts",
    hint: "Many short sessions across a day.",
  },
  {
    label: "Twice Daily",
    value: "twice-daily",
    hint: "Two longer sessions per day.",
  },
  {
    label: "Offline Heavy",
    value: "offline-heavy",
    hint: "Mostly offline with brief active check-ins.",
  },
  {
    label: "Weekend Marathon",
    value: "weekend-marathon",
    hint: "Short weekday play, long weekend sessions.",
  },
] as const satisfies ReadonlyArray<{ label: string; value: TemplateSessionPatternId; hint: string }>;

type PromptLike = Pick<
  PromptApi,
  "group" | "intro" | "outro" | "note" | "select" | "text"
>;

export type InitWizardResult = Readonly<{
  track: TemplateTrack;
  preset: TemplatePreset;
  name?: string;
  overrides: TemplateWizardOverrides;
}>;

function wasFlagProvided(runtimeArgs: readonly string[], flag: string): boolean {
  return runtimeArgs.includes(flag) || runtimeArgs.some((arg) => arg.startsWith(`${flag}=`));
}

function validateNonEmpty(message: string) {
  return (value: string) => {
    if (value.trim().length === 0) return message;
    return true;
  };
}

function validateNumeric(message: string) {
  return (value: string) => {
    if (!Number.isFinite(Number(value))) return message;
    return true;
  };
}

function validatePositiveNumeric(message: string) {
  return (value: string) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return message;
    return true;
  };
}

function economyPromptSpec(scenario: any): ReadonlyArray<{
  key: string;
  label: string;
  hint: string;
  validate: (value: string) => boolean | string;
}> {
  if (scenario.model?.id === "plugin.generators") {
    return [
      {
        key: "baseIncome",
        label: "Base income",
        hint: "Passive income before producers.",
        validate: validatePositiveNumeric("Base income must be a positive number."),
      },
      {
        key: "producerIncome",
        label: "Producer income",
        hint: "Income contribution per producer tier.",
        validate: validatePositiveNumeric("Producer income must be a positive number."),
      },
      {
        key: "producerBaseCost",
        label: "Producer base cost",
        hint: "Opening producer unlock cost.",
        validate: validatePositiveNumeric("Producer base cost must be a positive number."),
      },
      {
        key: "producerCostGrowth",
        label: "Producer cost growth",
        hint: "Growth multiplier per producer purchase.",
        validate: validatePositiveNumeric("Producer cost growth must be a positive number."),
      },
    ];
  }

  return [
    {
      key: "incomePerSec",
      label: "Income / sec",
      hint: "Baseline earning speed.",
      validate: validatePositiveNumeric("Income per second must be a positive number."),
    },
    {
      key: "buyCostBase",
      label: "Base buy cost",
      hint: "Opening purchase cost.",
      validate: validatePositiveNumeric("Base buy cost must be a positive number."),
    },
    {
      key: "buyCostGrowth",
      label: "Cost growth",
      hint: "Cost multiplier applied per purchase.",
      validate: validatePositiveNumeric("Cost growth must be a positive number."),
    },
    {
      key: "buyIncomeDelta",
      label: "Income delta",
      hint: "Income added per purchase.",
      validate: validatePositiveNumeric("Income delta must be a positive number."),
    },
  ];
}

function trimToUndefined(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeEconomyValue(current: unknown, nextValue: string): string | number {
  return typeof current === "number" ? Number(nextValue) : nextValue.trim();
}

export async function runInitWizard(args: {
  prompt: PromptLike;
  terminal: TerminalInfo;
  runtimeArgs: readonly string[];
  outPath: string;
  initialTrack: TemplateTrack;
  initialPreset?: TemplatePreset;
  initialName?: string;
}): Promise<InitWizardResult> {
  if (!args.terminal.isInteractive || args.terminal.isCI) {
    throw usageError("init scenario --wizard requires an interactive terminal.", "Use explicit flags in CI or non-TTY environments.");
  }

  const track = wasFlagProvided(args.runtimeArgs, "--track")
    ? args.initialTrack
    : await args.prompt.select<TemplateTrack>("Choose a template track", {
        options: TEMPLATE_TRACKS.map((value) => ({
          value,
          label: value,
          hint:
            value === "intro"
              ? "Small, built-in starter examples."
              : value === "design"
                ? "Plugin-backed worked examples for system design."
                : "Personal bundle for your own game scaffold.",
        })),
        default: args.initialTrack,
      });

  const presetDefault = resolveTemplatePreset(track, args.initialPreset);
  const preset = wasFlagProvided(args.runtimeArgs, "--preset")
    ? presetDefault
    : await args.prompt.select<TemplatePreset>("Choose a pacing preset", {
        options: TEMPLATE_PRESETS.map((value) => ({
          value,
          label: value,
          hint:
            value === "session"
              ? "Short loops and fast feedback."
              : value === "builder"
                ? "Balanced progression for default design work."
                : "Long-horizon balance and worth checks.",
        })),
        default: presetDefault,
      });

  const name = track === "personal"
    ? (wasFlagProvided(args.runtimeArgs, "--name")
        ? args.initialName?.trim()
        : await args.prompt.text("Bundle display name", {
            default: args.initialName?.trim() || "My Game",
            validate: validateNonEmpty("Bundle name cannot be empty."),
          }))
    : undefined;

  const previewPlan = buildInitTemplatePlan({
    track,
    preset,
    outPath: args.outPath,
    name,
  });
  const scenarioFile = previewPlan.find((file) => file.kind === "scenario");
  if (!scenarioFile) {
    throw usageError("Wizard could not resolve a scenario template preview.");
  }
  const scenario = structuredClone(scenarioFile.content as any);
  const economyFields = economyPromptSpec(scenario);

  args.prompt.intro(`Interactive init wizard (${track}/${preset})`);
  args.prompt.note(
    [
      `Output: ${args.outPath}`,
      `Model: ${scenario.model?.id ?? "unknown"}`,
      `Strategy: ${scenario.strategy?.id ?? "unknown"}`,
    ].join("\n"),
    "Template Preview",
  );

  const economyDefaults = scenario.model?.params ?? {};
  const overrides = await args.prompt.group({
    unitCode: () =>
      args.prompt.text("Main currency code", {
        default: String(scenario.unit?.code ?? "COIN"),
        validate: validateNonEmpty("Currency code cannot be empty."),
      }),
    unitSymbol: () =>
      args.prompt.text("Currency symbol", {
        default: String(scenario.unit?.symbol ?? ""),
      }),
    designIntent: () =>
      args.prompt.select<TemplateIntent>("Design intent", {
        options: [...INTENT_OPTIONS],
        default: (scenario.design?.intent as TemplateIntent | undefined) ?? "strategic-optimization",
      }),
    sessionPatternId: () =>
      args.prompt.select<TemplateSessionPatternId>("Session pattern", {
        options: [...SESSION_OPTIONS],
        default: (scenario.design?.sessionPattern?.id as TemplateSessionPatternId | undefined) ?? "always-on",
      }),
    ...Object.fromEntries(
      economyFields.map((field) => [
        field.key,
        () =>
          args.prompt.text(field.label, {
            default: String(economyDefaults[field.key] ?? ""),
            validate: field.validate,
            placeholder: field.hint,
          }),
      ]),
    ),
  });
  const overrideRecord = overrides as Record<string, unknown>;

  const economy = Object.fromEntries(
    economyFields.map((field) => [field.key, normalizeEconomyValue(economyDefaults[field.key], String(overrideRecord[field.key]))]),
  );

  args.prompt.outro(`Wizard configured ${track}/${preset} scaffold.`);

  return {
    track,
    preset,
    name: trimToUndefined(name),
    overrides: {
      unitCode: trimToUndefined(String(overrides.unitCode)),
      unitSymbol: String(overrides.unitSymbol),
      designIntent: overrides.designIntent as TemplateIntent,
      sessionPatternId: overrides.sessionPatternId as TemplateSessionPatternId,
      economy,
    },
  };
}
