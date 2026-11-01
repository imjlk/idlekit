import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { createRequire } from "module";
import { resolve } from "path";
import { MainCiFailedError, type WorkflowJob, type WorkflowRun, waitForMainCi } from "./ci-evidence";
import { STEPS, publishSteps, remainingSteps, requiredWorkflows, stepCommandLine } from "./publish-gate";

const { parse } = createRequire(resolve(import.meta.dir, "../packages/cli/package.json"))("yaml") as {
  parse: (input: string) => unknown;
};

const REPO = "imjlk/idlekit";
const SHA = "bd5a85f4e4d671f77855cdb68ef22107f3494e88";
const OTHER_SHA = "299658b8a2c0d0a3d1f2a9f1c1b4d8b1e3f2a6c7";
const CI = ".github/workflows/ci.yml";
const DOCS = ".github/workflows/docs-verify.yml";
const CI_JOBS = ["changesets", "checks", "typecheck", "test", "build", "windows-cli", "macos-cli"];

type Fixture = { runs: Record<string, WorkflowRun[]>; jobs: Record<number, WorkflowJob[]> };

function run(id: number, path: string, patch: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id,
    path,
    event: "push",
    head_branch: "main",
    head_sha: SHA,
    status: "completed",
    conclusion: "success",
    html_url: `https://github.com/${REPO}/actions/runs/${id}`,
    repository: { full_name: REPO },
    head_repository: { full_name: REPO },
    ...patch,
  };
}

const jobs = (names: readonly string[], conclusion: string | null = "success", status = "completed"): WorkflowJob[] =>
  names.map((name) => ({ name, status, conclusion }));

/** A fake clock and API; each `sleep` advances the clock and lets the scenario change state. */
function harness(states: Fixture[], options: { appearMs?: number; deadlineMs?: number; failPolls?: number } = {}) {
  let clock = 0;
  let poll = 0;
  const paths: string[] = [];
  const api = async (path: string): Promise<unknown> => {
    paths.push(path);
    if (poll < (options.failPolls ?? 0)) throw new Error("HTTP 502");
    const state = states[Math.min(poll, states.length - 1)]!;
    const listed = /\/actions\/workflows\/([^/]+)\/runs\?/.exec(path);
    if (listed) return { workflow_runs: state.runs[`.github/workflows/${decodeURIComponent(listed[1]!)}`] ?? [] };
    const runId = Number(/\/actions\/runs\/(\d+)\/jobs/.exec(path)?.[1]);
    return { jobs: state.jobs[runId] ?? [] };
  };
  const wait = () =>
    waitForMainCi({
      repository: REPO,
      sha: SHA,
      workflows: requiredWorkflows(),
      api,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
        poll += 1;
      },
      log: () => {},
      deadlineMs: options.deadlineMs ?? 30 * 60_000,
      appearMs: options.appearMs ?? 5 * 60_000,
      pollMs: 30_000,
    });
  return { wait, paths, polls: () => poll };
}

const green: Fixture = {
  runs: { [CI]: [run(1, CI)], [DOCS]: [run(2, DOCS)] },
  jobs: { 1: jobs(CI_JOBS), 2: jobs(["docs-verify"]) },
};

describe("main CI evidence for the publish gate", () => {
  it("maps every reused step to an unconditional step running the same command in a main push workflow", () => {
    for (const step of STEPS) {
      if (!step.ci) continue;
      const workflow = parse(readFileSync(resolve(import.meta.dir, "..", step.ci.workflow), "utf8")) as {
        on: { push?: { branches?: string[] } };
        jobs: Record<string, { if?: string; steps: { run?: string; if?: string }[] }>;
      };
      expect(workflow.on.push?.branches).toEqual(["main"]);
      const job = workflow.jobs[step.ci.job]!;
      expect({ step: step.command, jobIf: job.if }).toEqual({ step: step.command, jobIf: undefined });
      const matches = job.steps.filter((candidate) => candidate.run === stepCommandLine(step));
      expect({ step: step.command, matches: matches.length, conditional: matches.some((m) => m.if) }).toEqual({
        step: step.command, matches: 1, conditional: false,
      });
    }
  });

  it("always runs the steps that build and check the published packages", () => {
    expect(publishSteps().map((step) => step.command)).toEqual([
      "build", "install:smoke", "public:check", "replay:verify", "kpi:report", "kpi:regress", "release:plan",
    ]);
    expect(requiredWorkflows()).toEqual([
      { path: CI, jobs: ["typecheck", "checks", "test"] },
      { path: DOCS, jobs: ["docs-verify"] },
    ]);
  });

  it("reuses green runs and leaves only the publish steps", async () => {
    const evidence = await harness([green]).wait();
    expect(evidence).toEqual({
      kind: "reused",
      runs: [
        { path: CI, id: 1, url: `https://github.com/${REPO}/actions/runs/1` },
        { path: DOCS, id: 2, url: `https://github.com/${REPO}/actions/runs/2` },
      ],
    });
    expect(remainingSteps(evidence)).toEqual([]);
    expect([...publishSteps(), ...remainingSteps(evidence)].length).toBeLessThan(STEPS.length);
  });

  it("queries only push runs on main for the selected commit, per workflow file", async () => {
    const { wait, paths } = harness([green]);
    await wait();
    const listings = paths.filter((path) => path.includes("/runs?"));
    expect(listings).toEqual([
      `/repos/${REPO}/actions/workflows/ci.yml/runs?head_sha=${SHA}&event=push&branch=main&per_page=100`,
      `/repos/${REPO}/actions/workflows/docs-verify.yml/runs?head_sha=${SHA}&event=push&branch=main&per_page=100`,
    ]);
  });

  it("waits for runs that are still in progress", async () => {
    const running: Fixture = {
      runs: { [CI]: [run(1, CI, { status: "in_progress", conclusion: null })], [DOCS]: [] },
      jobs: { 1: [...jobs(["checks", "test"]), ...jobs(["typecheck"], null, "in_progress")] },
    };
    const { wait, polls } = harness([running, running, green]);
    expect((await wait()).kind).toBe("reused");
    expect(polls()).toBe(2);
  });

  for (const conclusion of ["failure", "cancelled", "timed_out", "startup_failure"]) {
    it(`fails publication when a main run concludes ${conclusion}`, async () => {
      const red: Fixture = { ...green, runs: { ...green.runs, [CI]: [run(1, CI, { conclusion })] } };
      await expect(harness([red]).wait()).rejects.toThrow(MainCiFailedError);
    });
  }

  it("fails as soon as any job fails, before the run completes", async () => {
    const red: Fixture = {
      runs: { [CI]: [run(1, CI, { status: "in_progress", conclusion: null })], [DOCS]: [run(2, DOCS, { status: "queued", conclusion: null })] },
      jobs: { 1: [...jobs(["windows-cli"], "failure"), ...jobs(["typecheck"], null, "in_progress")], 2: [] },
    };
    const { wait, polls } = harness([red]);
    await expect(wait()).rejects.toThrow(/job windows-cli failure/);
    expect(polls()).toBe(0);
  });

  it("fails on a red run even when another workflow never started", async () => {
    const red: Fixture = { runs: { [DOCS]: [run(2, DOCS, { conclusion: "failure" })] }, jobs: { 2: jobs(["docs-verify"], "failure") } };
    await expect(harness([red], { appearMs: 0 }).wait()).rejects.toThrow(MainCiFailedError);
  });

  for (const failing of ["docs-verify", "ci.yml"]) it(`fails on a red run even when ${failing} API requests keep failing`, async () => {
    const redPath = failing === "ci.yml" ? DOCS : CI;
    const redId = redPath === CI ? 1 : 2;
    const red: Fixture = { ...green, runs: { ...green.runs, [redPath]: [run(redId, redPath, { conclusion: "failure" })] } };
    let calls = 0;
    const api = async (path: string): Promise<unknown> => {
      calls += 1;
      if (path.includes(`workflows/${failing}`)) throw new Error("HTTP 503");
      if (path.includes("/runs?")) return { workflow_runs: red.runs[redPath] };
      return { jobs: red.jobs[redId] };
    };
    await expect(
      waitForMainCi({ repository: REPO, sha: SHA, workflows: requiredWorkflows(), api, log: () => {}, sleep: async () => {}, deadlineMs: 60_000, appearMs: 60_000, pollMs: 1 }),
    ).rejects.toThrow(MainCiFailedError);
    expect(calls).toBe(failing === "ci.yml" ? 3 : 2);
  });

  it("runs the full gate when a run never appears", async () => {
    const missing: Fixture = { runs: { [CI]: [run(1, CI)] }, jobs: green.jobs };
    const { wait, polls } = harness([missing]);
    const evidence = await wait();
    expect(evidence).toEqual({ kind: "unavailable", reason: `no push run of ${DOCS} on main for ${SHA}` });
    expect(polls()).toBe(10);
    expect([...publishSteps(), ...remainingSteps(evidence)].map((step) => step.command).sort()).toEqual(
      STEPS.map((step) => step.command).sort(),
    );
  });

  it("runs the full gate when the runs do not finish before the deadline", async () => {
    const running: Fixture = {
      runs: { [CI]: [run(1, CI, { status: "in_progress", conclusion: null })], [DOCS]: [run(2, DOCS)] },
      jobs: { 1: jobs(["checks"]), 2: jobs(["docs-verify"]) },
    };
    const evidence = await harness([running], { deadlineMs: 10 * 60_000 }).wait();
    expect(evidence).toEqual({ kind: "unavailable", reason: "main CI did not finish within 10 minutes" });
    expect(remainingSteps(evidence)).toEqual(STEPS.filter((step) => step.ci));
  });

  it("runs the full gate when a green run lacks a required job", async () => {
    const renamed: Fixture = { ...green, jobs: { ...green.jobs, 1: jobs(CI_JOBS.filter((name) => name !== "test")) } };
    expect(await harness([renamed]).wait()).toEqual({ kind: "unavailable", reason: `${CI} run 1: required job test is missing` });
    const skipped: Fixture = { ...green, jobs: { ...green.jobs, 2: jobs(["docs-verify"], "skipped") } };
    expect((await harness([skipped]).wait()).kind).toBe("unavailable");
  });

  it("runs the full gate after repeated GitHub API failures, but retries a transient one", async () => {
    expect(await harness([green], { failPolls: 3 }).wait()).toEqual({ kind: "unavailable", reason: "GitHub API failed 3 times" });
    expect((await harness([green], { failPolls: 2 }).wait()).kind).toBe("reused");
  });

  it("ignores runs from another event, branch, commit, workflow file, or repository", async () => {
    const untrusted = (path: string, id: number, conclusion: string) => [
      run(id + 10, path, { event: "pull_request", conclusion }),
      run(id + 20, path, { event: "workflow_dispatch", conclusion }),
      run(id + 30, path, { head_branch: "release/main", conclusion }),
      run(id + 40, path, { head_sha: OTHER_SHA, conclusion }),
      run(id + 50, path, { path: ".github/workflows/codeql.yml", conclusion }),
      run(id + 60, path, { path: `${path}@refs/heads/feature`, conclusion }),
      run(id + 70, path, { repository: { full_name: "fork/idlekit" }, conclusion }),
      run(id + 80, path, { head_repository: { full_name: "fork/idlekit" }, conclusion }),
    ];
    const greenOnlyUntrusted: Fixture = {
      runs: { [CI]: untrusted(CI, 1, "success"), [DOCS]: untrusted(DOCS, 2, "success") },
      jobs: {},
    };
    expect((await harness([greenOnlyUntrusted], { appearMs: 0 }).wait()).kind).toBe("unavailable");
    const redUntrusted: Fixture = {
      runs: { [CI]: [run(1, CI), ...untrusted(CI, 1, "failure")], [DOCS]: [run(2, DOCS), ...untrusted(DOCS, 2, "failure")] },
      jobs: { ...green.jobs, ...Object.fromEntries([11, 12, 21, 22].map((id) => [id, jobs(["test"], "failure")])) },
    };
    expect((await harness([redUntrusted]).wait()).kind).toBe("reused");
  });

  it("uses the newest trusted run when the commit was pushed to main more than once", async () => {
    const repushed: Fixture = { ...green, runs: { ...green.runs, [CI]: [run(1, CI, { conclusion: "failure" }), run(3, CI)] }, jobs: { ...green.jobs, 3: jobs(CI_JOBS) } };
    expect((await harness([repushed]).wait()).kind).toBe("reused");
  });

  it("does not query anything without a full SHA or repository", async () => {
    const paths: string[] = [];
    const base = { workflows: requiredWorkflows(), api: async (path: string) => paths.push(path), deadlineMs: 1, appearMs: 1, pollMs: 1 };
    expect((await waitForMainCi({ ...base, repository: REPO, sha: "bd5a85f" })).kind).toBe("unavailable");
    expect((await waitForMainCi({ ...base, repository: "", sha: SHA })).kind).toBe("unavailable");
    expect(paths).toEqual([]);
  });
});
