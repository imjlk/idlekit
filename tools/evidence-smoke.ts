import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import lintConfig from "../lint.config";
import {
  approvalApplies,
  assertExecutedTests,
  assertNonEmptyGlobs,
  evidenceProgramSourceFiles,
  commandTargetsFile,
  duplicateFullNames,
  duplicateFullNamesAcross,
  duplicateRequirementAnchors,
  junitCases,
  blockedTestArgs,
  junitReporterArgs,
  localPreloadFiles,
  unresolvedRunnerCalls,
  registrationLines,
  sourceGraph,
  citesRequirement,
  enabledClaimFailures,
  formatGateFailures,
  formatIncludeRoots,
  graphRuleFailures,
  headingAnchors,
  missingProtectedDocs,
  registeredSuites,
  isInventoryPackageHost,
  isNonProductionPath,
  recordedBaseSpec,
  requireFetchedRevision,
  uninventoriedCommandTargets,
  unregisteredImplementationHost,
  includedSourceCount,
  omittedProgramHosts,
  hasProductionExport,
  productionFileCites,
  retainedCoverage,
} from "./evidence-inventory";
import { plannerStepOnceBound } from "./planner-binding";
import {
  commandText,
  compilerBinName,
  root,
  runTtsc,
  ttsxUnderNodeName,
  type CommandResult,
} from "./evidence-host";

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
  const repeatedAnchor = duplicateRequirementAnchors([
    { doc: "docs/a.md", anchor: "same" },
    { doc: "docs/a.md", anchor: "same" },
    { doc: "docs/b.md", anchor: "same" },
  ]);
  const distinctAnchors = duplicateRequirementAnchors([
    { doc: "docs/a.md", anchor: "one" },
    { doc: "docs/a.md", anchor: "two" },
  ]);
  const droppedDoc = missingProtectedDocs(
    ["docs/requirements/active/quota.md"],
    ["packages/core/src/host.ts"],
  );
  const keptDoc = missingProtectedDocs(
    ["docs/requirements/active/quota.md"],
    ["docs/requirements/active/quota.md"],
  );
  const shrinkOk =
    !shrunk.ok &&
    shrunk.missing.includes("REQ-DROP") &&
    approved.ok &&
    repeatedAnchor.length === 1 &&
    distinctAnchors.length === 0 &&
    droppedDoc.length === 1 &&
    droppedDoc[0] === "docs/requirements/active/quota.md" &&
    keptDoc.length === 0;
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
  const classnameReport = [
    '<testsuites><testsuite name="concreteValidator.test.ts">',
    '<testcase name="accepts a numeric" classname="inner &amp;gt; concrete typia validator" />',
    "</testsuite></testsuites>",
  ].join("");
  const filelessReport = [
    '<testsuite name="concreteValidator.test.ts">',
    '<testcase name="accepts a numeric" classname="concrete typia validator" />',
    "</testsuite>",
  ].join("");
  const classnameName = junitCases(classnameReport)[0]?.name;
  const filelessName = junitCases(filelessReport)[0]?.name;
  const locatedSource = [
    'describe("alpha", () => {',
    '  it("quota is documented", exportedName);',
    "});",
  ].join("\n");
  const locatedLine = registrationLines(locatedSource, "alpha > quota is documented")[0];
  const locatedCase =
    `<testcase name="quota is documented" classname="alpha" ` +
    `file="src/host.test.ts" line="${locatedLine}" />`;
  const locatedReport = [
    '<testsuites><testsuite name="src/host.test.ts" file="src/host.test.ts">',
    locatedCase,
    "</testsuite></testsuites>",
  ].join("");
  const located = junitCases(locatedReport)[0];
  const qualifiedOk =
    qualified.length === 0 &&
    bareTitle.length > 0 &&
    printed.length > 0 &&
    classnameName === "concrete typia validator > inner > accepts a numeric" &&
    filelessName === "concrete typia validator > accepts a numeric" &&
    junitCases('<testcase name="literal &gt; sign" />')[0]?.name === "literal > sign" &&
    junitCases('<testcase name="literal &amp;gt; sign" />')[0]?.name === "literal &gt; sign" &&
    located?.file === "src/host.test.ts" &&
    located.line === locatedLine &&
    locatedLine === 2;
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
  const quotedFence = headingAnchors(
    ["> ```md", "> ## Example {#example}", "> ```", "## Kept {#kept}"].join("\n"),
  );
  const listedFence = headingAnchors(
    ["- ```md", "- ## Example {#example}", "- ```", "## Kept {#kept}"].join("\n"),
  );
  const fenceOk =
    anchors.length === 1 &&
    anchors[0] === "visible" &&
    backtickInfo.length === 1 &&
    backtickInfo[0] === "kept" &&
    tildeInfo.length === 1 &&
    tildeInfo[0] === "after" &&
    inlineComment.length === 1 &&
    inlineComment[0] === "kept" &&
    quotedFence.length === 1 &&
    quotedFence[0] === "kept" &&
    listedFence.length === 1 &&
    listedFence[0] === "kept";
  record(
    "fenced-headings",
    "zero",
    fenceOk ? 0 : 1,
    fenceOk,
    JSON.stringify({ anchors, backtickInfo, tildeInfo, quotedFence, listedFence }),
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
  const quotedBreak = headingAnchors("> Example {#example}\n---\n## Kept {#kept}\n");
  const quotedSetext = headingAnchors(
    ["> Requirement {#req-id}", "> ---", "## Kept {#kept}"].join("\n"),
  );
  const nestedSetext = headingAnchors(
    ["> > Requirement {#req-id}", "> > ---", "## Kept {#kept}"].join("\n"),
  );
  const quotedH1 = headingAnchors(["> Title {#h1}", "> ===", "## Kept {#kept}"].join("\n"));
  const listedSetext = headingAnchors(
    ["- Requirement {#req-id}", "  ---", "## Kept {#kept}"].join("\n"),
  );
  const listedH1 = headingAnchors(["- Title {#h1}", "  ===", "## Kept {#kept}"].join("\n"));
  const orderedSetext = headingAnchors(
    ["1. Requirement {#req-id}", "   ---", "## Kept {#kept}"].join("\n"),
  );
  const quotedListSetext = headingAnchors(
    ["> - Requirement {#req-id}", ">   ---", "## Kept {#kept}"].join("\n"),
  );
  const listedBreak = headingAnchors("- Example {#listed}\n---\n## Kept {#kept}\n");
  const htmlBlock = headingAnchors("<div>\n## Example {#example}\n</div>\n\n## Kept {#kept}\n");
  const htmlEnded = headingAnchors("<div>\n\n## Example {#example}\n");
  const htmlScript = headingAnchors(
    "<script>\n\n## Example {#example}\n</script>\n## Kept {#kept}\n",
  );
  const quotedHtml = headingAnchors(
    "> <div>\n> ## Example {#example}\n> </div>\n\n## Kept {#kept}\n",
  );
  const listedHtml = headingAnchors(
    "- <div>\n- ## Example {#example}\n- </div>\n\n## Kept {#kept}\n",
  );
  const quotedHeading = headingAnchors("> ## Requirement {#req-id}\n## Kept {#kept}\n");
  const listedHeading = headingAnchors("- ## Listed {#listed}\n## Kept {#kept}\n");
  const commentCloser = headingAnchors("<!--\n`-->`\n## Kept {#kept}\n");
  const sameLineCloser = headingAnchors("<!-- `-->`\n## Kept {#kept}\n");
  const closedHeading = headingAnchors("## Requirement {#req-id} ##\n## Kept {#kept}\n");
  const setextOk =
    setext.length === 3 &&
    setext[0] === "req-id" &&
    setext[1] === "kept" &&
    setext[2] === "" &&
    quotedBreak.length === 1 &&
    quotedBreak[0] === "kept" &&
    quotedSetext.length === 2 &&
    quotedSetext[0] === "req-id" &&
    quotedSetext[1] === "kept" &&
    nestedSetext.length === 2 &&
    nestedSetext[0] === "req-id" &&
    nestedSetext[1] === "kept" &&
    quotedH1.length === 1 &&
    quotedH1[0] === "kept" &&
    listedSetext.length === 2 &&
    listedSetext[0] === "req-id" &&
    listedSetext[1] === "kept" &&
    listedH1.length === 1 &&
    listedH1[0] === "kept" &&
    orderedSetext.length === 2 &&
    orderedSetext[0] === "req-id" &&
    orderedSetext[1] === "kept" &&
    quotedListSetext.length === 2 &&
    quotedListSetext[0] === "req-id" &&
    quotedListSetext[1] === "kept" &&
    listedBreak.length === 1 &&
    listedBreak[0] === "kept" &&
    htmlBlock.length === 1 &&
    htmlBlock[0] === "kept" &&
    htmlEnded.length === 1 &&
    htmlEnded[0] === "example" &&
    htmlScript.length === 1 &&
    htmlScript[0] === "kept" &&
    quotedHtml.length === 1 &&
    quotedHtml[0] === "kept" &&
    listedHtml.length === 1 &&
    listedHtml[0] === "kept" &&
    quotedHeading.length === 2 &&
    quotedHeading[0] === "req-id" &&
    quotedHeading[1] === "kept" &&
    listedHeading.length === 2 &&
    listedHeading[0] === "listed" &&
    listedHeading[1] === "kept" &&
    commentCloser.length === 1 &&
    commentCloser[0] === "kept" &&
    sameLineCloser.length === 1 &&
    sameLineCloser[0] === "kept" &&
    closedHeading.length === 2 &&
    closedHeading[0] === "req-id" &&
    closedHeading[1] === "kept";
  record(
    "setext-heading",
    "zero",
    setextOk ? 0 : 1,
    setextOk,
    JSON.stringify({ setext, quotedSetext, nestedSetext, quotedH1 }),
  );

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
  const ordinaryBlock =
    "/* note /** @evidence docs/requirements/active/x.md#anchor */ export function uncited() {}\n";
  const citationOk =
    !productionFileCites(spoofedCitation, "docs/requirements/active/x.md", "anchor") &&
    productionFileCites(realCitation, "docs/requirements/active/x.md", "anchor") &&
    !productionFileCites(ordinaryBlock, "docs/requirements/active/x.md", "anchor") &&
    !citesRequirement(ordinaryBlock, "uncited", "docs/requirements/active/x.md", "anchor");
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
  const shadowedBody = [
    "export function quotaTest() {}",
    'describe("alpha", () => {',
    "  const quotaTest = unrelated;",
    '  it("quota is documented", quotaTest);',
    "});",
  ].join("\n");
  const clearBody = [
    "export function quotaTest() {}",
    'describe("alpha", () => {',
    '  it("quota is documented", quotaTest);',
    "});",
  ].join("\n");
  const shadowed = registeredSuites(shadowedBody, "quotaTest", "quota is documented");
  const clear = registeredSuites(clearBody, "quotaTest", "quota is documented");
  const suiteNestingOk =
    wrongPath.length === 1 &&
    wrongPath[0]?.join(" > ") === "wrong" &&
    innerPath.length === 1 &&
    innerPath[0]?.join(" > ") === "expected > inner" &&
    shadowed.length === 0 &&
    clear.length === 1 &&
    clear[0]?.join(" > ") === "alpha";
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
  const graphDir = mkdtempSync(join(tmpdir(), "idlekit-evidence-graph-"));
  const helperPath = join(graphDir, "helper.ts");
  const hostPath = join(graphDir, "host.test.ts");
  writeFileSync(
    helperPath,
    'describe("kept", () => {\n  it("quota is documented", exportedName);\n});\n',
  );
  writeFileSync(
    hostPath,
    'import "./helper";\ndescribe("kept", () => {\n  it("quota is documented", exportedName);\n});\n',
  );
  const stalePath = join(graphDir, "old-helper.ts");
  const commentHostPath = join(graphDir, "comment-host.test.ts");
  writeFileSync(
    stalePath,
    'describe("kept", () => {\n  it("quota is documented", exportedName);\n});\n',
  );
  writeFileSync(
    commentHostPath,
    [
      '// import "./old-helper";',
      '/* import "./old-helper"; */',
      "const note = 'import \"./old-helper\"';",
      'import "./helper";',
    ].join("\n"),
  );
  let graphDuplicate = false;
  let commentIgnored = false;
  try {
    graphDuplicate = duplicateFullNamesAcross(sourceGraph([hostPath])).includes(
      "kept > quota is documented",
    );
    const commentBodies = sourceGraph([commentHostPath]);
    commentIgnored =
      commentBodies.length === 2 &&
      !duplicateFullNamesAcross(commentBodies).includes("kept > quota is documented");
  } finally {
    rmSync(graphDir, { recursive: true, force: true });
  }
  const computedBody = [
    'if (false) it("credited", citedExport);',
    'it(["cred", "ited"].join(""), unrelated);',
  ].join("\n");
  const computedNames = duplicateFullNames(computedBody);
  const computedDead = registeredSuites(computedBody, "citedExport", "credited");
  const computedCalls = unresolvedRunnerCalls(computedBody);
  const interpolatedCalls = unresolvedRunnerCalls("it(`quota ${name}`, exportedName);");
  const specifierDir = mkdtempSync(join(tmpdir(), "idlekit-evidence-specifier-"));
  const specifierHelper = join(specifierDir, "helper.ts");
  const specifierHost = join(specifierDir, "host.test.ts");
  const mjsHelper = join(specifierDir, "helper.mts");
  const mjsHost = join(specifierDir, "mjs-host.test.ts");
  const decoy = join(specifierDir, "helper.m.ts");
  writeFileSync(
    specifierHelper,
    [
      "export function register(it) {",
      '  it("credited", unrelated);',
      "}",
      "// from-typescript-helper",
    ].join("\n"),
  );
  writeFileSync(
    specifierHost,
    [
      'import { register } from "./helper.js";',
      'if (false) it("credited", citedExport);',
      "register(it);",
    ].join("\n"),
  );
  writeFileSync(decoy, "// from-decoy-helper\n");
  writeFileSync(
    mjsHelper,
    ["export function register(it) {", '  it("mjs-credited", unrelated);', "}"].join("\n"),
  );
  writeFileSync(mjsHost, 'import { register } from "./helper.mjs";\nregister(it);\n');
  let specifierDuplicate = false;
  let specifierResolved = false;
  let javascriptWins = false;
  let mjsResolved = false;
  try {
    const bodies = sourceGraph([specifierHost]);
    const joined = bodies.join("\n");
    specifierDuplicate = duplicateFullNamesAcross(bodies).includes("credited");
    specifierResolved =
      bodies.length === 2 &&
      joined.includes("from-typescript-helper") &&
      !joined.includes("from-decoy-helper");
    writeFileSync(
      join(specifierDir, "helper.js"),
      [
        "export function register(it) {",
        '  it("other", unrelated);',
        "}",
        "// from-javascript-helper",
      ].join("\n"),
    );
    const exactBodies = sourceGraph([specifierHost]);
    const exactJoined = exactBodies.join("\n");
    javascriptWins =
      exactBodies.length === 2 &&
      exactJoined.includes("from-javascript-helper") &&
      !exactJoined.includes("from-typescript-helper") &&
      !duplicateFullNamesAcross(exactBodies).includes("credited");
    const mjsBodies = sourceGraph([mjsHost]);
    mjsResolved =
      mjsBodies.length === 2 &&
      mjsBodies.some((body) => body.includes("mjs-credited")) &&
      !mjsBodies.some((body) => body.includes("from-decoy-helper"));
  } finally {
    rmSync(specifierDir, { recursive: true, force: true });
  }
  const preloadDir = mkdtempSync(join(tmpdir(), "idlekit-evidence-preload-"));
  const setupPath = resolve(preloadDir, "setup.ts");
  const preloadHost = join(preloadDir, "host.test.ts");
  writeFileSync(setupPath, 'export function wrap(it) {\n  it("credited", unrelated);\n}\n');
  writeFileSync(preloadHost, 'if (false) it("credited", citedExport);\n');
  let scalarPreload = false;
  let quotedPreload = false;
  let arrayPreload = false;
  try {
    writeFileSync(join(preloadDir, "bunfig.toml"), '[test]\npreload = "./setup.ts"\n');
    const scalar = localPreloadFiles(preloadDir, ["test"]);
    const scalarBodies = sourceGraph([preloadHost, ...scalar]);
    scalarPreload =
      scalar.length === 1 &&
      scalar[0] === setupPath &&
      duplicateFullNamesAcross(scalarBodies).includes("credited");
    writeFileSync(join(preloadDir, "bunfig.toml"), "[test]\npreload = './setup.ts'\n");
    const quoted = localPreloadFiles(preloadDir, ["test"]);
    quotedPreload = quoted.length === 1 && quoted[0] === setupPath;
    writeFileSync(join(preloadDir, "bunfig.toml"), '[test]\npreload = ["./setup.ts"]\n');
    const listed = localPreloadFiles(preloadDir, ["test"]);
    arrayPreload = listed.length === 1 && listed[0] === setupPath;
  } finally {
    rmSync(preloadDir, { recursive: true, force: true });
  }
  const focusedBody = [
    'describe("kept", () => {',
    '  if (false) it("quota is documented", exportedName);',
    '  it.only("quota is documented", otherName);',
    "});",
  ].join("\n");
  const focusedNames = duplicateFullNames(focusedBody);
  const focusedCallback = registeredSuites(focusedBody, "otherName", "quota is documented");
  const templateBody = [
    "describe(`kept`, () => {",
    '  if (false) it("quota is documented", exportedName);',
    "  it(`quota is documented`, unrelated);",
    "});",
  ].join("\n");
  const templateNames = duplicateFullNames(templateBody);
  const templateSuites = registeredSuites(templateBody, "unrelated", "quota is documented");
  const interpolated = registeredSuites(
    "it(`quota ${name}`, exportedName);",
    "exportedName",
    "quota is documented",
  );
  const unclosedNames = duplicateFullNames("it(`quota is documented, exportedName);");
  const substitutedBody = [
    'if (false) it("credited", citedExport);',
    '`${it("credited", unrelated)}`',
  ].join("\n");
  const substitutedNames = duplicateFullNames(substitutedBody);
  const substitutedLive = registeredSuites(substitutedBody, "unrelated", "credited");
  const substitutedDead = registeredSuites(
    '`it("credited", citedExport)`',
    "citedExport",
    "credited",
  );
  const nestedLive = registeredSuites('`${`${it("yes", unrelated)}`}`', "unrelated", "yes");
  const nestedDead = registeredSuites('`${`it("no", citedExport)`}`', "citedExport", "no");
  const eachBody = [
    'if (false) it("credited", citedExport);',
    'it.each([[1]])("credited", unrelated);',
  ].join("\n");
  const eachNames = duplicateFullNames(eachBody);
  const eachLive = registeredSuites(eachBody, "unrelated", "credited");
  const eachDead = registeredSuites(eachBody, "citedExport", "credited");
  const eachOnly = registeredSuites(
    'test.each([[1]])("credited", unrelated);',
    "unrelated",
    "credited",
  );
  const eachSuite = registeredSuites(
    ['describe.each([[1]])("kept", () => {', '  it("credited", unrelated);', "});"].join("\n"),
    "unrelated",
    "credited",
  );
  const conjunction = registeredSuites(
    'it("credited", citedExport && unrelated);',
    "citedExport",
    "credited",
  );
  const conjunctionOther = registeredSuites(
    'it("credited", citedExport && unrelated);',
    "unrelated",
    "credited",
  );
  const asserted = registeredSuites(
    'it("credited", citedExport as TestFn);',
    "citedExport",
    "credited",
  );
  const assertedLive = registeredSuites(
    'it("credited", citedExport as TestFn && unrelated);',
    "citedExport",
    "credited",
  );
  const member = registeredSuites('it("credited", citedExport.method);', "citedExport", "credited");
  const escapedBody = [
    'if (false) it("credited", citedExport);',
    'it("\\u0063redited", unrelated);',
  ].join("\n");
  const escapedNames = duplicateFullNames(escapedBody);
  const escapedLive = registeredSuites(escapedBody, "unrelated", "credited");
  const escapedDead = registeredSuites(escapedBody, "citedExport", "credited");
  const aliasBody = [
    "const register = it;",
    'if (false) it("credited", citedExport);',
    'register("credited", unrelated);',
  ].join("\n");
  const aliasNames = duplicateFullNames(aliasBody);
  const aliasLive = registeredSuites(aliasBody, "unrelated", "credited");
  const importedLive = registeredSuites(
    'import { it as register } from "bun:test";\nregister("credited", unrelated);',
    "unrelated",
    "credited",
  );
  const aliasShadowed = registeredSuites(
    'const register = it;\n{\n  const register = other;\n  register("credited", unrelated);\n}\n',
    "unrelated",
    "credited",
  );
  const asiBody = [
    "const register = it",
    'if (false) it("credited", citedExport)',
    'register("credited", unrelated)',
  ].join("\n");
  const asiLive = registeredSuites(asiBody, "unrelated", "credited");
  const typedBody = [
    "const register: typeof it = it",
    'register("credited", unrelated)',
  ].join("\n");
  const typedLive = registeredSuites(typedBody, "unrelated", "credited");
  const blockBody = ["{", "const register = it", 'register("credited", unrelated)', "}"].join("\n");
  const blockLive = registeredSuites(blockBody, "unrelated", "credited");
  const reboundBody = [
    "let register = it",
    "register = other",
    'register("credited", unrelated)',
  ].join("\n");
  const reboundLive = registeredSuites(reboundBody, "unrelated", "credited");
  const reboundUnresolved = unresolvedRunnerCalls(reboundBody);
  const wrappedBody = ["const register = wrap(it)", 'register("credited", unrelated)'].join("\n");
  const wrappedLive = registeredSuites(wrappedBody, "unrelated", "credited");
  const wrappedUnresolved = unresolvedRunnerCalls(wrappedBody);
  const forBody = [
    "const register = it",
    "for (const register = other; false;) {}",
    'register("credited", unrelated)',
  ].join("\n");
  const forLive = registeredSuites(forBody, "unrelated", "credited");
  const namespaceBody = [
    'import * as runner from "bun:test"',
    'if (false) it("credited", citedExport)',
    'runner.it("credited", unrelated)',
  ].join("\n");
  const namespaceLive = registeredSuites(namespaceBody, "unrelated", "credited");
  const namespaceExpect = unresolvedRunnerCalls(
    'import * as runner from "bun:test"\nrunner.expect("saved", "msg")',
  );
  const namespaceAlias = registeredSuites(
    [
      'import * as runner from "bun:test"',
      "const register = runner.it",
      'register("credited", unrelated)',
    ].join("\n"),
    "unrelated",
    "credited",
  );
  const namespaceType = registeredSuites(
    'import type * as runner from "bun:test"\nrunner.it("credited", unrelated)',
    "unrelated",
    "credited",
  );
  const namespaceShadowBody = [
    'import * as runner from "bun:test"',
    "{",
    "const runner = other",
    'runner.it("inner", unrelated)',
    "}",
    'runner.it("credited", citedExport)',
  ].join("\n");
  const namespaceShadow = registeredSuites(namespaceShadowBody, "citedExport", "credited");
  const namespaceShadowLive = registeredSuites(namespaceShadowBody, "unrelated", "inner");
  const plannerFile = readFileSync(join(root, "packages/core/src/sim/strategy/planner.ts"), "utf8");
  const plannerBound = plannerStepOnceBound(plannerFile);
  const plannerComment = plannerStepOnceBound("// ({ stepOnce }\n// d.stepOnce(\n");
  const plannerString = plannerStepOnceBound(
    'const label = "({ stepOnce }";\nconst call = "d.stepOnce(";\n',
  );
  const plannerTemplate = plannerStepOnceBound("const label = `({ stepOnce } d.stepOnce(`;\n");
  const plannerRenamed = plannerStepOnceBound("const d = ({ stepOnce });\nold.stepOnce();\n");
  const plannerLive = plannerStepOnceBound("const d = ({ stepOnce });\nd.stepOnce();\n");
  const failingBody = [
    'if (false) it("credited", citedExport)',
    'it.failing("credited", unrelated)',
  ].join("\n");
  const failingLive = registeredSuites(failingBody, "unrelated", "credited");
  const failingDead = registeredSuites(failingBody, "citedExport", "credited");
  const failingNames = duplicateFullNames(failingBody);
  const failingAlias = registeredSuites(
    ["const register = it.failing", 'register("credited", unrelated)'].join("\n"),
    "unrelated",
    "credited",
  );
  const namespaceFailing = registeredSuites(
    ['import * as runner from "bun:test"', 'runner.it.failing("credited", unrelated)'].join("\n"),
    "unrelated",
    "credited",
  );
  const skipIfLive = registeredSuites(
    'it.skipIf(ready)("credited", unrelated)',
    "unrelated",
    "credited",
  );
  const todoIfLive = registeredSuites(
    'it.todoIf(ready)("credited", unrelated)',
    "unrelated",
    "credited",
  );
  const ifLive = registeredSuites('it.if(ready)("credited", unrelated)', "unrelated", "credited");
  const conditionalEach = registeredSuites(
    'it.skipIf(ready).each([1])("credited", unrelated)',
    "unrelated",
    "credited",
  );
  const unknownBody = 'it.concurrent("credited", unrelated)';
  const unknownLive = registeredSuites(unknownBody, "unrelated", "credited");
  const unknownCalls = unresolvedRunnerCalls(unknownBody);
  const destructuredBody = [
    'const { it: register } = await import("bun:test")',
    'if (false) it("credited", citedExport)',
    'register("credited", unrelated)',
  ].join("\n");
  const destructuredLive = registeredSuites(destructuredBody, "unrelated", "credited");
  const destructuredDead = registeredSuites(destructuredBody, "citedExport", "credited");
  const destructuredNames = duplicateFullNames(destructuredBody);
  const otherDestructure = registeredSuites(
    [
      'const { it: register } = await import("other")',
      'register("credited", unrelated)',
    ].join("\n"),
    "unrelated",
    "credited",
  );
  const requiredBody = [
    'const { it: register } = require("bun:test")',
    'if (false) it("credited", citedExport)',
    'register("credited", unrelated)',
  ].join("\n");
  const requiredLive = registeredSuites(requiredBody, "unrelated", "credited");
  const requiredDead = registeredSuites(requiredBody, "citedExport", "credited");
  const requiredNames = duplicateFullNames(requiredBody);
  const otherRequire = registeredSuites(
    ['const { it: register } = require("other")', 'register("credited", unrelated)'].join("\n"),
    "unrelated",
    "credited",
  );
  const duplicateOk =
    duplicateNames.length === 1 &&
    duplicateNames[0] === "kept > quota is documented" &&
    duplicateStillRegistered.length === 1 &&
    acrossFiles.includes("kept > quota is documented") &&
    graphDuplicate &&
    commentIgnored &&
    focusedNames.length === 1 &&
    focusedNames[0] === "kept > quota is documented" &&
    focusedCallback.length === 1 &&
    templateNames.length === 1 &&
    templateNames[0] === "kept > quota is documented" &&
    templateSuites.length === 1 &&
    templateSuites[0]?.join(" > ") === "kept" &&
    interpolated.length === 0 &&
    unclosedNames.length === 0 &&
    substitutedNames.length === 1 &&
    substitutedNames[0] === "credited" &&
    substitutedLive.length === 1 &&
    substitutedDead.length === 0 &&
    nestedLive.length === 1 &&
    nestedDead.length === 0 &&
    eachNames.length === 1 &&
    eachNames[0] === "credited" &&
    eachLive.length === 1 &&
    eachDead.length === 1 &&
    eachOnly.length === 1 &&
    eachSuite.length === 1 &&
    eachSuite[0]?.join(" > ") === "kept" &&
    conjunction.length === 0 &&
    conjunctionOther.length === 0 &&
    asserted.length === 1 &&
    assertedLive.length === 0 &&
    member.length === 0 &&
    escapedNames.length === 1 &&
    escapedNames[0] === "credited" &&
    escapedLive.length === 1 &&
    escapedDead.length === 1 &&
    aliasNames.length === 1 &&
    aliasNames[0] === "credited" &&
    aliasLive.length === 1 &&
    importedLive.length === 1 &&
    aliasShadowed.length === 0 &&
    asiLive.length === 1 &&
    typedLive.length === 1 &&
    blockLive.length === 1 &&
    reboundLive.length === 0 &&
    reboundUnresolved.length === 1 &&
    wrappedLive.length === 0 &&
    wrappedUnresolved.length === 1 &&
    forLive.length === 1 &&
    namespaceLive.length === 1 &&
    namespaceExpect.length === 0 &&
    namespaceAlias.length === 1 &&
    namespaceType.length === 0 &&
    namespaceShadow.length === 1 &&
    namespaceShadowLive.length === 0 &&
    plannerBound &&
    plannerComment === false &&
    plannerString === false &&
    plannerTemplate === false &&
    plannerRenamed === false &&
    plannerLive &&
    failingLive.length === 1 &&
    failingDead.length === 1 &&
    failingNames.length === 1 &&
    failingAlias.length === 1 &&
    namespaceFailing.length === 1 &&
    skipIfLive.length === 1 &&
    todoIfLive.length === 1 &&
    ifLive.length === 1 &&
    conditionalEach.length === 1 &&
    unknownLive.length === 0 &&
    unknownCalls.length === 1 &&
    destructuredLive.length === 1 &&
    destructuredDead.length === 1 &&
    destructuredNames.length === 1 &&
    otherDestructure.length === 0 &&
    requiredLive.length === 1 &&
    requiredDead.length === 1 &&
    requiredNames.length === 1 &&
    otherRequire.length === 0 &&
    computedNames.length === 0 &&
    computedDead.length === 1 &&
    computedCalls.length === 1 &&
    computedCalls[0] === "it" &&
    interpolatedCalls.length === 1 &&
    specifierDuplicate &&
    specifierResolved &&
    javascriptWins &&
    mjsResolved &&
    scalarPreload &&
    quotedPreload &&
    arrayPreload;
  record(
    "duplicate-title",
    "zero",
    duplicateOk ? 0 : 1,
    duplicateOk,
    JSON.stringify({ duplicateNames, duplicateStillRegistered, commentIgnored }),
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
  const partialHost = [
    "/** @evidence docs/spec.md#quota Cites the section only. */",
    "export function requirementOnly(): void {}",
    "/** @evidence ./host.ts#quotaHost Calls the host. */",
    "export function covered(): void {}",
  ].join("\n");
  const partialGap = unregisteredImplementationHost(
    partialHost,
    "docs/spec.md",
    "quota",
    ["requirementOnly", "covered"],
    { file: "pkg/case.test.ts", production: ["pkg/host.ts"] },
  );
  const gapOk =
    typeof gap === "object" &&
    gap?.kind === "unregistered" &&
    gap.name === "helper" &&
    partialGap === "";
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
  const optionOnly = commandTargetsFile({
    file: "src/a.test.ts",
    exportName: "example",
    registeredAs: "example",
    cwd: ".",
    args: ["test", "--reporter-outfile", "src/a.test.ts"],
  });
  const optionThenFile = commandTargetsFile({
    file: "src/a.test.ts",
    exportName: "example",
    registeredAs: "example",
    cwd: ".",
    args: ["test", "--reporter-outfile", "out.xml", "src/a.test.ts"],
  });
  const optionEquals = commandTargetsFile({
    file: "src/a.test.ts",
    exportName: "example",
    registeredAs: "example",
    cwd: ".",
    args: ["test", "--reporter-outfile=src/a.test.ts"],
  });
  const extraTargets = uninventoriedCommandTargets(
    ["test", "src/example.test.ts", "src/other.test.ts"],
    ".",
    ["src/example.test.ts"],
  );
  const onlyTarget = uninventoriedCommandTargets(["test", "src/example.test.ts"], ".", [
    "src/example.test.ts",
  ]);
  const preloaded = uninventoriedCommandTargets(
    ["test", "--preload", "./setup.ts", "src/example.test.ts"],
    ".",
    ["src/example.test.ts"],
  );
  const preloadedEq = uninventoriedCommandTargets(
    ["test", "--preload=./setup.ts", "src/example.test.ts"],
    ".",
    ["src/example.test.ts"],
  );
  const directoryPattern = uninventoriedCommandTargets(
    ["test", "src/example.test.ts", "src"],
    ".",
    ["src/example.test.ts"],
  );
  const namedPattern = uninventoriedCommandTargets(
    ["test", "--test-name-pattern", "credited", "src/example.test.ts"],
    ".",
    ["src/example.test.ts"],
  );
  const namedEquals = uninventoriedCommandTargets(
    ["test", "--test-name-pattern=credited", "src/example.test.ts"],
    ".",
    ["src/example.test.ts"],
  );
  const shortNamed = uninventoriedCommandTargets(
    ["test", "-t", "credited", "src/example.test.ts"],
    ".",
    ["src/example.test.ts"],
  );
  const reported = uninventoriedCommandTargets(
    ["test", "--reporter", "junit", "--reporter-outfile", "out.xml", "src/example.test.ts"],
    ".",
    ["src/example.test.ts"],
  );
  const reporterArgs = junitReporterArgs(["test", "--", "src/example.test.ts"], "out.xml");
  const watchBlocked = blockedTestArgs(["test", "--watch", "src/example.test.ts"]);
  const updateBlocked = blockedTestArgs(["test", "-u", "src/example.test.ts"]);
  const updateNamed = blockedTestArgs(["test", "--update-snapshots", "src/example.test.ts"]);
  const plainCommand = blockedTestArgs(["test", "src/example.test.ts"]);
  const reporterAt = reporterArgs.indexOf("--reporter=junit");
  const separatorAt = reporterArgs.indexOf("--");
  const commandOk =
    wrapped === false &&
    direct === true &&
    optionOnly === false &&
    optionThenFile === true &&
    optionEquals === false &&
    extraTargets.length === 1 &&
    onlyTarget.length === 0 &&
    preloaded.length === 0 &&
    preloadedEq.length === 0 &&
    directoryPattern.length === 1 &&
    directoryPattern[0] === "src" &&
    namedPattern.length === 0 &&
    namedEquals.length === 0 &&
    shortNamed.length === 0 &&
    reported.length === 0 &&
    reporterAt >= 0 &&
    separatorAt > reporterAt &&
    reporterArgs.at(-1) === "src/example.test.ts" &&
    watchBlocked === "--watch" &&
    updateBlocked === "-u" &&
    updateNamed === "--update-snapshots" &&
    plainCommand === undefined;
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
  const testsDir = isNonProductionPath("packages/core/src/__tests__/quota.ts");
  const testDir = isNonProductionPath("packages/core/src/test/quota.ts");
  const testsSegment = isNonProductionPath("packages/core/src/tests/quota.ts");
  const testkit = !isNonProductionPath("packages/core/src/testkit/conformance.ts");
  const tsxHost = isInventoryPackageHost("packages/web/src/quota.tsx");
  const mtsHost = isInventoryPackageHost("packages/web/src/quota.mts");
  const ctsHost = isInventoryPackageHost("packages/web/src/quota.cts");
  const markdownHost = !isInventoryPackageHost("docs/quota.md");
  const specOk =
    specTsx &&
    specMts &&
    generatedTsx &&
    productionTs &&
    testsDir &&
    testDir &&
    testsSegment &&
    testkit &&
    tsxHost &&
    mtsHost &&
    ctsHost &&
    markdownHost;
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
  const defaultCites = productionFileCites(
    "/** @evidence docs/spec.md#quota */\nexport default function quotaHost() {\n  return 3;\n}\n",
    "docs/spec.md",
    "quota",
  );
  const defaultExport = hasProductionExport(
    "export default async function quotaHost() {\n  return 3;\n}\n",
  );
  const hiddenExport = hasProductionExport("function quotaHost() {\n  return 3;\n}\n");
  const classCites = productionFileCites(
    [
      "export class QuotaHost {",
      "  /** @evidence docs/spec.md#quota */",
      "  readonly marker = 1;",
      "}",
    ].join("\n"),
    "docs/spec.md",
    "quota",
  );
  const interfaceCites = productionFileCites(
    [
      "export interface QuotaHost {",
      "  /** @evidence docs/spec.md#quota */",
      "  marker: number;",
      "}",
    ].join("\n"),
    "docs/spec.md",
    "quota",
  );
  const localClass = productionFileCites(
    [
      "class QuotaHost {",
      "  /** @evidence docs/spec.md#quota */",
      "  marker = 1;",
      "}",
    ].join("\n"),
    "docs/spec.md",
    "quota",
  );
  const privateField = productionFileCites(
    [
      "export class QuotaHost {",
      "  /** @evidence docs/spec.md#quota */",
      "  private marker = 1;",
      "}",
    ].join("\n"),
    "docs/spec.md",
    "quota",
  );
  const nestedAssignment = productionFileCites(
    [
      "export class QuotaHost {",
      "  method(): void {",
      "    /** @evidence docs/spec.md#quota */",
      "    marker = 1;",
      "  }",
      "}",
    ].join("\n"),
    "docs/spec.md",
    "quota",
  );
  const citeOk =
    functionCites &&
    constCites &&
    !typeCites &&
    defaultCites &&
    defaultExport &&
    !hiddenExport &&
    classCites &&
    interfaceCites &&
    !localClass &&
    !privateField &&
    !nestedAssignment;
  record(
    "production-citation-kind",
    "zero",
    citeOk ? 0 : 1,
    citeOk,
    `function=${functionCites} const=${constCites} type=${typeCites} default=${defaultCites}`,
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
  const launcherOk =
    ttsxUnderNodeName("win32") === "ttsx-under-node.cmd" &&
    ttsxUnderNodeName("darwin") === "ttsx-under-node" &&
    compilerBinName("ttsc", "win32") === "ttsc.cmd" &&
    compilerBinName("tsc", "win32") === "tsc.cmd" &&
    compilerBinName("ttsc", "darwin") === "ttsc" &&
    compilerBinName("tsc", "linux") === "tsc";
  const programOk = omitted.length === 1 && omitted[0] === "src/b.ts" && hostPresent && launcherOk;
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
  const droppedFormat = formatGateFailures({
    tsconfigText: JSON.stringify({
      compilerOptions: {
        plugins: [{ transform: "@ttsc/lint", configFile: "./lint.format.config.ts" }],
      },
      include: ["tools/format-check.ts"],
    }),
  });
  const formatWith = (exclude: readonly string[]) =>
    formatGateFailures({
      tsconfigText: JSON.stringify({
        compilerOptions: {
          plugins: [{ transform: "@ttsc/lint", configFile: "./lint.format.config.ts" }],
        },
        include: formatIncludeRoots,
        exclude,
      }),
    });
  const dropsSmoke = (failures: readonly string[]) =>
    failures.some((message) => message.includes("exclude dropped tools/evidence-smoke.ts"));
  const excludedExact = formatWith(["tools/evidence-smoke.ts"]);
  const excludedStar = formatWith(["tools/*"]);
  const excludedTree = formatWith(["tools/**"]);
  const excludedDeep = formatWith(["tools/**/*.ts"]);
  const excludedAny = formatWith(["**/evidence-smoke.ts"]);
  const excludedBase = formatWith(["evidence-smoke.ts"]);
  const excludedDir = formatWith(["tools"]);
  const excludedSlash = formatWith(["tools/**/"]);
  const excludedDot = formatWith(["./tools/evidence-smoke.ts"]);
  const unrelatedExclude = formatWith(["fixtures/**"]);
  const keepsConfig = (failures: readonly string[]) =>
    !failures.some((message) => message.includes("evidence.config.ts"));
  const formatOk =
    badFormat.exitCode !== 0 &&
    /\[format\/(?:quotes|semi)\]/.test(badFormatText) &&
    rootFormatOk &&
    warningFormat.some((message) => message.includes("severity")) &&
    droppedFormat.some((message) => message.includes("tools/evidence-check.ts")) &&
    droppedFormat.some((message) => message.includes("tools/evidence-smoke.ts")) &&
    dropsSmoke(excludedExact) &&
    dropsSmoke(excludedStar) &&
    dropsSmoke(excludedTree) &&
    dropsSmoke(excludedDeep) &&
    dropsSmoke(excludedAny) &&
    dropsSmoke(excludedBase) &&
    dropsSmoke(excludedDir) &&
    keepsConfig(excludedDir) &&
    dropsSmoke(excludedSlash) &&
    dropsSmoke(excludedDot) &&
    unrelatedExclude.length === 0;
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
