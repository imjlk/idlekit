import { defineCommand, option } from "@bunli/core";
import { resolve } from "path";
import { z } from "zod";
import { cliError, unsupportedFlagForTrackError } from "../errors";
import { printNextSteps } from "../io/nextSteps";
import { runInitWizard } from "../lib/initWizard";
import { fileExists, writeTextFile } from "../runtime/bun";
import {
  buildInitTemplatePlan,
  serializeTemplate,
  TEMPLATE_PRESETS,
  TEMPLATE_TRACKS,
  type GeneratedTemplateFile,
} from "../templates/scenario";

type Track = (typeof TEMPLATE_TRACKS)[number];
type Preset = (typeof TEMPLATE_PRESETS)[number];

async function ensureWritable(path: string, force: boolean): Promise<void> {
  const exists = await fileExists(path);
  if (!exists || force) return;
  throw cliError("CLI_USAGE", `Output file already exists: ${path}`, {
    hint: "Pass --force true to overwrite.",
  });
}

function describeBundle(files: readonly GeneratedTemplateFile[]): string[] {
  return files.map((file) => `- ${file.kind}: ${file.path}`);
}

export default defineCommand({
  name: "scenario",
  description: "Generate a starter scenario template",
  options: {
    out: option(z.string().default("./tmp/new-scenario.json"), {
      description: "Output scenario path (personal track also writes compare/tune siblings)",
    }),
    track: option(z.enum(TEMPLATE_TRACKS).default("intro"), {
      description: "Template track (intro|design|personal)",
    }),
    preset: option(z.enum(TEMPLATE_PRESETS).optional(), {
      description: "Template preset (session|builder|longrun)",
    }),
    name: option(z.string().optional(), {
      description: "Optional personal track name. Changes generated file stem + meta id/title.",
    }),
    wizard: option(z.coerce.boolean().default(false), {
      description: "Launch an interactive wizard for template customization",
    }),
    force: option(z.coerce.boolean().default(false), {
      description: "Overwrite output file when already exists",
    }),
  },
  async handler({ flags, prompt, terminal, runtime }) {
    const outPath = resolve(process.cwd(), flags.out);
    const wizard = flags.wizard;
    const wizardResult = wizard
      ? await runInitWizard({
          prompt,
          terminal,
          runtimeArgs: runtime.args,
          outPath,
          initialTrack: flags.track as Track,
          initialPreset: flags.preset as Preset | undefined,
          initialName: flags.name,
        })
      : undefined;
    const track = wizardResult?.track ?? (flags.track as Track);
    const preset = wizardResult?.preset ?? (flags.preset as Preset | undefined);
    const bundleName = wizardResult?.name ?? flags.name;

    if (bundleName && track !== "personal") {
      throw unsupportedFlagForTrackError("--name", track);
    }

    const files = buildInitTemplatePlan({
      track,
      preset,
      outPath,
      name: bundleName,
      overrides: wizardResult?.overrides,
    });

    await Promise.all(files.map((file) => ensureWritable(file.path, flags.force)));
    await Promise.all(files.map((file) => writeTextFile(file.path, serializeTemplate(file.content))));

    if (track === "personal") {
      console.log("Wrote personal scenario bundle:");
      for (const line of describeBundle(files)) console.log(line);
      const base = files.find((file) => file.kind === "scenario");
      if (base) {
        printNextSteps({
          steps: [
            { label: "validate", command: `idk validate ${base.path}` },
            { label: "simulate", command: `idk simulate ${base.path} --format json` },
            { label: "experience", command: `idk experience ${base.path} --format md` },
          ],
        });
      }
      return;
    }

    console.log(`Wrote scenario template (${track}/${preset ?? "default"}) to ${files[0]!.path}`);
    if (wizard) {
      console.log("Wizard overrides applied to unit/design/economy fields.");
    }
    if (track === "design") {
      console.log("Note: design track template requires plugin.generators/plugin.producerFirst.");
    }
    printNextSteps({
      steps: [
        { label: "validate", command: `idk validate ${files[0]!.path}` },
        { label: "simulate", command: `idk simulate ${files[0]!.path} --format json` },
        { label: "experience", command: `idk experience ${files[0]!.path} --format md` },
      ],
    });
  },
});
