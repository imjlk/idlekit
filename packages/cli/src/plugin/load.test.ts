import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { loadRegistries, parsePluginPaths } from "./load";

describe("plugin load", () => {
  it("parses comma-separated plugin paths", () => {
    const out = parsePluginPaths(" ./a.ts, ./b.ts ,, ./c.ts ");
    expect(out).toEqual(["./a.ts", "./b.ts", "./c.ts"]);
  });

  it("loads model/strategy/objective factories from plugin module", async () => {
    const pluginPath = resolve(process.cwd(), "../../examples/plugins/custom-econ-plugin.ts");
    const loaded = await loadRegistries([pluginPath]);

    expect(loaded.modelRegistry.get("plugin.generators", 1)).toBeDefined();
    expect(loaded.strategyRegistry.get("plugin.producerFirst")).toBeDefined();
    expect(loaded.objectiveRegistry.get("plugin.gemsAndWorthLog10")).toBeDefined();
  });
});
