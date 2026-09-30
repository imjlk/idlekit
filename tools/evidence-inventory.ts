import { readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { disabledClaimLedger, evidenceGraph, productionFiles, testFiles } from "../evidence.config";
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

const NON_PRODUCTION = [
  ".test.ts",
  ".test.tsx",
  ".spec.ts",
  "/fixtures/",
  "/dist/",
  ".generated.ts",
  ".d.ts",
];

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
    if (!output.includes(name)) fail(failures, `executed reporter missed ${name}`);
    const lines = output.split("\n").filter((line) => line.includes(name));
    if (lines.some((line) => line.includes("(skip)") || line.includes("(fail)"))) {
      fail(failures, `required test was skipped or failed: ${name}`);
    }
  }
  return failures;
}

function headingAnchors(markdown: string): string[] {
  const anchors: string[] = [];
  for (const line of markdown.split("\n")) {
    const match = /^##\s+.+\{#([A-Za-z0-9][A-Za-z0-9._:-]*)\}\s*$/.exec(line);
    if (line.startsWith("## ") && !match) {
      anchors.push("");
      continue;
    }
    if (match?.[1]) anchors.push(match[1]);
  }
  return anchors;
}

function previousBaseline(): BaselineFile | undefined {
  const proc = Bun.spawnSync(["git", "show", "HEAD:docs/requirements/coverage-baseline.json"], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) return undefined;
  return JSON.parse(proc.stdout.toString()) as BaselineFile;
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
  const baselineIds = [...baseline.ids];
  if (baselineIds.join("\n") !== inventoryIds.join("\n")) {
    fail(failures, "inventory ids and coverage baseline ids differ");
  }

  const previous = projectRoot === root ? previousBaseline() : undefined;
  if (previous) {
    const shrink = retainedCoverage(previous.ids, baseline.ids, await approvalIds());
    if (!shrink.ok) {
      fail(failures, `active coverage shrunk without approval: ${shrink.missing.join(", ")}`);
    }
    const fileShrink = retainedCoverage(previous.protectedFiles, baseline.protectedFiles, []);
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
  }

  const activeDocs = await expandGlob("docs/requirements/active/**/*.md", projectRoot);
  if (activeDocs.length === 0) fail(failures, "active requirements directory is empty");
  const seenAnchors = new Set<string>();
  for (const doc of activeDocs) {
    const text = readFileSync(join(projectRoot, doc), "utf8");
    for (const anchor of headingAnchors(text)) {
      if (anchor.length === 0) {
        fail(failures, `active H2 is missing an explicit anchor: ${doc}`);
        continue;
      }
      seenAnchors.add(anchor);
    }
  }

  for (const requirement of inventory.requirements) {
    if (!requirement.pr) fail(failures, `${requirement.id} has no PR id`);
    if (!seenAnchors.has(requirement.anchor)) {
      fail(failures, `${requirement.id} anchor ${requirement.anchor} is not an active H2`);
    }
    const docText = readFileSync(join(projectRoot, requirement.doc), "utf8");
    if (!docText.includes(`{#${requirement.anchor}}`)) {
      fail(failures, `${requirement.id} doc does not contain its anchor`);
    }
    if (requirement.production.length === 0) fail(failures, `${requirement.id} has no production files`);
    for (const rel of requirement.production) {
      if (NON_PRODUCTION.some((token) => rel.includes(token))) {
        fail(
          failures,
          `${requirement.id} production file is a test, fixture, or generated file: ${rel}`,
        );
      }
      const body = readFileSync(join(projectRoot, rel), "utf8");
      if (!body.includes(`export function ${requirement.tests[0]?.exportName ?? ""}`) && !body.includes("export const")) {
        fail(failures, `${requirement.id} production file has no export: ${rel}`);
      }
    }
    if (requirement.tests.length === 0) fail(failures, `${requirement.id} has no executed tests`);
    for (const test of requirement.tests) {
      const body = readFileSync(join(projectRoot, test.file), "utf8");
      if (!body.includes(`export function ${test.exportName}`)) {
        fail(failures, `${requirement.id} test export ${test.exportName} is missing`);
      }
      const registered = body.includes(`it(${JSON.stringify(test.registeredAs)}, ${test.exportName})`)
        || body.includes(`test(${JSON.stringify(test.registeredAs)}, ${test.exportName})`);
      if (!registered) {
        fail(failures, `${requirement.id} does not register ${test.exportName} with the runner`);
      }
    }
  }

  for (const anchor of seenAnchors) {
    if (!inventory.requirements.some((requirement) => requirement.anchor === anchor)) {
      fail(failures, `active anchor ${anchor} is missing from the inventory`);
    }
  }

  const globFailures = await assertNonEmptyGlobs(
    [
      "docs/requirements/active/**/*.md",
      "docs/requirements/planned/**/*.md",
      ...productionFiles,
      ...testFiles,
    ],
    projectRoot,
  );
  failures.push(...globFailures);

  for (const rel of claimFiles()) {
    if (NON_PRODUCTION.some((token) => rel.includes(token)) && productionFiles.includes(rel)) {
      fail(failures, `production claim includes a non-production file: ${rel}`);
    }
  }
  for (const rel of productionFiles) {
    if (testFiles.includes(rel)) fail(failures, `production and test claims share ${rel}`);
  }

  if ((await includedSourceCount(join(projectRoot, "tsconfig.evidence.json"))) === 0) {
    fail(failures, "tsconfig.evidence.json includes no TypeScript sources");
  }

  const evidenceTsconfig = readFileSync(join(projectRoot, "tsconfig.evidence.json"), "utf8");
  if (evidenceTsconfig.includes("@ttsc/evidence")) {
    fail(failures, "tsconfig.evidence.json lists @ttsc/evidence as a compiler plugin");
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
      env: process.env,
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
