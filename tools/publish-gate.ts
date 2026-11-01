import { resolve } from "path";
import { ROOT, ensureDir, runText, writeText } from "./_bun";
import { type CiEvidence, type RequiredWorkflow, githubApi, waitForMainCi } from "./ci-evidence";

const CI = ".github/workflows/ci.yml";
const DOCS = ".github/workflows/docs-verify.yml";

/**
 * `ci` names the job of a `main` push workflow that runs this exact command with no condition.
 * Release reuses that job's result for the selected commit. Steps without it build or check
 * the artifacts this job publishes, or CI does not run them the same way (replay and KPI run
 * against the bundled CLI there), so the publish job always runs them itself.
 */
export type GateStep = Readonly<{ command: string; ci?: Readonly<{ workflow: string; job: string }> }>;

export const STEPS: readonly GateStep[] = [
  { command: "typecheck", ci: { workflow: CI, job: "typecheck" } },
  { command: "runtime:check", ci: { workflow: CI, job: "checks" } },
  { command: "bun run --cwd packages/cli generate:check", ci: { workflow: CI, job: "checks" } },
  { command: "bun run --cwd packages/cli doctor:completions", ci: { workflow: CI, job: "checks" } },
  { command: "test", ci: { workflow: CI, job: "test" } },
  { command: "build" },
  { command: "docs:verify", ci: { workflow: DOCS, job: "docs-verify" } },
  { command: "templates:check", ci: { workflow: CI, job: "checks" } },
  { command: "install:smoke" },
  { command: "public:check" },
  { command: "replay:verify" },
  { command: "kpi:report" },
  { command: "kpi:regress" },
  { command: "release:plan" },
];

/** The command line a workflow step runs for this gate step. */
export function stepCommandLine(step: GateStep): string {
  return step.command.startsWith("bun ") ? step.command : `bun run ${step.command}`;
}

/** Every workflow that proves a gate step, with the jobs that must succeed in it. */
export function requiredWorkflows(steps: readonly GateStep[] = STEPS): RequiredWorkflow[] {
  const jobs = new Map<string, Set<string>>();
  for (const { ci } of steps) {
    if (ci) jobs.set(ci.workflow, (jobs.get(ci.workflow) ?? new Set()).add(ci.job));
  }
  return [...jobs].map(([path, names]) => ({ path, jobs: [...names] }));
}

/** Steps the publish job always runs: they build and check what it publishes. */
export function publishSteps(steps: readonly GateStep[] = STEPS): GateStep[] {
  return steps.filter((step) => !step.ci);
}

/** Steps still to run once main CI has answered: none when it proved them, all of them otherwise. */
export function remainingSteps(evidence: CiEvidence, steps: readonly GateStep[] = STEPS): GateStep[] {
  return evidence.kind === "reused" ? [] : steps.filter((step) => step.ci);
}

type StepResult = Readonly<{
  name: string;
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}>;

/** The CI token is only for the GitHub API query; no gate step sees it. */
const TOKEN_ENV = "CI_EVIDENCE_TOKEN";

function runSteps(steps: readonly GateStep[], results: StepResult[]): void {
  const env = { ...process.env };
  delete env[TOKEN_ENV];
  for (const step of steps) {
    const startedAt = new Date();
    console.log(`==> ${step.command}`);
    runText(stepCommandLine(step).split(" "), { cwd: ROOT, env });
    const finishedAt = new Date();
    results.push({
      name: step.command,
      ok: true,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    });
  }
}

/**
 * Release runs this on the commit `main` CI is testing at the same time. Publish steps run
 * first, then the gate waits for that CI. A red run fails here; a run that never finishes
 * or cannot be read leaves the remaining steps to run locally, as the full gate does.
 */
async function reuseMainCi(): Promise<CiEvidence> {
  const token = process.env[TOKEN_ENV] ?? "";
  if (!token) return { kind: "unavailable", reason: `${TOKEN_ENV} is not set` };
  const waitSec = Number(process.env.CI_EVIDENCE_WAIT_SEC ?? 1800);
  return waitForMainCi({
    repository: process.env.GITHUB_REPOSITORY ?? "",
    sha: runText(["git", "rev-parse", "HEAD"], { cwd: ROOT }).trim(),
    workflows: requiredWorkflows(),
    api: githubApi(token, process.env.GITHUB_API_URL || undefined),
    deadlineMs: waitSec * 1000,
    appearMs: 5 * 60_000,
    pollMs: 30_000,
  });
}

async function main(): Promise<void> {
  const reuse = process.argv.includes("--reuse-ci");
  const results: StepResult[] = [];
  let evidence: CiEvidence | undefined;
  if (reuse) {
    runSteps(publishSteps(), results);
    evidence = await reuseMainCi();
    if (evidence.kind === "reused") {
      for (const run of evidence.runs) console.log(`reusing ${run.path} run ${run.id} ${run.url}`);
    } else {
      console.log(`running the checks main CI did not prove: ${evidence.reason}`);
    }
    runSteps(remainingSteps(evidence), results);
  } else {
    runSteps(STEPS, results);
  }

  const outPath = resolve(ROOT, "tmp", "publish-gate.json");
  await ensureDir(resolve(ROOT, "tmp"));
  await writeText(
    outPath,
    `${JSON.stringify({ ok: true, checkedAt: new Date().toISOString(), steps: results, ...(evidence ? { ci: evidence } : {}) }, null, 2)}\n`,
  );
  console.log(`publish gate passed: ${outPath}`);
}

if (import.meta.main) await main();
