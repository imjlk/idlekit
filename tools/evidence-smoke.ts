import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import {
  approvalApplies,
  assertExecutedTests,
  assertNonEmptyGlobs,
  evidenceProgramSourceFiles,
  headingAnchors,
  recordedBaseSpec,
  includedSourceCount,
  omittedProgramHosts,
  productionFileCites,
  retainedCoverage,
} from "./evidence-inventory";
import { commandText, root, runTtsc, type CommandResult } from "./evidence-host";

type Step = {
  name: string;
  expected: "zero" | "nonzero";
  exitCode: number;
  ok: boolean;
  detail?: string;
};

const steps: Step[] = [];
const base = join(root, "fixtures", "evidence", "base");

function record(name: string, expected: "zero" | "nonzero", exitCode: number, ok: boolean, detail?: string): void {
  steps.push({ name, expected, exitCode, ok, detail });
  console.error(`${ok ? "ok" : "FAIL"} ${name} exit=${exitCode}`);
  if (!ok && detail) console.error(detail.slice(0, 2000));
}

function expectNonZero(name: string, result: CommandResult, marker: RegExp): void {
  const body = commandText(result);
  const ok = result.exitCode !== 0 && marker.test(body);
  record(
    name,
    "nonzero",
    result.exitCode,
    ok,
    ok
      ? undefined
      : `expected nonzero matching ${marker}, got exit ${result.exitCode}\n${body.slice(0, 1500)}`,
  );
}

function expectZero(name: string, result: CommandResult): void {
  const ok = result.exitCode === 0;
  record(name, "zero", result.exitCode, ok, ok ? undefined : commandText(result).slice(0, 1500));
}

function copyBase(dir: string): void {
  cpSync(base, dir, { recursive: true });
}

function edit(dir: string, rel: string, from: string, to: string): void {
  const path = join(dir, rel);
  const text = readFileSync(path, "utf8");
  if (!text.includes(from)) throw new Error(`smoke edit missed ${rel}: ${from}`);
  writeFileSync(path, text.replace(from, to));
}

function checkFixture(dir: string, _cacheDir?: string): CommandResult {
  // One shared compiler cache. A fresh --cache-dir rebuilds typia for every
  // case and filled the disk. Markdown edits still have to invalidate.
  return runTtsc(["-p", "tsconfig.json", "--noEmit", "--cwd", dir], dir);
}

const tempParent = join(root, "tmp");
mkdirSync(tempParent, { recursive: true });
const cacheRoot = mkdtempSync(join(tempParent, "evidence-smoke-"));
mkdirSync(cacheRoot, { recursive: true });

try {
  const fresh = join(cacheRoot, "fresh");
  copyBase(fresh);
  const freshCache = join(cacheRoot, "cache-fresh");
  expectZero("base", checkFixture(fresh, freshCache));

  const deleted = join(cacheRoot, "deleted");
  copyBase(deleted);
  edit(
    deleted,
    "src/host.ts",
    " * @evidence docs/spec.md#quota Returns the quota this section states, which is 3.\n",
    "",
  );
  expectNonZero(
    "delete-citation",
    checkFixture(deleted, join(cacheRoot, "cache-delete")),
    /Missing acknowledgement/,
  );

  const anchor = join(cacheRoot, "anchor");
  copyBase(anchor);
  edit(anchor, "src/host.ts", "docs/spec.md#quota", "docs/spec.md#missing");
  expectNonZero(
    "bad-anchor",
    checkFixture(anchor, join(cacheRoot, "cache-anchor")),
    /missing|unresolved|Unable to resolve|does not/i,
  );

  const added = join(cacheRoot, "added");
  copyBase(added);
  writeFileSync(
    join(added, "docs", "spec.md"),
    `${readFileSync(join(added, "docs", "spec.md"), "utf8")}\n## Extra {#req-extra}\n\nNobody implements this.\n`,
  );
  expectNonZero(
    "new-requirement",
    checkFixture(added, join(cacheRoot, "cache-added")),
    /Missing acknowledgement|req-extra/,
  );

  const docCache = join(cacheRoot, "cache-doc");
  const docDir = join(cacheRoot, "doc");
  copyBase(docDir);
  expectZero("doc-before", checkFixture(docDir, docCache));
  edit(docDir, "docs/spec.md", "The host returns 3.", "The host returns 4.");
  expectNonZero("doc-review-expired", checkFixture(docDir, docCache), /fingerprint|review/i);

  const impl = join(cacheRoot, "impl");
  copyBase(impl);
  edit(impl, "src/host.ts", "return 3;", "return 4;");
  expectNonZero(
    "impl-review-expired",
    checkFixture(impl, join(cacheRoot, "cache-impl")),
    /fingerprint|review/i,
  );

  const excluded = join(cacheRoot, "excluded");
  copyBase(excluded);
  edit(
    excluded,
    "src/host.ts",
    "@evidence docs/spec.md#quota Returns the quota this section states, which is 3.",
    "@evidenceExclude docs/spec.md#quota The host refuses this section.",
  );
  expectNonZero(
    "forbidden-exclude",
    checkFixture(excluded, join(cacheRoot, "cache-exclude")),
    /[Ee]xclud/,
  );

  const unregistered = join(cacheRoot, "unregistered");
  copyBase(unregistered);
  edit(
    unregistered,
    "src/host.test.ts",
    '\ntest("quota is documented", quotaIsDocumented);\n',
    "\n",
  );
  expectZero(
    "unregistered-evidence",
    checkFixture(unregistered, join(cacheRoot, "cache-unregistered")),
  );
  const unregisteredTest = Bun.spawnSync([process.execPath, "test", "src/host.test.ts"], {
    cwd: unregistered,
    stdout: "pipe",
    stderr: "pipe",
  });
  const unregisteredOut = `${unregisteredTest.stdout.toString()}\n${unregisteredTest.stderr.toString()}`;
  const unregisteredFailures = assertExecutedTests(
    unregisteredOut,
    unregisteredTest.exitCode ?? 1,
    ["quota is documented"],
  );
  const unregisteredOk = unregisteredFailures.length > 0;
  record(
    "unregistered-execution",
    "nonzero",
    unregisteredOk ? 1 : 0,
    unregisteredOk,
    unregisteredOk
      ? undefined
      : `execution gate accepted an unregistered test\n${unregisteredOut.slice(0, 800)}`,
  );

  const assertion = join(cacheRoot, "assertion");
  copyBase(assertion);
  edit(
    assertion,
    "src/host.test.ts",
    "expect(quotaHost()).toBe(3);",
    "expect(quotaHost()).toBe(9);",
  );
  expectZero("assertion-evidence", checkFixture(assertion, join(cacheRoot, "cache-assertion")));
  const assertionTest = Bun.spawnSync([process.execPath, "test", "src/host.test.ts"], {
    cwd: assertion,
    stdout: "pipe",
    stderr: "pipe",
  });
  const assertionOk = (assertionTest.exitCode ?? 1) !== 0;
  record(
    "assertion-bun-test",
    "nonzero",
    assertionTest.exitCode ?? 1,
    assertionOk,
    assertionOk
      ? undefined
      : `bun test passed a false assertion\n${assertionTest.stdout.toString().slice(0, 800)}`,
  );

  const emptyGlobs = await assertNonEmptyGlobs(["src/does-not-exist/**/*.ts"], root);
  const emptyGlobOk = emptyGlobs.some((message) => message.includes("matched no files"));
  record("empty-glob", "nonzero", emptyGlobOk ? 1 : 0, emptyGlobOk, emptyGlobs.join("\n"));

  const emptyCount = await includedSourceCount(
    join(root, "fixtures", "evidence", "empty-program", "tsconfig.json"),
  );
  const emptyProgramOk = emptyCount === 0;
  record(
    "empty-program",
    "nonzero",
    emptyProgramOk ? 1 : 0,
    emptyProgramOk,
    emptyProgramOk ? undefined : `empty program included ${emptyCount} files`,
  );

  const shrunk = retainedCoverage(["REQ-KEEP", "REQ-DROP"], ["REQ-KEEP"], []);
  const approved = retainedCoverage(["REQ-KEEP", "REQ-DROP"], ["REQ-KEEP"], ["REQ-DROP"]);
  const shrinkOk = !shrunk.ok && shrunk.missing.includes("REQ-DROP") && approved.ok;
  record(
    "coverage-shrink",
    "nonzero",
    shrinkOk ? 1 : 0,
    shrinkOk,
    JSON.stringify({ shrunk, approved }),
  );
  const approvalOk =
    approvalApplies("fresh", undefined) &&
    approvalApplies("edited", "old") &&
    !approvalApplies("same", "same");
  record(
    "approval-transition",
    "zero",
    approvalOk ? 0 : 1,
    approvalOk,
    "a stale approval must not cover a later removal",
  );

  const ambiguousOut = [
    "(pass) alpha > quota is documented",
    "(pass) beta > quota is documented",
    "2 pass",
  ].join("\n");
  const ambiguous = assertExecutedTests(ambiguousOut, 0, ["quota is documented"]);
  const ambiguousOk = ambiguous.some((message) => message.includes("more than one suite"));
  record("ambiguous-suite", "nonzero", ambiguousOk ? 1 : 0, ambiguousOk, ambiguous.join("\n"));

  const qualifiedOut = ["(pass) alpha > quota is documented", "1 pass"].join("\n");
  const qualified = assertExecutedTests(qualifiedOut, 0, ["quota is documented"]);
  const qualifiedOk = qualified.length === 0;
  record("suite-qualified", "zero", qualifiedOk ? 0 : 1, qualifiedOk, qualified.join("\n"));

  const anchors = headingAnchors(
    [
      "## Visible {#visible}",
      "```ts",
      "## Example {#example}",
      "```",
      "<!--",
      "## Hidden {#hidden}",
      "-->",
      "text <!-- ## Mid {#mid} -->",
    ].join("\n"),
  );
  const fenceOk = anchors.length === 1 && anchors[0] === "visible";
  record("fenced-headings", "zero", fenceOk ? 0 : 1, fenceOk, JSON.stringify(anchors));

  const nested = headingAnchors(
    ["````md", "```ts", "## Example {#example}", "```", "````", "## After {#after}"].join("\n"),
  );
  const nestedOk = nested.length === 1 && nested[0] === "after";
  record("nested-fence", "zero", nestedOk ? 0 : 1, nestedOk, JSON.stringify(nested));

  const recordedSha = "a".repeat(40);
  const recorded = recordedBaseSpec({ GITHUB_BASE_SHA: recordedSha, GITHUB_BASE_REF: "main" });
  const moving = recordedBaseSpec({ GITHUB_BASE_REF: "main" });
  const recordedOk = recorded === recordedSha && moving === undefined;
  record(
    "recorded-base",
    "zero",
    recordedOk ? 0 : 1,
    recordedOk,
    `${recorded ?? "none"} ${moving ?? "none"}`,
  );

  const functionCites = productionFileCites(
    "/** @evidence docs/spec.md#quota */\nexport function quotaHost() {\n  return 3;\n}\n",
    "docs/spec.md",
    "quota",
  );
  const constCites = productionFileCites(
    "/** @evidence docs/spec.md#quota */\nexport const quotaHost = 3;\n",
    "docs/spec.md",
    "quota",
  );
  const typeCites = productionFileCites(
    "/** @evidence docs/spec.md#quota */\nexport type Quota = number;\n",
    "docs/spec.md",
    "quota",
  );
  const citeOk = functionCites && constCites && !typeCites;
  record(
    "production-citation-kind",
    "zero",
    citeOk ? 0 : 1,
    citeOk,
    `function=${functionCites} const=${constCites} type=${typeCites}`,
  );

  const exactAnchor = productionFileCites(
    "/** @evidence docs/spec.md#quota */\nexport function quotaHost() {}\n",
    "docs/spec.md",
    "quota",
  );
  const longerAnchor = productionFileCites(
    "/** @evidence docs/spec.md#quota-v2 */\nexport function quotaHost() {}\n",
    "docs/spec.md",
    "quota",
  );
  const anchorOk = exactAnchor && !longerAnchor;
  record(
    "citation-anchor",
    "zero",
    anchorOk ? 0 : 1,
    anchorOk,
    `exact=${exactAnchor} longer=${longerAnchor}`,
  );

  const omitted = omittedProgramHosts(["src/a.ts"], ["src/a.ts", "src/b.ts"]);
  const program = evidenceProgramSourceFiles(join(root, "tsconfig.evidence.json"));
  const hostPresent = program.includes("packages/core/src/scenario/typiaTransformMissing.ts");
  const programOk = omitted.length === 1 && omitted[0] === "src/b.ts" && hostPresent;
  record(
    "program-hosts",
    "zero",
    programOk ? 0 : 1,
    programOk,
    `omitted=${omitted.join(",")} host=${hostPresent}`,
  );

  const formatBad = join(root, "fixtures", "evidence", "format-bad");
  expectNonZero(
    "format-severity",
    runTtsc(["-p", "tsconfig.json", "--noEmit", "--cwd", formatBad], formatBad),
    /\[format\/(?:quotes|semi)\]/,
  );
} finally {
  rmSync(cacheRoot, { recursive: true, force: true });
}

const failed = steps.filter((step) => !step.ok);
for (const step of steps) {
  console.log(
    `${step.ok ? "pass" : "fail"} ${step.name} expected=${step.expected} exit=${step.exitCode}`,
  );
}
if (failed.length > 0) process.exit(1);
console.log(`evidence:smoke passed (${steps.length})`);
