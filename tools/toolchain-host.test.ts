import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";

const repoRoot = resolve(import.meta.dir, "..");

function missingGraphReport(override?: string) {
  const temporary = mkdtempSync(join(tmpdir(), "idlekit-doctor-"));
  const preload = join(temporary, "missing-graph.ts");
  const graphModule = Bun.resolveSync("@ttsc/graph", repoRoot);
  writeFileSync(preload, `import { mock } from "bun:test";
mock.module(${JSON.stringify(graphModule)}, () => ({ resolveGraphBinary: () => null }));
`);
  const env = { ...process.env };
  delete env.TTSC_GRAPH_BINARY;
  delete env.TTSC_GO_BINARY;
  if (override) env.TTSC_GRAPH_BINARY = override;
  try {
    const result = Bun.spawnSync([process.execPath, "--preload", preload, "tools/toolchain-doctor.ts"], {
      cwd: repoRoot, env, stdout: "pipe", stderr: "pipe", timeout: 30_000,
    });
    expect(result.exitCode).toBe(1);
    return JSON.parse(result.stdout.toString()) as {
      ok: boolean;
      failures: string[];
      graphBinaryEnv: { set: boolean; origin?: string; path?: string };
    };
  } finally {
    unlinkSync(preload);
    rmdirSync(temporary);
  }
}

describe("toolchain doctor missing native Graph package", () => {
  it("returns a diagnostic report instead of throwing", () => {
    const report = missingGraphReport();
    expect(report.ok).toBeFalse();
    expect(report.failures).toContain("Pinned native Graph package is missing; run bun install");
    expect(report.graphBinaryEnv).toEqual({ set: false });
  });

  it("does not accept an override when the pinned binary is unavailable", () => {
    const report = missingGraphReport(process.execPath);
    expect(report.ok).toBeFalse();
    expect(report.failures).toContain("Pinned native Graph package is missing; run bun install");
    expect(report.graphBinaryEnv).toEqual({ set: true, origin: "unavailable", path: process.execPath });
  });
});
