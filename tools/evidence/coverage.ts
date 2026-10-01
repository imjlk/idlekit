import { readFileSync } from "fs";
import { join } from "path";
import { root } from "../evidence-host";

import { type BaselineFile, type ShrinkResult } from "./model";
import { expandGlob } from "./program";

export function retainedCoverage(
  previous: readonly string[],
  current: readonly string[],
  approved: readonly string[],
): ShrinkResult {
  const currentSet = new Set(current);
  const approvedSet = new Set(approved);
  const missing = previous.filter((id) => !currentSet.has(id) && !approvedSet.has(id));
  return { ok: missing.length === 0, missing };
}

function showPath(spec: string, path: string): string | undefined {
  const proc = Bun.spawnSync(["git", "show", `${spec}:${path}`], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) return undefined;
  return proc.stdout.toString();
}

export function showBaseline(spec: string): BaselineFile | undefined {
  const text = showPath(spec, "docs/requirements/coverage-baseline.json");
  if (text === undefined) return undefined;
  return JSON.parse(text) as BaselineFile;
}

function fetchRevision(revision: string): boolean {
  const proc = Bun.spawnSync(["git", "fetch", "--no-tags", "--depth=1", "origin", revision], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  return proc.exitCode === 0;
}

/** An explicit baseline revision that cannot be fetched fails the gate. A fetched commit with no baseline file does not. */
export function requireFetchedRevision(
  revision: string,
  fetched: boolean,
  baselineFound: boolean,
): string | undefined {
  if (!fetched) throw new Error(`evidence baseline revision ${revision} could not be fetched`);
  return baselineFound ? revision : undefined;
}

/** The pull-request base SHA wins over a branch name that can move during the job. */
export function recordedBaseSpec(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const sha = env.GITHUB_BASE_SHA ?? "";
  return /^[0-9a-f]{40}$/.test(sha) ? sha : undefined;
}

export function previousRevision(): string | undefined {
  const recorded = recordedBaseSpec();
  if (recorded) {
    return requireFetchedRevision(
      recorded,
      fetchRevision(recorded),
      showBaseline(recorded) !== undefined,
    );
  }
  const baseRef = process.env.GITHUB_BASE_REF;
  if (baseRef) {
    requireFetchedRevision(baseRef, fetchRevision(baseRef), true);
    const spec = `origin/${baseRef}`;
    return showBaseline(spec) ? spec : undefined;
  }
  const before = process.env.GITHUB_BEFORE ?? "";
  if (/^[0-9a-f]{40}$/.test(before) && !before.startsWith("0000000")) {
    return requireFetchedRevision(
      before,
      fetchRevision(before),
      showBaseline(before) !== undefined,
    );
  }
  if (showBaseline("HEAD^")) return "HEAD^";
  return undefined;
}

/** An approval counts only when this baseline transition adds or edits its file. */
export function approvalApplies(current: string, previous: string | undefined): boolean {
  return previous === undefined || previous !== current;
}

/** Approval files name retired protected paths as bullet lines of `` `path` ``. */
export async function readApprovals(revision: string): Promise<{ ids: string[]; files: string[] }> {
  const ids: string[] = [];
  const files: string[] = [];
  for (const id of await approvalIds()) {
    const rel = `docs/requirements/approvals/${id}.md`;
    let text = "";
    try {
      text = readFileSync(join(root, rel), "utf8");
    } catch {
      continue;
    }
    if (!approvalApplies(text, showPath(revision, rel))) continue;
    ids.push(id);
    for (const line of text.split("\n")) {
      const match = /^\s*-\s+`([^`]+)`\s*$/.exec(line);
      if (match?.[1]) files.push(match[1]);
    }
  }
  return { ids, files };
}

async function approvalIds(): Promise<string[]> {
  const dir = join(root, "docs", "requirements", "approvals");
  let files: string[] = [];
  try {
    files = await expandGlob("*.md", dir);
  } catch {
    return [];
  }
  return files.map((file) => file.replace(/\.md$/, ""));
}
