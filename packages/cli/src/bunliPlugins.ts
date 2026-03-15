import { completionsPlugin } from "@bunli/plugin-completions";
import { CLI_NAME } from "./cliMeta";

const completionsPluginConfig = [
  completionsPlugin as (options?: unknown) => ReturnType<typeof completionsPlugin>,
  {
    commandName: CLI_NAME,
    executable: CLI_NAME,
    includeAliases: true,
    includeGlobalFlags: true,
  },
];

export const bunliPlugins = [completionsPluginConfig] as any[];
