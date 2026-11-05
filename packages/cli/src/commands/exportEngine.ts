import { defineCommand, option } from "../runtime/command";
import { validateScenarioV1 } from "@idlekit/core";
import { z } from "zod";
import { loadRegistriesFromFlags, pluginOptions } from "./_shared/plugin";
import { cliError, scenarioInvalidError, usageError } from "../errors";
import { hashContent } from "../io/outputMeta";
import { readScenarioFile } from "../io/readScenario";
import { assertOutputNotInput } from "../io/writeOutput";
import { writeStdout, writeTextFile } from "../runtime/bun";
import { CLI_VERSION } from "../cliMeta";
import { buildEngineParams } from "../integration/engineParams";
import {
  CSV_TABLES,
  DEFAULT_GODOT_SCRIPT_PATH,
  defaultFileFormat,
  emitEngineFile,
  ENGINE_FILE_FORMATS,
  ENGINE_TARGETS,
  supportedFileFormats,
} from "../integration/emitters";

export default defineCommand({
  name: "engine",
  description: "Export scenario parameters for a game engine (generic JSON, Godot, Unity)",
  options: {
    ...pluginOptions(),
    target: option(z.enum(ENGINE_TARGETS).default("generic"), {
      description: "Target engine (generic|godot|unity)",
    }),
    "file-format": option(z.enum(ENGINE_FILE_FORMATS).optional(), {
      description: "File format: generic=json, godot=tres|json, unity=json|csv (default: first listed)",
    }),
    levels: option(z.coerce.number().int().min(0).max(100000).default(50), {
      description: "Rows of the level price table for the built-in linear model (0 disables it)",
    }),
    "csv-table": option(z.enum(CSV_TABLES).default("auto"), {
      description: "CSV table for --target unity --file-format csv (auto|levels|parameters)",
    }),
    "godot-script": option(z.string().default(DEFAULT_GODOT_SCRIPT_PATH), {
      description: "res:// path of the IdlekitEconomy script a Godot .tres references",
    }),
    out: option(z.string().optional(), { description: "Output path (stdout when omitted)" }),
  },
  async handler({ flags, positional }) {
    const scenarioPath = positional[0];
    if (!scenarioPath) {
      throw usageError(
        "Usage: idk export engine <scenario> --target generic|godot|unity [--file-format json|tres|csv] [--out <path>]",
      );
    }
    const fileFormat = flags["file-format"] ?? defaultFileFormat(flags.target);
    if (!supportedFileFormats(flags.target).includes(fileFormat)) {
      throw usageError(
        `--target ${flags.target} does not support --file-format ${fileFormat}.`,
        `Use one of: ${supportedFileFormats(flags.target).join(", ")}.`,
      );
    }

    const input = await readScenarioFile(scenarioPath);
    const loaded = await loadRegistriesFromFlags(flags);
    const valid = validateScenarioV1(input, loaded.modelRegistry, loaded.strategyRegistry);
    if (!valid.ok || !valid.scenario) throw scenarioInvalidError(valid.issues);

    const doc = buildEngineParams({
      scenario: valid.scenario,
      registry: loaded.modelRegistry,
      scenarioHash: hashContent(valid.scenario),
      cliVersion: CLI_VERSION,
      levels: flags.levels,
    });
    let body: string;
    try {
      body = emitEngineFile({
        doc,
        target: flags.target,
        fileFormat,
        csvTable: flags["csv-table"],
        godotScriptPath: flags["godot-script"],
      });
    } catch (error) {
      throw cliError("CLI_USAGE", error instanceof Error ? error.message : String(error));
    }

    if (!flags.out) {
      await writeStdout(body);
      return;
    }
    const abs = await assertOutputNotInput(flags.out, { protectedInputs: [scenarioPath] });
    await writeTextFile(abs, body);
    console.log(`Wrote ${flags.target} ${fileFormat} export to ${abs}`);
    for (const note of doc.notes) console.warn(`[note] ${note}`);
  },
});
