import { defineCommand, option } from "../runtime/command";
import { validateScenarioV1 } from "@idlekit/core";
import { z } from "zod";
import { loadRegistriesFromFlags, pluginOptions } from "./_shared/plugin";
import { cliError, scenarioInvalidError, usageError } from "../errors";
import { buildOutputMeta, deriveDeterministicSeed } from "../io/outputMeta";
import { readScenarioFile } from "../io/readScenario";
import { writeOutput } from "../io/writeOutput";
import {
  renderRuntimeVerifyMarkdown,
  RUNTIME_VERIFY_SCHEMA_REF,
  verifyRuntime,
} from "../integration/runtimeVerify";

export default defineCommand({
  name: "runtime",
  description: "Compare a game runtime's income/cost functions (plugin runtimes) with the idlekit simulation",
  options: {
    ...pluginOptions(),
    runtime: option(z.string().optional(), {
      description: "Runtime adapter id from a plugin 'runtimes' export (default: the only one loaded)",
    }),
    seed: option(z.coerce.number().int().min(0).max(0xffffffff).optional(), {
      description: "Seed passed to ctx.seed and to the runtime init (default: derived from the scenario and runtime id)",
    }),
    duration: option(z.coerce.number().positive().optional(), { description: "Simulated seconds (default: clock.durationSec)" }),
    "trace-every": option(z.coerce.number().int().positive().default(1), { description: "Probe every N steps" }),
    "rel-tolerance": option(z.coerce.number().min(0).default(1e-9), { description: "Relative tolerance" }),
    "abs-tolerance": option(z.coerce.number().min(0).default(0), { description: "Absolute tolerance" }),
    "max-rows": option(z.coerce.number().int().min(0).default(20), { description: "Mismatch rows kept in the report" }),
    "fail-on-mismatch": option(z.coerce.boolean().default(true), {
      description: "Exit with code 1 when a probe is outside the tolerance",
    }),
    out: option(z.string().optional(), { description: "Output path" }),
    format: option(z.enum(["json", "md"]).default("json"), { description: "Output format" }),
  },
  async handler({ flags, positional }) {
    const scenarioPath = positional[0];
    if (!scenarioPath) {
      throw usageError(
        "Usage: idk verify runtime <scenario> --plugin <runtime-plugin.ts> --allow-plugin true [--runtime <id>] [--seed N]",
      );
    }
    const input = await readScenarioFile(scenarioPath);
    const loaded = await loadRegistriesFromFlags(flags);
    const valid = validateScenarioV1(input, loaded.modelRegistry, loaded.strategyRegistry);
    if (!valid.ok || !valid.scenario) throw scenarioInvalidError(valid.issues);

    const adapters = loaded.runtimeAdapters ?? [];
    if (adapters.length === 0) {
      throw usageError(
        "No runtime adapter is loaded.",
        "Pass a plugin that exports `runtimes` with --plugin <path> --allow-plugin true. See docs/engine-integration.md.",
      );
    }
    const adapter = flags.runtime ? adapters.find((x) => x.id === flags.runtime) : adapters.length === 1 ? adapters[0] : undefined;
    if (!adapter) {
      throw usageError(
        flags.runtime ? `Unknown runtime adapter: ${flags.runtime}` : "Several runtime adapters are loaded; choose one with --runtime.",
        `Loaded: ${adapters.map((x) => x.id).join(", ")}`,
      );
    }

    const seed =
      flags.seed ??
      deriveDeterministicSeed({ command: "verify.runtime", scenario: valid.scenario, runtime: adapter.id });
    let report;
    try {
      report = verifyRuntime({
        scenario: valid.scenario,
        modelRegistry: loaded.modelRegistry,
        strategyRegistry: loaded.strategyRegistry,
        adapter,
        seed,
        tolerance: { relative: flags["rel-tolerance"], absolute: flags["abs-tolerance"] },
        traceEvery: flags["trace-every"],
        durationSec: flags.duration,
        maxRows: flags["max-rows"],
      });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error) throw error;
      throw cliError("INTERNAL_ERROR", `Runtime verification failed: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
      });
    }

    await writeOutput({
      format: flags.format,
      outPath: flags.out,
      data: flags.format === "md" ? renderRuntimeVerifyMarkdown(report) : report,
      protectedInputs: [scenarioPath],
      meta: buildOutputMeta({
        command: "verify.runtime",
        seed,
        scenarioPath,
        scenario: valid.scenario,
        pluginDigest: loaded.pluginDigest,
        schemaRef: RUNTIME_VERIFY_SCHEMA_REF,
      }),
    });
    if (!report.ok && flags["fail-on-mismatch"]) {
      console.error(
        `Runtime ${adapter.id} differs from the idlekit model: ${report.metrics.reduce((n, m) => n + m.mismatches, 0)} mismatch(es). First: ${
          report.firstMismatch ? `${report.firstMismatch.metric} at t=${report.firstMismatch.t}` : "n/a"
        }.`,
      );
      process.exitCode = 1;
    }
  },
});
