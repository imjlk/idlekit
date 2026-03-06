import { defineCommand, option } from "@bunli/core";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";
import { z } from "zod";

const introTemplate = {
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

const designTemplate = {
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

const personalTemplate = {
  schemaVersion: 1,
  meta: {
    id: "my-game-v1",
    title: "My Game V1 Template",
    description: "Personal starter scenario. Rename the unit, adjust the growth curve, then compare and tune.",
    tags: ["template", "personal", "idle", "design-first"],
  },
  unit: { code: "TOKEN", symbol: "T" },
  policy: { mode: "accumulate", maxLogGap: 14 },
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
    wallet: { unit: "TOKEN", amount: "35", bucket: "0" },
    vars: { owned: 0 },
    prestige: { count: 0, points: "0", multiplier: "1" },
  },
  clock: { stepSec: 1, durationSec: 3600 },
  strategy: {
    id: "greedy",
    params: {
      schemaVersion: 1,
      objective: "maximizeNetWorth",
      maxPicksPerStep: 1,
      bulk: { mode: "bestQuote" },
      netWorth: {
        horizonSec: 600,
        series: "netWorth",
        useFastPreview: true,
      },
    },
  },
  analysis: {
    eta: { mode: "analytic" },
    growth: { windowSec: 60 },
  },
  monetization: {
    cohorts: { baseUsers: 5000 },
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
    acquisition: { cpi: 1.5 },
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
} as const;

const personalCompareTemplate = {
  schemaVersion: 1,
  meta: {
    id: "my-game-v1-compare-b",
    title: "My Game V1 Compare Variant B",
    description: "A/B comparison variant for the personal starter. Slightly faster opening, tighter long-tail growth.",
    tags: ["template", "personal", "idle", "compare"],
  },
  unit: { code: "TOKEN", symbol: "T" },
  policy: { mode: "accumulate", maxLogGap: 14 },
  model: {
    id: "linear",
    version: 1,
    params: {
      incomePerSec: "1.9",
      buyCostBase: "16",
      buyCostGrowth: 1.17,
      buyIncomeDelta: "1.05",
    },
  },
  initial: {
    t: 0,
    wallet: { unit: "TOKEN", amount: "35", bucket: "0" },
    vars: { owned: 0 },
    prestige: { count: 0, points: "0", multiplier: "1" },
  },
  clock: { stepSec: 1, durationSec: 3600 },
  strategy: {
    id: "greedy",
    params: {
      schemaVersion: 1,
      objective: "maximizeNetWorth",
      maxPicksPerStep: 1,
      bulk: { mode: "bestQuote" },
      netWorth: {
        horizonSec: 600,
        series: "netWorth",
        useFastPreview: true,
      },
    },
  },
  analysis: {
    eta: { mode: "analytic" },
    growth: { windowSec: 60 },
  },
  monetization: personalTemplate.monetization,
  sim: personalTemplate.sim,
  outputs: personalTemplate.outputs,
} as const;

const personalTuneTemplate = {
  schemaVersion: 1,
  meta: {
    id: "my-game-v1-tune",
    title: "My Game V1 TuneSpec",
    description: "Tune the greedy preview behavior for the personal starter.",
    tags: ["template", "personal", "idle", "tune"],
  },
  strategy: {
    id: "greedy",
    baseParams: {
      schemaVersion: 1,
      objective: "maximizeNetWorth",
      maxPicksPerStep: 1,
      bulk: { mode: "bestQuote" },
      netWorth: {
        horizonSec: 600,
        series: "netWorth",
        useFastPreview: true,
      },
    },
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
      {
        budget: 5,
        durationSec: 600,
        keepTopK: 4,
        fast: true,
      },
      {
        budget: 5,
        durationSec: 1800,
        keepTopK: 4,
        fast: true,
      },
    ],
  },
} as const;

function serializeTemplate(template: unknown): string {
  return `${JSON.stringify(template, null, 2)}\n`;
}

async function ensureWritable(path: string, force: boolean): Promise<void> {
  const exists = await stat(path).then(() => true).catch(() => false);
  if (exists && !force) {
    throw new Error(`Output file already exists: ${path}. Pass --force true to overwrite.`);
  }
}

function buildPersonalBundlePaths(outPath: string): Readonly<{
  base: string;
  compare: string;
  tune: string;
}> {
  const parsed = parse(outPath);
  const ext = parsed.ext || ".json";
  const baseName = parsed.ext ? parsed.name : parsed.base;
  return {
    base: outPath,
    compare: resolve(parsed.dir, `${baseName}-compare-b${ext}`),
    tune: resolve(parsed.dir, `${baseName}-tune${ext}`),
  };
}

export default defineCommand({
  name: "scenario",
  description: "Generate a starter scenario template",
  options: {
    out: option(z.string().default("./tmp/new-scenario.json"), {
      description: "Output scenario path (personal track also writes compare/tune siblings)",
    }),
    track: option(z.enum(["intro", "design", "personal"]).default("intro"), {
      description: "Template track (intro|design|personal)",
    }),
    force: option(z.coerce.boolean().default(false), {
      description: "Overwrite output file when already exists",
    }),
  },
  async handler({ flags }) {
    const outPath = resolve(process.cwd(), flags.out);
    if (flags.track === "personal") {
      const bundle = buildPersonalBundlePaths(outPath);
      await Promise.all([
        ensureWritable(bundle.base, flags.force),
        ensureWritable(bundle.compare, flags.force),
        ensureWritable(bundle.tune, flags.force),
      ]);
      await mkdir(dirname(bundle.base), { recursive: true });
      await Promise.all([
        writeFile(bundle.base, serializeTemplate(personalTemplate), "utf8"),
        writeFile(bundle.compare, serializeTemplate(personalCompareTemplate), "utf8"),
        writeFile(bundle.tune, serializeTemplate(personalTuneTemplate), "utf8"),
      ]);

      console.log("Wrote personal scenario bundle:");
      console.log(`- base: ${bundle.base}`);
      console.log(`- compare: ${bundle.compare}`);
      console.log(`- tune: ${bundle.tune}`);
      return;
    }

    const template = flags.track === "design" ? designTemplate : introTemplate;
    await ensureWritable(outPath, flags.force);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, serializeTemplate(template), "utf8");

    console.log(`Wrote scenario template (${flags.track}) to ${outPath}`);
    if (flags.track === "design") {
      console.log("Note: design track template requires plugin.generators/plugin.producerFirst.");
    }
  },
});
