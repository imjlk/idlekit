import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { loadRegistries, parsePluginPaths } from "./load";

describe("plugin load", () => {
  it("parses comma-separated plugin paths", () => {
    const out = parsePluginPaths(" ./a.ts, ./b.ts ,, ./c.ts ", true);
    expect(out).toEqual(["./a.ts", "./b.ts", "./c.ts"]);
  });

  it("requires explicit allow flag for plugin paths", () => {
    expect(() => parsePluginPaths("./a.ts")).toThrow("Plugin loading is disabled by default");
  });

  it("loads model/strategy/objective factories from plugin module", async () => {
    const pluginPath = resolve(process.cwd(), "../../examples/plugins/custom-econ-plugin.ts");
    const loaded = await loadRegistries([pluginPath]);

    expect(loaded.modelRegistry.get("plugin.generators", 1)).toBeDefined();
    expect(loaded.strategyRegistry.get("plugin.producerFirst")).toBeDefined();
    expect(loaded.objectiveRegistry.get("plugin.gemsAndWorthLog10")).toBeDefined();
  });

  it("rejects non-local plugin paths", async () => {
    await expect(loadRegistries(["https://example.com/plugin.ts"])).rejects.toThrow(
      "Plugin path must be a local file path",
    );
  });

  it("rejects unsupported plugin file extension", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "idlekit-plugin-test-"));
    const invalidPath = resolve(dir, "plugin.txt");
    await writeFile(invalidPath, "export default {}", "utf8");

    await expect(loadRegistries([invalidPath])).rejects.toThrow("Unsupported plugin extension");
    await rm(dir, { recursive: true, force: true });
  });
});
