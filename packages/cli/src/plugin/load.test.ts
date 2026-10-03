import { describe, expect, it } from "bun:test";
import { relative, resolve } from "path";
import type { ScenarioV1 } from "@idlekit/core";
import { loadRegistries, parsePluginPaths, parsePluginRoots, parsePluginSecurityOptions, parsePluginSha256 } from "./load";
import { prepareResolvedRun } from "../lib/runConfiguration";
import { createTempDir, readText, removePath, sha256Hex, writeText } from "../testkit/bun";

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
    const dir = await createTempDir("idlekit-plugin-test");
    const invalidPath = resolve(dir, "plugin.txt");
    await writeText(invalidPath, "export default {}");

    await expect(loadRegistries([invalidPath])).rejects.toThrow("Unsupported plugin extension");
    await removePath(dir);
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
    const digest = sha256Hex(await readText(pluginPath));
    const loaded = await loadRegistries([pluginPath], {
      requiredSha256: {
        [pluginPath]: digest,
      },
    });
    expect(loaded.strategyRegistry.get("plugin.producerFirst")).toBeDefined();
  });

  it("loads plugin trust policy file and enforces sha256", async () => {
    const pluginPath = resolve(process.cwd(), "../../examples/plugins/custom-econ-plugin.ts");
    const digest = sha256Hex(await readText(pluginPath));

    const dir = await createTempDir("idlekit-plugin-trust");
    try {
      const trustPath = resolve(dir, "trust.json");
      await writeText(
        trustPath,
        `${JSON.stringify({
          plugins: {
            [pluginPath]: digest,
          },
        })}\n`,
      );

      const parsed = parsePluginSecurityOptions({
        trustFile: trustPath,
      });
      const loaded = await loadRegistries([pluginPath], parsed);
      expect(loaded.strategyRegistry.get("plugin.producerFirst")).toBeDefined();
    } finally {
      await removePath(dir);
    }
  });

  it("trust file supports relative paths resolved from trust file directory", async () => {
    const pluginPath = resolve(process.cwd(), "../../examples/plugins/custom-econ-plugin.ts");
    const digest = sha256Hex(await readText(pluginPath));

    const dir = await createTempDir("idlekit-plugin-trust-relative");
    try {
      const trustPath = resolve(dir, "trust.json");
      const relToPlugin = relative(dir, pluginPath);
      await writeText(
        trustPath,
        `${JSON.stringify({
          plugins: {
            [relToPlugin]: digest,
          },
        })}\n`,
      );

      const loaded = await loadRegistries([pluginPath], { trustFile: trustPath });
      expect(loaded.modelRegistry.get("plugin.generators", 1)).toBeDefined();
    } finally {
      await removePath(dir);
    }
  });

  it("fails closed when trust-file and cli sha policy conflict", async () => {
    const pluginPath = resolve(process.cwd(), "../../examples/plugins/custom-econ-plugin.ts");
    const digest = sha256Hex(await readText(pluginPath));
    const wrongDigest = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    const dir = await createTempDir("idlekit-plugin-trust-conflict");
    try {
      const trustPath = resolve(dir, "trust.json");
      await writeText(
        trustPath,
        `${JSON.stringify({
          plugins: {
            [pluginPath]: digest,
          },
        })}\n`,
      );

      await expect(
        loadRegistries([pluginPath], {
          trustFile: trustPath,
          requiredSha256: {
            [pluginPath]: wrongDigest,
          },
        }),
      ).rejects.toThrow("Conflicting sha256 policy");
    } finally {
      await removePath(dir);
    }
  });

  it("digests the helpers a plugin reaches through local imports", async () => {
    const dir = await createTempDir("idlekit-plugin-closure");
    try {
      const entry = `import { tag } from "./impl";\nexport const strategies = [{ id: "plugin.helper", tag, create: () => ({ id: "plugin.helper", decide: () => [] }) }];\n`;
      const plugin = async (name: string, implTag: string) => {
        const path = resolve(dir, name, "plugin.mjs");
        await writeText(path, entry);
        await writeText(resolve(dir, name, "impl.mjs"), `export { tag } from "./lib";\n`);
        await writeText(resolve(dir, name, "lib/index.mjs"), `export const tag = "${implTag}";\n`);
        return path;
      };
      const scenario: ScenarioV1 = {
        schemaVersion: 1,
        unit: { code: "COIN" },
        policy: { mode: "drop" },
        model: { id: "linear", version: 1, params: {} },
        initial: { wallet: { unit: "COIN", amount: "0" } },
        clock: { stepSec: 1, durationSec: 1 },
        strategy: { id: "plugin.helper" },
      };
      const run = async (path: string) => {
        const loaded = await loadRegistries([path]);
        const digest = loaded.pluginDigest[path]!;
        const hash = prepareResolvedRun({ scenario, ...loaded, seed: 1 }).open("simulate", "x").hash;
        return { digest, hash };
      };

      const a = await plugin("a", "one");
      const before = await run(a);
      expect(before.digest).not.toBe(sha256Hex(entry));
      await writeText(resolve(dir, "a", "lib/index.mjs"), `export const tag = "two";\n`);
      const after = await run(a);
      // Only the helper changed, so the entry file sha256 is the same.
      expect(after.digest).not.toBe(before.digest);
      expect(after.hash).not.toBe(before.hash);

      // Identical entries in two directories with different helpers.
      const b = await plugin("b", "one");
      const c = await plugin("c", "three");
      const copy = await run(b);
      expect(copy.digest).toBe(before.digest);
      expect(copy.hash).toBe(before.hash);
      expect((await run(c)).digest).not.toBe(copy.digest);

      // An absolute local import is followed the same way.
      const shared = resolve(dir, "shared", "helper.mjs");
      await writeText(shared, `export const tag = "one";\n`);
      const absolute = resolve(dir, "abs", "plugin.mjs");
      await writeText(
        absolute,
        `import { tag } from ${JSON.stringify(shared)};\nexport const strategies = [{ id: "plugin.helper", tag, create: () => ({ id: "plugin.helper", decide: () => [] }) }];\n`,
      );
      const absBefore = await run(absolute);
      await writeText(shared, `export const tag = "two";\n`);
      const absAfter = await run(absolute);
      expect(absAfter.digest).not.toBe(absBefore.digest);
      expect(absAfter.hash).not.toBe(absBefore.hash);

      // Without relative imports the digest stays the entry file sha256.
      const single = resolve(dir, "single.mjs");
      const body = `export const strategies = [];\n`;
      await writeText(single, body);
      expect((await loadRegistries([single])).pluginDigest[single]).toBe(sha256Hex(body));
    } finally {
      await removePath(dir);
    }
  });

  it("keeps plugin order in the run hash when two plugins register one strategy id", async () => {
    const dir = await createTempDir("idlekit-plugin-order");
    try {
      const plugin = async (tag: string) => {
        const path = resolve(dir, `${tag}.mjs`);
        await writeText(
          path,
          `export const strategies = [{ id: "plugin.same", tag: "${tag}", create: () => ({ id: "plugin.same", decide: () => [] }) }];\n`,
        );
        return path;
      };
      const a = await plugin("a");
      const b = await plugin("b");
      const scenario: ScenarioV1 = {
        schemaVersion: 1,
        unit: { code: "COIN" },
        policy: { mode: "drop" },
        model: { id: "linear", version: 1, params: {} },
        initial: { wallet: { unit: "COIN", amount: "0" } },
        clock: { stepSec: 1, durationSec: 1 },
        strategy: { id: "plugin.same" },
      };
      const run = async (paths: string[]) => {
        const loaded = await loadRegistries(paths);
        const tag = (loaded.strategyRegistry.get("plugin.same") as { tag?: string } | undefined)?.tag;
        const hash = prepareResolvedRun({ scenario, ...loaded, seed: 1 }).open("simulate", "x").hash;
        return { tag, hash };
      };

      const ab = await run([a, b]);
      const ba = await run([b, a]);
      const aba = await run([a, b, a]);
      // The last registration wins, so the two orders run different strategies.
      expect(ab.tag).toBe("b");
      expect(ba.tag).toBe("a");
      expect(ab.hash).not.toBe(ba.hash);
      expect(aba.tag).toBe("a");
      expect(aba.hash).toBe(ba.hash);
    } finally {
      await removePath(dir);
    }
  });
});
