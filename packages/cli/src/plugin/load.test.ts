import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { loadRegistries, parsePluginPaths, parsePluginRoots, parsePluginSha256 } from "./load";

describe("plugin load", () => {
  it("parses comma-separated plugin paths", () => {
    const out = parsePluginPaths(" ./a.ts, ./b.ts ,, ./c.ts ", true);
    expect(out).toEqual(["./a.ts", "./b.ts", "./c.ts"]);
  });

  it("requires explicit allow flag for plugin paths", () => {
    expect(() => parsePluginPaths("./a.ts")).toThrow("Plugin loading is disabled by default");
  });

  it("parses plugin root paths as absolute paths", () => {
    const roots = parsePluginRoots("./a,./b");
    expect(roots.length).toBe(2);
    expect(roots.every((x) => x.startsWith("/"))).toBeTrue();
  });

  it("parses plugin sha256 map", () => {
    const parsed = parsePluginSha256("./x.ts=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    const abs = resolve("./x.ts");
    expect(parsed[abs]).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  });

  it("rejects malformed plugin sha256 map entry", () => {
    expect(() => parsePluginSha256("./x.ts:deadbeef")).toThrow("Invalid --plugin-sha256 entry");
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

  it("rejects plugin outside allowed roots", async () => {
    const pluginPath = resolve(process.cwd(), "../../examples/plugins/custom-econ-plugin.ts");
    const outsideRoot = resolve(process.cwd(), "./src");
    await expect(loadRegistries([pluginPath], { allowedRoots: [outsideRoot] })).rejects.toThrow(
      "outside allowed roots",
    );
  });

  it("accepts plugin under allowed roots", async () => {
    const pluginPath = resolve(process.cwd(), "../../examples/plugins/custom-econ-plugin.ts");
    const pluginRoot = resolve(process.cwd(), "../../examples/plugins");
    const loaded = await loadRegistries([pluginPath], { allowedRoots: [pluginRoot] });
    expect(loaded.modelRegistry.get("plugin.generators", 1)).toBeDefined();
  });

  it("rejects plugin on sha256 mismatch", async () => {
    const pluginPath = resolve(process.cwd(), "../../examples/plugins/custom-econ-plugin.ts");
    await expect(
      loadRegistries([pluginPath], {
        requiredSha256: {
          [pluginPath]: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
      }),
    ).rejects.toThrow("sha256 mismatch");
  });

  it("accepts plugin when sha256 matches", async () => {
    const pluginPath = resolve(process.cwd(), "../../examples/plugins/custom-econ-plugin.ts");
    const buf = await readFile(pluginPath);
    const digest = createHash("sha256").update(buf).digest("hex");
    const loaded = await loadRegistries([pluginPath], {
      requiredSha256: {
        [pluginPath]: digest,
      },
    });
    expect(loaded.strategyRegistry.get("plugin.producerFirst")).toBeDefined();
  });
});
