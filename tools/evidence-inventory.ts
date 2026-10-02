import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import lintConfig from "../lint.config";
import {
  disabledClaimLedger,
  evidenceGraph,
  graphLintConfig,
  productionFiles,
  testFiles,
} from "../evidence.config";
import { root } from "./evidence-host";

import {
  hasProductionExport,
  isInventoryPackageHost,
  isNonProductionPath,
  type BaselineFile,
  type InventoryFile,
  type InventoryTest,
} from "./evidence/model";
import {
  ambiguousSuiteSeparators,
  duplicateFullNamesAcross,
  registersNamedTest,
  unresolvedRunnerCalls,
} from "./evidence/runner-registry";
import {
  assertExecutedTests,
  junitCases,
  junitReporterArgs,
  plainTestEnv,
  reporterNameMatches,
} from "./evidence/junit";
import {
  assertNonEmptyGlobs,
  evidenceProgramSourceFiles,
  expandGlob,
  fail,
  omittedProgramHosts,
  readJson,
} from "./evidence/program";
import {
  blockedTestArgs,
  commandTargetsFile,
  localPreloadFiles,
  sameCommandFile,
  uninventoriedCommandTargets,
  unresolvedPreloadSpecifiers,
} from "./evidence/commands";
import {
  citesRequirement,
  duplicateRequirementAnchors,
  exportsNamedFunction,
  productionFileCites,
  unregisteredImplementationHost,
} from "./evidence/citations";
import {
  claimFiles,
  enabledClaimFailures,
  enabledMarkdownGlobs,
  graphRuleFailures,
  missingProtectedDocs,
} from "./evidence/claims";
import { headingAnchors } from "./evidence/markdown";
import {
  previousRevision,
  readApprovals,
  retainedCoverage,
  showBaseline,
} from "./evidence/coverage";
import {
  loaderPluginRegistration,
  mockModuleRegistration,
  sourceFiles,
  sourceGraph,
  unresolvedLocalRequires,
} from "./evidence/source-graph";
import {
  changedSources,
  installSourceLock,
  preloadTestArgs,
  sourceLockCommand,
  sealSources,
  sourceDigests,
  unsealSources,
} from "./evidence/source-lock";

export { hasProductionExport, isInventoryPackageHost, isNonProductionPath };
export { assertExecutedTests, junitCases, junitReporterArgs };
export { assertNonEmptyGlobs, evidenceProgramSourceFiles, expandGlob, omittedProgramHosts };
export { includedSourceCount } from "./evidence/program";
export { headingAnchors };
export { retainedCoverage };
export { approvalApplies, recordedBaseSpec, requireFetchedRevision } from "./evidence/coverage";
export { ambiguousSuiteSeparators, duplicateFullNamesAcross, unresolvedRunnerCalls };
export {
  duplicateFullNames,
  registrationLines,
  registeredSuites,
} from "./evidence/runner-registry";
export {
  citesRequirement,
  duplicateRequirementAnchors,
  productionFileCites,
  unregisteredImplementationHost,
};
export {
  blockedTestArgs,
  commandTargetsFile,
  localPreloadFiles,
  uninventoriedCommandTargets,
  unresolvedPreloadSpecifiers,
};
export {
  loaderPluginRegistration,
  mockModuleRegistration,
  sourceFiles,
  sourceGraph,
  unresolvedLocalRequires,
};
export { enabledClaimFailures, graphRuleFailures, missingProtectedDocs };
export { formatGateFailures, formatIncludeRoots } from "./evidence/format-gate";
export type { ShrinkResult } from "./evidence/model";
export type { JUnitCase } from "./evidence/junit";
export type { ImplementationHostGap } from "./evidence/citations";

/** The section under `{#anchor}` names its ID once as Requirement `REQ-...`. */
export function declaredRequirementId(docText: string, anchor: string): string | undefined {
  const start = docText.indexOf(`{#${anchor}}`);
  if (start < 0) return undefined;
  const next = docText.indexOf("\n## ", start);
  const section = docText.slice(start, next < 0 ? undefined : next);
  return /Requirement `([^`]+)`/.exec(section)?.[1];
}

/** `it(`, `test.only(`, `describe.each(` as a bare name. `regex.test(` is a method call. */
const BARE_RUNNER_CALL = /(?:^|[^.\w$])(?:it|test|describe)(?:\s*\.\s*\w+)*\s*\(/m;

/**
 * Sources that can register a test: they name the runner module, or call the global
 * `it` / `test` / `describe` that tsconfig's `bun` types expose without an import.
 * Production code reached through the source graph does neither, so a call such as
 * `assertSimulationClock("offline", clock)` or `new Function(...)` there is not a
 * hidden registration. A runner smuggled in some other way is adversarial test code,
 * which this gate does not defend against.
 */
export function runnerSources(bodies: readonly string[]): string[] {
  return bodies.filter((body) => body.includes("bun:test") || BARE_RUNNER_CALL.test(body));
}

type CommandScan = {
  extras: string[];
  missingPreloads: string[];
  requireFaults: string[];
  ambiguous: string[];
  unresolvedRunner: boolean;
  loaderOrMock: boolean;
  duplicates: Set<string>;
};

const commandScans = new Map<string, CommandScan>();

/**
 * Every test on one command shares these results. The source graph of a large
 * suite takes seconds, so it is built once per command, not once per test.
 */
function commandScan(
  projectRoot: string,
  test: InventoryTest,
  commandKey: string,
  inventoriedFiles: string[],
): CommandScan {
  const key = `${projectRoot}\n${commandKey}\n${inventoriedFiles.join("\n")}`;
  const cached = commandScans.get(key);
  if (cached) return cached;
  const commandCwd = join(projectRoot, test.cwd);
  const commandFiles = [
    ...inventoriedFiles.map((file) => join(projectRoot, file)),
    ...localPreloadFiles(commandCwd, test.args),
  ];
  const commandSources = sourceGraph(commandFiles);
  const scan: CommandScan = {
    extras: uninventoriedCommandTargets(test.args, test.cwd, inventoriedFiles),
    missingPreloads: unresolvedPreloadSpecifiers(commandCwd, test.args),
    requireFaults: unresolvedLocalRequires(commandFiles),
    ambiguous: ambiguousSuiteSeparators(commandSources),
    unresolvedRunner: runnerSources(commandSources).some(
      (source) => unresolvedRunnerCalls(source).length > 0,
    ),
    loaderOrMock: commandSources.some(
      (source) => loaderPluginRegistration(source) || mockModuleRegistration(source),
    ),
    duplicates: new Set(duplicateFullNamesAcross(commandSources)),
  };
  commandScans.set(key, scan);
  return scan;
}

export async function checkInventory(projectRoot = root): Promise<string[]> {
  commandScans.clear();
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
  if (duplicateRequirementAnchors(inventory.requirements).length > 0) {
    fail(failures, "inventory document anchors are duplicated");
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
    const isPackageHost = isInventoryPackageHost(rel);
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
    } else {
      const declared = declaredRequirementId(docText, requirement.anchor);
      if (declared !== requirement.id) {
        fail(
          failures,
          `${requirement.id} section ${requirement.anchor} declares ${declared ?? "no requirement id"}`,
        );
      }
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
      const commandKey = `${test.cwd}\n${test.args.join("\0")}`;
      const commandBodies = inventory.requirements.flatMap((entry) =>
        entry.tests
          .filter((candidate) => `${candidate.cwd}\n${candidate.args.join("\0")}` === commandKey)
          .map((candidate) => candidate.file),
      );
      const scan = commandScan(projectRoot, test, commandKey, [...new Set(commandBodies)]);
      if (scan.extras.length > 0) {
        fail(
          failures,
          `${requirement.id} command runs uninventoried tests: ${scan.extras.join(", ")}`,
        );
      }
      if (scan.missingPreloads.length > 0) {
        fail(
          failures,
          `${requirement.id} preload cannot be scanned: ${scan.missingPreloads.join(", ")}`,
        );
      }
      if (scan.requireFaults.length > 0) {
        fail(
          failures,
          `${requirement.id} has an unresolved local require: ${scan.requireFaults.join(", ")}`,
        );
      }
      if (scan.ambiguous.length > 0) {
        fail(
          failures,
          `${requirement.id} suite title contains the JUnit separator: ${scan.ambiguous.join(", ")}`,
        );
      }
      if (scan.unresolvedRunner) {
        fail(failures, `${requirement.id} has a registration call that is not the test runner`);
      }
      if (scan.loaderOrMock) {
        fail(failures, `${requirement.id} registers a Bun loader plugin or replaces a module`);
      }
      if (scan.duplicates.has(test.registeredAs)) {
        fail(failures, `${requirement.id} registers ${test.registeredAs} more than once`);
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
    for (const rel of missingProtectedDocs([requirement.doc], baseline.protectedFiles)) {
      fail(failures, `inventory host is not protected: ${rel}`);
    }
    const files = [...new Set(requirement.tests.map((test) => test.file))];
    for (const file of files) {
      const body = readFileSync(join(projectRoot, file), "utf8");
      if (unresolvedRunnerCalls(body).length > 0) {
        fail(failures, `${requirement.id} has a registration call that is not the test runner`);
      }
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

  failures.push(...enabledClaimFailures());
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
  if (lintConfig !== graphLintConfig) {
    fail(failures, "lint.config.ts must export graphLintConfig");
  }
  const loadedRules = lintConfig.rules;
  const reviewRule = loadedRules["evidence/review"];
  failures.push(...graphRuleFailures(loadedRules));
  const reviewOn = reviewRule === "error" || (Array.isArray(reviewRule) && reviewRule[0] === "error");
  if (!reviewOn) {
    fail(failures, "lint.config.ts must enable evidence/review");
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
    const blocked = blockedTestArgs(first.args);
    if (blocked) {
      fail(failures, `inventory command uses ${blocked}`);
      continue;
    }
    const reportDir = mkdtempSync(join(tmpdir(), "idlekit-evidence-"));
    const reportPath = join(reportDir, "junit.xml");
    const commandCwd = resolve(projectRoot, first.cwd);
    const inventoriedFiles = [...new Set(tests.map((test) => test.file))];
    const commandFiles = [
      ...inventoriedFiles.map((file) => join(projectRoot, file)),
      ...localPreloadFiles(commandCwd, first.args),
    ];
    const locked = sourceFiles(commandFiles);
    const digests = sourceDigests(locked);
    const lock = installSourceLock(reportDir, locked);
    const modes = sealSources(locked);
    let exitCode = 1;
    let output = "";
    try {
      const bare = [
        process.execPath,
        ...preloadTestArgs(junitReporterArgs(first.args, reportPath), lock.preload),
      ];
      // Windows has no source-lock sandbox. Typecheck still runs the inventoried
      // command there. sealedCommand keeps refusing to return that unsealed argv.
      const wrapped = sourceLockCommand(process.platform, reportDir, bare, locked);
      const command = wrapped ?? bare;
      const proc = Bun.spawnSync(command, {
        cwd: commandCwd,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...plainTestEnv(), IDLEKIT_EVIDENCE_LOCK: lock.env },
      });
      exitCode = proc.exitCode ?? 1;
      try {
        output = readFileSync(reportPath, "utf8");
      } catch {
        output = "";
      }
    } finally {
      unsealSources(modes);
      rmSync(reportDir, { recursive: true, force: true });
    }
    for (const file of changedSources(digests)) {
      const prefix = `${projectRoot}/`;
      const relative = file.startsWith(prefix) ? file.slice(prefix.length) : file;
      fail(failures, `scanned source changed while tests ran: ${relative}`);
    }
    failures.push(
      ...assertExecutedTests(
        output,
        exitCode,
        tests.map((test) => test.registeredAs),
      ),
    );
    const entries = junitCases(output);
    for (const test of tests) {
      // Bun records the loader's line, not the source line, after ttsc runs.
      // The imported module graph rejects a second registration of this name.
      const bound = entries.some(
        (entry) =>
          entry.status === "pass" &&
          reporterNameMatches(entry.name, test.registeredAs) &&
          sameCommandFile(test.cwd, entry.file, test.file),
      );
      if (!bound) {
        fail(
          failures,
          `executed ${test.registeredAs} did not pass from its registration in ${test.file}`,
        );
      }
    }
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
