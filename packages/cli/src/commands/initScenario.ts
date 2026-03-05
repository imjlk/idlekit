import { defineCommand, option } from "@bunli/core";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
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

export default defineCommand({
  name: "scenario",
  description: "Generate a starter scenario template",
  options: {
    out: option(z.string().default("./tmp/new-scenario.json"), { description: "Output scenario path" }),
    track: option(z.enum(["intro", "design"]).default("intro"), {
      description: "Template track (intro|design)",
    }),
    force: option(z.coerce.boolean().default(false), {
      description: "Overwrite output file when already exists",
    }),
  },
  async handler({ flags }) {
    const outPath = resolve(process.cwd(), flags.out);
    const template = flags.track === "design" ? designTemplate : introTemplate;

    const exists = await stat(outPath).then(() => true).catch(() => false);
    if (exists && !flags.force) {
      throw new Error(`Output file already exists: ${outPath}. Pass --force true to overwrite.`);
    }

    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(template, null, 2)}\n`, "utf8");

    console.log(`Wrote scenario template (${flags.track}) to ${outPath}`);
    if (flags.track === "design") {
      console.log("Note: design track template requires plugin.generators/plugin.producerFirst.");
    }
  },
});
