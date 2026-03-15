import { describe, expect, it } from "bun:test";
import { resolve } from "path";
import { createTempDir, readJson, readText, removePath, runCliFailure, runCliJson } from "../testkit/bun";
import { runTuneWizard } from "../lib/tuneWizard";
import { loadRegistriesFromFlags } from "./_shared/plugin";

const pluginFlags = {
  plugin: "",
  "allow-plugin": false,
  "plugin-root": "",
  "plugin-sha256": "",
  "plugin-trust-file": "",
} as const;

function createPromptStub(responses: {
  select: readonly unknown[];
  text: readonly string[];
}) {
  let selectIndex = 0;
  let textIndex = 0;
  return {
    prompt: {
      intro() {},
      outro() {},
      async select() {
        return responses.select[selectIndex++] as never;
      },
      async text() {
        return responses.text[textIndex++] ?? "";
      },
      async confirm() {
        return true;
      },
    },
  };
}

describe("setup and tune wizard", () => {
  it("setup completions writes a managed block to the target rc file", async () => {
    const dir = await createTempDir("idlekit-setup-completions");
    try {
      const rcPath = resolve(dir, ".zshrc");
      const out = runCliJson([
        "setup",
        "completions",
        "--shell",
        "zsh",
        "--rc",
        rcPath,
        "--format",
        "json",
      ]);
      expect(out.ok).toBeTrue();
      expect(out.updated).toBeTrue();
      const rcContents = await readText(rcPath);
      expect(rcContents).toContain("# >>> idk completions >>>");
      expect(rcContents).toContain("source <(idk completions zsh)");

      const second = runCliJson([
        "setup",
        "completions",
        "--shell",
        "zsh",
        "--rc",
        rcPath,
        "--format",
        "json",
      ]);
      expect(second.updated).toBeFalse();
    } finally {
      await removePath(dir);
    }
  });

  it("setup plugin-trust writes relative plugin digests and recommendations", async () => {
    const dir = await createTempDir("idlekit-setup-trust");
    try {
      const outPath = resolve(dir, "trust.json");
      const pluginPath = resolve(process.cwd(), "../../examples/plugins/custom-econ-plugin.ts");
      const out = runCliJson([
        "setup",
        "plugin-trust",
        "--plugin",
        pluginPath,
        "--out",
        outPath,
        "--format",
        "json",
      ]);
      expect(out.ok).toBeTrue();
      expect(out.pluginCount).toBe(1);
      expect(Array.isArray(out.recommendedFlags)).toBeTrue();
      const trust = await readJson<any>(outPath);
      expect(Object.keys(trust.plugins ?? {}).length).toBe(1);
      expect(String(Object.values(trust.plugins ?? {})[0])).toHaveLength(64);
    } finally {
      await removePath(dir);
    }
  });

  it("doctor --fix installs completions and plugin trust artifacts", async () => {
    const dir = await createTempDir("idlekit-doctor-fix");
    try {
      const rcPath = resolve(dir, ".zshrc");
      const trustPath = resolve(dir, "trust.json");
      const pluginPath = resolve(process.cwd(), "../../examples/plugins/custom-econ-plugin.ts");
      const out = runCliJson([
        "doctor",
        "--format",
        "json",
        "--fix",
        "true",
        "--shell",
        "zsh",
        "--rc",
        rcPath,
        "--plugin",
        pluginPath,
        "--trust-out",
        trustPath,
      ]);
      expect(out.ok).toBeTrue();
      expect(Array.isArray(out.fixes)).toBeTrue();
      expect(out.fixes.some((fix: any) => fix.id === "completions" && fix.status === "applied")).toBeTrue();
      expect(out.fixes.some((fix: any) => fix.id === "plugin-trust" && fix.status === "applied")).toBeTrue();
      expect((await readText(rcPath))).toContain("idk completions zsh");
      expect(Object.keys((await readJson<any>(trustPath)).plugins ?? {})).toHaveLength(1);
    } finally {
      await removePath(dir);
    }
  });

  it("tune wizard creates a TuneSpec for greedy scenarios", async () => {
    const dir = await createTempDir("idlekit-tune-wizard");
    try {
      const scenarioPath = resolve(process.cwd(), "../../examples/tutorials/11-my-game-v1.json");
      const scenarioInput = await readJson<any>(scenarioPath);
      const loaded = await loadRegistriesFromFlags(pluginFlags);
      const tunePath = resolve(dir, "space-miner-tune.json");
      const { prompt } = createPromptStub({
        select: ["experienceBalancedLog10"],
        text: ["12", "1800", tunePath],
      });

      const out = await runTuneWizard({
        prompt: prompt as never,
        terminal: {
          width: 120,
          height: 40,
          isInteractive: true,
          isCI: false,
          supportsColor: true,
          supportsMouse: false,
        },
        scenarioPath,
        scenarioInput,
        modelRegistry: loaded.modelRegistry,
        outPath: tunePath,
        force: false,
      });

      expect(out.tunePath).toBe(tunePath);
      const written = await readJson<any>(tunePath);
      expect(written.strategy.id).toBe("greedy");
      expect(written.objective.id).toBe("experienceBalancedLog10");
      expect(Array.isArray(written.strategy.space)).toBeTrue();
    } finally {
      await removePath(dir);
    }
  });

  it("tune --wizard fails in non-interactive mode", async () => {
    const scenarioPath = resolve(process.cwd(), "../../examples/tutorials/11-my-game-v1.json");
    const failure = runCliFailure(["tune", scenarioPath, "--wizard", "true"]);
    expect(failure.stderr).toContain("[CLI_USAGE]");
  });
});
