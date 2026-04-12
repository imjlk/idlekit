import { completionsPlugin } from "@bunli/plugin-completions";
import { CLI_NAME } from "./cliMeta";

const generatedMetadataPath = new URL("../.bunli/commands.gen.ts", import.meta.url).pathname;

const completionsPluginConfig = [
  completionsPlugin as (options?: unknown) => ReturnType<typeof completionsPlugin>,
  {
    commandName: CLI_NAME,
    executable: CLI_NAME,
    generatedPath: generatedMetadataPath,
    includeAliases: true,
    includeGlobalFlags: true,
  },
];

export const bunliPlugins = [completionsPluginConfig] as any[];
