import { resolve, parse } from "path";

export const TEMPLATE_TRACKS = ["intro", "design", "personal"] as const;
export type TemplateTrack = (typeof TEMPLATE_TRACKS)[number];

export const TEMPLATE_PRESETS = ["session", "builder", "longrun"] as const;
export type TemplatePreset = (typeof TEMPLATE_PRESETS)[number];

export type GeneratedTemplateFile = Readonly<{
  kind: "scenario" | "compare" | "tune";
  path: string;
  content: unknown;
}>;

const INTRO_PRESET_DEFAULT: Readonly<Record<TemplateTrack, TemplatePreset>> = {
  intro: "session",
  design: "builder",
  personal: "builder",
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function formatDecimal(value: number): string {
  const rounded = Number(value.toFixed(12));
  if (Number.isInteger(rounded)) return String(rounded);
  return String(rounded);
}

function scaleNumericString(value: string, factor: number): string {
  return formatDecimal(Number(value) * factor);
}

function scaleNumberish(value: string | number, factor: number): string | number {
  return typeof value === "string" ? scaleNumericString(value, factor) : Number((value * factor).toFixed(12));
}

function addNumberish(value: string | number, delta: number): string | number {
  return typeof value === "string" ? formatDecimal(Number(value) + delta) : Number((value + delta).toFixed(12));
}

function slugifyName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function titleCaseSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeStemFromOutPath(outPath: string): string {
  const parsed = parse(outPath);
  const raw = (parsed.ext ? parsed.name : parsed.base).replace(/-(compare-b|tune)$/i, "");
  return raw.endsWith("-v1") ? raw : `${raw}-v1`;
}

export function resolveTemplatePreset(track: TemplateTrack, preset?: TemplatePreset): TemplatePreset {
  return preset ?? INTRO_PRESET_DEFAULT[track];
}

const introSession = {
  schemaVersion: 1,
  meta: {
    id: "intro-linear",
    title: "Intro Linear Scenario",
  },
  unit: { code: "COIN" },
  policy: { mode: "drop", maxLogGap: 12 },
  model: {
    id: "linear",
    version: 1,
    params: {
      incomePerSec: "1",
      buyCostBase: "10",
      buyCostGrowth: 1.15,
      buyIncomeDelta: "1",
    },
  },
  initial: {
    wallet: { unit: "COIN", amount: "0", bucket: "0" },
    vars: { owned: 0 },
    prestige: { count: 0, points: "0", multiplier: "1" },
  },
  clock: {
    stepSec: 1,
    durationSec: 1200,
  },
  strategy: {
    id: "greedy",
  },
  outputs: {
    format: "json",
  },
} as const;

const introBuilder = {
  schemaVersion: 1,
  meta: {
    id: "cafe-baseline",
    title: "Cafe Baseline",
  },
  unit: {
    code: "COIN",
    symbol: "C",
  },
  policy: {
    mode: "accumulate",
    maxLogGap: 14,
  },
  model: {
    id: "linear",
    version: 1,
    params: {
      incomePerSec: "1",
      buyCostBase: "12",
      buyCostGrowth: 1.11,
      buyIncomeDelta: "1.35",
    },
  },
  initial: {
    t: 0,
    wallet: {
      unit: "COIN",
      amount: "0",
      bucket: "0",
    },
    vars: {
      owned: 0,
    },
    prestige: {
      count: 0,
      points: "0",
      multiplier: "1",
    },
  },
  clock: {
    stepSec: 1,
    durationSec: 1200,
  },
  strategy: {
    id: "greedy",
  },
  analysis: {
    eta: {
      mode: "simulate",
    },
    growth: {
      windowSec: 60,
    },
  },
  outputs: {
    format: "json",
    report: {
      checkpointsSec: [60, 300, 900, 1200],
      includeTrace: true,
      traceEverySteps: 1,
      includeGrowth: true,
      includeUX: true,
    },
  },
} as const;

const introLongrun = {
  schemaVersion: 1,
  meta: {
    id: "intro-longrun-linear",
    title: "Intro Longrun Linear Scenario",
    description: "Long-horizon linear starter aligned with bench profiles.",
  },
  unit: { code: "COIN" },
  policy: { mode: "drop", maxLogGap: 12 },
  model: {
    id: "linear",
    version: 1,
    params: {
      incomePerSec: "1.2",
      buyCostBase: "9",
      buyCostGrowth: 1.14,
      buyIncomeDelta: "0.9",
    },
  },
  initial: {
    wallet: { unit: "COIN", amount: "25", bucket: "0" },
    vars: { owned: 0 },
    prestige: { count: 0, points: "0", multiplier: "1" },
  },
  clock: {
    stepSec: 300,
    durationSec: 604800,
  },
  strategy: { id: "greedy" },
  sim: { fast: true },
  outputs: { format: "json" },
} as const;

const designBuilder = {
  schemaVersion: 1,
  meta: {
    id: "design-template",
    title: "Design Template (Producer/Upgrade/Gem)",
    description: "Requires plugin.generators + plugin.producerFirst",
  },
  unit: { code: "COIN", symbol: "C" },
  policy: { mode: "accumulate", maxLogGap: 14 },
  model: {
    id: "plugin.generators",
    version: 1,
    params: {
      baseIncome: "0.8",
      producerIncome: "1.5",
      producerBaseCost: "10",
      producerCostGrowth: 1.12,
      upgradeBaseCost: "120",
      upgradeGrowth: 1.65,
      upgradeIncomeBoost: 0.18,
      gemExchangeCost: "900",
    },
  },
  initial: {
    wallet: { unit: "COIN", amount: "40", bucket: "0" },
    vars: { producers: 0, upgrades: 0, gems: 0 },
    prestige: { count: 0, points: "0", multiplier: "1" },
  },
  clock: {
    stepSec: 1,
    durationSec: 2400,
  },
  strategy: {
    id: "plugin.producerFirst",
    params: {
      schemaVersion: 1,
      allowUpgrade: true,
      preferUpgradeAtProducers: 8,
    },
  },
  monetization: {
    cohorts: { baseUsers: 10000 },
    retention: { d1: 0.42, d7: 0.2, d30: 0.09, d90: 0.04, longTailDailyDecay: 0.02 },
    revenue: {
      payerConversion: 0.03,
      arppuDaily: 0.7,
      adArpDau: 0.02,
      platformFeeRate: 0.3,
      grossMarginRate: 0.92,
      progressionRevenueLift: 0.45,
      progressionLogSpan: 6,
    },
    acquisition: { cpi: 1.8 },
    uncertainty: {
      enabled: true,
      draws: 300,
      quantiles: [0.5, 0.9],
      sigma: { retention: 0.08, conversion: 0.12, arppu: 0.2, ad: 0.15 },
      correlation: {
        retentionConversion: 0.3,
        retentionArppu: 0.25,
        retentionAd: 0.15,
        conversionArppu: 0.45,
        conversionAd: 0.25,
        arppuAd: 0.35,
      },
    },
  },
  outputs: { format: "json" },
} as const;

function createDesignScenario(preset: TemplatePreset): unknown {
  if (preset === "builder") return clone(designBuilder);
  const scenario = clone(designBuilder) as any;
  if (preset === "session") {
    scenario.meta.id = "design-template-session";
    scenario.meta.title = "Design Template Session Preset";
    scenario.clock.durationSec = 1800;
    scenario.model.params.producerBaseCost = scaleNumericString(scenario.model.params.producerBaseCost, 0.8);
    scenario.model.params.producerCostGrowth = 1.1;
    scenario.model.params.upgradeBaseCost = scaleNumericString(scenario.model.params.upgradeBaseCost, 0.75);
    scenario.model.params.upgradeGrowth = 1.5;
    scenario.model.params.gemExchangeCost = scaleNumericString(scenario.model.params.gemExchangeCost, 0.75);
    scenario.strategy.params.preferUpgradeAtProducers = 6;
    return scenario;
  }
  scenario.meta.id = "design-template-longrun";
  scenario.meta.title = "Design Template Longrun Preset";
  scenario.clock.stepSec = 10;
  scenario.clock.durationSec = 86400;
  scenario.sim = {
    fast: true,
    eventLog: {
      enabled: false,
      maxEvents: 0,
    },
  };
  scenario.model.params.producerBaseCost = scaleNumericString(scenario.model.params.producerBaseCost, 1.4);
  scenario.model.params.producerCostGrowth = 1.16;
  scenario.model.params.upgradeBaseCost = scaleNumericString(scenario.model.params.upgradeBaseCost, 1.35);
  scenario.model.params.upgradeGrowth = 1.78;
  scenario.model.params.gemExchangeCost = scaleNumericString(scenario.model.params.gemExchangeCost, 1.4);
  scenario.strategy.params.preferUpgradeAtProducers = 14;
  return scenario;
}

function createPersonalBaseScenario(preset: TemplatePreset): unknown {
  if (preset === "builder") {
    return {
      schemaVersion: 1,
      meta: {
        id: "my-game-v1",
        title: "My Game V1 Template",
        description: "Personal starter scenario. Rename the unit, adjust the growth curve, then compare and tune.",
        tags: ["template", "personal", "idle", "design-first"],
      },
      unit: {
        code: "TOKEN",
        symbol: "T",
      },
      policy: {
        mode: "accumulate",
        maxLogGap: 14,
      },
      model: {
        id: "linear",
        version: 1,
        params: {
          incomePerSec: "1.6",
          buyCostBase: "20",
          buyCostGrowth: 1.13,
          buyIncomeDelta: "1.2",
        },
      },
      initial: {
        t: 0,
        wallet: {
          unit: "TOKEN",
          amount: "35",
          bucket: "0",
        },
        vars: {
          owned: 0,
        },
        prestige: {
          count: 0,
          points: "0",
          multiplier: "1",
        },
      },
      clock: {
        stepSec: 1,
        durationSec: 3600,
      },
      strategy: {
        id: "greedy",
        params: {
          schemaVersion: 1,
          objective: "maximizeNetWorth",
          maxPicksPerStep: 1,
          bulk: {
            mode: "bestQuote",
          },
          netWorth: {
            horizonSec: 600,
            series: "netWorth",
            useFastPreview: true,
          },
        },
      },
      analysis: {
        eta: {
          mode: "analytic",
        },
        growth: {
          windowSec: 60,
        },
      },
      monetization: {
        cohorts: {
          baseUsers: 5000,
        },
        retention: {
          d1: 0.4,
          d7: 0.18,
          d30: 0.08,
          d90: 0.035,
          longTailDailyDecay: 0.02,
        },
        revenue: {
          payerConversion: 0.025,
          arppuDaily: 0.65,
          adArpDau: 0.018,
          platformFeeRate: 0.3,
          grossMarginRate: 0.92,
          progressionRevenueLift: 0.4,
          progressionLogSpan: 6,
        },
        acquisition: {
          cpi: 1.5,
        },
        uncertainty: {
          enabled: true,
          draws: 200,
          quantiles: [0.5, 0.9],
          seed: 13,
          sigma: {
            retention: 0.08,
            conversion: 0.12,
            arppu: 0.2,
            ad: 0.15,
          },
          correlation: {
            retentionConversion: 0.25,
            retentionArppu: 0.2,
            retentionAd: 0.12,
            conversionArppu: 0.4,
            conversionAd: 0.22,
            arppuAd: 0.3,
          },
        },
      },
      sim: {
        fast: true,
        eventLog: {
          enabled: false,
          maxEvents: 0,
        },
      },
      outputs: {
        format: "json",
        report: {
          checkpointsSec: [60, 300, 900, 1800, 3600],
          includeGrowth: true,
          includeUX: true,
        },
      },
    };
  }
  if (preset === "session") {
    return {
      schemaVersion: 1,
      meta: {
        id: "my-game-v1",
        title: "My Game V1 Session Template",
        description: "Personal starter scenario for short session loops.",
        tags: ["template", "personal", "idle", "session"],
      },
      unit: {
        code: "GOLD",
        symbol: "G",
      },
      policy: {
        mode: "drop",
        maxLogGap: 12,
      },
      model: {
        id: "linear",
        version: 1,
        params: {
          incomePerSec: "0.9",
          buyCostBase: "8",
          buyCostGrowth: 1.1,
          buyIncomeDelta: "0.8",
        },
      },
      initial: {
        t: 0,
        wallet: {
          unit: "GOLD",
          amount: "15",
          bucket: "0",
        },
        vars: {
          owned: 0,
        },
        prestige: {
          count: 0,
          points: "0",
          multiplier: "1",
        },
      },
      clock: {
        stepSec: 1,
        durationSec: 1800,
      },
      strategy: {
        id: "greedy",
        params: {
          schemaVersion: 1,
          objective: "minPayback",
          maxPicksPerStep: 2,
          bulk: {
            mode: "bestQuote",
          },
        },
      },
      outputs: {
        format: "json",
      },
    };
  }
  return {
    schemaVersion: 1,
    meta: {
      id: "my-game-v1",
      title: "My Game V1 Longrun Template",
      description: "Personal starter scenario for long-horizon balance checks.",
      tags: ["template", "personal", "idle", "longrun"],
    },
    unit: {
      code: "CREDIT",
      symbol: "Cr",
    },
    policy: {
      mode: "accumulate",
      maxLogGap: 16,
    },
    model: {
      id: "linear",
      version: 1,
      params: {
        incomePerSec: "3.2",
        buyCostBase: "140",
        buyCostGrowth: 1.18,
        buyIncomeDelta: "4.6",
      },
    },
    initial: {
      t: 0,
      wallet: {
        unit: "CREDIT",
        amount: "300",
        bucket: "0",
      },
      vars: {
        owned: 0,
      },
      prestige: {
        count: 0,
        points: "0",
        multiplier: "1",
      },
    },
    clock: {
      stepSec: 10,
      durationSec: 86400,
    },
    strategy: {
      id: "planner",
      params: {
        schemaVersion: 1,
        horizonSteps: 5,
        beamWidth: 2,
        objective: "maximizeNetWorthAtEnd",
        series: "netWorth",
        maxBranchingActions: 6,
        useFastPreview: true,
        bulk: {
          mode: "bestQuote",
        },
      },
    },
    sim: {
      fast: true,
      eventLog: {
        enabled: false,
        maxEvents: 0,
      },
    },
    outputs: {
      format: "json",
    },
  };
}

function createPersonalCompareScenario(baseInput: unknown): unknown {
  const base = clone(baseInput) as any;
  base.meta = {
    ...base.meta,
    id: `${base.meta.id}-compare-b`,
    title: String(base.meta.title).replace(/Template$/, "Compare Variant B").replace(/V1$/, "Compare Variant B"),
    description: `A/B comparison variant for ${base.meta.id}. Slightly faster opening, tighter long-tail growth.`,
    tags: Array.isArray(base.meta.tags) ? [...base.meta.tags, "compare"] : ["compare"],
  };
  base.model.params.incomePerSec = scaleNumericString(base.model.params.incomePerSec, 1.15);
  base.model.params.buyCostBase = scaleNumericString(base.model.params.buyCostBase, 0.8);
  base.model.params.buyCostGrowth = addNumberish(base.model.params.buyCostGrowth, 0.04);
  base.model.params.buyIncomeDelta = scaleNumericString(base.model.params.buyIncomeDelta, 0.875);
  return base;
}

function createPersonalTuneSpec(preset: TemplatePreset, baseScenario: any): unknown {
  if (preset === "session") {
    return {
      schemaVersion: 1,
      meta: {
        id: `${baseScenario.meta.id}-tune`,
        title: `${String(baseScenario.meta.title).replace(/Template$/, "TuneSpec")}`,
        description: `Tune the greedy preview behavior for ${baseScenario.meta.id}.`,
        tags: ["template", "personal", "idle", "tune"],
      },
      strategy: {
        id: "greedy",
        baseParams: clone(baseScenario.strategy.params),
        space: [
          { path: "maxPicksPerStep", space: { kind: "int", min: 1, max: 3 } },
          { path: "bulk.mode", space: { kind: "choice", values: ["size1", "bestQuote", "maxAffordable"] } },
          { path: "payback.capSec", space: { kind: "int", min: 300, max: 3600 } },
        ],
      },
      objective: {
        id: "pacingBalancedLog10",
        params: {
          targetActionsPerHour: 140,
          actionRateWeight: 1,
          droppedRateWeight: 2,
        },
      },
      runner: {
        seeds: [7, 13, 29],
        budget: 10,
        overrideDurationSec: 1800,
        topK: 4,
        stages: [
          { budget: 5, durationSec: 600, keepTopK: 4, fast: true },
          { budget: 5, durationSec: 1800, keepTopK: 4, fast: true },
        ],
      },
    };
  }
  if (preset === "longrun") {
    return {
      schemaVersion: 1,
      meta: {
        id: `${baseScenario.meta.id}-tune`,
        title: `${String(baseScenario.meta.title).replace(/Template$/, "TuneSpec")}`,
        description: `Tune the planner lookahead for ${baseScenario.meta.id}.`,
        tags: ["template", "personal", "idle", "tune"],
      },
      strategy: {
        id: "planner",
        baseParams: clone(baseScenario.strategy.params),
        space: [
          { path: "horizonSteps", space: { kind: "int", min: 4, max: 8 } },
          { path: "beamWidth", space: { kind: "int", min: 1, max: 3 } },
          { path: "maxBranchingActions", space: { kind: "int", min: 4, max: 8 } },
          { path: "useFastPreview", space: { kind: "bool" } },
        ],
      },
      objective: { id: "endNetWorthLog10" },
      runner: {
        seeds: [7, 13, 29],
        budget: 12,
        overrideDurationSec: 86400,
        topK: 4,
        stages: [
          { budget: 6, durationSec: 14400, keepTopK: 4, fast: true },
          { budget: 6, durationSec: 86400, keepTopK: 4, fast: true },
        ],
      },
    };
  }
  return {
    schemaVersion: 1,
    meta: {
      id: `${baseScenario.meta.id}-tune`,
      title: `${String(baseScenario.meta.title).replace(/Template$/, "TuneSpec")}`,
      description: `Tune the greedy preview behavior for ${baseScenario.meta.id}.`,
      tags: ["template", "personal", "idle", "tune"],
    },
    strategy: {
      id: "greedy",
      baseParams: clone(baseScenario.strategy.params),
      space: [
        {
          path: "maxPicksPerStep",
          space: { kind: "int", min: 1, max: 2 },
        },
        {
          path: "bulk.mode",
          space: { kind: "choice", values: ["size1", "bestQuote", "maxAffordable"] },
        },
        {
          path: "netWorth.horizonSec",
          space: { kind: "int", min: 300, max: 1200 },
        },
        {
          path: "netWorth.useFastPreview",
          space: { kind: "bool" },
        },
      ],
    },
    objective: { id: "endNetWorthLog10" },
    runner: {
      seeds: [7, 13, 29],
      budget: 10,
      overrideDurationSec: 1800,
      topK: 4,
      stages: [
        { budget: 5, durationSec: 600, keepTopK: 4, fast: true },
        { budget: 5, durationSec: 1800, keepTopK: 4, fast: true },
      ],
    },
  };
}

function applyPersonalBundleIdentity(bundle: { base: any; compare: any; tune: any }, args: { stem: string; displayName: string }) {
  bundle.base.meta.id = args.stem;
  bundle.base.meta.title = `${args.displayName} V1 Template`;
  bundle.compare.meta.id = `${args.stem}-compare-b`;
  bundle.compare.meta.title = `${args.displayName} Compare Variant B`;
  bundle.tune.meta.id = `${args.stem}-tune`;
  bundle.tune.meta.title = `${args.displayName} TuneSpec`;
}

export function buildInitTemplatePlan(args: {
  track: TemplateTrack;
  outPath: string;
  preset?: TemplatePreset;
  name?: string;
}): readonly GeneratedTemplateFile[] {
  const track = args.track;
  const preset = resolveTemplatePreset(track, args.preset);
  if (track === "personal") {
    const displayName = args.name?.trim() || titleCaseSlug(normalizeStemFromOutPath(args.outPath).replace(/-v1$/, ""));
    const stemRoot = args.name?.trim() ? slugifyName(args.name) || "my-game" : normalizeStemFromOutPath(args.outPath).replace(/-v1$/, "");
    const stem = `${stemRoot}-v1`;
    const parsed = parse(args.outPath);
    const ext = parsed.ext || ".json";
    const dir = parsed.dir || ".";
    const baseScenario = createPersonalBaseScenario(preset) as any;
    const compareScenario = createPersonalCompareScenario(baseScenario) as any;
    const tuneSpec = createPersonalTuneSpec(preset, baseScenario) as any;
    applyPersonalBundleIdentity({ base: baseScenario, compare: compareScenario, tune: tuneSpec }, { stem, displayName });
    return [
      { kind: "scenario", path: resolve(dir, `${stem}${ext}`), content: baseScenario },
      { kind: "compare", path: resolve(dir, `${stem}-compare-b${ext}`), content: compareScenario },
      { kind: "tune", path: resolve(dir, `${stem}-tune${ext}`), content: tuneSpec },
    ];
  }

  const content = track === "intro"
    ? clone(preset === "session" ? introSession : preset === "builder" ? introBuilder : introLongrun)
    : createDesignScenario(preset);
  return [{ kind: "scenario", path: resolve(args.outPath), content }];
}

export function serializeTemplate(template: unknown): string {
  return `${JSON.stringify(template, null, 2)}\n`;
}

export function buildCanonicalPersonalBuilderExamples(): Readonly<{
  base: unknown;
  compare: unknown;
  tune: unknown;
}> {
  const plan = buildInitTemplatePlan({
    track: "personal",
    preset: "builder",
    outPath: resolve("examples/tutorials/11-my-game-v1.json"),
  });
  return {
    base: plan.find((x) => x.kind === "scenario")!.content,
    compare: plan.find((x) => x.kind === "compare")!.content,
    tune: plan.find((x) => x.kind === "tune")!.content,
  };
}
