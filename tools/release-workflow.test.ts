import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "module";
import { resolve } from "path";

const { parse } = createRequire(resolve(import.meta.dir, "../packages/cli/package.json"))("yaml") as {
  parse: (input: string) => unknown;
};

type Step = {
  name: string;
  uses?: string;
  run?: string;
  with?: Record<string, string>;
  env?: Record<string, string>;
};
type Job = { if: string; permissions: Record<string, string>; steps: Step[] };
type Workflow = {
  on: { push: { branches: string[] }; workflow_dispatch: { inputs: { publish: { type: string; default: boolean } } } };
  permissions: Record<string, string>;
  jobs: { prepare: Job; publish: Job };
};
const workflow = parse(readFileSync(resolve(import.meta.dir, "../.github/workflows/release.yml"), "utf8")) as Workflow;

/** Evaluate only the boolean/string subset used by these job guards. */
function allows(guard: string, event: string, ref: string, publish: boolean): boolean {
  const expression = guard
    .replaceAll("github.event_name", JSON.stringify(event))
    .replaceAll("github.ref", JSON.stringify(ref))
    .replaceAll("inputs.publish", String(publish));
  if (!/^(?:\s|'[^'\\]*'|"[^"\\]*"|true|false|&&|\|\||!|==|\(|\))*$/.test(expression)) {
    throw new Error("Unsupported release guard syntax");
  }
  return Boolean(Function(`return (${expression})`)());
}

describe("release preparation and publishing", () => {
  for (const outcome of ["successful", "failed"] as const) {
    it(`selects npm and restores the exact publish lockfile after a ${outcome} publisher`, async () => {
      const steps = workflow.jobs.publish.steps;
      const selection = steps.findIndex((step) => step.name === "Select npm for trusted publishing");
      const publish = steps.findIndex((step) => step.with?.command === "publish");
      const restoration = steps.findIndex((step) => step.name === "Restore publish lockfile");
      expect(selection).toBeGreaterThan(steps.findIndex((step) => step.name === "Recheck selected commit before publishing"));
      expect(selection).toBeLessThan(publish);
      expect(restoration).toBeGreaterThan(publish);
      expect((steps[restoration] as Step & { if?: string })?.if).toBe("always()");
      const prefix = resolve(tmpdir(), "idlekit-publish-wiring-");
      const fixture = await mkdtemp(prefix);
      const runnerTemp = resolve(fixture, "runner-temp");
      const original = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('{"packages":{"pinned":"1.0.0"}}\n')]);
      const lockPath = resolve(fixture, "bun.lock");
      const bash = process.platform === "win32" ? resolve(process.env.ProgramFiles ?? "C:/Program Files", "Git/bin/bash.exe") : "bash";
      const execute = (script: string) => Bun.spawnSync([bash, "--noprofile", "--norc", "-e", "-c", script], {
        cwd: fixture, env: { ...process.env, RUNNER_TEMP: runnerTemp.replaceAll("\\", "/") }, stdout: "pipe", stderr: "pipe",
      });
      try {
        await mkdir(runnerTemp);
        await Bun.write(lockPath, original);
        const selected = execute(steps[selection]!.run!);
        expect(selected.exitCode).toBe(0);
        expect(await Bun.file(lockPath).exists()).toBeFalse();
        expect(new Uint8Array(await Bun.file(resolve(runnerTemp, "idlekit-publish.bun.lock")).arrayBuffer())).toEqual(original);
        try {
          const publisher = execute(outcome === "failed" ? "exit 17" : "true");
          expect(publisher.exitCode).toBe(outcome === "failed" ? 17 : 0);
          if (outcome === "failed") await Bun.write(lockPath, "partial publisher lockfile");
        } finally {
          expect(execute(steps[restoration]!.run!).exitCode).toBe(0);
        }
        expect(new Uint8Array(await Bun.file(lockPath).arrayBuffer())).toEqual(original);
        expect(await Bun.file(resolve(runnerTemp, "idlekit-publish.bun.lock")).exists()).toBeFalse();
      } finally {
        if (!resolve(fixture).startsWith(prefix)) throw new Error("Unexpected publish fixture path");
        await rm(fixture, { recursive: true, force: true });
      }
    });
  }

  it("preserves dependencies while preparing workspace versions through the actual workflow steps", async () => {
    const steps = workflow.jobs.prepare.steps;
    const preservation = steps.findIndex((step) => step.name === "Preserve release dependency resolutions");
    const release = steps.findIndex((step) => step.with?.command === "release");
    const refresh = steps.findIndex((step) => step.name === "Refresh workspace lockfile");
    expect(preservation).toBeGreaterThan(steps.findIndex((step) => step.name === "Install"));
    expect(preservation).toBeLessThan(release);
    expect(refresh).toBeGreaterThan(release);
    const prefix = resolve(tmpdir(), "idlekit-release-wiring-");
    const fixture = await mkdtemp(prefix);
    try {
      await mkdir(resolve(fixture, "tools"));
      await Bun.write(resolve(fixture, "tools/release-lockfile.ts"), readFileSync(resolve(import.meta.dir, "release-lockfile.ts")));
      await Bun.write(resolve(fixture, "package.json"), JSON.stringify({ name: "fixture", private: true, workspaces: ["packages/*"] }));
      for (const pkg of ["money", "core", "cli"]) {
        await mkdir(resolve(fixture, "packages", pkg), { recursive: true });
        await Bun.write(resolve(fixture, "packages", pkg, "package.json"), JSON.stringify({ name: `@idlekit/${pkg}`, version: "0.1.1" }));
      }
      const bash = process.platform === "win32" ? resolve(process.env.ProgramFiles ?? "C:/Program Files", "Git/bin/bash.exe") : "bash";
      const execute = (script: string) => {
        const result = Bun.spawnSync([bash, "--noprofile", "--norc", "-e", "-c", 'bun() { "$BUN_TEST_EXE" "$@"; }\n' + script], {
          cwd: fixture,
          env: { ...process.env, RUNNER_TEMP: fixture.replaceAll("\\", "/"), BUN_TEST_EXE: process.execPath.replaceAll("\\", "/") },
          stdout: "pipe", stderr: "pipe",
        });
        if (result.exitCode !== 0) throw new Error(result.stderr.toString() || `Release step exited ${result.exitCode}`);
      };
      await execute("bun install --lockfile-only --ignore-scripts");
      const before = new Uint8Array(await Bun.file(resolve(fixture, "bun.lock")).arrayBuffer());
      await execute(steps[preservation]!.run!);
      expect(await Bun.file(resolve(fixture, "bun.lock")).exists()).toBeFalse();
      expect(new Uint8Array(await Bun.file(resolve(fixture, "idlekit-release.bun.lock")).arrayBuffer())).toEqual(before);
      // Sampo's version/changelog phase is exercised with the pinned binaries in the release fixture.
      for (const pkg of ["money", "core", "cli"]) {
        await Bun.write(resolve(fixture, "packages", pkg, "package.json"), JSON.stringify({ name: `@idlekit/${pkg}`, version: "0.2.0" }));
      }
      await execute(steps[refresh]!.run!);
      type FixtureLock = { packages: unknown; workspaces: Record<string, { version: string }> };
      const after = Bun.JSONC.parse(await Bun.file(resolve(fixture, "bun.lock")).text()) as FixtureLock;
      expect(after.packages).toEqual((Bun.JSONC.parse(new TextDecoder().decode(before)) as FixtureLock).packages);
      for (const pkg of ["money", "core", "cli"]) expect(after.workspaces[`packages/${pkg}`]?.version).toBe("0.2.0");
    } finally {
      if (!resolve(fixture).startsWith(prefix)) throw new Error("Unexpected release fixture path");
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it("publishes only on an explicit manual request on main", () => {
    const cases = [
      ["push", "refs/heads/main", false, true, false],
      ["push", "refs/heads/main", true, true, false],
      ["workflow_dispatch", "refs/heads/main", false, true, false],
      ["workflow_dispatch", "refs/heads/main", true, false, true],
      ["workflow_dispatch", "refs/heads/feature", false, false, false],
      ["workflow_dispatch", "refs/heads/feature", true, false, false],
      ["pull_request", "refs/heads/main", true, false, false],
    ] as const;
    for (const [event, ref, publish, prepareAllowed, publishAllowed] of cases) {
      expect(allows(workflow.jobs.prepare.if, event, ref, publish)).toBe(prepareAllowed);
      expect(allows(workflow.jobs.publish.if, event, ref, publish)).toBe(publishAllowed);
    }
    expect(workflow.on.push.branches).toEqual(["main"]);
    expect(workflow.on.workflow_dispatch.inputs.publish).toMatchObject({ type: "boolean", default: false });
  });

  it("keeps publish commands and registry credentials out of preparation", () => {
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.jobs.prepare.permissions["id-token"]).toBeUndefined();
    expect(workflow.jobs.publish.permissions["id-token"]).toBe("write");
    const preparation = JSON.stringify(workflow.jobs.prepare);
    expect(preparation).not.toContain("NPM_TOKEN");
    expect(preparation).not.toContain("NODE_AUTH_TOKEN");
    expect(preparation).not.toContain("setup-node@");
    for (const [jobName, job] of Object.entries(workflow.jobs)) {
      const actions = job.steps.filter((step) => step.uses?.startsWith("bruits/sampo/"));
      expect(actions).toHaveLength(1);
      expect(actions[0]?.with?.command).toBe(jobName === "prepare" ? "release" : "publish");
      expect(actions[0]?.with?.command).not.toBe("auto");
    }
    const registrySteps = workflow.jobs.publish.steps.filter((step) => step.env?.NODE_AUTH_TOKEN);
    expect(registrySteps).toHaveLength(1);
    expect(registrySteps[0]?.with?.command).toBe("publish");
    expect(workflow.jobs.publish.steps.findIndex((step) => step.name === "Require consumed changesets"))
      .toBeLessThan(workflow.jobs.publish.steps.findIndex((step) => step.with?.command === "publish"));
  });

  it("pins publication to the manual request and checks main on both sides of preflight", () => {
    const steps = workflow.jobs.publish.steps;
    expect(steps.find((step) => step.uses?.startsWith("actions/checkout@"))?.with?.ref).toBe("${{ github.sha }}");
    const checks = steps.filter((step) => step.env?.SELECTED_SHA === "${{ github.sha }}");
    expect(checks).toHaveLength(2);
    const preflight = steps.findIndex((step) => step.name === "Release preflight");
    expect(steps.indexOf(checks[0]!)).toBeLessThan(preflight);
    expect(steps.indexOf(checks[1]!)).toBeGreaterThan(preflight);
    for (const check of checks) {
      expect(check.run).toContain('git rev-parse HEAD');
      expect(check.run).toContain('git ls-remote origin refs/heads/main');
    }
    expect(checks[0]?.run).toContain('git checkout -B main "$SELECTED_SHA"');
  });
});
