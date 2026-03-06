import { option } from "@bunli/core";
import { z } from "zod";
import { loadRegistries, parsePluginPaths, parsePluginSecurityOptions } from "../../plugin/load";

export type PluginOptionFlags = Readonly<{
  plugin: string;
  "allow-plugin": boolean;
  "plugin-root": string;
  "plugin-sha256": string;
  "plugin-trust-file": string;
}>;

export function pluginOptions() {
  return {
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
    "plugin-trust-file": option(z.string().default(""), {
      description: "Plugin trust policy json file path",
    }),
  } as const;
}

export function loadRegistriesFromFlags(flags: PluginOptionFlags) {
  return loadRegistries(
    parsePluginPaths(flags.plugin, flags["allow-plugin"]),
    parsePluginSecurityOptions({
      roots: flags["plugin-root"],
      sha256: flags["plugin-sha256"],
      trustFile: flags["plugin-trust-file"],
    }),
  );
}
