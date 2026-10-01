import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import lintConfig from "../lint.config";
import {
  approvalApplies,
  assertExecutedTests,
  assertNonEmptyGlobs,
  evidenceProgramSourceFiles,
  commandTargetsFile,
  duplicateFullNames,
  duplicateFullNamesAcross,
  citesRequirement,
  enabledClaimFailures,
  formatGateFailures,
  graphRuleFailures,
  headingAnchors,
  registeredSuites,
  isNonProductionPath,
  recordedBaseSpec,
  requireFetchedRevision,
  uninventoriedCommandTargets,
  unregisteredImplementationHost,
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
  const unregisteredReportDir = mkdtempSync(join(tmpdir(), "idlekit-evidence-"));
  const unregisteredReport = join(unregisteredReportDir, "junit.xml");
  const unregisteredTest = Bun.spawnSync(
    [
      process.execPath,
      "test",
      "src/host.test.ts",
      "--reporter=junit",
      "--reporter-outfile",
      unregisteredReport,
    ],
    {
      cwd: unregistered,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  let unregisteredOut = "";
  try {
    unregisteredOut = readFileSync(unregisteredReport, "utf8");
  } catch {
    unregisteredOut = "";
  }
  rmSync(unregisteredReportDir, { recursive: true, force: true });
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
    '<testsuites tests="1"><testsuite name="file.ts" file="file.ts">',
    '<testsuite name="beta"><testcase name="quota is documented" /></testsuite>',
    "</testsuite></testsuites>",
  ].join("");
  const ambiguous = assertExecutedTests(ambiguousOut, 0, ["alpha > quota is documented"]);
  const ambiguousOk = ambiguous.some((message) => message.includes("missed"));
  record("ambiguous-suite", "nonzero", ambiguousOk ? 1 : 0, ambiguousOk, ambiguous.join("\n"));

  const qualifiedOut = [
    '<testsuites tests="1"><testsuite name="file.ts" file="file.ts">',
    '<testsuite name="alpha"><testcase name="quota is documented" /></testsuite>',
    "</testsuite></testsuites>",
  ].join("");
  const printedOut = ["(pass) alpha > quota is documented", "1 pass"].join("\n");
  const qualified = assertExecutedTests(qualifiedOut, 0, ["alpha > quota is documented"]);
  const bareTitle = assertExecutedTests(qualifiedOut, 0, ["quota is documented"]);
  const printed = assertExecutedTests(printedOut, 0, ["alpha > quota is documented"]);
  const qualifiedOk = qualified.length === 0 && bareTitle.length > 0 && printed.length > 0;
  record(
    "suite-qualified",
    "zero",
    qualifiedOk ? 0 : 1,
    qualifiedOk,
    `full=${qualified.join("\n")} bare=${bareTitle.join("\n")}`,
  );

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
  const backtickInfo = headingAnchors("```js `not`\n## Kept {#kept}\n");
  const tildeInfo = headingAnchors("~~~js `code`\n## Hidden {#hidden}\n~~~\n## After {#after}\n");
  const inlineComment = headingAnchors("Document the `<!--` marker\n## Kept {#kept}\n");
  const fenceOk =
    anchors.length === 1 &&
    anchors[0] === "visible" &&
    backtickInfo.length === 1 &&
    backtickInfo[0] === "kept" &&
    tildeInfo.length === 1 &&
    tildeInfo[0] === "after" &&
    inlineComment.length === 1 &&
    inlineComment[0] === "kept";
  record(
    "fenced-headings",
    "zero",
    fenceOk ? 0 : 1,
    fenceOk,
    JSON.stringify({ anchors, backtickInfo, tildeInfo }),
  );

  const nested = headingAnchors(
    ["````md", "```ts", "## Example {#example}", "```", "````", "## After {#after}"].join("\n"),
  );
  const nestedOk = nested.length === 1 && nested[0] === "after";
  record("nested-fence", "zero", nestedOk ? 0 : 1, nestedOk, JSON.stringify(nested));

  const indented = headingAnchors(" ## Quota {#quota}\n    ## Hidden {#hidden}\n");
  const indentedOk = indented.length === 1 && indented[0] === "quota";
  record("indented-heading", "zero", indentedOk ? 0 : 1, indentedOk, JSON.stringify(indented));

  const fencedComment = headingAnchors("```\n<!--\n```\n## After {#after}\n");
  const fencedCommentOk = fencedComment.length === 1 && fencedComment[0] === "after";
  record(
    "fenced-comment",
    "zero",
    fencedCommentOk ? 0 : 1,
    fencedCommentOk,
    JSON.stringify(fencedComment),
  );

  const commentFence = headingAnchors("<!--\n```\n-->\n## After {#after}\n");
  const commentFenceOk = commentFence.length === 1 && commentFence[0] === "after";
  record(
    "comment-fence",
    "zero",
    commentFenceOk ? 0 : 1,
    commentFenceOk,
    JSON.stringify(commentFence),
  );

  const crlf = headingAnchors("## Kept {#kept}\r\n## Missing\r\n");
  const crlfOk = crlf.length === 2 && crlf[0] === "kept" && crlf[1] === "";
  record("crlf-heading", "zero", crlfOk ? 0 : 1, crlfOk, JSON.stringify(crlf));

  const setext = headingAnchors(
    "Requirement {#req-id}\n---\nTitle {#h1}\n===\n## Kept {#kept}\nParagraph\n---\n",
  );
  const setextOk =
    setext.length === 3 && setext[0] === "req-id" && setext[1] === "kept" && setext[2] === "";
  record("setext-heading", "zero", setextOk ? 0 : 1, setextOk, JSON.stringify(setext));

  const activeDocs = ["docs/requirements/active/**/*.md"];
  const productionHosts = [
    "packages/core/src/scenario/concreteValidator.ts",
    "packages/core/src/scenario/typiaTransformMissing.ts",
  ];
  const testHosts = ["packages/core/src/scenario/concreteValidator.test.ts"];
  const rebound = enabledClaimFailures([
    {
      name: "active requirements have production implementations",
      files: testHosts,
      reference: { files: activeDocs },
    },
    {
      name: "active requirements have executed test hosts",
      files: testHosts,
      reference: { files: activeDocs },
    },
    {
      name: "executed tests cite the implementation they run",
      files: testHosts,
      reference: { files: productionHosts },
    },
  ]);
  const spoofedCitation =
    "const text = `/** @evidence docs/requirements/active/x.md#anchor */ export function fake`;\n";
  const realCitation = "/** @evidence docs/requirements/active/x.md#anchor */\nexport function real() {}\n";
  const citationOk =
    !productionFileCites(spoofedCitation, "docs/requirements/active/x.md", "anchor") &&
    productionFileCites(realCitation, "docs/requirements/active/x.md", "anchor");
  const spoofedRequirement =
    "const text = `/** @evidence docs/requirements/active/x.md#anchor */ export function sameName`;\n";
  const realRequirement =
    "/** @evidence docs/requirements/active/x.md#anchor */\nexport function sameName() {}\n";
  const lineCommentRequirement =
    "// /** @evidence docs/requirements/active/x.md#anchor */\nexport function sameName() {}\n";
  const requirementCiteOk =
    !citesRequirement(spoofedRequirement, "sameName", "docs/requirements/active/x.md", "anchor") &&
    citesRequirement(realRequirement, "sameName", "docs/requirements/active/x.md", "anchor") &&
    citesRequirement(
      spoofedRequirement + realRequirement,
      "sameName",
      "docs/requirements/active/x.md",
      "anchor",
    ) &&
    !citesRequirement(lineCommentRequirement, "sameName", "docs/requirements/active/x.md", "anchor") &&
    !productionFileCites(lineCommentRequirement, "docs/requirements/active/x.md", "anchor");
  const reviewedOff = enabledClaimFailures([
    {
      name: "active requirements have production implementations",
      type: "typescript",
      symbol: ["function", "property"],
      files: productionHosts,
      reference: {
        type: "markdown",
        files: activeDocs,
        symbol: "h2",
        noEvidenceExclude: true,
        requireReview: false,
      },
    },
    {
      name: "active requirements have executed test hosts",
      type: "typescript",
      symbol: "function",
      files: testHosts,
      reference: {
        type: "markdown",
        files: activeDocs,
        symbol: "h2",
        noEvidenceExclude: true,
        requireReview: true,
      },
    },
    {
      name: "executed tests cite the implementation they run",
      type: "typescript",
      symbol: "function",
      files: testHosts,
      reference: {
        type: "typescript",
        files: productionHosts,
        symbol: ["property", "function"],
        noEvidenceExclude: true,
        requireReview: true,
      },
    },
  ]);
  const reviewOffOk = reviewedOff.some((message) => message.includes("requireReview"));
  const reboundGraph = graphRuleFailures({ "evidence/graph": ["error", { claims: [] }] });
  const graphBound = graphRuleFailures(lintConfig.rules).length === 0 && reboundGraph.length > 0;
  const claimOk =
    enabledClaimFailures().length === 0 &&
    enabledClaimFailures([]).length > 0 &&
    rebound.length > 0 &&
    citationOk &&
    requirementCiteOk &&
    reviewOffOk &&
    graphBound;
  record(
    "claim-populations",
    "zero",
    claimOk ? 0 : 1,
    claimOk,
    `live=${enabledClaimFailures().join("; ")} rebound=${rebound.join("; ")} reviewOff=${reviewedOff.join(
      "; ",
    )}`,
  );

  const tabbed = headingAnchors("##\tMissing\n##\tKept {#kept}\n");
  const tabbedOk = tabbed.length === 2 && tabbed[0] === "" && tabbed[1] === "kept";
  record("tab-heading", "zero", tabbedOk ? 0 : 1, tabbedOk, JSON.stringify(tabbed));

  const nestedBody = [
    'describe("wrong", () => {',
    '  it("quota is documented", exportedName);',
    "});",
    'describe("expected", () => {',
    '  describe("inner", () => {',
    '    it("quota is documented", otherName);',
    "  });",
    "});",
  ].join("\n");
  const wrongPath = registeredSuites(nestedBody, "exportedName", "quota is documented");
  const innerPath = registeredSuites(nestedBody, "otherName", "quota is documented");
  const suiteNestingOk =
    wrongPath.length === 1 &&
    wrongPath[0]?.join(" > ") === "wrong" &&
    innerPath.length === 1 &&
    innerPath[0]?.join(" > ") === "expected > inner";
  record(
    "suite-nesting",
    "zero",
    suiteNestingOk ? 0 : 1,
    suiteNestingOk,
    JSON.stringify({ wrongPath, innerPath }),
  );

  const regexBody = [
    'describe("kept", () => {',
    "  expect(value).toMatch(/\\}/);",
    '  it("quota is documented", exportedName);',
    "});",
    'describe("later", () => {',
    "  expect(value).toMatch(/\\{/);",
    '  it("quota is documented", otherName);',
    "});",
  ].join("\n");
  const regexKept = registeredSuites(regexBody, "exportedName", "quota is documented");
  const regexLater = registeredSuites(regexBody, "otherName", "quota is documented");
  const regexSuiteOk =
    regexKept.length === 1 &&
    regexKept[0]?.join(" > ") === "kept" &&
    regexLater.length === 1 &&
    regexLater[0]?.join(" > ") === "later";
  record(
    "regex-brace",
    "zero",
    regexSuiteOk ? 0 : 1,
    regexSuiteOk,
    JSON.stringify({ regexKept, regexLater }),
  );

  const duplicateBody = [
    'describe("kept", () => {',
    '  if (false) it("quota is documented", exportedName);',
    '  it("quota is documented", otherName);',
    "});",
  ].join("\n");
  const duplicateNames = duplicateFullNames(duplicateBody);
  const duplicateStillRegistered = registeredSuites(
    duplicateBody,
    "exportedName",
    "quota is documented",
  );
  const otherFile = [
    'describe("kept", () => {',
    '  it("quota is documented", exportedName);',
    "});",
  ].join("\n");
  const acrossFiles = duplicateFullNamesAcross([otherFile, duplicateBody]);
  const duplicateOk =
    duplicateNames.length === 1 &&
    duplicateNames[0] === "kept > quota is documented" &&
    duplicateStillRegistered.length === 1 &&
    acrossFiles.includes("kept > quota is documented");
  record(
    "duplicate-title",
    "zero",
    duplicateOk ? 0 : 1,
    duplicateOk,
    JSON.stringify({ duplicateNames, duplicateStillRegistered }),
  );

  const indentedFence = headingAnchors("    ```\n## Visible {#quota}\n");
  const indentedFenceOk = indentedFence.length === 1 && indentedFence[0] === "quota";
  record(
    "indented-fence",
    "zero",
    indentedFenceOk ? 0 : 1,
    indentedFenceOk,
    JSON.stringify(indentedFence),
  );

  const splitHost = [
    "/** @evidence docs/spec.md#quota Cites the section only. */",
    "export function registeredOnly(): void {}",
    "/** @evidence ./host.ts#quotaHost Calls the host. */",
    "export function helper(): void {}",
  ].join("\n");
  const gap = unregisteredImplementationHost(splitHost, "docs/spec.md", "quota", [
    "registeredOnly",
  ]);
  const gapOk =
    typeof gap === "object" && gap?.kind === "unregistered" && gap.name === "helper";
  record("registered-implementation", "nonzero", gapOk ? 1 : 0, gapOk, JSON.stringify(gap));

  const siblingBody = [
    "/** @evidence ./host.ts#quotaHost Calls the host. */",
    "export function owned(): void {}",
    "/** @evidence ./other.ts#otherHost Calls the sibling host. */",
    "export function sibling(): void {}",
  ].join("\n");
  const sibling = unregisteredImplementationHost(siblingBody, "docs/spec.md", "quota", ["owned"], {
    file: "pkg/case.test.ts",
    production: ["pkg/host.ts"],
    fileRegistered: ["owned", "sibling"],
  });
  const siblingOk = sibling === undefined;
  record("sibling-inventory", "zero", siblingOk ? 0 : 1, siblingOk, JSON.stringify(sibling));

  const foreign = unregisteredImplementationHost(siblingBody, "docs/spec.md", "quota", ["owned"], {
    file: "pkg/case.test.ts",
    production: ["pkg/missing.ts"],
    fileRegistered: ["owned", "sibling"],
  });
  const foreignOk =
    typeof foreign === "object" && foreign?.kind === "foreign" && foreign.name === "owned";
  record("foreign-production", "nonzero", foreignOk ? 1 : 0, foreignOk, JSON.stringify(foreign));

  const wrapped = commandTargetsFile({
    file: "src/example.test.ts",
    exportName: "example",
    registeredAs: "example",
    cwd: ".",
    args: ["run", "wrapper", "src/example.test.ts"],
  });
  const direct = commandTargetsFile({
    file: "src/example.test.ts",
    exportName: "example",
    registeredAs: "example",
    cwd: ".",
    args: ["test", "src/example.test.ts"],
  });
  const extraTargets = uninventoriedCommandTargets(
    ["test", "src/example.test.ts", "src/other.test.ts"],
    ".",
    ["src/example.test.ts"],
  );
  const onlyTarget = uninventoriedCommandTargets(["test", "src/example.test.ts"], ".", [
    "src/example.test.ts",
  ]);
  const commandOk =
    wrapped === false && direct === true && extraTargets.length === 1 && onlyTarget.length === 0;
  record(
    "test-subcommand",
    "zero",
    commandOk ? 0 : 1,
    commandOk,
    `wrapped=${wrapped} direct=${direct}`,
  );

  const specTsx = isNonProductionPath("packages/web/src/widget.spec.tsx");
  const specMts = isNonProductionPath("packages/web/src/widget.spec.mts");
  const generatedTsx = isNonProductionPath("packages/web/src/widget.generated.tsx");
  const productionTs = !isNonProductionPath("packages/core/src/scenario/concreteValidator.ts");
  const specOk = specTsx && specMts && generatedTsx && productionTs;
  record("spec-tsx", "nonzero", specOk ? 1 : 0, specOk, String(specOk));

  let fetchThrew = false;
  try {
    requireFetchedRevision("abc", false, false);
  } catch {
    fetchThrew = true;
  }
  const fetchedMissing = requireFetchedRevision("abc", true, false);
  const fetchOk = fetchThrew && fetchedMissing === undefined;
  record(
    "baseline-fetch",
    "nonzero",
    fetchOk ? 1 : 0,
    fetchOk,
    `threw=${fetchThrew} missing=${fetchedMissing ?? "none"}`,
  );

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
  const badFormat = runTtsc(["-p", "tsconfig.json", "--noEmit", "--cwd", formatBad], formatBad);
  const badFormatText = commandText(badFormat);
  const rootFormatOk = formatGateFailures().length === 0;
  const warningFormat = formatGateFailures({ severity: "warning" });
  const formatOk =
    badFormat.exitCode !== 0 &&
    /\[format\/(?:quotes|semi)\]/.test(badFormatText) &&
    rootFormatOk &&
    warningFormat.some((message) => message.includes("severity"));
  record(
    "format-severity",
    "nonzero",
    badFormat.exitCode,
    formatOk,
    `${badFormatText.slice(0, 500)}\nroot=${rootFormatOk} warning=${warningFormat.join("; ")}`,
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
