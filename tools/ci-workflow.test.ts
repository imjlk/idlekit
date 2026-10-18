import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { createRequire } from "module";
import { resolve } from "path";

const { parse } = createRequire(resolve(import.meta.dir, "../packages/cli/package.json"))("yaml") as {
  parse: (input: string) => unknown;
};

type Step = {
  name?: string;
  if?: string;
  uses?: string;
  run?: string;
  with?: Record<string, string>;
  env?: Record<string, string>;
};
type Job = {
  "runs-on": string;
  "timeout-minutes"?: number;
  needs?: string | string[];
  env?: Record<string, string>;
  steps: Step[];
};

const root = resolve(import.meta.dir, "..");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");
const workflowFiles = ["ci.yml", "release.yml", "docs-verify.yml", "codeql.yml"] as const;
const workflows = Object.fromEntries(
  workflowFiles.map((file) => [file, parse(read(`.github/workflows/${file}`)) as { jobs: Record<string, Job> }]),
) as Record<(typeof workflowFiles)[number], { jobs: Record<string, Job> }>;
const allJobs = workflowFiles.flatMap((file) =>
  Object.entries(workflows[file].jobs).map(([id, job]) => ({ file, id, job })),
);
const ci = workflows["ci.yml"].jobs;
const release = workflows["release.yml"].jobs;

/** sampo CLI release -> the sampo-core it is built on (crates.io dependency metadata). */
const SAMPO_CORE_BY_CLI: Record<string, string> = { "0.22.0": "0.18.0" };
const SAMPO_ACTION = /^bruits\/sampo\/crates\/sampo-github-action@[0-9a-f]{40}$/;
const PINNED_BINSTALL = "./.github/actions/cargo-binstall";
const TTSC_CACHE_PATHS = "node_modules/.cache/ttsc/plugins\nnode_modules/.cache/ttsc/go-build\n";
const TTSC_CACHE_KEY = "${{ runner.os }}-${{ runner.arch }}-ttsc-${{ hashFiles('fixtures/toolchain/pins.json') }}";
const TTSC_GO_CACHE_DIR = "${{ github.workspace }}/node_modules/.cache/ttsc/go-build";
// Commands that compile ttsc plugins (typecheck, bun-register preload, the bundled CLI build).
const TTSC_COMMANDS = /bun run (typecheck|test|build|docs:verify|publish:gate|toolchain:smoke|contracts:check)\b/;

describe("CI and release workflow layout", () => {
  it("bounds every job with a timeout", () => {
    for (const { file, id, job } of allJobs) {
      expect({ file, id, timeout: job["timeout-minutes"] }).toEqual({ file, id, timeout: expect.any(Number) });
      expect(job["timeout-minutes"]!).toBeGreaterThan(0);
      expect(job["timeout-minutes"]!).toBeLessThanOrEqual(90);
    }
  });

  it("leaves every job that verifies the registry time to reach the verifier's own deadline", () => {
    const deadlineMinutes = Number(read("tools/release-registry.ts").match(/REGISTRY_WAIT_SEC \?\? (\d+)/)?.[1]) / 60;
    expect(deadlineMinutes).toBeGreaterThan(0);
    for (const [id, job] of Object.entries(release)) {
      if (!job.steps.some((step) => step.run === "bun tools/release-registry.ts verify")) continue;
      // Setup and, in publish, the ~30-minute preflight come on top of the polling window.
      expect({ id, fits: job["timeout-minutes"]! >= deadlineMinutes + (id === "publish" ? 45 : 10) }).toEqual({ id, fits: true });
    }
  });

  it("splits Linux CI into parallel jobs with one typecheck on a fresh plugin directory", () => {
    expect(Object.keys(ci).sort()).toEqual(["build", "changesets", "checks", "macos-cli", "test", "typecheck", "windows-cli"]);
    for (const job of Object.values(ci)) expect(job.needs).toBeUndefined();
    const typechecks = Object.values(ci).flatMap((job) => job.steps).filter((step) => step.run === "bun run typecheck");
    expect(typechecks).toHaveLength(1);
    expect(typechecks[0]?.env?.TTSC_CACHE_DIR).toBe("${{ runner.temp }}/idlekit-cold-typecheck");
    // evidence:check compares coverage with the base revision, so the fetches stay with the typecheck.
    expect(ci.typecheck!.env).toMatchObject({
      GITHUB_BEFORE: "${{ github.event.before }}",
      GITHUB_BASE_SHA: "${{ github.event.pull_request.base.sha }}",
    });
    const names = ci.typecheck!.steps.map((step) => step.name);
    expect(names.indexOf("Fetch pull request base")).toBeLessThan(names.indexOf("Cold protected typecheck"));
  });

  it("runs every tools test by directory and leaves out only tests run elsewhere", () => {
    const steps = ci.checks!.steps.filter((step) => step.run?.startsWith("bun test ./tools"));
    expect(steps).toHaveLength(1);
    const ignored = [...steps[0]!.run!.matchAll(/--path-ignore-patterns='([^']+)'/g)].map((match) => match[1]);
    expect(ignored).toEqual(["tools/conformance.negative.test.ts"]);
    // The protected inventory (evidence:check, inside typecheck) runs it on Linux; Windows runs it directly.
    expect(read("evidence.config.ts")).toContain('"tools/conformance.negative.test.ts"');
    expect(ci["windows-cli"]!.steps.some((step) => step.run === "bun test tools/conformance.negative.test.ts")).toBeTrue();
    const runs = Object.values(ci).flatMap((job) => job.steps.map((step) => step.run ?? ""));
    expect(runs.some((run) => run.includes("bun test tools/release-workflow.test.ts"))).toBeFalse();
  });

  it("validates changesets in CI with the Sampo action and core the release prepare job runs", () => {
    const sampoSteps = (job: Job) => job.steps.filter((step) => step.uses?.startsWith("bruits/sampo/"));
    const uses = new Set(allJobs.flatMap(({ job }) => sampoSteps(job).map((step) => step.uses)));
    expect(uses.size).toBe(1);
    expect([...uses][0]).toMatch(SAMPO_ACTION);
    const [validate] = sampoSteps(ci.changesets!);
    expect(validate?.with).toEqual({ command: "release", "dry-run": "true" });
    expect(validate?.env?.SAMPO_RELEASE_BRANCH).toBe("main");
    const [prepare] = sampoSteps(release.prepare!);
    expect(prepare?.with?.command).toBe(validate?.with?.command);
    expect(prepare?.env?.SAMPO_RELEASE_BRANCH).toBe(validate?.env?.SAMPO_RELEASE_BRANCH);

    // publish:gate's release:plan runs the npm CLI; it must share the action's core.
    const releaseText = read(".github/workflows/release.yml");
    const cli = releaseText.match(/npm install -g [^\n]*\bsampo@(\d+\.\d+\.\d+)/)?.[1];
    const cores = new Set([...releaseText.matchAll(/sampo-github-action@[0-9a-f]{40} # action [\d.]+, core ([\d.]+)/g)].map((m) => m[1]));
    expect(cores.size).toBe(1);
    expect(SAMPO_CORE_BY_CLI[cli ?? ""]).toBe([...cores][0]!);
    expect(read(".github/workflows/ci.yml")).toContain(`# action ${releaseText.match(/# action ([\d.]+)/)?.[1]}, core ${[...cores][0]}`);
  });

  it("installs a checksum-pinned cargo-binstall before every Sampo action and limits its strategies", () => {
    for (const { file, id, job } of allJobs) {
      const sampo = job.steps.findIndex((step) => step.uses?.startsWith("bruits/sampo/"));
      if (sampo < 0) continue;
      const binstall = job.steps.findIndex((step) => step.uses === PINNED_BINSTALL);
      expect({ file, id, ordered: binstall >= 0 && binstall < sampo }).toEqual({ file, id, ordered: true });
      expect(job.steps[binstall]?.if).toBe(job.steps[sampo]?.if);
      expect(job.steps[sampo]?.env).toMatchObject({ BINSTALL_STRATEGIES: "crate-meta-data", BINSTALL_DISABLE_TELEMETRY: "true" });
    }
    const action = parse(read(".github/actions/cargo-binstall/action.yml")) as { runs: { using: string; steps: Step[] } };
    expect(action.runs.using).toBe("composite");
    expect(action.runs.steps).toHaveLength(1);
    const [install] = action.runs.steps;
    expect(install?.env?.BINSTALL_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(install?.run).not.toContain("releases/latest");
    expect(install?.run).not.toContain("raw.githubusercontent.com");
    expect(install?.run).toContain("releases/download/v${BINSTALL_VERSION}/");
    expect(install?.run).toContain("sha256sum -c -");
    expect(install?.run?.match(/sha256=[0-9a-f]{64} ;;/g)).toHaveLength(2);
  });

  it("shares one ttsc cache entry that only the CI typecheck job writes", () => {
    const caches = allJobs.flatMap(({ file, id, job }) =>
      job.steps.filter((step) => step.uses?.startsWith("actions/cache")).map((step) => ({ file, id, step })),
    );
    for (const { step } of caches) {
      expect(step.with).toEqual({ path: TTSC_CACHE_PATHS, key: TTSC_CACHE_KEY, "restore-keys": "${{ runner.os }}-${{ runner.arch }}-ttsc-\n" });
    }
    const writers = caches.filter(({ step }) => !step.uses!.startsWith("actions/cache/restore@"));
    expect(writers.map(({ file, id }) => `${file}:${id}`)).toEqual(["ci.yml:typecheck"]);
  });

  it("gives every Linux job that compiles ttsc plugins the Go object cache and a restored plugin cache", () => {
    for (const { file, id, job } of allJobs) {
      if (job["runs-on"] !== "ubuntu-latest") continue;
      const first = job.steps.findIndex((step) => TTSC_COMMANDS.test(step.run ?? ""));
      if (first < 0) continue;
      const cache = job.steps.findIndex((step) => step.uses?.startsWith("actions/cache"));
      expect({ file, id, cached: cache >= 0 && cache < first }).toEqual({ file, id, cached: true });
      expect({ file, id, go: job.env?.TTSC_GO_CACHE_DIR }).toEqual({ file, id, go: TTSC_GO_CACHE_DIR });
    }
    expect(release.publish!.steps.some((step) => step.uses?.startsWith("actions/cache/restore@"))).toBeTrue();
  });
});
