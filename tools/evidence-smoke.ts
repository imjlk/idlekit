import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { plainTestEnv } from "./evidence/junit";
import {
  installSourceLock,
  sealedCommand,
  sealSources,
  unsealSources,
} from "./evidence/source-lock";
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
  loaderPluginRegistration,
  mockModuleRegistration,
  localPreloadFiles,
  unresolvedPreloadSpecifiers,
  unresolvedRunnerCalls,
  registrationLines,
  sourceGraph,
  sourceFiles,
  unresolvedLocalRequires,
  ambiguousSuiteSeparators,
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
  const quotedFenceBreak = headingAnchors(["> ```", "## Requirement {#req-id}"].join("\n"));
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
    quotedFenceBreak.length === 1 &&
    quotedFenceBreak[0] === "req-id" &&
    listedFence.length === 1 &&
    listedFence[0] === "kept";
  record(
    "fenced-headings",
    "zero",
    fenceOk ? 0 : 1,
    fenceOk,
    JSON.stringify({ anchors, backtickInfo, tildeInfo, quotedFence, quotedFenceBreak, listedFence }),
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
  const continuedList = headingAnchors(
    ["123. item", "     ## Requirement {#req-id}", "## Kept {#kept}"].join("\n"),
  );
  const continuedBlank = headingAnchors(
    ["123. item", "", "     ## Requirement {#req-id}"].join("\n"),
  );
  const continuedCode = headingAnchors(
    ["123. item", "    ## Hidden {#hidden}", "## Kept {#kept}"].join("\n"),
  );
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
    closedHeading[1] === "kept" &&
    continuedList.length === 2 &&
    continuedList[0] === "req-id" &&
    continuedList[1] === "kept" &&
    continuedBlank.length === 1 &&
    continuedBlank[0] === "req-id" &&
    continuedCode.length === 1 &&
    continuedCode[0] === "kept";
  record(
    "setext-heading",
    "zero",
    setextOk ? 0 : 1,
    setextOk,
    JSON.stringify({
      setext,
      quotedSetext,
      nestedSetext,
      quotedH1,
      continuedList,
      continuedBlank,
      continuedCode,
    }),
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
  let requireDuplicate = false;
  let requireResolved = false;
  let templateRequire = false;
  let unresolvedRequire = false;
  let dynamicRequire = false;
  let packageRequire = false;
  let commentRequire = false;
  let shadowedRequire = false;
  let importEquals = false;
  let createdRequire = false;
  let commentImport = false;
  let relativeTypeSkipped = false;
  let dynamicImport = false;
  let unresolvedImport = false;
  let packageImport = false;
  let resolvedImport = false;
  let helperComputed = false;
  let moduleRequire = false;
  let metaRequire = false;
  let moduleSpacedRequire = false;
  let memberRequireIgnored = false;
  let moduleDynamicRequire = false;
  let directoryEntry = false;
  let queryImport = false;
  let fragmentImport = false;
  let directoryQuery = false;
  let installedPackage = false;
  let nestedPackage = false;
  let quietPackage = false;
  let libraryPackage = false;
  let missingInstalled = false;
  let dynamicPackage = false;
  let dataImport = false;
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
    const requireHelper = join(specifierDir, "required-helper.ts");
    const requireHost = join(specifierDir, "require-host.test.ts");
    writeFileSync(
      requireHelper,
      [
        "function register(it) {",
        '  it("credited", unrelated);',
        "}",
        "register(it);",
        "// from-required-helper",
      ].join("\n"),
    );
    writeFileSync(
      requireHost,
      ['require("./required-helper");', 'if (false) it("credited", citedExport);'].join("\n"),
    );
    const requireBodies = sourceGraph([requireHost]);
    requireDuplicate = duplicateFullNamesAcross(requireBodies).includes("credited");
    requireResolved = requireBodies.some((body) => body.includes("from-required-helper"));
    writeFileSync(
      requireHost,
      [
        'import { register } from /* note */ "./required-helper";',
        'if (false) it("credited", citedExport);',
      ].join("\n"),
    );
    const blockBodies = sourceGraph([requireHost]);
    const blockImport =
      blockBodies.length === 2 && duplicateFullNamesAcross(blockBodies).includes("credited");
    writeFileSync(
      requireHost,
      [
        "import { register } from // note",
        '  "./required-helper";',
        'if (false) it("credited", citedExport);',
      ].join("\n"),
    );
    const lineBodies = sourceGraph([requireHost]);
    const lineImport =
      lineBodies.length === 2 && duplicateFullNamesAcross(lineBodies).includes("credited");
    writeFileSync(
      requireHost,
      [
        'import /* note */ "./required-helper";',
        'if (false) it("credited", citedExport);',
      ].join("\n"),
    );
    const sideBodies = sourceGraph([requireHost]);
    const sideImport =
      sideBodies.length === 2 && duplicateFullNamesAcross(sideBodies).includes("credited");
    commentImport = blockImport && lineImport && sideImport;
    writeFileSync(
      join(specifierDir, "types.ts"),
      'it("credited", unrelated);\n// from-type-only\n',
    );
    writeFileSync(
      requireHost,
      ['import type { Box } from "./types";', 'if (false) it("credited", citedExport);'].join("\n"),
    );
    const erasedBodies = sourceGraph([requireHost]);
    const erasedType =
      erasedBodies.length === 1 && !erasedBodies.some((body) => body.includes("from-type-only"));
    writeFileSync(
      requireHost,
      ['import { type Box } from "./types";', 'if (false) it("credited", citedExport);'].join("\n"),
    );
    const inlineBodies = sourceGraph([requireHost]);
    const inlineType =
      inlineBodies.length === 1 && !inlineBodies.some((body) => body.includes("from-type-only"));
    relativeTypeSkipped = erasedType && inlineType;
    writeFileSync(
      requireHost,
      ['module.require("./required-helper");', 'if (false) it("credited", citedExport);'].join(
        "\n",
      ),
    );
    const moduleBodies = sourceGraph([requireHost]);
    moduleRequire =
      duplicateFullNamesAcross(moduleBodies).includes("credited") &&
      moduleBodies.some((body) => body.includes("from-required-helper"));
    writeFileSync(
      requireHost,
      ['import.meta.require("./required-helper");', 'if (false) it("credited", citedExport);'].join(
        "\n",
      ),
    );
    const metaBodies = sourceGraph([requireHost]);
    metaRequire =
      duplicateFullNamesAcross(metaBodies).includes("credited") &&
      metaBodies.some((body) => body.includes("from-required-helper"));
    writeFileSync(requireHost, 'module . require("./required-helper");\n');
    moduleSpacedRequire = sourceGraph([requireHost]).some((body) =>
      body.includes("from-required-helper"),
    );
    writeFileSync(requireHost, 'foo.require("./required-helper");\n');
    memberRequireIgnored =
      sourceGraph([requireHost]).length === 1 &&
      unresolvedLocalRequires([requireHost]).length === 0;
    writeFileSync(requireHost, "module.require(name);\n");
    moduleDynamicRequire = unresolvedLocalRequires([requireHost]).includes("dynamic require");
    writeFileSync(requireHost, "require(`./required-helper`);\n");
    templateRequire = sourceGraph([requireHost]).some((body) =>
      body.includes("from-required-helper"),
    );
    writeFileSync(requireHost, 'require("./missing");\n');
    unresolvedRequire = unresolvedLocalRequires([requireHost]).includes("./missing");
    writeFileSync(requireHost, "require(name);\n");
    dynamicRequire = unresolvedLocalRequires([requireHost]).includes("dynamic require");
    writeFileSync(
      requireHost,
      `require("bun:test");\nrequire(${JSON.stringify("node:" + "fs")});\n`,
    );
    const packageFaults = unresolvedLocalRequires([requireHost]);
    packageRequire = packageFaults.length === 0 && sourceGraph([requireHost]).length === 1;
    writeFileSync(requireHost, 'import("./" + "required-helper");\n');
    dynamicImport = unresolvedLocalRequires([requireHost]).includes("dynamic import");
    writeFileSync(requireHost, 'import("./missing-import");\n');
    unresolvedImport = unresolvedLocalRequires([requireHost]).includes("./missing-import");
    writeFileSync(requireHost, 'import("bun:test");\n');
    packageImport = unresolvedLocalRequires([requireHost]).length === 0;
    writeFileSync(requireHost, 'import("./required-helper");\n');
    resolvedImport = sourceGraph([requireHost]).some((body) =>
      body.includes("from-required-helper"),
    );
    writeFileSync(
      requireHost,
      [
        '// require("./missing-comment");',
        "const text = 'require(\"./missing-string\")';",
      ].join("\n"),
    );
    commentRequire = unresolvedLocalRequires([requireHost]).length === 0;
    writeFileSync(
      requireHost,
      ["const require = (value: string) => value;", 'require("./missing.ts");'].join("\n"),
    );
    const localRequire = unresolvedLocalRequires([requireHost]);
    writeFileSync(
      requireHost,
      ['require("./missing-before.ts");', "const require = (value: string) => value;"].join("\n"),
    );
    const earlyRequire = unresolvedLocalRequires([requireHost]);
    writeFileSync(
      requireHost,
      [
        "function hide(require) {",
        '  require("./missing-shadow.ts");',
        "}",
        'require("./missing-real.ts");',
      ].join("\n"),
    );
    const nestedRequire = unresolvedLocalRequires([requireHost]);
    writeFileSync(
      requireHost,
      ["// const require = (value: string) => value;", 'require("./missing-comment.ts");'].join(
        "\n",
      ),
    );
    const commentBinding = unresolvedLocalRequires([requireHost]);
    writeFileSync(
      requireHost,
      [
        "const { require } = { require: (value) => value };",
        'require("./missing-destructure.ts");',
      ].join("\n"),
    );
    const destructuredRequire = unresolvedLocalRequires([requireHost]);
    writeFileSync(
      requireHost,
      [
        "const box = { a: 1 };",
        "const { a = require } = box;",
        'require("./missing-default.ts");',
      ].join("\n"),
    );
    const defaultRequire = unresolvedLocalRequires([requireHost]);
    shadowedRequire =
      localRequire.length === 0 &&
      earlyRequire.length === 0 &&
      nestedRequire.includes("./missing-real.ts") &&
      !nestedRequire.includes("./missing-shadow.ts") &&
      commentBinding.includes("./missing-comment.ts") &&
      destructuredRequire.length === 0 &&
      defaultRequire.includes("./missing-default.ts");
    writeFileSync(requireHost, 'import helper = require("./required-helper");\n');
    const equalsBodies = sourceGraph([requireHost]);
    const equalsResolved = equalsBodies.some((body) => body.includes("from-required-helper"));
    writeFileSync(requireHost, 'import helper = require("./missing-equals");\n');
    const equalsFault = unresolvedLocalRequires([requireHost]).includes("./missing-equals");
    writeFileSync(
      requireHost,
      [
        'import helper = require("./required-helper");',
        'require("./missing-after-equals.ts");',
      ].join("\n"),
    );
    const equalsKeepsCall = unresolvedLocalRequires([requireHost]).includes(
      "./missing-after-equals.ts",
    );
    importEquals = equalsResolved && equalsFault && equalsKeepsCall;
    const nodeModule = "node:" + "module";
    writeFileSync(
      requireHost,
      [
        `import { createRequire } from ${JSON.stringify(nodeModule)};`,
        "const req = createRequire(import.meta.url);",
        'req("./required-helper");',
      ].join("\n"),
    );
    const createdBodies = sourceGraph([requireHost]);
    const createdResolved = createdBodies.some((body) => body.includes("from-required-helper"));
    writeFileSync(
      requireHost,
      ["const req = createRequire(import.meta.url);", 'req("./missing-created");'].join("\n"),
    );
    const createdFault = unresolvedLocalRequires([requireHost]).includes("./missing-created");
    writeFileSync(
      requireHost,
      [
        'import { createRequire as makeRequire } from "module";',
        "const req = makeRequire(import.meta.url);",
        'req("./required-helper");',
      ].join("\n"),
    );
    const renamedCreated = sourceGraph([requireHost]).some((body) =>
      body.includes("from-required-helper"),
    );
    writeFileSync(requireHost, 'createRequire(import.meta.url)("./required-helper");\n');
    const directCreated = sourceGraph([requireHost]).some((body) =>
      body.includes("from-required-helper"),
    );
    createdRequire = createdResolved && createdFault && renamedCreated && directCreated;
    writeFileSync(
      requireHelper,
      [
        "export function register() {",
        '  it(["cred", "ited"].join(""), unrelated);',
        "}",
        "// from-computed-helper",
      ].join("\n"),
    );
    const computedHost = [
      'import { register } from "./required-helper";',
      'if (false) it("credited", citedExport);',
      "register();",
    ].join("\n");
    writeFileSync(requireHost, computedHost);
    const computedBodies = sourceGraph([requireHost]);
    helperComputed =
      computedBodies.some((body) => body.includes("from-computed-helper")) &&
      !duplicateFullNamesAcross(computedBodies).includes("credited") &&
      unresolvedRunnerCalls(computedHost).length === 0 &&
      computedBodies.some((body) => unresolvedRunnerCalls(body).length > 0);
    const entryDir = join(specifierDir, "entry");
    mkdirSync(entryDir);
    writeFileSync(join(entryDir, "package.json"), '{ "name": "entry", "main": "./register.ts" }\n');
    writeFileSync(
      join(entryDir, "register.ts"),
      'it("credited", unrelated);\n// from-package-entry\n',
    );
    writeFileSync(
      join(entryDir, "index.ts"),
      'it("credited", citedExport);\n// from-package-index\n',
    );
    const entryHost = join(specifierDir, "entry-host.test.ts");
    writeFileSync(entryHost, 'import "./entry";\nif (false) it("credited", citedExport);\n');
    const entryBodies = sourceGraph([entryHost]);
    directoryEntry =
      entryBodies.some((body) => body.includes("from-package-entry")) &&
      !entryBodies.some((body) => body.includes("from-package-index")) &&
      duplicateFullNamesAcross(entryBodies).includes("credited");
    const queryHelper = join(specifierDir, "query-helper.ts");
    const queryHost = join(specifierDir, "query-host.test.ts");
    writeFileSync(queryHelper, 'it("credited", unrelated);\n// from-query-helper\n');
    writeFileSync(
      queryHost,
      [
        'import "./query-helper.ts?loader=test#section";',
        'if (false) it("credited", citedExport);',
      ].join("\n"),
    );
    const queryBodies = sourceGraph([queryHost]);
    queryImport =
      queryBodies.some((body) => body.includes("from-query-helper")) &&
      duplicateFullNamesAcross(queryBodies).includes("credited");
    const fragmentHost = join(specifierDir, "fragment-host.test.ts");
    writeFileSync(fragmentHost, 'import "./query-helper.ts#section";\n');
    fragmentImport =
      unresolvedLocalRequires([fragmentHost]).includes("./query-helper.ts#section") &&
      !sourceGraph([fragmentHost]).some((body) => body.includes("from-query-helper"));
    const queryEntryHost = join(specifierDir, "query-entry-host.test.ts");
    writeFileSync(queryEntryHost, 'import "./entry?x";\n');
    const queryEntryBodies = sourceGraph([queryEntryHost]);
    directoryQuery =
      queryEntryBodies.some((body) => body.includes("from-package-entry")) &&
      !queryEntryBodies.some((body) => body.includes("from-package-index"));
    const installedRoot = join(specifierDir, "node_modules");
    const helperPkg = join(installedRoot, "test-helper");
    mkdirSync(helperPkg, { recursive: true });
    writeFileSync(
      join(helperPkg, "package.json"),
      '{ "name": "test-helper", "module": "./register.ts", "main": "./register.ts" }\n',
    );
    writeFileSync(
      join(helperPkg, "register.ts"),
      'it("credited", unrelated);\n// from-installed-helper\n',
    );
    const installedHost = join(specifierDir, "installed-host.test.ts");
    writeFileSync(
      installedHost,
      ['import { register } from "test-helper";', 'if (false) it("credited", citedExport);'].join(
        "\n",
      ),
    );
    const installedBodies = sourceGraph([installedHost]);
    installedPackage =
      installedBodies.some((body) => body.includes("from-installed-helper")) &&
      duplicateFullNamesAcross(installedBodies).includes("credited");
    const innerPkg = join(installedRoot, "inner-helper");
    const outerPkg = join(installedRoot, "outer-helper");
    mkdirSync(innerPkg, { recursive: true });
    mkdirSync(outerPkg, { recursive: true });
    writeFileSync(
      join(innerPkg, "package.json"),
      '{ "name": "inner-helper", "main": "./register.ts" }\n',
    );
    writeFileSync(
      join(innerPkg, "register.ts"),
      'it("credited", unrelated);\n// from-inner-helper\n',
    );
    writeFileSync(
      join(outerPkg, "package.json"),
      '{ "name": "outer-helper", "main": "./index.ts" }\n',
    );
    writeFileSync(join(outerPkg, "index.ts"), 'export { register } from "inner-helper";\n');
    const nestedHost = join(specifierDir, "nested-host.test.ts");
    writeFileSync(
      nestedHost,
      ['import "outer-helper";', 'if (false) it("credited", citedExport);'].join("\n"),
    );
    const nestedBodies = sourceGraph([nestedHost]);
    nestedPackage =
      nestedBodies.some((body) => body.includes("from-inner-helper")) &&
      duplicateFullNamesAcross(nestedBodies).includes("credited");
    const quietPkg = join(installedRoot, "quiet-helper");
    mkdirSync(quietPkg, { recursive: true });
    writeFileSync(
      join(quietPkg, "package.json"),
      '{ "name": "quiet-helper", "main": "./index.ts" }\n',
    );
    writeFileSync(join(quietPkg, "index.ts"), "export const value = 1;\n// from-quiet-helper\n");
    const quietHost = join(specifierDir, "quiet-host.test.ts");
    writeFileSync(quietHost, 'import "quiet-helper";\n');
    const quietBodies = sourceGraph([quietHost]);
    quietPackage =
      quietBodies.length === 1 && !quietBodies.some((body) => body.includes("from-quiet-helper"));
    const libraryPkg = join(installedRoot, "library-helper");
    mkdirSync(libraryPkg, { recursive: true });
    writeFileSync(
      join(libraryPkg, "package.json"),
      '{ "name": "library-helper", "main": "./index.ts" }\n',
    );
    writeFileSync(
      join(libraryPkg, "index.ts"),
      [
        "function describe(lines, extra) {",
        "  return lines;",
        "}",
        'describe(lines, ["min"]);',
        "// from-library-helper",
      ].join("\n"),
    );
    const libraryHost = join(specifierDir, "library-host.test.ts");
    writeFileSync(libraryHost, 'import "library-helper";\n');
    const libraryBodies = sourceGraph([libraryHost]);
    libraryPackage =
      !libraryBodies.some((body) => body.includes("from-library-helper")) &&
      libraryBodies.every((body) => !unresolvedRunnerCalls(body).includes("describe"));
    const missingHost = join(specifierDir, "missing-installed-host.test.ts");
    writeFileSync(missingHost, 'import "not-installed-evidence-pkg";\n');
    const missingFaults = unresolvedLocalRequires([missingHost]).length === 0;
    missingInstalled = missingFaults && sourceGraph([missingHost]).length === 1;
    const dynamicPkg = join(installedRoot, "dynamic-helper");
    mkdirSync(dynamicPkg, { recursive: true });
    writeFileSync(
      join(dynamicPkg, "package.json"),
      '{ "name": "dynamic-helper", "main": "./index.ts" }\n',
    );
    writeFileSync(
      join(dynamicPkg, "index.ts"),
      'require(name);\nit("credited", unrelated);\n// from-dynamic-package\n',
    );
    const dynamicHost = join(specifierDir, "dynamic-host.test.ts");
    writeFileSync(
      dynamicHost,
      ['import "dynamic-helper";', 'if (false) it("credited", citedExport);'].join("\n"),
    );
    const dynamicBodies = sourceGraph([dynamicHost]);
    const dynamicFaults = unresolvedLocalRequires([dynamicHost]);
    dynamicPackage =
      dynamicBodies.some((body) => body.includes("from-dynamic-package")) &&
      duplicateFullNamesAcross(dynamicBodies).includes("credited") &&
      !dynamicFaults.includes("dynamic require");
    const dataSpec = "data:text/javascript,register";
    const dataHost = join(specifierDir, "data-host.test.ts");
    writeFileSync(dataHost, `import ${JSON.stringify(dataSpec)};\n`);
    dataImport =
      sourceGraph([dataHost]).length === 1 &&
      unresolvedLocalRequires([dataHost]).includes(dataSpec);
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
  let packagePreload = false;
  let missingPackagePreload = false;
  let missingRelativePreload = false;
  let configPreload = false;
  let configSplitPreload = false;
  let missingConfigPreload = false;
  let quotedKeyPreload = false;
  let commentedPreload = false;
  let shortPreload = false;
  let attachedPreload = false;
  let importPreload = false;
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
    const setupPkg = join(preloadDir, "node_modules", "test-setup");
    mkdirSync(setupPkg, { recursive: true });
    writeFileSync(
      join(setupPkg, "package.json"),
      '{ "name": "test-setup", "main": "./index.ts" }\n',
    );
    writeFileSync(join(setupPkg, "index.ts"), 'import "./register";\n');
    writeFileSync(
      join(setupPkg, "register.ts"),
      'it("credited", unrelated);\n// from-package-preload\n',
    );
    writeFileSync(join(preloadDir, "bunfig.toml"), '[test]\npreload = ["test-setup"]\n');
    const packageFiles = localPreloadFiles(preloadDir, ["test"]);
    const packageBodies = sourceGraph([preloadHost, ...packageFiles]);
    const packageLocked = sourceFiles([preloadHost, ...packageFiles]);
    packagePreload =
      packageFiles.length === 1 &&
      packageBodies.some((body) => body.includes("from-package-preload")) &&
      duplicateFullNamesAcross(packageBodies).includes("credited") &&
      packageLocked.some((file) => file.split(/[/\\]/).includes("node_modules"));
    writeFileSync(join(preloadDir, "bunfig.toml"), '[test]\npreload = ["not-a-package"]\n');
    missingPackagePreload = unresolvedPreloadSpecifiers(preloadDir, ["test"]).includes(
      "not-a-package",
    );
    writeFileSync(join(preloadDir, "bunfig.toml"), '[test]\npreload = ["./missing-setup.ts"]\n');
    missingRelativePreload = unresolvedPreloadSpecifiers(preloadDir, ["test"]).includes(
      "./missing-setup.ts",
    );
    writeFileSync(join(preloadDir, "bunfig.toml"), '[test]\npreload = ["./setup.ts"]\n');
    writeFileSync(join(preloadDir, "alt.toml"), '[test]\npreload = ["test-setup"]\n');
    const configured = localPreloadFiles(preloadDir, ["test", "--config=alt.toml"]);
    const configuredBodies = sourceGraph([preloadHost, ...configured]);
    configPreload =
      configured.length === 1 &&
      configured[0]?.endsWith("index.ts") === true &&
      duplicateFullNamesAcross(configuredBodies).includes("credited");
    const splitConfigured = localPreloadFiles(preloadDir, ["test", "--config", "alt.toml"]);
    configSplitPreload = splitConfigured.length === 1 && splitConfigured[0] === configured[0];
    missingConfigPreload = unresolvedPreloadSpecifiers(preloadDir, [
      "test",
      "--config=missing.toml",
    ]).includes("missing.toml");
    writeFileSync(join(preloadDir, "bunfig.toml"), '[test]\n"preload" = ["./setup.ts"]\n');
    const quotedKey = localPreloadFiles(preloadDir, ["test"]);
    writeFileSync(join(preloadDir, "bunfig.toml"), "[test]\n'preload' = \"./setup.ts\"\n");
    const singleKey = localPreloadFiles(preloadDir, ["test"]);
    const quotedKeyHit = quotedKey.length === 1 && quotedKey[0] === setupPath;
    quotedKeyPreload = quotedKeyHit && singleKey.length === 1 && singleKey[0] === setupPath;
    writeFileSync(
      join(preloadDir, "bunfig.toml"),
      ['# preload = ["./old-setup.ts"]', 'preload = ["./setup.ts"]'].join("\n"),
    );
    const commented = localPreloadFiles(preloadDir, ["test"]);
    const commentedMissing = unresolvedPreloadSpecifiers(preloadDir, ["test"]);
    const hashed = 'note = "hash # " preload = "./setup.ts"\n';
    writeFileSync(join(preloadDir, "bunfig.toml"), hashed);
    const quotedHash = localPreloadFiles(preloadDir, ["test"]);
    writeFileSync(join(preloadDir, "bunfig.toml"), '# preload = ["./old-setup.ts"]\n');
    const commentOnly = localPreloadFiles(preloadDir, ["test"]);
    const commentOnlyMissing = unresolvedPreloadSpecifiers(preloadDir, ["test"]);
    writeFileSync(
      join(preloadDir, "bunfig.toml"),
      ['note = """', 'hash # " preload = "./setup.ts"', '"""'].join("\n"),
    );
    const tripleHash = localPreloadFiles(preloadDir, ["test"]);
    commentedPreload =
      commented.length === 1 &&
      commented[0] === setupPath &&
      !commentedMissing.includes("./old-setup.ts") &&
      quotedHash.length === 1 &&
      quotedHash[0] === setupPath &&
      commentOnly.length === 0 &&
      !commentOnlyMissing.includes("./old-setup.ts") &&
      tripleHash.length === 1 &&
      tripleHash[0] === setupPath;
    const equalsPreload = localPreloadFiles(preloadDir, ["test", "-r=./setup.ts"]);
    const splitPreload = localPreloadFiles(preloadDir, ["test", "-r", "./setup.ts"]);
    shortPreload =
      equalsPreload.some((file) => file === setupPath) &&
      splitPreload.some((file) => file === setupPath);
    attachedPreload = localPreloadFiles(preloadDir, ["test", "-r./setup.ts"]).some(
      (file) => file === setupPath,
    );
    importPreload = localPreloadFiles(preloadDir, ["test", "--import=./setup.ts"]).some(
      (file) => file === setupPath,
    );
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
  const printfEachBody = [
    'it.each([["ited"]])("cred%s", unrelated);',
    'it("credited", citedExport);',
  ].join("\n");
  const printfEachCalls = unresolvedRunnerCalls(printfEachBody);
  const printfEachLive = registeredSuites(printfEachBody, "unrelated", "cred%s");
  const printfEachDead = registeredSuites(printfEachBody, "citedExport", "credited");
  const printfDescribe = unresolvedRunnerCalls(
    'describe.each([["kept"]])("name %s", () => it("credited", unrelated));',
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
  const nodeTest = JSON.stringify("node:" + "test");
  const nodeSuiteBody = [
    `import { suite } from ${nodeTest}`,
    'suite("s", () => test("credited", unrelated))',
    'describe("s", () => test("credited", citedExport))',
  ].join("\n");
  const nodeSuiteDuplicate = duplicateFullNames(nodeSuiteBody).includes("s > credited");
  const renamedSuite = duplicateFullNames(
    [
      `import { suite as group } from ${nodeTest}`,
      'group("s", () => test("credited", unrelated))',
      'describe("s", () => test("credited", citedExport))',
    ].join("\n"),
  ).includes("s > credited");
  const requiredSuite = duplicateFullNames(
    [
      `const { suite } = require(${nodeTest})`,
      'suite("s", () => test("credited", unrelated))',
      'describe("s", () => test("credited", citedExport))',
    ].join("\n"),
  ).includes("s > credited");
  const dynamicSuite = duplicateFullNames(
    [
      `const { suite } = await import(${nodeTest})`,
      'suite("s", () => test("credited", unrelated))',
      'describe("s", () => test("credited", citedExport))',
    ].join("\n"),
  ).includes("s > credited");
  const bunSuiteDuplicate = duplicateFullNames(
    [
      'import { suite } from "bun:test"',
      'suite("s", () => test("credited", unrelated))',
      'describe("s", () => test("credited", citedExport))',
    ].join("\n"),
  ).includes("s > credited");
  const nodeDefaultDuplicate = duplicateFullNames(
    [
      `import register from ${nodeTest}`,
      'register("credited", unrelated)',
      'if (false) it("credited", citedExport)',
    ].join("\n"),
  ).includes("credited");
  const bunDefaultDuplicate = duplicateFullNames(
    [
      'import register from "bun:test"',
      'register("credited", unrelated)',
      'if (false) it("credited", citedExport)',
    ].join("\n"),
  ).includes("credited");
  const namespaceDestructure = duplicateFullNames(
    [
      'import * as runner from "bun:test"',
      "const { it: register } = runner",
      'if (false) it("credited", citedExport)',
      'register("credited", unrelated)',
    ].join("\n"),
  ).includes("credited");
  const dynamicNamespace = duplicateFullNames(
    [
      'const runner = await import("bun:test")',
      'if (false) it("credited", citedExport)',
      'runner.it("credited", unrelated)',
    ].join("\n"),
  ).includes("credited");
  const requiredNamespace = duplicateFullNames(
    [
      'const runner = require("bun:test")',
      'if (false) it("credited", citedExport)',
      'runner.it("credited", unrelated)',
    ].join("\n"),
  ).includes("credited");
  const otherDynamicNamespace = duplicateFullNames(
    [
      'const runner = await import("other")',
      'runner.it("credited", unrelated)',
      'if (false) it("credited", citedExport)',
    ].join("\n"),
  ).includes("credited");
  const chainedNamespace = duplicateFullNames(
    [
      'const runner = await import("bun:test").then((mod) => mod)',
      'runner.it("credited", unrelated)',
      'if (false) it("credited", citedExport)',
    ].join("\n"),
  ).includes("credited");
  const nodeNamespaceSuite = duplicateFullNames(
    [
      `import * as runner from ${nodeTest}`,
      'runner.suite("s", () => test("credited", unrelated))',
      'describe("s", () => test("credited", citedExport))',
    ].join("\n"),
  ).includes("s > credited");
  const bunNamespaceSuite = duplicateFullNames(
    [
      'import * as runner from "bun:test"',
      'runner.suite("s", () => test("credited", unrelated))',
      'describe("s", () => test("credited", citedExport))',
    ].join("\n"),
  ).includes("s > credited");
  const directRequire = duplicateFullNames(
    [
      'require("bun:test").it("credited", unrelated)',
      'if (false) it("credited", citedExport)',
    ].join("\n"),
  ).includes("credited");
  const directSuite = duplicateFullNames(
    [
      `require(${nodeTest}).suite("s", () => test("credited", unrelated))`,
      'describe("s", () => test("credited", citedExport))',
    ].join("\n"),
  ).includes("s > credited");
  const directExpect = duplicateFullNames(
    [
      'require("bun:test").expect("saved")',
      'if (false) it("credited", citedExport)',
    ].join("\n"),
  ).includes("credited");
  const namespaceSuite = duplicateFullNames(
    [
      `import * as runner from ${nodeTest}`,
      "const { suite: group } = runner",
      'group("s", () => test("credited", unrelated))',
      'describe("s", () => test("credited", citedExport))',
    ].join("\n"),
  ).includes("s > credited");
  const foreignImport = registeredSuites(
    ['import { it as register } from "./wrapper"', 'register("credited", unrelated)'].join("\n"),
    "unrelated",
    "credited",
  );
  const foreignNamespace = registeredSuites(
    ['import * as runner from "./wrapper"', 'runner.it("credited", unrelated)'].join("\n"),
    "unrelated",
    "credited",
  );
  const namedBody = [
    "function liveSuite() {",
    '  it("credited", unrelated);',
    "}",
    'if (false) describe("suite", () => it("credited", citedExport));',
    'describe("suite", liveSuite);',
  ].join("\n");
  const namedDuplicate = duplicateFullNames(namedBody).includes("suite > credited");
  const namedLive = registeredSuites(namedBody, "unrelated", "credited").some(
    (path) => path.length === 1 && path[0] === "suite",
  );
  const arrowBody = [
    "const liveSuite = () => {",
    '  it("credited", unrelated);',
    "};",
    'describe("suite", liveSuite);',
  ].join("\n");
  const arrowLive = registeredSuites(arrowBody, "unrelated", "credited").some(
    (path) => path.length === 1 && path[0] === "suite",
  );
  const suiteReboundBody = [
    "let suiteBody = () => {",
    '  it("credited", citedExport);',
    "};",
    "suiteBody = () => {",
    '  it("credited", unrelated);',
    "};",
    'describe("s", suiteBody);',
  ].join("\n");
  const reboundSuite = unresolvedRunnerCalls(suiteReboundBody).includes("suiteBody");
  const reboundCredit = registeredSuites(suiteReboundBody, "citedExport", "credited").every(
    (path) => path[0] !== "s",
  );
  const objectBody = [
    "const runners = { it };",
    'runners.it("credited", unrelated);',
    'if (false) it("credited", citedExport);',
  ].join("\n");
  const objectRunner = unresolvedRunnerCalls(objectBody).includes("runners");
  const renamedObject = unresolvedRunnerCalls(
    [
      "const runners = { run: it };",
      'runners.run("credited", unrelated);',
      'if (false) it("credited", citedExport);',
    ].join("\n"),
  ).includes("runners");
  const plainObject = unresolvedRunnerCalls(
    [
      'const runners = { label: "kept" };',
      'runners.label("credited", unrelated);',
      'if (false) it("credited", citedExport);',
    ].join("\n"),
  );
  const arrayRunner =
    unresolvedRunnerCalls(
      [
        "const runners = [it.only];",
        'runners[0]("credited", unrelated);',
        'if (false) it("credited", citedExport);',
      ].join("\n"),
    ).includes("runners") &&
    unresolvedRunnerCalls(
      [
        "const register = it;",
        "const runners = [register];",
        'runners?.[0]("credited", unrelated);',
        'if (false) it("credited", citedExport);',
      ].join("\n"),
    ).includes("runners");
  const plainArray = unresolvedRunnerCalls(
    [
      'const runners = ["kept"];',
      'runners[0]("credited", unrelated);',
      'if (false) it("credited", citedExport);',
    ].join("\n"),
  );
  const spreadRunner =
    unresolvedRunnerCalls(
      [
        "const runners = { ...{ run: it } };",
        'runners.run("credited", unrelated);',
        'if (false) it("credited", citedExport);',
      ].join("\n"),
    ).includes("runners") &&
    unresolvedRunnerCalls(
      [
        "const runners = { ...{ ...{ run: it } } };",
        'runners.run("credited", unrelated);',
        'if (false) it("credited", citedExport);',
      ].join("\n"),
    ).includes("runners") &&
    unresolvedRunnerCalls(
      [
        "const runners = { ...hidden };",
        'runners.run("credited", unrelated);',
        'if (false) it("credited", citedExport);',
      ].join("\n"),
    ).includes("runners");
  const spreadArray = unresolvedRunnerCalls(
    [
      "const runners = [...[it]];",
      'runners[0]("credited", unrelated);',
      'if (false) it("credited", citedExport);',
    ].join("\n"),
  ).includes("runners");
  const plainSpread = unresolvedRunnerCalls(
    [
      'const runners = { ...{ label: "kept" } };',
      'runners.label("credited", unrelated);',
      'if (false) it("credited", citedExport);',
    ].join("\n"),
  );
  const plainSpreadArray = unresolvedRunnerCalls(
    [
      'const runners = [...["kept"]];',
      'runners[0]("credited", unrelated);',
      'if (false) it("credited", citedExport);',
    ].join("\n"),
  );
  const forwardedBody = [
    "function register(run) {",
    '  run("credited", unrelated);',
    "}",
    "register(it);",
    'if (false) it("credited", citedExport);',
  ].join("\n");
  const argumentBody = [
    "function register(run) {",
    '  run("credited", unrelated);',
    "}",
    "register(true ? it : test);",
    'if (false) it("credited", citedExport);',
  ].join("\n");
  const argumentCalls = unresolvedRunnerCalls(argumentBody);
  const groupedArgument = unresolvedRunnerCalls("register((true ? it.only : test));");
  const orArgument = unresolvedRunnerCalls("register(it || test);");
  const boundTernary = unresolvedRunnerCalls("const register = (true ? it : test);");
  const callbackBindBody = [
    "register(() => {",
    "  const local = it;",
    '  local("credited", citedExport);',
    "});",
  ].join("\n");
  const forwardedRunner =
    unresolvedRunnerCalls(forwardedBody).includes("it") &&
    argumentCalls.includes("it") &&
    argumentCalls.includes("test") &&
    groupedArgument.includes("it") &&
    groupedArgument.includes("test") &&
    orArgument.includes("it") &&
    orArgument.includes("test") &&
    boundTernary.length === 0 &&
    unresolvedRunnerCalls(callbackBindBody).length === 0 &&
    registeredSuites(callbackBindBody, "citedExport", "credited").length === 1;
  const propertyRunner =
    unresolvedRunnerCalls(
      [
        "const carrier = globalThis;",
        "carrier.run = it;",
        'carrier.run("credited", unrelated);',
        'if (false) it("credited", citedExport);',
      ].join("\n"),
    ).includes("it") &&
    unresolvedRunnerCalls(
      [
        "const carrier = globalThis;",
        "carrier.run = it.only;",
        'carrier.run("credited", unrelated);',
        'if (false) it("credited", citedExport);',
      ].join("\n"),
    ).includes("it") &&
    unresolvedRunnerCalls(
      [
        "const carrier = globalThis;",
        'carrier["run"] = it;',
        'if (false) it("credited", citedExport);',
      ].join("\n"),
    ).includes("it");
  const propertyContainer =
    unresolvedRunnerCalls(
      [
        "const carrier = globalThis;",
        "carrier.run = { it };",
        'if (false) it("credited", citedExport);',
      ].join("\n"),
    ).includes("carrier") &&
    unresolvedRunnerCalls(
      [
        "const carrier = globalThis;",
        "carrier.run = [it];",
        'if (false) it("credited", citedExport);',
      ].join("\n"),
    ).includes("carrier");
  const plainProperty = unresolvedRunnerCalls(
    [
      "const carrier = globalThis;",
      "carrier.run = kept;",
      'carrier.run("credited", unrelated);',
      'if (false) it("credited", citedExport);',
    ].join("\n"),
  );
  const plainAssignBody = [
    "let register = kept;",
    "register = it;",
    'register("credited", citedExport);',
  ].join("\n");
  const plainAssign =
    unresolvedRunnerCalls(plainAssignBody).length === 0 &&
    registeredSuites(plainAssignBody, "citedExport", "credited").length === 1;
  const classField =
    unresolvedRunnerCalls(
      [
        "class Carrier {",
        "  static run = it;",
        "}",
        'Carrier.run("credited", unrelated);',
        'if (false) it("credited", citedExport);',
      ].join("\n"),
    ).includes("it") &&
    unresolvedRunnerCalls(["class Carrier {", "  run = it;", "}"].join("\n")).includes("it") &&
    unresolvedRunnerCalls(["class Carrier {", "  #run = it;", "}"].join("\n")).includes("it") &&
    unresolvedRunnerCalls("class Carrier {\n  static run = it.only;\n}").includes("it") &&
    unresolvedRunnerCalls('class Carrier {\n  static ["run"] = it;\n}').includes("it");
  const classContainer = unresolvedRunnerCalls(
    "class Carrier {\n  static run = { it };\n}",
  ).includes("run");
  const classMethodBody = [
    "class Carrier {",
    "  method() {",
    "    const register = it;",
    '    register("credited", citedExport);',
    "  }",
    "}",
  ].join("\n");
  const classMethod =
    unresolvedRunnerCalls(classMethodBody).length === 0 &&
    registeredSuites(classMethodBody, "citedExport", "credited").length === 1;
  const localRunner =
    unresolvedRunnerCalls(
      ['import { run } from "./host.ts";', 'run("credited", unrelated);'].join("\n"),
    ).includes("run") &&
    unresolvedRunnerCalls(
      ['import run from "../host.ts";', 'run("credited", unrelated);'].join("\n"),
    ).includes("run") &&
    unresolvedRunnerCalls(
      ['import { run as register } from "./host.ts";', 'register("credited", unrelated);'].join(
        "\n",
      ),
    ).includes("register");
  const packageCall = unresolvedRunnerCalls(
    ['import { readFile } from "fs";', 'readFile("a", "utf8");'].join("\n"),
  );
  const localUnused = unresolvedRunnerCalls(
    ['import { helper } from "./helper.ts";', "helper(1, 2);"].join("\n"),
  );
  const typeLocal = unresolvedRunnerCalls(
    ['import { type run } from "./host.ts";', 'run("credited", unrelated);'].join("\n"),
  );
  const returnedRunner =
    unresolvedRunnerCalls(
      [
        "const get = () => it;",
        'get()("credited", unrelated);',
        'if (false) it("credited", citedExport);',
      ].join("\n"),
    ).includes("it") &&
    unresolvedRunnerCalls(["const get = () =>", "  it;"].join("\n")).includes("it") &&
    unresolvedRunnerCalls(
      [
        "function get() {",
        "  return it;",
        "}",
        'get()("credited", unrelated);',
      ].join("\n"),
    ).includes("it") &&
    unresolvedRunnerCalls("function get() {\n  return (it);\n}").includes("it") &&
    unresolvedRunnerCalls("const get = () => it.only;").includes("it");
  const returnedContainer = unresolvedRunnerCalls(
    "const get = () => ({ it });",
  ).includes("return");
  const calledArrow = 'const get = () => it("credited", citedExport);';
  const returnedCall =
    unresolvedRunnerCalls(calledArrow).length === 0 &&
    registeredSuites(calledArrow, "citedExport", "credited").length === 1;
  const returnedAsi = unresolvedRunnerCalls(
    ["function get() {", "  return", "  it;", "}"].join("\n"),
  );
  const sameFileExport = registeredSuites(
    ["export const run = it;", 'run("credited", citedExport);'].join("\n"),
    "citedExport",
    "credited",
  );
  const laterBody = [
    'describe("suite", liveSuite);',
    "function liveSuite() {",
    '  it("credited", unrelated);',
    "}",
  ].join("\n");
  const laterLive = registeredSuites(laterBody, "unrelated", "credited").some(
    (path) => path.length === 1 && path[0] === "suite",
  );
  const afterBody = [
    "function liveSuite() {",
    '  it("credited", unrelated);',
    "}",
    'describe("suite", liveSuite);',
    'it("after", citedExport);',
  ].join("\n");
  const afterSuites = registeredSuites(afterBody, "citedExport", "after");
  const pendingHeld = afterSuites.length === 1 && afterSuites[0]?.length === 0;
  const missingSuite = unresolvedRunnerCalls('describe("suite", missingSuite);');
  const qualifiedBody = [
    'describe("s", helper.suiteBody);',
    'it("credited", unrelated);',
  ].join("\n");
  const qualifiedDescribe = unresolvedRunnerCalls(qualifiedBody).includes("describe");
  const qualifiedFlat = registeredSuites(qualifiedBody, "unrelated", "credited").some(
    (path) => path.length === 0,
  );
  const functionDescribe =
    registeredSuites(
      'describe("s", function () { it("credited", unrelated); });',
      "unrelated",
      "credited",
    ).some((path) => path.length === 1 && path[0] === "s") &&
    registeredSuites(
      'describe("s", async () => { it("credited", unrelated); });',
      "unrelated",
      "credited",
    ).some((path) => path.length === 1 && path[0] === "s");
  const separatorBody = [
    'if (false) describe("outer", () => describe("inner", () => it("credited", citedExport)));',
    'describe("inner > outer", () => it("credited", unrelated));',
  ].join("\n");
  const separatorTitles = ambiguousSuiteSeparators([separatorBody]);
  const separatorClosed =
    separatorTitles.includes("inner > outer") &&
    ambiguousSuiteSeparators(['it("a > b", unrelated);']).includes("a > b");
  const aliasRoot = mkdtempSync(join(tmpdir(), "idlekit-evidence-alias-"));
  const aliasHelper = join(aliasRoot, "helper.ts");
  const aliasHost = join(aliasRoot, "host.test.ts");
  const aliasMissing = join(aliasRoot, "missing.test.ts");
  writeFileSync(
    join(aliasRoot, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        paths: { "@helper": ["./helper.ts"], "@missing/*": ["./gone/*"] },
      },
    }),
  );
  writeFileSync(
    aliasHelper,
    [
      "export function register(it) {",
      '  it("credited", unrelated);',
      "}",
      "// from-aliased-helper",
    ].join("\n"),
  );
  writeFileSync(
    aliasHost,
    [
      'import { register } from "@helper";',
      'if (false) it("credited", citedExport);',
      "register(it);",
    ].join("\n"),
  );
  writeFileSync(aliasMissing, 'import { missing } from "@missing/file";\n');
  const workspaceRoot = mkdtempSync(join(tmpdir(), "idlekit-evidence-workspace-"));
  const workspacePkg = join(workspaceRoot, "pkgs", "helper");
  mkdirSync(workspacePkg, { recursive: true });
  writeFileSync(join(workspaceRoot, "package.json"), JSON.stringify({ workspaces: ["pkgs/*"] }));
  writeFileSync(
    join(workspacePkg, "package.json"),
    JSON.stringify({
      name: "@helper/pkg",
      exports: { ".": { bun: "./register.ts" } },
    }),
  );
  writeFileSync(
    join(workspacePkg, "register.ts"),
    [
      "export function register(it) {",
      '  it("credited", unrelated);',
      "}",
      "// from-workspace-helper",
    ].join("\n"),
  );
  const workspaceHost = join(workspaceRoot, "host.test.ts");
  const workspaceTypeHost = join(workspaceRoot, "type-host.test.ts");
  writeFileSync(
    workspaceHost,
    [
      'import { register } from "@helper/pkg";',
      'if (false) it("credited", citedExport);',
      "register();",
    ].join("\n"),
  );
  writeFileSync(workspaceTypeHost, 'import type { register } from "@helper/pkg";\n');
  const runtimePkg = join(workspaceRoot, "pkgs", "runtime");
  mkdirSync(runtimePkg);
  writeFileSync(
    join(runtimePkg, "package.json"),
    JSON.stringify({
      name: "@helper/runtime",
      types: "./register.d.ts",
      module: "./register.ts",
    }),
  );
  writeFileSync(
    join(runtimePkg, "register.d.ts"),
    "export function register(): void;\n// from-runtime-declaration\n",
  );
  writeFileSync(
    join(runtimePkg, "register.ts"),
    [
      "export function register() {",
      '  it("credited", unrelated);',
      "}",
      "// from-runtime-entry",
    ].join("\n"),
  );
  const runtimeHost = join(workspaceRoot, "runtime-host.test.ts");
  writeFileSync(
    runtimeHost,
    [
      'import { register } from "@helper/runtime";',
      'if (false) it("credited", citedExport);',
      "register();",
    ].join("\n"),
  );
  const declPkg = join(workspaceRoot, "pkgs", "decls");
  mkdirSync(declPkg);
  writeFileSync(
    join(declPkg, "package.json"),
    JSON.stringify({ name: "@helper/decls", types: "./only.d.ts" }),
  );
  writeFileSync(join(declPkg, "only.d.ts"), "export function register(): void;\n");
  const declHost = join(workspaceRoot, "decl-host.test.ts");
  writeFileSync(declHost, 'import { register } from "@helper/decls";\n');
  const orderedPkg = join(workspaceRoot, "pkgs", "ordered");
  mkdirSync(orderedPkg);
  writeFileSync(
    join(orderedPkg, "package.json"),
    JSON.stringify({
      name: "@helper/ordered",
      exports: {
        ".": { import: "./evil.ts", bun: "./safe.ts" },
        "./bun-first": { bun: "./safe.ts", import: "./evil.ts" },
        "./require-first": { require: "./evil.ts", import: "./safe.ts" },
        "./nested": {
          bun: { import: "./evil.ts", default: "./def.ts" },
          default: "./safe.ts",
        },
        "./types-first": { types: "./types.ts", default: "./safe.ts" },
        "./blocked": { bun: { browser: "./evil.ts" }, default: "./safe.ts" },
        "./null-bun": { bun: null, default: "./safe.ts" },
        "./listed": [{ browser: "./evil.ts" }, "./safe.ts"],
        "./array-null": [null, "./safe.ts"],
        "./node-first": { node: "./evil.ts", import: "./safe.ts" },
        "./browser": { browser: "./evil.ts", default: "./safe.ts" },
      },
    }),
  );
  writeFileSync(join(orderedPkg, "evil.ts"), "// from-ordered-evil\n");
  writeFileSync(join(orderedPkg, "safe.ts"), "// from-ordered-safe\n");
  writeFileSync(join(orderedPkg, "def.ts"), "// from-ordered-default\n");
  writeFileSync(join(orderedPkg, "types.ts"), "// from-ordered-types\n");
  const orderedCases: Array<[string, string]> = [
    ["ordered-import.test.ts", 'import "@helper/ordered";\n'],
    ["ordered-bun.test.ts", 'import "@helper/ordered/bun-first";\n'],
    ["ordered-require.test.ts", 'require("@helper/ordered/require-first");\n'],
    ["ordered-require-import.test.ts", 'import "@helper/ordered/require-first";\n'],
    ["ordered-nested.test.ts", 'import "@helper/ordered/nested";\n'],
    ["ordered-nested-require.test.ts", 'require("@helper/ordered/nested");\n'],
    ["ordered-types.test.ts", 'import "@helper/ordered/types-first";\n'],
    ["ordered-blocked.test.ts", 'import "@helper/ordered/blocked";\n'],
    ["ordered-null.test.ts", 'import "@helper/ordered/null-bun";\n'],
    ["ordered-listed.test.ts", 'import "@helper/ordered/listed";\n'],
    ["ordered-array-null.test.ts", 'import "@helper/ordered/array-null";\n'],
    ["ordered-node.test.ts", 'import "@helper/ordered/node-first";\n'],
    ["ordered-browser.test.ts", 'import "@helper/ordered/browser";\n'],
  ];
  const orderedHosts: Record<string, string> = {};
  for (const [name, source] of orderedCases) {
    const file = join(workspaceRoot, name);
    orderedHosts[name] = file;
    writeFileSync(file, source);
  }
  let aliasedDuplicate = false;
  let aliasedResolved = false;
  let aliasedMissing = false;
  let workspaceDuplicate = false;
  let workspaceResolved = false;
  let workspaceTypeSkipped = false;
  let runtimeEntry = false;
  let declarationOnly = false;
  let orderedImport = false;
  let orderedBun = false;
  let orderedRequire = false;
  let orderedRequireImport = false;
  let orderedNested = false;
  let orderedNestedRequire = false;
  let orderedTypes = false;
  let orderedBlocked = false;
  let orderedNull = false;
  let orderedListed = false;
  let orderedArrayNull = false;
  let orderedNode = false;
  let orderedBrowser = false;
  try {
    const aliasBodies = sourceGraph([aliasHost]);
    aliasedDuplicate = duplicateFullNamesAcross(aliasBodies).includes("credited");
    aliasedResolved = aliasBodies.some((body) => body.includes("from-aliased-helper"));
    aliasedMissing = unresolvedLocalRequires([aliasMissing]).includes("@missing/file");
    const workspaceBodies = sourceGraph([workspaceHost]);
    workspaceDuplicate = duplicateFullNamesAcross(workspaceBodies).includes("credited");
    workspaceResolved = workspaceBodies.some((body) => body.includes("from-workspace-helper"));
    const typeBodies = sourceGraph([workspaceTypeHost]);
    workspaceTypeSkipped =
      typeBodies.length === 1 && !typeBodies.some((body) => body.includes("from-workspace-helper"));
    const runtimeBodies = sourceGraph([runtimeHost]);
    runtimeEntry =
      runtimeBodies.some((body) => body.includes("from-runtime-entry")) &&
      !runtimeBodies.some((body) => body.includes("from-runtime-declaration")) &&
      duplicateFullNamesAcross(runtimeBodies).includes("credited");
    declarationOnly = unresolvedLocalRequires([declHost]).includes("@helper/decls");
    const orderedMarker = (name: string, text: string): boolean => {
      const file = orderedHosts[name];
      if (!file) return false;
      return sourceGraph([file]).some((body) => body.includes(text));
    };
    const orderedMissing = (name: string, spec: string): boolean => {
      const file = orderedHosts[name];
      if (!file) return false;
      const bodies = sourceGraph([file]);
      const leaked = bodies.some(
        (body) =>
          body.includes("from-ordered-evil") ||
          body.includes("from-ordered-safe") ||
          body.includes("from-ordered-default"),
      );
      return unresolvedLocalRequires([file]).includes(spec) && !leaked;
    };
    orderedImport =
      orderedMarker("ordered-import.test.ts", "from-ordered-evil") &&
      !orderedMarker("ordered-import.test.ts", "from-ordered-safe");
    orderedBun =
      orderedMarker("ordered-bun.test.ts", "from-ordered-safe") &&
      !orderedMarker("ordered-bun.test.ts", "from-ordered-evil");
    orderedRequire =
      orderedMarker("ordered-require.test.ts", "from-ordered-evil") &&
      !orderedMarker("ordered-require.test.ts", "from-ordered-safe");
    orderedRequireImport =
      orderedMarker("ordered-require-import.test.ts", "from-ordered-safe") &&
      !orderedMarker("ordered-require-import.test.ts", "from-ordered-evil");
    orderedNested =
      orderedMarker("ordered-nested.test.ts", "from-ordered-evil") &&
      !orderedMarker("ordered-nested.test.ts", "from-ordered-default") &&
      !orderedMarker("ordered-nested.test.ts", "from-ordered-safe");
    orderedNestedRequire =
      orderedMarker("ordered-nested-require.test.ts", "from-ordered-default") &&
      !orderedMarker("ordered-nested-require.test.ts", "from-ordered-evil") &&
      !orderedMarker("ordered-nested-require.test.ts", "from-ordered-safe");
    orderedTypes =
      orderedMarker("ordered-types.test.ts", "from-ordered-safe") &&
      !orderedMarker("ordered-types.test.ts", "from-ordered-types");
    orderedBlocked =
      orderedMarker("ordered-blocked.test.ts", "from-ordered-safe") &&
      !orderedMarker("ordered-blocked.test.ts", "from-ordered-evil");
    orderedNull = orderedMissing("ordered-null.test.ts", "@helper/ordered/null-bun");
    orderedListed =
      orderedMarker("ordered-listed.test.ts", "from-ordered-safe") &&
      !orderedMarker("ordered-listed.test.ts", "from-ordered-evil");
    orderedArrayNull = orderedMissing("ordered-array-null.test.ts", "@helper/ordered/array-null");
    orderedNode =
      orderedMarker("ordered-node.test.ts", "from-ordered-evil") &&
      !orderedMarker("ordered-node.test.ts", "from-ordered-safe");
    orderedBrowser =
      orderedMarker("ordered-browser.test.ts", "from-ordered-safe") &&
      !orderedMarker("ordered-browser.test.ts", "from-ordered-evil");
  } finally {
    rmSync(aliasRoot, { recursive: true, force: true });
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
  const indirectCalls = unresolvedRunnerCalls(
    [
      'if (false) it("credited", citedExport);',
      'Reflect.apply(it, undefined, ["credited", unrelated]);',
    ].join("\n"),
  );
  const boundCalls = unresolvedRunnerCalls(
    ["const register = it;", 'register("credited", unrelated);'].join("\n"),
  );
  const groupedBound = unresolvedRunnerCalls(
    ["const register = (it);", 'register("credited", unrelated);'].join("\n"),
  );
  const runnerShadowBody = [
    "const it = (title, _callback, runner) => runner(title, unrelated);",
    'it("credited", citedExport, realIt);',
  ].join("\n");
  const shadowedCalls = unresolvedRunnerCalls(runnerShadowBody);
  const shadowedCredit = registeredSuites(runnerShadowBody, "citedExport", "credited");
  const parenBody = [
    '(it)("credited", unrelated);',
    '(it.failing)("credited", unrelated);',
  ].join("\n");
  const parenCalls = unresolvedRunnerCalls(parenBody);
  const parenCredit = registeredSuites('(it)("credited", citedExport);', "citedExport", "credited");
  const optionalBody = [
    'it?.("credited", unrelated);',
    'it?.failing("credited", unrelated);',
    'it.failing?.("credited", unrelated);',
    '(it)?.("credited", unrelated);',
    'it?.skipIf(ready)("credited", unrelated);',
  ].join("\n");
  const optionalCalls = unresolvedRunnerCalls(optionalBody);
  const optionalCredit = registeredSuites(
    'it?.("credited", citedExport);',
    "citedExport",
    "credited",
  );
  const optionalNamespace = unresolvedRunnerCalls(
    'import * as runner from "bun:test"\nrunner?.it("credited", unrelated)',
  );
  const optionalExpect = unresolvedRunnerCalls(
    'import * as runner from "bun:test"\nrunner?.expect("saved", "msg")',
  );
  const bracketBody = [
    'import * as runner from "bun:test"',
    'if (false) it("credited", citedExport)',
    'runner["it"]("credited", unrelated)',
  ].join("\n");
  const bracketDuplicate = duplicateFullNames(bracketBody).includes("credited");
  const bracketSingle = registeredSuites(
    'import * as runner from "bun:test"\nrunner[\'it\']("credited", unrelated)',
    "unrelated",
    "credited",
  );
  const bracketTemplate = registeredSuites(
    'import * as runner from "bun:test"\nrunner[`it`]("credited", unrelated)',
    "unrelated",
    "credited",
  );
  const bracketExpect = unresolvedRunnerCalls(
    'import * as runner from "bun:test"\nrunner["expect"]("saved", "msg")',
  );
  const bracketDynamic = unresolvedRunnerCalls(
    'import * as runner from "bun:test"\nrunner[name]("credited", unrelated)',
  );
  const bracketOptional = unresolvedRunnerCalls(
    'import * as runner from "bun:test"\nrunner?.["it"]("credited", unrelated)',
  );
  const reassigned = registeredSuites(
    ["citedExport = unrelated;", 'it("credited", citedExport);'].join("\n"),
    "citedExport",
    "credited",
  );
  const assignedAfter = registeredSuites(
    ['it("credited", citedExport);', "citedExport = unrelated;"].join("\n"),
    "citedExport",
    "credited",
  );
  const shadowedAssign = registeredSuites(
    [
      "{",
      "  let citedExport = other;",
      "  citedExport = unrelated;",
      "}",
      'it("credited", citedExport);',
    ].join("\n"),
    "citedExport",
    "credited",
  );
  const dynamicEval = unresolvedRunnerCalls(
    ['if (false) it("credited", citedExport)', 'eval("it(\\"credited\\", unrelated)")'].join("\n"),
  );
  const dynamicFunction = unresolvedRunnerCalls('Function("return it(\\"credited\\", unrelated)")');
  const dynamicNew = unresolvedRunnerCalls('new Function("it", "it(\\"credited\\", unrelated)")');
  const dynamicMember = unresolvedRunnerCalls('globalThis.eval("it(\\"credited\\", unrelated)")');
  const dynamicGrouped = unresolvedRunnerCalls('(eval)("it(\\"credited\\", unrelated)")');
  const dynamicPlain = unresolvedRunnerCalls('const label = "eval";\nfunction eval() {}\n');
  const creditGuards =
    aliasedDuplicate &&
    aliasedResolved &&
    aliasedMissing &&
    workspaceDuplicate &&
    workspaceResolved &&
    workspaceTypeSkipped &&
    runtimeEntry &&
    declarationOnly &&
    indirectCalls.includes("it") &&
    boundCalls.length === 0 &&
    groupedBound.length === 0 &&
    shadowedCalls.includes("it") &&
    shadowedCredit.length === 0 &&
    parenCalls.includes("it") &&
    parenCredit.length === 0 &&
    optionalCalls.includes("it") &&
    optionalCredit.length === 0 &&
    optionalNamespace.includes("runner") &&
    optionalExpect.length === 0 &&
    bracketDuplicate &&
    bracketSingle.length === 1 &&
    bracketTemplate.length === 1 &&
    bracketExpect.length === 0 &&
    bracketDynamic.includes("runner") &&
    bracketOptional.includes("runner") &&
    reassigned.length === 0 &&
    assignedAfter.length === 1 &&
    shadowedAssign.length === 1 &&
    dynamicEval.includes("eval") &&
    dynamicFunction.includes("Function") &&
    dynamicNew.includes("Function") &&
    dynamicMember.includes("eval") &&
    dynamicGrouped.includes("eval") &&
    dynamicPlain.length === 0 &&
    orderedImport &&
    orderedBun &&
    orderedRequire &&
    orderedRequireImport &&
    orderedNested &&
    orderedNestedRequire &&
    orderedTypes &&
    orderedBlocked &&
    orderedNull &&
    orderedListed &&
    orderedArrayNull &&
    orderedNode &&
    orderedBrowser;
  const loaderPlugin =
    loaderPluginRegistration('Bun.plugin({ name: "rewriter", setup() {} });') &&
    loaderPluginRegistration("Bun . plugin ({});") &&
    loaderPluginRegistration("Bun?.plugin({});") &&
    loaderPluginRegistration("const saved = Bun.plugin;\n") &&
    loaderPluginRegistration("const install = Bun.plugin;\ninstall({});\n") &&
    loaderPluginRegistration("const { plugin } = Bun;\n") &&
    loaderPluginRegistration("const { plugin: install } = Bun;\n") &&
    loaderPluginRegistration("const ns = Bun;\nns.plugin({});\n") &&
    loaderPluginRegistration('Bun["plugin"];\n') &&
    loaderPluginRegistration("Bun['plugin'];\n") &&
    loaderPluginRegistration("Bun[`plugin`];\n");
  const loaderIgnored =
    !loaderPluginRegistration("// Bun.plugin({})\nconst kept = 1;\n") &&
    !loaderPluginRegistration("/** Bun.plugin( */\nconst kept = 1;\n") &&
    !loaderPluginRegistration('const text = "Bun.plugin(";\n') &&
    !loaderPluginRegistration("myBun.plugin({});\n") &&
    !loaderPluginRegistration("runtime.plugin({});\n") &&
    !loaderPluginRegistration("const { other } = Bun;\n") &&
    !loaderPluginRegistration("const { install: plugin } = Bun;\n") &&
    !loaderPluginRegistration("const ns = Bun;\nns.file();\n") &&
    !loaderPluginRegistration("obj.Bun.plugin({});\n");
  const mockModule = mockModuleRegistration(
    'import { mock } from "bun:test"\nmock.module("./helper.ts", () => ({}));\n',
  );
  const mockSpaced = mockModuleRegistration("mock . module('./helper.ts', () => ({}));\n");
  const mockOptional = mockModuleRegistration("runner.mock?.module('./helper.ts', () => ({}));\n");
  const mockIgnored =
    !mockModuleRegistration('// mock.module("./helper.ts", () => {})\nconst kept = 1;\n') &&
    !mockModuleRegistration('const text = "mock.module(";\n') &&
    !mockModuleRegistration('myMock.module("./helper.ts", () => ({}));\n');
  const inventoryRoot = join(root, "packages/core");
  const inventoryFile = join(inventoryRoot, "src/scenario/concreteValidator.test.ts");
  const inventoryPreloads = localPreloadFiles(inventoryRoot, [
    "test",
    "src/scenario/concreteValidator.test.ts",
  ]);
  const inventorySources = sourceGraph([inventoryFile, ...inventoryPreloads]);
  const inventoryLoader = inventorySources.some(
    (source) => loaderPluginRegistration(source) || mockModuleRegistration(source),
  );
  const inventoryRunners = inventorySources.some(
    (source) => unresolvedRunnerCalls(source).length > 0,
  );
  const inventoryFaults = unresolvedLocalRequires([inventoryFile, ...inventoryPreloads]).length;
  const lockDir = mkdtempSync(join(tmpdir(), "idlekit-evidence-lock-"));
  const lockedHelper = join(lockDir, "helper.ts");
  const attackFile = join(lockDir, "attack.test.ts");
  let sourceLock = false;
  try {
    writeFileSync(lockedHelper, "export const marker = 1;\n");
    writeFileSync(
      attackFile,
      [
        'import { chmodSync, writeFileSync } from "fs";',
        'import { test } from "bun:test";',
        `const helper = ${JSON.stringify(lockedHelper)};`,
        "chmodSync(helper, 0o644);",
        'writeFileSync(helper, "export const marker = 2;\\n");',
        'await import("./helper.ts");',
        'test("credited", () => {});',
      ].join("\n"),
    );
    const lock = installSourceLock(lockDir, [lockedHelper]);
    const modes = sealSources([lockedHelper]);
    try {
      const proc = Bun.spawnSync(
        sealedCommand(
          lockDir,
          [process.execPath, "test", "--preload", lock.preload, "attack.test.ts"],
          [lockedHelper],
        ),
        {
          cwd: lockDir,
          stdout: "pipe",
          stderr: "pipe",
          env: { ...plainTestEnv(), IDLEKIT_EVIDENCE_LOCK: lock.env },
        },
      );
      const output = `${proc.stdout.toString()}\n${proc.stderr.toString()}`;
      const intact = readFileSync(lockedHelper, "utf8").includes("marker = 1");
      const blocked =
        output.includes("EPERM") || output.includes("EROFS") || output.includes("read-only");
      sourceLock = (proc.exitCode ?? 1) !== 0 && intact && blocked;
    } finally {
      unsealSources(modes);
    }
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
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
    printfEachCalls.includes("it") &&
    printfEachLive.length === 0 &&
    printfEachDead.length === 1 &&
    printfDescribe.includes("describe") &&
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
    wrappedUnresolved.length === 2 &&
    wrappedUnresolved.includes("it") &&
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
    nodeSuiteDuplicate &&
    renamedSuite &&
    requiredSuite &&
    dynamicSuite &&
    !bunSuiteDuplicate &&
    nodeDefaultDuplicate &&
    !bunDefaultDuplicate &&
    namespaceDestructure &&
    namespaceSuite &&
    nodeNamespaceSuite &&
    !bunNamespaceSuite &&
    directRequire &&
    directSuite &&
    !directExpect &&
    dynamicNamespace &&
    requiredNamespace &&
    !otherDynamicNamespace &&
    !chainedNamespace &&
    computedNames.length === 0 &&
    computedDead.length === 1 &&
    computedCalls.length === 1 &&
    computedCalls[0] === "it" &&
    interpolatedCalls.length === 1 &&
    specifierDuplicate &&
    specifierResolved &&
    javascriptWins &&
    mjsResolved &&
    requireDuplicate &&
    requireResolved &&
    moduleRequire &&
    metaRequire &&
    moduleSpacedRequire &&
    memberRequireIgnored &&
    moduleDynamicRequire &&
    templateRequire &&
    unresolvedRequire &&
    dynamicRequire &&
    shadowedRequire &&
    importEquals &&
    createdRequire &&
    packageRequire &&
    commentRequire &&
    dynamicImport &&
    unresolvedImport &&
    packageImport &&
    resolvedImport &&
    directoryEntry &&
    queryImport &&
    fragmentImport &&
    directoryQuery &&
    installedPackage &&
    nestedPackage &&
    quietPackage &&
    libraryPackage &&
    missingInstalled &&
    dynamicPackage &&
    dataImport &&
    foreignImport.length === 0 &&
    foreignNamespace.length === 0 &&
    helperComputed &&
    namedDuplicate &&
    namedLive &&
    arrowLive &&
    reboundSuite &&
    reboundCredit &&
    objectRunner &&
    renamedObject &&
    plainObject.length === 0 &&
    arrayRunner &&
    plainArray.length === 0 &&
    spreadRunner &&
    spreadArray &&
    plainSpread.length === 0 &&
    plainSpreadArray.length === 0 &&
    forwardedRunner &&
    propertyRunner &&
    propertyContainer &&
    plainProperty.length === 0 &&
    plainAssign &&
    classField &&
    classContainer &&
    classMethod &&
    localRunner &&
    packageCall.length === 0 &&
    localUnused.length === 0 &&
    typeLocal.length === 0 &&
    sameFileExport.length === 1 &&
    returnedRunner &&
    returnedContainer &&
    returnedCall &&
    returnedAsi.length === 0 &&
    commentImport &&
    relativeTypeSkipped &&
    sourceLock &&
    laterLive &&
    pendingHeld &&
    missingSuite.length === 1 &&
    missingSuite[0] === "missingSuite" &&
    qualifiedDescribe &&
    qualifiedFlat &&
    functionDescribe &&
    loaderPlugin &&
    loaderIgnored &&
    !inventoryLoader &&
    !inventoryRunners &&
    inventoryFaults === 0 &&
    mockModule &&
    mockSpaced &&
    mockOptional &&
    mockIgnored &&
    quotedKeyPreload &&
    commentedPreload &&
    shortPreload &&
    attachedPreload &&
    importPreload &&
    separatorClosed &&
    scalarPreload &&
    quotedPreload &&
    arrayPreload &&
    packagePreload &&
    missingPackagePreload &&
    missingRelativePreload &&
    configPreload &&
    configSplitPreload &&
    missingConfigPreload;
  record(
    "duplicate-title",
    "zero",
    duplicateOk ? 0 : 1,
    duplicateOk,
    JSON.stringify({
      duplicateNames,
      duplicateStillRegistered,
      commentIgnored,
      moduleRequire,
      metaRequire,
      moduleSpacedRequire,
      memberRequireIgnored,
      moduleDynamicRequire,
      printfEachCalls,
      printfEachLive,
      printfEachDead,
      printfDescribe,
      nodeSuiteDuplicate,
      renamedSuite,
      requiredSuite,
      dynamicSuite,
      bunSuiteDuplicate,
      nodeDefaultDuplicate,
      bunDefaultDuplicate,
      namespaceDestructure,
      namespaceSuite,
      nodeNamespaceSuite,
      bunNamespaceSuite,
      directRequire,
      directSuite,
      directExpect,
      dynamicNamespace,
      requiredNamespace,
      otherDynamicNamespace,
      chainedNamespace,
      directoryEntry,
      queryImport,
      fragmentImport,
      directoryQuery,
      installedPackage,
      nestedPackage,
      quietPackage,
      libraryPackage,
      missingInstalled,
      dynamicPackage,
      dataImport,
      packagePreload,
      missingPackagePreload,
      missingRelativePreload,
      configPreload,
      configSplitPreload,
      missingConfigPreload,
      qualifiedDescribe,
      qualifiedFlat,
      functionDescribe,
      loaderPlugin,
      loaderIgnored,
      inventoryLoader,
      inventoryRunners,
      inventoryFaults,
      reboundSuite,
      reboundCredit,
      objectRunner,
      renamedObject,
      plainObject,
      arrayRunner,
      plainArray,
      spreadRunner,
      spreadArray,
      plainSpread,
      plainSpreadArray,
      forwardedRunner,
      propertyRunner,
      propertyContainer,
      plainProperty,
      plainAssign,
      classField,
      classContainer,
      classMethod,
      localRunner,
      packageCall,
      localUnused,
      typeLocal,
      sameFileExport,
      returnedRunner,
      returnedContainer,
      returnedCall,
      returnedAsi,
      shadowedRequire,
      importEquals,
      createdRequire,
      commentImport,
      relativeTypeSkipped,
      sourceLock,
      mockModule,
      mockSpaced,
      mockOptional,
      mockIgnored,
      quotedKeyPreload,
      commentedPreload,
      shortPreload,
      attachedPreload,
      importPreload,
      missingSuite,
    }),
  );
  record(
    "alias-credit",
    "zero",
    creditGuards ? 0 : 1,
    creditGuards,
    JSON.stringify({
      aliasedDuplicate,
      aliasedResolved,
      aliasedMissing,
      workspaceDuplicate,
      workspaceResolved,
      workspaceTypeSkipped,
      runtimeEntry,
      declarationOnly,
      indirectCalls,
      boundCalls,
      groupedBound,
      shadowedCalls,
      shadowedCredit,
      parenCalls,
      parenCredit,
      optionalCalls,
      optionalCredit,
      optionalNamespace,
      optionalExpect,
      bracketDuplicate,
      bracketSingle,
      bracketTemplate,
      bracketExpect,
      bracketDynamic,
      bracketOptional,
      reassigned,
      assignedAfter,
      shadowedAssign,
      dynamicEval,
      dynamicFunction,
      dynamicNew,
      dynamicMember,
      dynamicGrouped,
      dynamicPlain,
      orderedImport,
      orderedBun,
      orderedRequire,
      orderedRequireImport,
      orderedNested,
      orderedNestedRequire,
      orderedTypes,
      orderedBlocked,
      orderedNull,
      orderedListed,
      orderedArrayNull,
      orderedNode,
      orderedBrowser,
    }),
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
  const moduleHost = [
    "/** @evidence packages/web/src/quota.mts#quotaHost Calls the host. */",
    "export function owned(): void {}",
  ].join("\n");
  const moduleCitation = unregisteredImplementationHost(
    moduleHost,
    "docs/spec.md",
    "quota",
    ["owned"],
    {
      file: "packages/web/src/quota.test.ts",
      production: ["packages/web/src/quota.mts"],
    },
  );
  const scriptHost = [
    "/** @evidence packages/web/src/quota.cts#quotaHost Calls the host. */",
    "export function owned(): void {}",
  ].join("\n");
  const scriptCitation = unregisteredImplementationHost(
    scriptHost,
    "docs/spec.md",
    "quota",
    ["owned"],
    {
      file: "packages/web/src/quota.test.ts",
      production: ["packages/web/src/quota.cts"],
    },
  );
  const siblingOk =
    sibling === undefined && moduleCitation === undefined && scriptCitation === undefined;
  record(
    "sibling-inventory",
    "zero",
    siblingOk ? 0 : 1,
    siblingOk,
    JSON.stringify({ sibling, moduleCitation, scriptCitation }),
  );

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
  const configuredTarget = uninventoriedCommandTargets(
    ["test", "--config", "alt.toml", "src/example.test.ts"],
    ".",
    ["src/example.test.ts"],
  );
  const configuredEquals = uninventoriedCommandTargets(
    ["test", "--config=alt.toml", "src/example.test.ts"],
    ".",
    ["src/example.test.ts"],
  );
  const preloadedEq = uninventoriedCommandTargets(
    ["test", "--preload=./setup.ts", "src/example.test.ts"],
    ".",
    ["src/example.test.ts"],
  );
  const shortRequired = uninventoriedCommandTargets(
    ["test", "-r", "./setup.ts", "src/example.test.ts"],
    ".",
    ["src/example.test.ts"],
  );
  const shortEquals = uninventoriedCommandTargets(
    ["test", "-r=./setup.ts", "src/example.test.ts"],
    ".",
    ["src/example.test.ts"],
  );
  const shortAttached = uninventoriedCommandTargets(
    ["test", "-r./setup.ts", "src/example.test.ts"],
    ".",
    ["src/example.test.ts"],
  );
  const importedPreload = uninventoriedCommandTargets(
    ["test", "--import=./setup.ts", "src/example.test.ts"],
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
  const cwdEquals = blockedTestArgs(["test", "--cwd=../other", "src/x.test.ts"]);
  const cwdSplit = blockedTestArgs(["test", "--cwd", "../other", "src/x.test.ts"]);
  const cwdAfterSeparator = blockedTestArgs(["test", "src/x.test.ts", "--", "--cwd"]);
  const inspectWait = blockedTestArgs(["test", "--inspect-wait", "src/example.test.ts"]);
  const inspectBrk = blockedTestArgs([
    "test",
    "--inspect-brk=127.0.0.1:9229",
    "src/example.test.ts",
  ]);
  const inspectOpen = blockedTestArgs(["test", "--inspect", "src/example.test.ts"]);
  const inspectAfterSeparator = blockedTestArgs(["test", "src/x.test.ts", "--", "--inspect-wait"]);
  const conditionsBlocked = blockedTestArgs(["test", "--conditions=evil", "src/example.test.ts"]);
  const conditionsSplit = blockedTestArgs(["test", "--conditions", "evil", "src/example.test.ts"]);
  const conditionsAfter = blockedTestArgs(["test", "src/x.test.ts", "--", "--conditions=evil"]);
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
    shortRequired.length === 0 &&
    shortEquals.length === 0 &&
    shortAttached.length === 0 &&
    importedPreload.length === 0 &&
    configuredTarget.length === 0 &&
    configuredEquals.length === 0 &&
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
    plainCommand === undefined &&
    cwdEquals === "--cwd" &&
    cwdSplit === "--cwd" &&
    cwdAfterSeparator === undefined &&
    inspectWait === "--inspect-wait" &&
    inspectBrk === "--inspect-brk" &&
    inspectOpen === undefined &&
    inspectAfterSeparator === undefined &&
    conditionsBlocked === "--conditions" &&
    conditionsSplit === "--conditions" &&
    conditionsAfter === undefined;
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
