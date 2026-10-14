import { describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { pathToFileURL } from "url";
import { analysisTaskSeed, type AnalysisTrialTaskV1 } from "@idlekit/core";
import { sha256Hex } from "../../runtime/bun";
import { loadRegistries } from "../../plugin/load";
import { createTempDir } from "../../testkit/bun";
import { runAnalysisTrial } from "./trial";

// Keep plugin integration separate from the inventoried pool.test.ts hosts.
function trial(logicalIndex: number, payload: Record<string, unknown> = {}): AnalysisTrialTaskV1 {
  return {
    schemaVersion: 1,
    contract: "idlekit.execution-task.v1",
    taskId: `trial-${logicalIndex}`,
    logicalIndex,
    seed: analysisTaskSeed(19, logicalIndex),
    stepBudget: 1000,
    kind: "analysis-trial",
    payload: { stepSec: 1, durationSec: 3, incomePerSec: "1", ...payload },
    pluginPaths: [],
    pluginRoots: [],
    pluginDigests: {},
  };
}

describe("worker plugin admission", () => {
  it("runs the packaged default worker without compiler dependencies", async () => {
    const output = resolve(".test-bundle/worker-probe");
    // The protected Evidence runner can start Bun without placing it on PATH.
    const build = Bun.spawnSync([process.execPath, "scripts/cli-bundle.ts", "--entry", "src/worker-pool.fixture.ts", "--outdir", ".test-bundle/worker-probe"], { stdout: "pipe", stderr: "pipe" });
    if (build.exitCode !== 0) throw new Error(build.stderr.toString());
    const consumer = await createTempDir("idlekit-worker-consumer");
    try {
      mkdirSync(join(consumer, "runtime/workers"), { recursive: true });
      writeFileSync(join(consumer, "probe.js"), readFileSync(join(output, "worker-pool.fixture.js")));
      writeFileSync(join(consumer, "runtime/workers/entry.js"), readFileSync(join(output, "runtime/workers/entry.js")));
      writeFileSync(join(consumer, "bunfig.toml"), "preload = []\n");
      const invoke = (plugins: object = {}) => {
        const result = Bun.spawnSync([process.execPath, "probe.js", JSON.stringify(plugins)], { cwd: consumer, stdout: "pipe", stderr: "pipe" });
        if (result.exitCode !== 0) throw new Error(result.stderr.toString());
        return JSON.parse(result.stdout.toString());
      };
      const builtin = invoke();
      expect(builtin.entry).toBe(pathToFileURL(join(consumer, "runtime/workers/entry.js")).href);
      expect(builtin.batch.fullDistribution).toBe(true);
      expect(builtin.batch.outcomes[0]).toMatchObject({ status: "ok", attempts: 1 });
      const closurePlugin = join(consumer, "closure.mjs");
      const closureHelper = join(consumer, "helper.mjs");
      writeFileSync(closureHelper, 'export const tag = "one";');
      writeFileSync(closurePlugin, 'import { tag } from "./helper.mjs"; export const strategies = []; export { tag };');
      const parent = await loadRegistries([closurePlugin], { allowedRoots: [consumer] });
      const closurePolicy = { pluginPaths: [closurePlugin], pluginRoots: [consumer], pluginDigests: parent.pluginDigest };
      expect(invoke(closurePolicy).batch.outcomes[0]).toMatchObject({ status: "ok", attempts: 1 });
      writeFileSync(closureHelper, 'throw new Error("changed helper must not be evaluated");');
      expect(invoke(closurePolicy).batch.outcomes[0]).toMatchObject({ status: "failed", reason: "plugin-trust", attempts: 1 });
      const plugin = join(consumer, "throws.mjs");
      writeFileSync(plugin, 'throw new Error("initialization failed");');
      const digest = sha256Hex(readFileSync(plugin));
      const admitted = invoke({ pluginPaths: [plugin], pluginRoots: [consumer], pluginDigests: { [plugin]: digest } });
      expect(admitted.batch.outcomes[0]).toMatchObject({ status: "failed", reason: "trial-failed", attempts: 2 });
      const refused = invoke({ pluginPaths: [plugin], pluginRoots: [consumer], pluginDigests: { [plugin]: "0".repeat(64) } });
      expect(refused.batch.outcomes[0]).toMatchObject({ status: "failed", reason: "plugin-trust", attempts: 1 });
    } finally { rmSync(consumer, { recursive: true, force: true }); }
  }, 360_000);
  it("classifies an admitted plugin module evaluation error as a trial failure", async () => {
    const root = await createTempDir("idlekit-admitted-plugin");
    try {
      const plugin = join(root, "throws.mjs");
      writeFileSync(plugin, 'throw new Error("initialization failed");');
      const task = { ...trial(0), pluginPaths: [plugin], pluginRoots: [root], pluginDigests: { [plugin]: sha256Hex(readFileSync(plugin)) } };
      expect(await runAnalysisTrial(task, loadRegistries)).toMatchObject({ status: "failed", reason: "trial-failed" });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("accepts the parent's recorded plugin closure and refuses changed helpers", async () => {
    const root = await createTempDir("idlekit-worker-closure");
    try {
      const plugin = join(root, "plugin.mjs");
      const helper = join(root, "helper.mjs");
      writeFileSync(helper, 'export const tag = "one";');
      writeFileSync(plugin, 'import { tag } from "./helper.mjs"; export const strategies = []; export { tag };');
      const parent = await loadRegistries([plugin], { allowedRoots: [root] });
      expect(parent.pluginDigest[plugin]).not.toBe(sha256Hex(readFileSync(plugin)));
      const task = { ...trial(0), pluginPaths: [plugin], pluginRoots: [root], pluginDigests: parent.pluginDigest };
      expect(await runAnalysisTrial(task, loadRegistries)).toMatchObject({ status: "ok", attempts: 1 });
      writeFileSync(helper, 'throw new Error("changed helper must not be evaluated");');
      expect(await runAnalysisTrial(task, loadRegistries)).toMatchObject({ status: "failed", reason: "plugin-trust", attempts: 1 });
      expect(await runAnalysisTrial({ ...task, pluginDigests: { [plugin]: sha256Hex(readFileSync(plugin)) } }, loadRegistries)).toMatchObject({ status: "failed", reason: "plugin-trust" });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
