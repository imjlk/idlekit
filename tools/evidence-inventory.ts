import { readFileSync, realpathSync } from "fs";
import { dirname, join, relative, resolve } from "path";
import {
  disabledClaimLedger,
  evidenceGraph,
  graphLintConfig,
  productionFiles,
  testFiles,
} from "../evidence.config";
import { root } from "./evidence-host";

type InventoryTest = {
  file: string;
  exportName: string;
  registeredAs: string;
  cwd: string;
  args: string[];
};

type InventoryRequirement = {
  id: string;
  pr: string;
  anchor: string;
  doc: string;
  production: string[];
  tests: InventoryTest[];
};

type InventoryFile = {
  requirements: InventoryRequirement[];
};

type BaselineFile = {
  ids: string[];
  protectedFiles: string[];
};

export type ShrinkResult = {
  ok: boolean;
  missing: string[];
};

const NON_PRODUCTION_SUFFIXES = [
  ".test.ts",
  ".test.tsx",
  ".spec.ts",
  ".spec.tsx",
  ".generated.ts",
  ".d.ts",
];
const NON_PRODUCTION_SEGMENTS = new Set(["fixtures", "dist"]);

export function isNonProductionPath(rel: string): boolean {
  const normalized = rel.replaceAll("\\", "/");
  if (NON_PRODUCTION_SUFFIXES.some((suffix) => normalized.endsWith(suffix))) return true;
  return normalized.split("/").some((segment) => NON_PRODUCTION_SEGMENTS.has(segment));
}

function hasProductionExport(body: string): boolean {
  return /\bexport\s+(?:async\s+)?function\b/.test(body)
    || /\bexport\s+(?:const|class|type|interface|enum)\b/.test(body)
    || /\bexport\s*\{/.test(body);
}

function stripAnsi(text: string): string {
  return text.replaceAll(/\u001b\[[0-9;]*m/g, "");
}

function plainTestEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.FORCE_COLOR;
  delete env.CLICOLOR_FORCE;
  env.NO_COLOR = "1";
  return env;
}

function reporterEntry(line: string): { status: string; name: string } | undefined {
  const match = /^\s*\((pass|fail|skip|todo)\)\s+(.+?)\s*(?:\[[^\]]*\])?\s*$/.exec(stripAnsi(line));
  if (!match?.[1] || !match[2]) return undefined;
  return { status: match[1], name: match[2] };
}

/** Bun prints `suite > nested > test title`. The ledger stores that full name. */
function reporterNameMatches(reported: string, registered: string): boolean {
  return reported === registered;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function fail(failures: string[], message: string): void {
  failures.push(message);
}

export async function expandGlob(pattern: string, cwd: string): Promise<string[]> {
  const glob = new Bun.Glob(pattern);
  const matches: string[] = [];
  for await (const file of glob.scan({ cwd, onlyFiles: true })) matches.push(file);
  matches.sort();
  return matches;
}

export async function assertNonEmptyGlobs(patterns: readonly string[], cwd: string): Promise<string[]> {
  const failures: string[] = [];
  for (const pattern of patterns) {
    if (pattern.trim().length === 0) {
      fail(failures, "evidence glob is empty");
      continue;
    }
    const matches = await expandGlob(pattern, cwd);
    if (matches.length === 0) fail(failures, `evidence glob matched no files: ${pattern}`);
  }
  return failures;
}

export async function includedSourceCount(tsconfigPath: string): Promise<number> {
  const project = readJson<{ include?: string[]; files?: string[] }>(tsconfigPath);
  const patterns = [...(project.files ?? []), ...(project.include ?? [])];
  if (patterns.length === 0) return 0;
  const cwd = dirname(tsconfigPath);
  let count = 0;
  for (const pattern of patterns) {
    if (pattern.trim().length === 0) continue;
    for (const file of await expandGlob(pattern, cwd)) {
      if (file.endsWith(".ts") || file.endsWith(".tsx")) count += 1;
    }
  }
  return count;
}

export function omittedProgramHosts(programFiles: readonly string[], hosts: readonly string[]): string[] {
  const present = new Set(programFiles);
  return hosts.filter((host) => !present.has(host));
}

/** Source files of the evidence program, including imports of the included roots. */
export function evidenceProgramSourceFiles(tsconfigPath: string): string[] {
  const base = realpathSync(dirname(tsconfigPath));
  const tsc = join(base, "node_modules", ".bin", "tsc");
  const proc = Bun.spawnSync(
    [tsc, "-p", tsconfigPath, "--listFilesOnly", "--noEmit", "--pretty", "false"],
    { cwd: base, stdout: "pipe", stderr: "pipe" },
  );
  const stdout = proc.stdout.toString();
  if ((proc.exitCode ?? 1) !== 0 && stdout.trim().length === 0) {
    throw new Error(proc.stderr.toString() || "tsc --listFilesOnly failed");
  }
  const files: string[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.includes("/node_modules/") || trimmed.endsWith(".d.ts")) continue;
    const rel = relative(base, realpathSync(trimmed)).replaceAll("\\", "/");
    if (rel.startsWith("..")) continue;
    files.push(rel);
  }
  return files;
}

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

/**
 * Project auxiliary check. This does not parse `@evidence` tags and does not
 * decide whether an assertion is logically complete. Evidence answers citation
 * coverage. This answers whether the ledger's tests actually ran.
 */
export function assertExecutedTests(output: string, exitCode: number, names: readonly string[]): string[] {
  const failures: string[] = [];
  if (names.length === 0) fail(failures, "execution ledger has no test names");
  const passLine = /(\d+)\s+pass\b/.exec(output);
  const passCount = passLine ? Number(passLine[1]) : 0;
  if (exitCode !== 0) fail(failures, `bun test exited ${exitCode}`);
  if (!Number.isFinite(passCount) || passCount === 0) {
    fail(failures, "bun test pass count is 0");
  }
  for (const name of names) {
    const entries = output
      .split("\n")
      .map(reporterEntry)
      .filter(
        (entry): entry is { status: string; name: string } =>
          entry !== undefined && reporterNameMatches(entry.name, name),
      );
    const reportedNames = new Set(entries.map((entry) => entry.name));
    if (reportedNames.size > 1) {
      fail(failures, `executed reporter matched more than one suite for ${name}`);
      continue;
    }
    if (!entries.some((entry) => entry.status === "pass")) {
      fail(failures, `executed reporter missed a passing ${name}`);
    }
  }
  return failures;
}

export function headingAnchors(markdown: string): string[] {
  const anchors: string[] = [];
  let fenceChar: "`" | "~" | undefined;
  let fenceLength = 0;
  let inComment = false;
  for (const rawLine of markdown.split("\n")) {
    const marker = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(rawLine);
    const opener = marker?.[2];
    const info = marker?.[3] ?? "";
    if (!fenceChar) {
      if (opener) {
        fenceChar = opener.startsWith("`") ? "`" : "~";
        fenceLength = opener.length;
        continue;
      }
    } else if (opener && opener.startsWith(fenceChar) && opener.length >= fenceLength && info.trim() === "") {
      fenceChar = undefined;
      fenceLength = 0;
      continue;
    } else {
      continue;
    }
    if (inComment) {
      if (rawLine.includes("-->")) inComment = false;
      continue;
    }
    const commentAt = rawLine.indexOf("<!--");
    const line = commentAt === -1 ? rawLine : rawLine.slice(0, commentAt);
    if (commentAt !== -1 && !rawLine.includes("-->", commentAt + 4)) inComment = true;
    const heading = line.replace(/^ {0,3}/, "");
    const match = /^##\s+.+\{#([A-Za-z0-9][A-Za-z0-9._:-]*)\}\s*$/.exec(heading);
    if (heading.startsWith("## ") && !match) {
      anchors.push("");
      continue;
    }
    if (match?.[1]) anchors.push(match[1]);
  }
  return anchors;
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

function showBaseline(spec: string): BaselineFile | undefined {
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

function previousRevision(): string | undefined {
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

function previousBaseline(): BaselineFile | undefined {
  const revision = previousRevision();
  return revision ? showBaseline(revision) : undefined;
}

/** An approval counts only when this baseline transition adds or edits its file. */
export function approvalApplies(current: string, previous: string | undefined): boolean {
  return previous === undefined || previous !== current;
}

/** Approval files name retired protected paths as bullet lines of `` `path` ``. */
async function readApprovals(revision: string): Promise<{ ids: string[]; files: string[] }> {
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

function exportsNamedFunction(body: string, name: string): boolean {
  return new RegExp(`export\\s+(?:async\\s+)?function\\s+${name}\\b`).test(body);
}

function registersNamedTest(body: string, registeredAs: string, exportName: string): boolean {
  const parts = registeredAs.split(" > ");
  const title = parts.at(-1);
  if (!title) return false;
  const quoted = JSON.stringify(title).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const fn = exportName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!new RegExp(`\\b(?:it|test)\\(\\s*${quoted}\\s*,\\s*${fn}\\b`).test(body)) return false;
  return parts.slice(0, -1).every((suite) => {
    const suiteQuoted = JSON.stringify(suite).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\bdescribe\\(\\s*${suiteQuoted}`).test(body);
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `quota` must not match a citation of `quota-v2`. */
function citesAnchor(text: string, doc: string, anchor: string): boolean {
  const pattern = `@evidence ${escapeRegExp(doc)}#${escapeRegExp(anchor)}(?![A-Za-z0-9._:-])`;
  return new RegExp(pattern).test(text);
}

/** The block comment immediately above this export, with no nested terminator. */
function adjacentExportComment(body: string, exportName: string): string | undefined {
  const fn = exportName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(
    `\\/\\*\\*((?:(?!\\*\\/)[\\s\\S])*)\\*\\/\\s*export\\s+(?:async\\s+)?function\\s+${fn}\\b`,
  ).exec(body);
  return match?.[1];
}

/** The doc comment on the exported test must cite this requirement, not only share its file. */
function citesRequirement(body: string, exportName: string, doc: string, anchor: string): boolean {
  const comment = adjacentExportComment(body, exportName);
  return comment !== undefined && citesAnchor(comment, doc, anchor);
}

function evidenceTargets(comment: string): string[] {
  const targets: string[] = [];
  for (const match of comment.matchAll(/@evidence\s+(\S+)/g)) {
    if (match[1]) targets.push(match[1]);
  }
  return targets;
}

function isRequirementTarget(target: string, doc: string, anchor: string): boolean {
  const pattern = `^${escapeRegExp(doc)}#${escapeRegExp(anchor)}(?![A-Za-z0-9._:-])`;
  return new RegExp(pattern).test(target);
}

function isImplementationTarget(target: string, doc: string, anchor: string): boolean {
  if (isRequirementTarget(target, doc, anchor)) return false;
  return target.includes(".ts#") || target.startsWith("./") || target.startsWith("../");
}

function citedPath(target: string, testFile: string): string | undefined {
  const pathPart = target.split("#")[0]?.replaceAll("\\", "/");
  if (!pathPart) return undefined;
  if (pathPart.startsWith("./") || pathPart.startsWith("../")) {
    return relative(root, resolve(root, dirname(testFile), pathPart)).replaceAll("\\", "/");
  }
  if (pathPart.endsWith(".ts") || pathPart.endsWith(".tsx")) return pathPart;
  return undefined;
}

function citesProduction(target: string, testFile: string, production: readonly string[]): boolean {
  const cited = citedPath(target, testFile);
  return cited !== undefined && production.some((host) => host.replaceAll("\\", "/") === cited);
}

export type ImplementationHostGap =
  | ""
  | undefined
  | { kind: "unregistered" | "foreign"; name: string };

/** Inventoried exports must cite this requirement's production hosts, not another requirement's. */
export function unregisteredImplementationHost(
  body: string,
  doc: string,
  anchor: string,
  registered: readonly string[],
  scope: { file: string; production: readonly string[]; fileRegistered?: readonly string[] } = {
    file: "test.ts",
    production: [],
  },
): ImplementationHostGap {
  const names = new Set(scope.fileRegistered ?? registered);
  const own = new Set(registered);
  let ownCites = false;
  for (const match of body.matchAll(
    /\/\*\*((?:(?!\*\/)[\s\S])*)\*\/\s*export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/g,
  )) {
    const comment = match[1] ?? "";
    const name = match[2];
    if (!name) continue;
    const implementation = evidenceTargets(comment).filter((target) =>
      isImplementationTarget(target, doc, anchor),
    );
    if (implementation.length === 0) continue;
    if (!names.has(name)) return { kind: "unregistered", name };
    if (!own.has(name)) continue;
    if (implementation.some((target) => !citesProduction(target, scope.file, scope.production))) {
      return { kind: "foreign", name };
    }
    ownCites = true;
  }
  return ownCites ? undefined : "";
}

export function productionFileCites(body: string, doc: string, anchor: string): boolean {
  for (const match of body.matchAll(/\/\*\*((?:(?!\*\/)[\s\S])*)\*\//g)) {
    if (!match[1] || !citesAnchor(match[1], doc, anchor) || match.index === undefined) continue;
    const after = body.slice(match.index + match[0].length);
    // A // note may sit between the doc block and the export. Another block comment may not.
    const exportFollows = new RegExp(
      "^(?:\\s|//[^\\n]*(?:\\n|$))*export\\s+(?:async\\s+)?(?:function|const)\\b",
    );
    if (exportFollows.test(after)) return true;
  }
  return false;
}

export function commandTargetsFile(test: InventoryTest): boolean {
  if (test.args[0] !== "test") return false;
  const fromCwd = relative(test.cwd, test.file).replaceAll("\\", "/");
  return test.args.slice(1).some((arg) => {
    const normalized = arg.replaceAll("\\", "/");
    return normalized === fromCwd || normalized === test.file;
  });
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

function enabledMarkdownGlobs(): string[] {
  const globs: string[] = [];
  for (const claim of evidenceGraph.claims) {
    if (claim.disabled) continue;
    const references = Array.isArray(claim.reference) ? claim.reference : [claim.reference];
    for (const reference of references) {
      if (reference.type === "markdown") globs.push(...reference.files);
    }
  }
  return [...new Set(globs)];
}

function claimFiles(): string[] {
  const files: string[] = [];
  for (const claim of evidenceGraph.claims) {
    if (claim.disabled) continue;
    files.push(...claim.files);
  }
  return files;
}

export async function checkInventory(projectRoot = root): Promise<string[]> {
  const failures: string[] = [];
  const inventory = readJson<InventoryFile>(join(projectRoot, "docs/requirements/inventory.json"));
  const baseline = readJson<BaselineFile>(
    join(projectRoot, "docs/requirements/coverage-baseline.json"),
  );
  const inventoryIds = inventory.requirements.map((requirement) => requirement.id);
  if (inventoryIds.length === 0) fail(failures, "active inventory has no requirements");
  if (new Set(inventoryIds).size !== inventoryIds.length) {
    fail(failures, "inventory requirement ids are duplicated");
  }
  const baselineIds = [...baseline.ids];
  if (new Set(baselineIds).size !== baselineIds.length) {
    fail(failures, "coverage baseline ids are duplicated");
  }
  if (baselineIds.join("\n") !== inventoryIds.join("\n")) {
    fail(failures, "inventory ids and coverage baseline ids differ");
  }

  const revision = projectRoot === root ? previousRevision() : undefined;
  const approvals = revision ? await readApprovals(revision) : { ids: [], files: [] };
  const previous = revision ? showBaseline(revision) : undefined;
  if (previous) {
    const shrink = retainedCoverage(previous.ids, baseline.ids, approvals.ids);
    if (!shrink.ok) {
      fail(failures, `active coverage shrunk without approval: ${shrink.missing.join(", ")}`);
    }
    const fileShrink = retainedCoverage(
      previous.protectedFiles,
      baseline.protectedFiles,
      approvals.files,
    );
    if (!fileShrink.ok) {
      fail(
        failures,
        `protected evidence files shrunk without approval: ${fileShrink.missing.join(", ")}`,
      );
    }
  }

  for (const rel of baseline.protectedFiles) {
    const path = join(projectRoot, rel);
    try {
      readFileSync(path);
    } catch {
      fail(failures, `protected evidence file is missing: ${rel}`);
    }
    const isPackageHost = rel.startsWith("packages/") && rel.endsWith(".ts");
    const listed = inventory.requirements.some(
      (requirement) =>
        requirement.production.includes(rel) || requirement.tests.some((test) => test.file === rel),
    );
    if (isPackageHost && !listed) {
      fail(failures, `protected evidence host left the inventory: ${rel}`);
    }
  }

  const activeDocs = await expandGlob("docs/requirements/active/**/*.md", projectRoot);
  if (activeDocs.length === 0) fail(failures, "active requirements directory is empty");
  const seenPairs = new Set<string>();
  for (const doc of activeDocs) {
    const text = readFileSync(join(projectRoot, doc), "utf8");
    const seenInDoc = new Set<string>();
    for (const anchor of headingAnchors(text)) {
      if (anchor.length === 0) {
        fail(failures, `active H2 is missing an explicit anchor: ${doc}`);
        continue;
      }
      if (seenInDoc.has(anchor)) {
        fail(failures, `active document repeats anchor ${anchor}: ${doc}`);
        continue;
      }
      seenInDoc.add(anchor);
      seenPairs.add(`${doc}#${anchor}`);
    }
  }

  for (const requirement of inventory.requirements) {
    if (!requirement.pr) fail(failures, `${requirement.id} has no PR id`);
    if (!seenPairs.has(`${requirement.doc}#${requirement.anchor}`)) {
      fail(
        failures,
        `${requirement.id} anchor ${requirement.anchor} is not an active H2 in ${requirement.doc}`,
      );
    }
    const docText = readFileSync(join(projectRoot, requirement.doc), "utf8");
    if (!docText.includes(`{#${requirement.anchor}}`)) {
      fail(failures, `${requirement.id} doc does not contain its anchor`);
    }
    if (requirement.production.length === 0) fail(failures, `${requirement.id} has no production files`);
    for (const rel of requirement.production) {
      if (isNonProductionPath(rel)) {
        fail(
          failures,
          `${requirement.id} production file is a test, fixture, or generated file: ${rel}`,
        );
      }
      const body = readFileSync(join(projectRoot, rel), "utf8");
      if (!hasProductionExport(body)) {
        fail(failures, `${requirement.id} production file has no export: ${rel}`);
      }
      if (!productionFileCites(body, requirement.doc, requirement.anchor)) {
        fail(
          failures,
          `${requirement.id} production file ${rel} does not cite ${requirement.doc}#${requirement.anchor}`,
        );
      }
    }
    if (requirement.tests.length === 0) fail(failures, `${requirement.id} has no executed tests`);
    for (const test of requirement.tests) {
      const body = readFileSync(join(projectRoot, test.file), "utf8");
      if (!exportsNamedFunction(body, test.exportName)) {
        fail(failures, `${requirement.id} test export ${test.exportName} is missing`);
      }
      if (!registersNamedTest(body, test.registeredAs, test.exportName)) {
        fail(failures, `${requirement.id} does not register ${test.exportName} with the runner`);
      }
      if (!commandTargetsFile(test)) {
        fail(failures, `${requirement.id} command does not run ${test.file}`);
      }
      if (!citesRequirement(body, test.exportName, requirement.doc, requirement.anchor)) {
        fail(
          failures,
          `${requirement.id} test ${test.exportName} does not cite ${requirement.doc}#${requirement.anchor}`,
        );
      }
      if (!baseline.protectedFiles.includes(test.file)) {
        fail(failures, `inventory host is not protected: ${test.file}`);
      }
    }
    for (const rel of requirement.production) {
      if (!baseline.protectedFiles.includes(rel)) {
        fail(failures, `inventory host is not protected: ${rel}`);
      }
    }
    const files = [...new Set(requirement.tests.map((test) => test.file))];
    for (const file of files) {
      const body = readFileSync(join(projectRoot, file), "utf8");
      const registered = requirement.tests
        .filter((test) => test.file === file)
        .map((test) => test.exportName);
      const fileRegistered = inventory.requirements.flatMap((entry) =>
        entry.tests
          .filter((test) => test.file === file)
          .map((test) => test.exportName),
      );
      const host = unregisteredImplementationHost(
        body,
        requirement.doc,
        requirement.anchor,
        registered,
        {
          file,
          production: requirement.production,
          fileRegistered,
        },
      );
      if (host === "") {
        fail(failures, `${requirement.id} inventoried tests do not cite the implementation`);
      } else if (host?.kind === "unregistered") {
        fail(
          failures,
          `${requirement.id} implementation citation is on unregistered export ${host.name}`,
        );
      } else if (host?.kind === "foreign") {
        fail(
          failures,
          `${requirement.id} test ${host.name} cites an implementation outside its production hosts`,
        );
      }
    }
  }

  for (const pair of seenPairs) {
    const split = pair.lastIndexOf("#");
    const doc = pair.slice(0, split);
    const anchor = pair.slice(split + 1);
    if (
      !inventory.requirements.some(
        (requirement) => requirement.doc === doc && requirement.anchor === anchor,
      )
    ) {
      fail(failures, `active anchor ${pair} is missing from the inventory`);
    }
  }

  const activeGlobs = enabledMarkdownGlobs().filter((glob) => glob.includes("/active/"));
  const activeScan = await expandGlob("docs/requirements/active/**/*.md", projectRoot);
  const covered = new Set<string>();
  for (const glob of activeGlobs) {
    for (const file of await expandGlob(glob, projectRoot)) covered.add(file);
  }
  if (activeGlobs.length === 0 || covered.size === 0) {
    fail(failures, "enabled graph claims cover no active requirements");
  }
  for (const doc of activeScan) {
    if (!covered.has(doc)) fail(failures, `active graph references omit ${doc}`);
  }
  const globFailures = await assertNonEmptyGlobs(
    [...activeGlobs, "docs/requirements/planned/**/*.md", ...productionFiles, ...testFiles],
    projectRoot,
  );
  failures.push(...globFailures);

  for (const rel of claimFiles()) {
    if (isNonProductionPath(rel) && productionFiles.includes(rel)) {
      fail(failures, `production claim includes a non-production file: ${rel}`);
    }
  }
  for (const rel of productionFiles) {
    if (testFiles.includes(rel)) fail(failures, `production and test claims share ${rel}`);
  }

  let programFiles: string[] = [];
  try {
    programFiles = evidenceProgramSourceFiles(join(projectRoot, "tsconfig.evidence.json"));
  } catch (error) {
    fail(failures, error instanceof Error ? error.message : String(error));
  }
  if (!programFiles.some((file) => file.endsWith(".ts") || file.endsWith(".tsx"))) {
    fail(failures, "tsconfig.evidence.json includes no TypeScript sources");
  }
  for (const host of omittedProgramHosts(programFiles, [...productionFiles, ...testFiles])) {
    fail(failures, `evidence program omits graph host ${host}`);
  }

  const evidenceTsconfig = readFileSync(join(projectRoot, "tsconfig.evidence.json"), "utf8");
  if (evidenceTsconfig.includes("@ttsc/evidence")) {
    fail(failures, "tsconfig.evidence.json lists @ttsc/evidence as a compiler plugin");
  }
  let evidencePlugins: Array<{ transform?: string; configFile?: string; enabled?: boolean }> = [];
  try {
    const parsed = JSON.parse(evidenceTsconfig) as {
      compilerOptions?: { plugins?: Array<{ transform?: string; configFile?: string; enabled?: boolean }> };
    };
    evidencePlugins = parsed.compilerOptions?.plugins ?? [];
  } catch (error) {
    fail(failures, error instanceof Error ? error.message : String(error));
  }
  const lintPlugin = evidencePlugins.find((plugin) => plugin.transform === "@ttsc/lint");
  const lintEnabled =
    lintPlugin !== undefined && lintPlugin.enabled !== false && lintPlugin.configFile === "./lint.config.ts";
  if (!lintEnabled) {
    fail(failures, "tsconfig.evidence.json must enable @ttsc/lint for lint.config.ts");
  }
  const loadedRules = graphLintConfig.rules;
  const graphRule = loadedRules["evidence/graph"];
  const reviewRule = loadedRules["evidence/review"];
  const graphOn =
    Array.isArray(graphRule) &&
    graphRule[0] === "error" &&
    typeof graphRule[1] === "object" &&
    graphRule[1] !== null;
  const reviewOn = reviewRule === "error" || (Array.isArray(reviewRule) && reviewRule[0] === "error");
  if (!graphOn || !reviewOn) {
    fail(failures, "lint.config.ts must enable evidence/graph and evidence/review");
  }
  const evidencePackage = readJson<{ ttsc?: unknown }>(
    join(projectRoot, "node_modules", "@ttsc", "evidence", "package.json"),
  );
  if (evidencePackage.ttsc !== undefined) {
    fail(
      failures,
      "@ttsc/evidence declares a ttsc compiler plugin; it must stay a lint contributor",
    );
  }

  const disabledNames = evidenceGraph.claims.filter((claim) => claim.disabled).map(
    (claim) => claim.name,
  );
  for (const entry of disabledClaimLedger) {
    if (!entry.owner || !entry.scope || !entry.activatesIn) {
      fail(failures, `disabled claim ${entry.name} is missing owner, scope, or activating PR`);
    }
    if (!disabledNames.includes(entry.name)) {
      fail(failures, `disabled ledger ${entry.name} is not disabled in the graph`);
    }
  }
  for (const name of disabledNames) {
    if (!disabledClaimLedger.some((entry) => entry.name === name)) {
      fail(failures, `disabled claim ${name} has no ledger entry`);
    }
  }

  const inventoryTestFiles = [
    ...new Set(inventory.requirements.flatMap((requirement) => requirement.tests.map((test) => test.file))),
  ].sort();
  const graphTestFiles = [...testFiles].sort();
  if (inventoryTestFiles.join("\n") !== graphTestFiles.join("\n")) {
    fail(
      failures,
      `inventory test files and evidence graph test hosts differ: inventory=${inventoryTestFiles.join(",")} graph=${graphTestFiles.join(",")}`,
    );
  }
  const inventoryProductionFiles = [
    ...new Set(inventory.requirements.flatMap((requirement) => requirement.production)),
  ].sort();
  const graphProductionFiles = [...productionFiles].sort();
  if (inventoryProductionFiles.join("\n") !== graphProductionFiles.join("\n")) {
    fail(
      failures,
      `inventory production files and evidence graph production hosts differ: inventory=${inventoryProductionFiles.join(",")} graph=${graphProductionFiles.join(",")}`,
    );
  }

  const names = inventory.requirements.flatMap((requirement) =>
    requirement.tests.map((test) => test.registeredAs),
  );
  const groups = new Map<string, InventoryTest[]>();
  for (const requirement of inventory.requirements) {
    for (const test of requirement.tests) {
      const key = `${test.cwd}\n${test.args.join("\0")}`;
      const list = groups.get(key) ?? [];
      list.push(test);
      groups.set(key, list);
    }
  }
  for (const tests of groups.values()) {
    const first = tests[0];
    if (!first) continue;
    const proc = Bun.spawnSync([process.execPath, ...first.args], {
      cwd: resolve(projectRoot, first.cwd),
      stdout: "pipe",
      stderr: "pipe",
      env: plainTestEnv(),
    });
    const output = `${proc.stdout.toString()}\n${proc.stderr.toString()}`;
    failures.push(
      ...assertExecutedTests(
        output,
        proc.exitCode ?? 1,
        tests.map((test) => test.registeredAs),
      ),
    );
  }
  if (names.length === 0) fail(failures, "inventory execution list is empty");
  return failures;
}

if (import.meta.main) {
  const failures = await checkInventory(root);
  if (failures.length > 0) {
    for (const message of failures) console.error(message);
    process.exit(1);
  }
  console.log("evidence inventory passed");
}
