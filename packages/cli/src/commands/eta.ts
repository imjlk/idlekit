import { defineCommand, option } from "@bunli/core";
import {
  compileScenario,
  createNumberEngine,
  etaAnalytic,
  etaSimulate,
  validateScenarioV1,
} from "@idlekit/core";
import { z } from "zod";
import { readScenarioFile } from "../io/readScenario";
import { writeOutput } from "../io/writeOutput";
import { loadRegistries, parsePluginPaths, parsePluginSecurityOptions } from "../plugin/load";

export default defineCommand({
  name: "eta",
  description: "Estimate time to target money or net worth",
  options: {
    plugin: option(z.string().default(""), { description: "Comma-separated plugin paths" }),
    "allow-plugin": option(z.coerce.boolean().default(false), {
      description: "Allow loading local plugin modules",
    }),
    "plugin-root": option(z.string().default(""), {
      description: "Comma-separated allowed plugin root directories",
    }),
    "plugin-sha256": option(z.string().default(""), {
      description: "Comma-separated '<path>=<sha256>' plugin integrity map",
    }),
    "target-money": option(z.string().optional(), { description: "Target money NumStr" }),
    "target-worth": option(z.string().optional(), { description: "Target net worth NumStr" }),
    mode: option(z.enum(["simulate", "analytic"]).default("simulate"), { description: "ETA mode" }),
    diff: option(z.enum(["simulate", "analytic"]).optional(), {
      description: "Compare with another mode",
    }),
    "max-duration": option(z.coerce.number().default(86400), { description: "Max simulate duration" }),
    "include-run": option(z.coerce.boolean().default(false), {
      description: "Include detailed run payload in simulate mode output",
    }),
    fast: option(z.coerce.boolean().default(false), { description: "Fast simulation mode" }),
    out: option(z.string().optional(), { description: "Output path" }),
    format: option(z.enum(["json", "md", "csv"]).default("json"), { description: "Output format" }),
  },
  async handler({ flags, positional }) {
    const scenarioPath = positional[0];
    if (!scenarioPath) {
      throw new Error("Usage: idk eta <scenario> --target-money <NumStr> | --target-worth <NumStr>");
    }

    const targetMoney = flags["target-money"];
    const targetWorth = flags["target-worth"];
    const maxDuration = flags["max-duration"];

    const hasMoney = !!targetMoney;
    const hasWorth = !!targetWorth;
    if ((hasMoney ? 1 : 0) + (hasWorth ? 1 : 0) !== 1) {
      throw new Error("Exactly one target is required: --target-money or --target-worth");
    }

    const target = hasMoney
      ? ({ kind: "money", value: targetMoney! } as const)
      : ({ kind: "netWorth", value: targetWorth! } as const);

    const input = await readScenarioFile(scenarioPath);
    const loaded = await loadRegistries(
      parsePluginPaths(flags.plugin, flags["allow-plugin"]),
      parsePluginSecurityOptions({
        roots: flags["plugin-root"],
        sha256: flags["plugin-sha256"],
      }),
    );
    const valid = validateScenarioV1(input, loaded.modelRegistry);
    if (!valid.ok || !valid.scenario) {
      throw new Error(
        `Scenario invalid: ${valid.issues.map((i) => `${i.path ?? "root"}: ${i.message}`).join("; ")}`,
      );
    }

    const E = createNumberEngine();
    const compiled = compileScenario<number, string, Record<string, unknown>>({
      E,
      scenario: valid.scenario,
      registry: loaded.modelRegistry,
      strategyRegistry: loaded.strategyRegistry,
      opts: { allowSuffixNotation: true },
    });

    const scenarioInput = {
      ...compiled,
      run: {
        ...compiled.run,
        eventLog: flags["include-run"]
          ? compiled.run.eventLog
          : {
              enabled: false,
              maxEvents: 0,
            },
        fast: flags.fast
          ? { enabled: true, kind: "log-domain" as const, disableMoneyEvents: true }
          : compiled.run.fast,
      },
    };

    const primary =
      flags.mode === "analytic"
        ? etaAnalytic({ scenario: scenarioInput, target })
        : etaSimulate({
            scenario: scenarioInput,
            target,
            maxDurationSec: maxDuration,
            includeRun: flags["include-run"],
          });

    let output: typeof primary = primary;
    if (flags.diff) {
      const secondary =
        flags.diff === "analytic"
          ? etaAnalytic({ scenario: scenarioInput, target })
          : etaSimulate({
              scenario: scenarioInput,
              target,
              maxDurationSec: maxDuration,
              includeRun: false,
            });

      const diffSec = secondary.seconds - primary.seconds;
      output = {
        ...primary,
        compare: {
          simulateSec: flags.mode === "simulate" ? primary.seconds : secondary.seconds,
          analyticSec: flags.mode === "analytic" ? primary.seconds : secondary.seconds,
          diffSec,
          diffPct: primary.seconds !== 0 ? (diffSec / primary.seconds) * 100 : undefined,
        },
      };
    }

    await writeOutput({
      format: flags.format,
      outPath: flags.out,
      data: output,
    });
  },
});
