import { defineCommand, option } from "../runtime/command";
import { extname, resolve } from "path";
import { validateScenarioV1 } from "@idlekit/core";
import YAML from "yaml";
import { z } from "zod";
import { loadRegistriesFromFlags, pluginOptions } from "./_shared/plugin";
import { cliError, scenarioInvalidError, usageError } from "../errors";
import { printNextSteps } from "../io/nextSteps";
import { assertOutputNotInput } from "../io/writeOutput";
import { readTextFile, writeStdout, writeTextFile } from "../runtime/bun";
import { isEngineParamsDocument } from "../integration/engineParams";
import {
  importMappingSchema,
  importScenarioFromEngineParams,
  importScenarioWithMapping,
  parseCsv,
  type ImportResult,
} from "../integration/scenarioImport";

async function readTable(path: string): Promise<unknown> {
  const abs = resolve(path);
  const raw = await readTextFile(abs).catch((error) => {
    throw cliError("SCENARIO_READ_FAILED", `Failed to read ${abs}`, { cause: error, detail: String(error) });
  });
  const ext = extname(abs).toLowerCase();
  try {
    if (ext === ".csv") return parseCsv(raw);
    if (ext === ".yaml" || ext === ".yml") return YAML.parse(raw);
    return JSON.parse(raw);
  } catch (error) {
    throw cliError("SCENARIO_READ_FAILED", `Failed to parse ${abs}`, {
      cause: error,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default defineCommand({
  name: "scenario",
  description: "Convert a game economy table (CSV/JSON/YAML) to a ScenarioV1 file with a mapping",
  options: {
    ...pluginOptions(),
    mapping: option(z.string().optional(), {
      description: "Import mapping file (idlekit.import-mapping v1). Optional for an idlekit.engine-params input",
    }),
    id: option(z.string().optional(), { description: "Override the scenario id" }),
    out: option(z.string().optional(), { description: "Scenario output path (stdout when omitted)" }),
    "report-out": option(z.string().optional(), { description: "Write the import report JSON here" }),
  },
  async handler({ flags, positional }) {
    const tablePath = positional[0];
    if (!tablePath) {
      throw usageError("Usage: idk import scenario <table.(csv|json|yaml)> --mapping <mapping.json> [--out scenario.json]");
    }
    const table = await readTable(tablePath);

    let result: ImportResult;
    if (flags.mapping) {
      const parsed = importMappingSchema.safeParse(await readTable(flags.mapping));
      if (!parsed.success) {
        throw cliError("CLI_USAGE", "Import mapping invalid.", {
          detail: parsed.error.issues.map((i) => `${i.path.join(".") || "/"}: ${i.message}`).join("; "),
          hint: "See docs/schemas/import-mapping.v1.schema.json.",
        });
      }
      const mapping = flags.id ? { ...parsed.data, scenario: { ...parsed.data.scenario, id: flags.id } } : parsed.data;
      try {
        result = importScenarioWithMapping(table, mapping);
      } catch (error) {
        throw cliError("CLI_USAGE", `Import failed: ${message(error)}`);
      }
    } else if (isEngineParamsDocument(table)) {
      result = importScenarioFromEngineParams(table, { id: flags.id });
    } else {
      throw usageError("--mapping is required unless the input is an idlekit.engine-params document.");
    }

    // The import is only useful if `idk validate` accepts it, so check with the same registries.
    const loaded = await loadRegistriesFromFlags(flags);
    const valid = validateScenarioV1(result.scenario, loaded.modelRegistry, loaded.strategyRegistry);
    if (!valid.ok) throw scenarioInvalidError(valid.issues, "produced by import");

    const body = `${JSON.stringify(result.scenario, null, 2)}\n`;
    const protectedInputs = [tablePath, ...(flags.mapping ? [flags.mapping] : [])];
    if (flags["report-out"]) {
      const reportAbs = await assertOutputNotInput(flags["report-out"], { protectedInputs });
      await writeTextFile(reportAbs, `${JSON.stringify(result.report, null, 2)}\n`);
    }
    if (!flags.out) {
      await writeStdout(body);
      for (const warning of result.report.warnings) console.warn(`[warn] ${warning}`);
      return;
    }
    const abs = await assertOutputNotInput(flags.out, { protectedInputs });
    await writeTextFile(abs, body);
    console.log(`Wrote scenario ${result.report.scenarioId} (${result.report.model}) to ${abs}`);
    for (const fit of Object.entries(result.report.fits)) {
      const [name, f] = fit;
      if (!f) continue;
      console.log(`- ${name} fit: ${f.kind} over ${f.rows} rows, r2=${f.r2}, max relative error=${f.maxRelError}`);
    }
    for (const warning of result.report.warnings) console.warn(`[warn] ${warning}`);
    printNextSteps({
      steps: [
        { label: "validate", command: `idk validate ${flags.out}` },
        { label: "simulate", command: `idk simulate ${flags.out} --format json` },
      ],
    });
  },
});
