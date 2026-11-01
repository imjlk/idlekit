/**
 * Decides whether the Release publish job can reuse the CI that `main` already ran for the
 * selected commit. Only a `push` run on `main` for that exact SHA, from the repository's own
 * workflow file, counts. A red or cancelled run fails publication; a run that never appears,
 * an unreadable API, or a deadline that passes leaves the full local gate to run.
 */

/** A workflow whose run on the selected commit proves some publish gate steps. */
export type RequiredWorkflow = Readonly<{
  /** Repository-relative workflow file, for example `.github/workflows/ci.yml`. */
  path: string;
  /** Job ids whose steps the publish gate would otherwise repeat. */
  jobs: readonly string[];
}>;

/** The fields of a GitHub workflow run that this check reads. */
export type WorkflowRun = Readonly<{
  id: number;
  path: string;
  event: string;
  head_branch: string | null;
  head_sha: string;
  status: string | null;
  conclusion: string | null;
  html_url?: string;
  repository?: Readonly<{ full_name: string }>;
  head_repository?: Readonly<{ full_name: string }> | null;
}>;

export type WorkflowJob = Readonly<{ name: string; status: string | null; conclusion: string | null }>;

export type ReusedRun = Readonly<{ path: string; id: number; url: string }>;
export type CiEvidence =
  | Readonly<{ kind: "reused"; runs: readonly ReusedRun[] }>
  | Readonly<{ kind: "unavailable"; reason: string }>;

export class MainCiFailedError extends Error {
  override name = "MainCiFailedError";
}

const MAIN = "main";
/** Job conclusions that make the whole run fail; a run is not waited out once one appears. */
const FAILED_JOB = new Set(["failure", "cancelled", "timed_out", "action_required", "startup_failure", "stale"]);

/**
 * Only a push to main for the selected commit, from this repository's own workflow file, counts.
 * The API can qualify the path with the ref it ran from; only `main` is accepted.
 */
export function trustedRun(run: WorkflowRun, input: Readonly<{ repository: string; sha: string; path: string }>): boolean {
  return (
    run.event === "push" &&
    run.head_branch === MAIN &&
    run.head_sha === input.sha &&
    [input.path, `${input.path}@${MAIN}`, `${input.path}@refs/heads/${MAIN}`].includes(run.path) &&
    run.repository?.full_name === input.repository &&
    run.head_repository?.full_name === input.repository
  );
}

/** The newest trusted run; a later push of the same commit replaces an earlier run. */
export function selectRun(
  runs: readonly WorkflowRun[],
  input: Readonly<{ repository: string; sha: string; path: string }>,
): WorkflowRun | undefined {
  return runs.filter((run) => trustedRun(run, input)).sort((a, b) => b.id - a.id)[0];
}

export type RunVerdict =
  | Readonly<{ kind: "success" }>
  | Readonly<{ kind: "pending" }>
  | Readonly<{ kind: "failed"; reason: string }>
  | Readonly<{ kind: "unproven"; reason: string }>;

/**
 * A completed run must conclude `success` and every required job must have succeeded. A
 * failed job fails the verdict before the run completes. A successful run that lacks a
 * required job (renamed, skipped) proves nothing, so the gate runs that step itself.
 */
export function judgeRun(run: WorkflowRun, jobs: readonly WorkflowJob[], required: readonly string[]): RunVerdict {
  const label = `${run.path} run ${run.id}`;
  const failedJob = jobs.find((job) => job.status === "completed" && FAILED_JOB.has(job.conclusion ?? ""));
  if (failedJob) return { kind: "failed", reason: `${label}: job ${failedJob.name} ${failedJob.conclusion}` };
  if (run.status !== "completed") return { kind: "pending" };
  if (run.conclusion !== "success") return { kind: "failed", reason: `${label} concluded ${run.conclusion ?? "without a conclusion"}` };
  for (const name of required) {
    const job = jobs.find((candidate) => candidate.name === name);
    if (job?.conclusion !== "success") {
      return { kind: "unproven", reason: `${label}: required job ${name} ${job ? `concluded ${job.conclusion}` : "is missing"}` };
    }
  }
  return { kind: "success" };
}

export type WaitOptions = Readonly<{
  repository: string;
  sha: string;
  workflows: readonly RequiredWorkflow[];
  /** GET a GitHub REST path such as `/repos/o/r/actions/runs/1/jobs`; throws on an HTTP error. */
  api: (path: string) => Promise<unknown>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
  /** Give up waiting for the runs to finish after this long, then run the full gate. */
  deadlineMs: number;
  /** Give up waiting for a run to appear after this long; push runs start with the push. */
  appearMs: number;
  pollMs: number;
  /** Consecutive API failures that end the wait. */
  maxApiErrors?: number;
}>;

/**
 * Polls the required workflows on the selected commit until each one succeeds, one fails,
 * or the wait ends. Throws `MainCiFailedError` for a red run; never falls back from one.
 */
export async function waitForMainCi(options: WaitOptions): Promise<CiEvidence> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const log = options.log ?? ((line: string) => console.log(line));
  const maxApiErrors = options.maxApiErrors ?? 3;
  const startedAt = now();
  let apiErrors = 0;
  let lastWait = "";

  if (!/^[0-9a-f]{40}$/.test(options.sha)) return { kind: "unavailable", reason: `selected commit ${options.sha} is not a full SHA` };
  if (!/^[^/\s]+\/[^/\s]+$/.test(options.repository)) {
    return { kind: "unavailable", reason: `repository ${options.repository || "(unset)"} is not owner/name` };
  }

  while (true) {
    const elapsed = now() - startedAt;
    const reused: ReusedRun[] = [];
    const waiting: string[] = [];
    const unproven: string[] = [];
    const errors: string[] = [];
    // Every workflow is read on every poll, so an API error on one cannot hide a red run of another.
    for (const workflow of options.workflows) {
      let run: WorkflowRun | undefined;
      let jobs: WorkflowJob[];
      try {
        const file = workflow.path.split("/").pop()!;
        const query = new URLSearchParams({ head_sha: options.sha, event: "push", branch: MAIN, per_page: "100" });
        const listed = (await options.api(
          `/repos/${options.repository}/actions/workflows/${encodeURIComponent(file)}/runs?${query}`,
        )) as { workflow_runs?: WorkflowRun[] };
        run = selectRun(listed.workflow_runs ?? [], { repository: options.repository, sha: options.sha, path: workflow.path });
        if (!run) {
          if (elapsed >= options.appearMs) unproven.push(`no push run of ${workflow.path} on ${MAIN} for ${options.sha}`);
          else waiting.push(`${workflow.path} (not started)`);
          continue;
        }
        // A run the listing already reports as red fails without its jobs: a jobs API error cannot hide it.
        if (run.status === "completed" && run.conclusion !== "success") {
          throw new MainCiFailedError(`main CI failed for ${options.sha}: ${run.path} run ${run.id} concluded ${run.conclusion ?? "without a conclusion"}`);
        }
        const listedJobs = (await options.api(
          `/repos/${options.repository}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`,
        )) as { jobs?: WorkflowJob[] };
        jobs = listedJobs.jobs ?? [];
      } catch (error) {
        if (error instanceof MainCiFailedError) throw error;
        errors.push(`${workflow.path}: ${(error as Error).message}`);
        continue;
      }
      const verdict = judgeRun(run, jobs, workflow.jobs);
      // A red run fails publication at once: no API error or missing run elsewhere turns it into a fallback.
      if (verdict.kind === "failed") throw new MainCiFailedError(`main CI failed for ${options.sha}: ${verdict.reason}`);
      if (verdict.kind === "unproven") unproven.push(verdict.reason);
      else if (verdict.kind === "pending") waiting.push(`${workflow.path} run ${run.id} (${run.status})`);
      else reused.push({ path: workflow.path, id: run.id, url: run.html_url ?? "" });
    }
    if (errors.length > 0) {
      apiErrors += 1;
      log(`GitHub API error ${apiErrors}/${maxApiErrors}: ${errors.join("; ")}`);
      if (apiErrors >= maxApiErrors) return { kind: "unavailable", reason: `GitHub API failed ${apiErrors} times` };
    } else {
      apiErrors = 0;
      // A run that cannot be reused still waits for the others, so a later red run fails publication.
      if (waiting.length === 0) {
        return unproven.length > 0 ? { kind: "unavailable", reason: unproven.join("; ") } : { kind: "reused", runs: reused };
      }
      const line = `waiting for ${[...waiting, ...unproven.map((reason) => `(not reusable: ${reason})`)].join(", ")}`;
      if (line !== lastWait) log(line);
      lastWait = line;
    }
    if (now() - startedAt + options.pollMs > options.deadlineMs) {
      return { kind: "unavailable", reason: `main CI did not finish within ${Math.round(options.deadlineMs / 60_000)} minutes` };
    }
    await sleep(options.pollMs);
  }
}

/** A GET against the GitHub REST API with the given token. */
export function githubApi(token: string, base = "https://api.github.com"): (path: string) => Promise<unknown> {
  return async (path) => {
    const response = await fetch(`${base}${path}`, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`GET ${path}: HTTP ${response.status}`);
    return response.json();
  };
}
