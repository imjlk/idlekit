import { describe, expect, it } from "bun:test";
import { link, readFile, symlink } from "node:fs/promises";
import { resolve } from "path";
import { createTempDir, removePath, REPO_ROOT, runCli, writeText } from "../testkit/bun";

async function inputs(directory: string) {
  const source = await readFile(resolve(REPO_ROOT, "examples/bench/kpi-baseline.json"), "utf8");
  const baseline = resolve(directory, "baseline.json");
  const current = resolve(directory, "current.json");
  await writeText(baseline, source);
  await writeText(current, source);
  return { baseline, current, source, args: ["kpi", "regress", "--baseline", baseline, "--current", current] };
}

describe("KPI regression input protection", () => {
  for (const target of ["baseline", "current"] as const) {
    it(`rejects ${target} as the output in every format`, async () => {
      const directory = await createTempDir("idlekit-kpi-input-protection");
      try {
        const fixture = await inputs(directory);
        for (const format of ["json", "md", "csv"]) {
          const result = runCli([...fixture.args, "--out", fixture[target], "--format", format], { check: false });
          expect(result.exitCode).not.toBe(0);
          expect(result.stderr).toContain("CLI_USAGE");
          expect(await readFile(fixture.baseline, "utf8")).toBe(fixture.source);
          expect(await readFile(fixture.current, "utf8")).toBe(fixture.source);
        }
      } finally { await removePath(directory); }
    });

    it(`protects hardlinks and directory aliases of ${target}`, async () => {
      const directory = await createTempDir("idlekit-kpi-input-aliases");
      try {
        const fixture = await inputs(directory);
        const hardlink = resolve(directory, "input-alias.json");
        await link(fixture[target], hardlink);
        const alias = resolve(directory, "directory-alias");
        await symlink(directory, alias, process.platform === "win32" ? "junction" : "dir");
        for (const output of [hardlink, resolve(alias, `${target}.json`)]) {
          const result = runCli([...fixture.args, "--out", output], { check: false });
          expect(result.exitCode).not.toBe(0);
          expect(result.stderr).toContain("CLI_USAGE");
          expect(await readFile(fixture.baseline, "utf8")).toBe(fixture.source);
          expect(await readFile(fixture.current, "utf8")).toBe(fixture.source);
        }
      } finally { await removePath(directory); }
    });
  }

  it("preserves both inputs when writing a separate report or stdout", async () => {
    const directory = await createTempDir("idlekit-kpi-separate-output");
    try {
      const fixture = await inputs(directory);
      const output = resolve(directory, "report.json");
      expect(runCli([...fixture.args, "--out", output]).exitCode).toBe(0);
      const report: unknown = JSON.parse(await readFile(output, "utf8"));
      expect(report).toMatchObject({ pass: true, _meta: { command: "kpi.regress" } });
      const stdout: unknown = JSON.parse(runCli(fixture.args).stdout);
      expect(stdout).toMatchObject({ pass: true, _meta: { command: "kpi.regress" } });
      expect(await readFile(fixture.baseline, "utf8")).toBe(fixture.source);
      expect(await readFile(fixture.current, "utf8")).toBe(fixture.source);
    } finally { await removePath(directory); }
  });
});
