import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "fs";
import { tmpdir } from "os";
import { dirname, isAbsolute, join, relative, resolve } from "path";
import lintConfig from "../lint.config";
import {
  disabledClaimLedger,
  evidenceGraph,
  graphLintConfig,
  productionFiles,
  testFiles,
} from "../evidence.config";
import formatConfig from "../lint.format.config";
import { compilerBinName, root } from "./evidence-host";

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

const SOURCE_EXTENSION = /\.(?:[cm]?tsx?)$/;
const NON_PRODUCTION_ROLE = /\.(?:test|spec|generated|d)$/;
const NON_PRODUCTION_SEGMENTS = new Set(["fixtures", "dist", "__tests__", "test", "tests"]);
const TEST_MODIFIERS = new Set(["only", "skip", "todo"]);

export function isNonProductionPath(rel: string): boolean {
  const normalized = rel.replaceAll("\\", "/");
  const file = normalized.split("/").at(-1) ?? normalized;
  const stem = file.replace(SOURCE_EXTENSION, "");
  if (stem !== file && NON_PRODUCTION_ROLE.test(stem)) return true;
  return normalized.split("/").some((segment) => NON_PRODUCTION_SEGMENTS.has(segment));
}

/** Package sources the inventory must keep, including `.tsx`, `.mts`, and `.cts`. */
export function isInventoryPackageHost(rel: string): boolean {
  const normalized = rel.replaceAll("\\", "/");
  return normalized.startsWith("packages/") && SOURCE_EXTENSION.test(normalized);
}

export function hasProductionExport(body: string): boolean {
  return /\bexport\s+(?:default\s+)?(?:async\s+)?function\b/.test(body)
    || /\bexport\s+(?:const|class|type|interface|enum)\b/.test(body)
    || /\bexport\s*\{/.test(body);
}

function plainTestEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.FORCE_COLOR;
  delete env.CLICOLOR_FORCE;
  env.NO_COLOR = "1";
  return env;
}

const XML_TEXT: Record<string, string> = {
  "&amp;": "&",
  "&gt;": ">",
  "&lt;": "<",
  "&quot;": '"',
  "&apos;": "'",
};

/** One XML layer. `&gt;` becomes `>`, and `&amp;gt;` stays the text `&gt;`. */
function decodeXmlText(text: string): string {
  return text.replace(/&(?:amp|gt|lt|quot|apos);/g, (entity) => XML_TEXT[entity] ?? entity);
}

function rawAttr(tag: string, name: string): string {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return match?.[1] ?? "";
}

function xmlAttr(tag: string, name: string): string {
  return decodeXmlText(rawAttr(tag, name));
}

/** A file suite's `name` is the path. Describe suites keep their own names. */
function isFileSuite(name: string, file: string): boolean {
  if (file.length > 0 && name === file) return true;
  return /(?:^|\/)[^/]+\.[cm]?tsx?$/.test(name);
}

/**
 * Bun stores describe ancestry in `classname`, inside-out, and often omits
 * `file` on the outer suite. Nested `testsuite` names remain the fallback.
 */
function describePath(rawClassname: string): string {
  if (rawClassname.length === 0) return "";
  // Bun joins suites with ` > `. The attribute stores that join as ` &amp;gt; `.
  const encodedSeparator = " &amp;gt; ";
  const names = rawClassname.includes(encodedSeparator)
    ? rawClassname.split(encodedSeparator).map((piece) => decodeXmlText(piece))
    : decodeXmlText(rawClassname).split(" > ");
  return names.reverse().join(" > ");
}

export type JUnitCase = { status: string; name: string; file: string; line: number };

/** Bun's junit file, not the stdout stream tests can print into. */
export function junitCases(xml: string): JUnitCase[] {
  const cases: JUnitCase[] = [];
  const stack: string[] = [];
  const files: string[] = [];
  const token = /<testsuite\b[^>]*>|<\/testsuite>|<testcase\b[^>]*\/>|<testcase\b[^>]*>[\s\S]*?<\/testcase>/g;
  for (const match of xml.matchAll(token)) {
    const tag = match[0];
    if (tag.startsWith("</testsuite")) {
      stack.pop();
      files.pop();
      continue;
    }
    if (tag.startsWith("<testsuite")) {
      const file = xmlAttr(tag, "file");
      files.push(file);
      const name = xmlAttr(tag, "name");
      if (name.length > 0 && !isFileSuite(name, file)) stack.push(name);
      continue;
    }
    const title = xmlAttr(tag, "name");
    const described = describePath(rawAttr(tag, "classname"));
    const suite = described.length > 0 ? described : stack.join(" > ");
    const ownFile = xmlAttr(tag, "file");
    const parsedLine = Number(xmlAttr(tag, "line"));
    let status = "pass";
    if (/<failure\b|<error\b/.test(tag)) status = "fail";
    else if (/<skipped\b/.test(tag)) status = "skip";
    cases.push({
      status,
      name: [suite, title].filter((part) => part.length > 0).join(" > "),
      file: ownFile.length > 0 ? ownFile : (files.at(-1) ?? ""),
      line: Number.isInteger(parsedLine) ? parsedLine : 0,
    });
  }
  return cases;
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
  const tsc = join(base, "node_modules", ".bin", compilerBinName("tsc"));
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
  const entries = junitCases(output);
  const passCount = entries.filter((entry) => entry.status === "pass").length;
  if (exitCode !== 0) fail(failures, `bun test exited ${exitCode}`);
  if (!Number.isFinite(passCount) || passCount === 0) {
    fail(failures, "bun test pass count is 0");
  }
  for (const name of names) {
    const matched = entries.filter((entry) => reporterNameMatches(entry.name, name));
    const reportedNames = new Set(matched.map((entry) => entry.name));
    if (reportedNames.size > 1) {
      fail(failures, `executed reporter matched more than one suite for ${name}`);
      continue;
    }
    if (!matched.some((entry) => entry.status === "pass")) {
      fail(failures, `executed reporter missed a passing ${name}`);
    }
  }
  return failures;
}

function inlineCodeSpans(line: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let index = 0;
  while (index < line.length) {
    if (line[index] !== "`") {
      index += 1;
      continue;
    }
    let length = 0;
    while (line[index + length] === "`") length += 1;
    let search = index + length;
    let found = -1;
    while (search < line.length) {
      if (line[search] !== "`") {
        search += 1;
        continue;
      }
      let run = 0;
      while (line[search + run] === "`") run += 1;
      if (run === length) {
        found = search;
        break;
      }
      search += run;
    }
    if (found === -1) {
      index += length;
      continue;
    }
    spans.push([index, found + length]);
    index = found + length;
  }
  return spans;
}

const HTML_BLOCK_TAGS = [
  "address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup",
  "dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset",
  "h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes",
  "ol|optgroup|option|p|param|search|section|summary|table|tbody|td|textarea|tfoot",
  "th|thead|title|tr|track|ul",
].join("|");

type HtmlBlock = { kind: "blank" } | { kind: "contains"; token: string; ignoreCase: boolean };

/** CommonMark HTML blocks hide later ATX lines. A blank line ends types 6 and 7. */
function htmlBlockStart(line: string, inParagraph: boolean): HtmlBlock | undefined {
  const text = line.replace(/^ {0,3}/, "");
  const embedded = /^<(script|pre|style|textarea)(?:[ \t>]|$)/i.exec(text);
  const embeddedName = embedded?.[1];
  if (embeddedName) {
    return { kind: "contains", token: `</${embeddedName.toLowerCase()}>`, ignoreCase: true };
  }
  if (/^<\?/.test(text)) return { kind: "contains", token: "?>", ignoreCase: false };
  if (/^<![A-Za-z]/.test(text)) return { kind: "contains", token: ">", ignoreCase: false };
  if (/^<!\[CDATA\[/i.test(text)) return { kind: "contains", token: "]]>", ignoreCase: false };
  const blockTag = new RegExp(`^</?(?:${HTML_BLOCK_TAGS})(?:[ \\t>]|$)`, "i");
  if (blockTag.test(text)) return { kind: "blank" };
  if (inParagraph) return undefined;
  const name = "[A-Za-z][A-Za-z0-9-]*";
  const value = "(?:[^ \\t\"'=<>`]+|\"[^\"]*\"|'[^']*')";
  const attr = `[A-Za-z_:][A-Za-z0-9_.:-]*(?:\\s*=\\s*${value})?`;
  const complete = new RegExp(`^</?${name}(?:\\s+${attr})*\\s*/?>\\s*$`);
  return complete.test(text) ? { kind: "blank" } : undefined;
}

function htmlBlockClosed(line: string, block: HtmlBlock): boolean {
  if (block.kind === "blank") return line.trim() === "";
  const haystack = block.ignoreCase ? line.toLowerCase() : line;
  return haystack.includes(block.token);
}

/** A setext heading text is a paragraph. Quotes, lists, and breaks are not. */
function isSetextParagraph(text: string): boolean {
  if (text.startsWith(">")) return false;
  if (/^[-*+](?:[ \t]|$)/.test(text)) return false;
  if (/^\d{1,9}[.)](?:[ \t]|$)/.test(text)) return false;
  if (/^#{1,6}(?:[ \t]|$)/.test(text)) return false;
  if (/^(?:-{3,}|\*{3,}|_{3,})[ \t]*$/.test(text)) return false;
  return true;
}

/** Blockquote and list markers can wrap an ATX heading. Setext text keeps its marker. */
function atxText(heading: string): string {
  let rest = heading;
  let opened = false;
  for (;;) {
    const quoted = /^ {0,3}> ?/.exec(rest);
    if (quoted) {
      rest = rest.slice(quoted[0].length);
      opened = true;
      continue;
    }
    const listed = /^(?:[-*+]|\d{1,9}[.)])[ \t]+/.exec(rest);
    if (listed) {
      rest = rest.slice(listed[0].length);
      opened = true;
      continue;
    }
    break;
  }
  return opened ? rest.replace(/^ {0,3}/, "") : rest;
}

function indexOutsideInline(line: string, token: string, from = 0): number {
  const spans = inlineCodeSpans(line);
  let search = from;
  while (search < line.length) {
    const at = line.indexOf(token, search);
    if (at < 0) return -1;
    if (!spans.some((span) => at >= span[0] && at < span[1])) return at;
    search = at + token.length;
  }
  return -1;
}

export function headingAnchors(markdown: string): string[] {
  const anchors: string[] = [];
  let fenceChar: "`" | "~" | undefined;
  let fenceLength = 0;
  let inComment = false;
  let htmlBlock: HtmlBlock | undefined;
  let pending: string | undefined;
  for (const rawLine of markdown.split(/\r?\n/)) {
    const marker = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(atxText(rawLine));
    const opener = marker?.[2];
    const info = marker?.[3] ?? "";
    if (fenceChar) {
      if (opener && opener.startsWith(fenceChar) && opener.length >= fenceLength && info.trim() === "") {
        fenceChar = undefined;
        fenceLength = 0;
      }
      pending = undefined;
      continue;
    }
    if (inComment) {
      if (rawLine.includes("-->")) inComment = false;
      pending = undefined;
      continue;
    }
    if (htmlBlock) {
      pending = undefined;
      if (htmlBlockClosed(rawLine, htmlBlock)) htmlBlock = undefined;
      continue;
    }
    // CommonMark: a backtick opener whose info string contains a backtick is not a fence.
    if (opener && !(opener.startsWith("`") && info.includes("`"))) {
      fenceChar = opener.startsWith("`") ? "`" : "~";
      fenceLength = opener.length;
      pending = undefined;
      continue;
    }
    const htmlStart = htmlBlockStart(rawLine, pending !== undefined);
    if (htmlStart) {
      pending = undefined;
      if (!htmlBlockClosed(rawLine, htmlStart)) htmlBlock = htmlStart;
      continue;
    }
    const commentAt = indexOutsideInline(rawLine, "<!--");
    const line = commentAt === -1 ? rawLine : rawLine.slice(0, commentAt);
    const commentCloses = commentAt !== -1 && rawLine.indexOf("-->", commentAt + 4) !== -1;
    if (commentAt !== -1 && !commentCloses) inComment = true;
    const heading = line.replace(/^ {0,3}/, "");
    const underline = /^(-+|=+)[ \t]*$/.exec(heading);
    if (underline && pending !== undefined) {
      if (underline[1]?.startsWith("-")) {
        const setext = /\{#([A-Za-z0-9][A-Za-z0-9._:-]*)\}[ \t]*$/.exec(pending.trim());
        anchors.push(setext?.[1] ?? "");
      }
      pending = undefined;
      continue;
    }
    const atx = atxText(heading);
    const match = /^##[ \t]+.+\{#([A-Za-z0-9][A-Za-z0-9._:-]*)\}[ \t]*$/.exec(atx);
    if (/^##[ \t]/.test(atx) && !match) {
      anchors.push("");
      pending = undefined;
      continue;
    }
    if (match?.[1]) {
      anchors.push(match[1]);
      pending = undefined;
      continue;
    }
    const paragraph = heading.trim();
    pending = paragraph.length > 0 && isSetextParagraph(paragraph) ? heading : undefined;
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

function skipWhitespace(body: string, index: number): number {
  let cursor = index;
  while (cursor < body.length && /\s/.test(body[cursor] ?? "")) cursor += 1;
  return cursor;
}

function skipQuoted(body: string, index: number): number {
  const quote = body[index];
  if (quote !== "'" && quote !== '"') return index;
  let cursor = index + 1;
  while (cursor < body.length) {
    if (body[cursor] === "\\") {
      cursor += 2;
      continue;
    }
    if (body[cursor] === quote) return cursor + 1;
    cursor += 1;
  }
  return cursor;
}

function readQuoted(body: string, index: number): { value: string; end: number } | undefined {
  const cursor = skipWhitespace(body, index);
  const quote = body[cursor];
  if (quote !== "'" && quote !== '"') return undefined;
  const end = skipQuoted(body, cursor);
  const raw = body.slice(cursor + 1, end - 1);
  return { value: raw.replace(/\\(["'\\])/g, "$1"), end };
}

function regexCanStart(body: string, index: number): boolean {
  let cursor = index - 1;
  while (cursor >= 0 && /\s/.test(body[cursor] ?? "")) cursor -= 1;
  if (cursor < 0) return true;
  const previous = body[cursor] ?? "";
  if ("([{,;:=!&|?+-*%^~<>".includes(previous)) return true;
  if (!/[A-Za-z0-9_$]/.test(previous)) return false;
  const word = /[A-Za-z_$][A-Za-z0-9_$]*$/.exec(body.slice(0, cursor + 1))?.[0];
  return (
    word === "return" ||
    word === "throw" ||
    word === "case" ||
    word === "void" ||
    word === "typeof" ||
    word === "delete" ||
    word === "await" ||
    word === "yield" ||
    word === "in" ||
    word === "of"
  );
}

function skipRegex(body: string, index: number): number {
  let cursor = index + 1;
  let inClass = false;
  while (cursor < body.length) {
    const char = body[cursor] ?? "";
    if (char === "\\") {
      cursor += 2;
      continue;
    }
    if (char === "\n") return cursor;
    if (char === "[" && !inClass) inClass = true;
    else if (char === "]" && inClass) inClass = false;
    else if (char === "/" && !inClass) {
      cursor += 1;
      while (cursor < body.length && /[a-zA-Z]/.test(body[cursor] ?? "")) cursor += 1;
      return cursor;
    }
    cursor += 1;
  }
  return cursor;
}

function readIdentifier(body: string, index: number): { value: string; end: number } | undefined {
  const cursor = skipWhitespace(body, index);
  const match = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(body.slice(cursor));
  if (!match) return undefined;
  return { value: match[0], end: cursor + match[0].length };
}

type Registration = { suites: string[]; title: string; callback?: string; line: number };

/**
 * Names bound inside a block, a catch clause, or a function parameter list.
 * A module-level declaration does not hide the exported callback.
 */
function matchingGroup(body: string, open: number, left: string, right: string): number {
  let cursor = open + 1;
  let depth = 1;
  while (cursor < body.length && depth > 0) {
    const char = body[cursor] ?? "";
    if (char === "'" || char === '"') {
      cursor = skipQuoted(body, cursor);
      continue;
    }
    if (char === "/" && body[cursor + 1] === "/") {
      const line = body.indexOf("\n", cursor);
      cursor = line < 0 ? body.length : line + 1;
      continue;
    }
    if (char === "/" && body[cursor + 1] === "*") {
      const close = body.indexOf("*/", cursor + 2);
      cursor = close < 0 ? body.length : close + 2;
      continue;
    }
    if (char === left) depth += 1;
    else if (char === right) depth -= 1;
    cursor += 1;
  }
  return depth === 0 ? cursor - 1 : -1;
}

function localRanges(body: string): Array<[string, number, number]> {
  const ranges: Array<[string, number, number]> = [];
  const scopes: { start: number; names: string[] }[] = [{ start: 0, names: [] }];
  let pending: string[] = [];
  let index = 0;

  const declareHere = (name: string): void => {
    if (scopes.length <= 1) return;
    scopes[scopes.length - 1]?.names.push(name);
  };
  const openScope = (start: number): void => {
    scopes.push({ start, names: pending });
    pending = [];
  };
  const closeScope = (end: number): void => {
    const scope = scopes.pop();
    if (!scope || scopes.length === 0) return;
    for (const name of scope.names) ranges.push([name, scope.start, end]);
  };
  const previousWord = (at: number): string => {
    let cursor = at - 1;
    while (cursor >= 0 && /\s/.test(body[cursor] ?? "")) cursor -= 1;
    const match = /[A-Za-z_$][A-Za-z0-9_$]*$/.exec(body.slice(0, cursor + 1));
    if (!match || match.index + match[0].length !== cursor + 1) return "";
    return match[0];
  };
  const skipSpaceAndComments = (cursor: number): number => {
    let next = cursor;
    while (next < body.length) {
      const char = body[next] ?? "";
      if (/\s/.test(char)) {
        next += 1;
        continue;
      }
      if (char === "/" && body[next + 1] === "/") {
        const line = body.indexOf("\n", next);
        next = line < 0 ? body.length : line + 1;
        continue;
      }
      if (char === "/" && body[next + 1] === "*") {
        const close = body.indexOf("*/", next + 2);
        next = close < 0 ? body.length : close + 2;
        continue;
      }
      break;
    }
    return next;
  };
  const bindNames = (names: readonly string[], intoPending: boolean): void => {
    for (const name of names) {
      if (intoPending) pending.push(name);
      else declareHere(name);
    }
  };
  const skipNested = (cursor: number, limit: number): number => {
    let depth = 0;
    while (cursor < limit) {
      const mark = body[cursor] ?? "";
      if (mark === "'" || mark === '"') {
        cursor = skipQuoted(body, cursor);
        continue;
      }
      if (mark === "<" || mark === "(" || mark === "{" || mark === "[") depth += 1;
      else if (mark === ">" || mark === ")" || mark === "}" || mark === "]") {
        if (depth === 0) break;
        depth -= 1;
      } else if (depth === 0 && (mark === "," || mark === "=" || mark === ";")) break;
      cursor += 1;
    }
    return cursor;
  };
  const bindingNames = (open: number, close: number): string[] => {
    const names: string[] = [];
    let cursor = open + 1;
    let depth = 0;
    while (cursor < close) {
      const char = body[cursor] ?? "";
      if (char === "'" || char === '"') {
        cursor = skipQuoted(body, cursor);
        continue;
      }
      if (char === "{" || char === "[") {
        depth += 1;
        cursor += 1;
        continue;
      }
      if (char === "}" || char === "]") {
        depth = Math.max(0, depth - 1);
        cursor += 1;
        continue;
      }
      if (depth !== 0 || !/[A-Za-z_$]/.test(char)) {
        cursor += 1;
        continue;
      }
      const id = readIdentifier(body, cursor);
      if (!id || id.end > close) break;
      const after = skipSpaceAndComments(id.end);
      if (body[after] === ":") {
        const alias = readIdentifier(body, skipSpaceAndComments(after + 1));
        if (alias) names.push(alias.value);
        cursor = alias ? skipNested(alias.end, close) : after + 1;
        continue;
      }
      names.push(id.value);
      cursor = id.end;
    }
    return names;
  };
  const parameterNames = (open: number, close: number): string[] => {
    const names: string[] = [];
    let cursor = open + 1;
    while (cursor < close) {
      cursor = skipSpaceAndComments(cursor);
      if (cursor >= close) break;
      const char = body[cursor] ?? "";
      if (char === "{" || char === "[") {
        const end = matchingGroup(body, cursor, char, char === "{" ? "}" : "]");
        if (end < 0 || end > close) break;
        names.push(...bindingNames(cursor, end));
        cursor = skipSpaceAndComments(end + 1);
        if (body[cursor] === ":") cursor = skipNested(cursor + 1, close);
        if (body[cursor] === "=") cursor = skipNested(cursor + 1, close);
        if (body[cursor] === ",") cursor += 1;
        continue;
      }
      if (body.startsWith("...", cursor)) {
        cursor += 3;
        continue;
      }
      const id = readIdentifier(body, cursor);
      if (!id || id.end > close) {
        cursor += 1;
        continue;
      }
      names.push(id.value);
      cursor = skipSpaceAndComments(id.end);
      if (body[cursor] === ":") cursor = skipNested(cursor + 1, close);
      if (body[cursor] === "=") cursor = skipNested(cursor + 1, close);
      if (body[cursor] === ",") cursor += 1;
    }
    return names;
  };
  const loopBound = (at: number): boolean => {
    let cursor = at - 1;
    while (cursor >= 0 && /\s/.test(body[cursor] ?? "")) cursor -= 1;
    if (body[cursor] !== "(") return false;
    const word = previousWord(cursor);
    if (word === "for") return true;
    return word === "await" && previousWord(cursor - "await".length) === "for";
  };
  const matchingParen = (open: number): number => matchingGroup(body, open, "(", ")");

  while (index < body.length) {
    const char = body[index] ?? "";
    if (char === "/" && body[index + 1] === "/") {
      const next = body.indexOf("\n", index);
      index = next < 0 ? body.length : next + 1;
      continue;
    }
    if (char === "/" && body[index + 1] === "*") {
      const next = body.indexOf("*/", index + 2);
      index = next < 0 ? body.length : next + 2;
      continue;
    }
    if (char === "'" || char === '"') {
      index = skipQuoted(body, index);
      continue;
    }
    if (char === "`") {
      index += 1;
      while (index < body.length && body[index] !== "`") {
        if (body[index] === "\\") index += 2;
        else index += 1;
      }
      index += 1;
      continue;
    }
    if (char === "/" && regexCanStart(body, index)) {
      index = skipRegex(body, index);
      continue;
    }
    if (char === "{") {
      openScope(index);
      index += 1;
      continue;
    }
    if (char === "}") {
      closeScope(index + 1);
      index += 1;
      continue;
    }
    if (char === "(") {
      const word = previousWord(index);
      const close = matchingParen(index);
      const after = close < 0 ? index : skipSpaceAndComments(close + 1);
      const params =
        close >= 0 && (word === "function" || word === "catch" || body.startsWith("=>", after));
      if (params && close >= 0) {
        bindNames(parameterNames(index, close), true);
        index = close + 1;
        continue;
      }
      index += 1;
      continue;
    }
    if (!/[A-Za-z_$]/.test(char)) {
      index += 1;
      continue;
    }
    const word = readIdentifier(body, index);
    if (!word) {
      index += 1;
      continue;
    }
    const previous = body[index - 1];
    if (previous === "." || (previous !== undefined && /[A-Za-z0-9_$]/.test(previous))) {
      index = word.end;
      continue;
    }
    if (word.value === "const" || word.value === "let" || word.value === "var") {
      const intoPending = loopBound(index);
      let cursor = skipSpaceAndComments(word.end);
      while (cursor < body.length) {
        if (body[cursor] === "{" || body[cursor] === "[") {
          const left = body[cursor] ?? "{";
          const end = matchingGroup(body, cursor, left, left === "{" ? "}" : "]");
          if (end < 0) break;
          bindNames(bindingNames(cursor, end), intoPending);
          cursor = end + 1;
        } else {
          const id = readIdentifier(body, cursor);
          if (!id || id.value === "of" || id.value === "in") break;
          bindNames([id.value], intoPending);
          cursor = id.end;
        }
        cursor = skipSpaceAndComments(cursor);
        if (body[cursor] === ":") cursor = skipNested(cursor + 1, body.length);
        cursor = skipSpaceAndComments(cursor);
        if (body[cursor] === "=") cursor = skipNested(cursor + 1, body.length);
        cursor = skipSpaceAndComments(cursor);
        if (body[cursor] === ",") {
          cursor = skipSpaceAndComments(cursor + 1);
          continue;
        }
        break;
      }
      index = cursor;
      continue;
    }
    if (word.value === "function" || word.value === "class") {
      const name = readIdentifier(body, skipSpaceAndComments(word.end));
      if (name) {
        const intro = previousWord(index);
        let markAt = index;
        if (intro === "async") markAt = index - intro.length;
        let cursor = markAt - 1;
        while (cursor >= 0 && /\s/.test(body[cursor] ?? "")) cursor -= 1;
        const mark = cursor < 0 ? "" : (body[cursor] ?? "");
        const declared =
          intro === "export" || mark === "" || mark === "{" || mark === "}" || mark === ";";
        if (declared) declareHere(name.value);
        else pending.push(name.value);
        index = name.end;
      } else index = word.end;
      continue;
    }
    const ahead = skipSpaceAndComments(word.end);
    if (body.startsWith("=>", ahead)) pending.push(word.value);
    index = word.end;
  }
  while (scopes.length > 1) closeScope(body.length);
  return ranges;
}

function locallyBound(
  ranges: ReadonlyArray<readonly [string, number, number]>,
  name: string,
  at: number,
): boolean {
  return ranges.some(([bound, from, to]) => bound === name && at >= from && at < to);
}

/** Every `it`/`test` title in this source, including ones inside a false condition. */
function collectRegistrations(body: string): Registration[] {
  const ranges = localRanges(body);
  const found: Registration[] = [];
  const stack: { title: string; depth: number }[] = [];
  let depth = 0;
  let parens = 0;
  let pending: { title: string; parens: number } | undefined;
  let index = 0;

  const pushPending = (): void => {
    if (!pending) return;
    stack.push({ title: pending.title, depth });
    pending = undefined;
  };

  while (index < body.length) {
    const char = body[index] ?? "";
    if (char === "/" && body[index + 1] === "/") {
      const next = body.indexOf("\n", index);
      index = next < 0 ? body.length : next + 1;
      continue;
    }
    if (char === "/" && body[index + 1] === "*") {
      const next = body.indexOf("*/", index + 2);
      index = next < 0 ? body.length : next + 2;
      continue;
    }
    if (char === "'" || char === '"') {
      index = skipQuoted(body, index);
      continue;
    }
    if (char === "`") {
      index += 1;
      while (index < body.length && body[index] !== "`") {
        if (body[index] === "\\") index += 2;
        else index += 1;
      }
      index += 1;
      continue;
    }
    if (char === "/" && regexCanStart(body, index)) {
      index = skipRegex(body, index);
      continue;
    }
    if (char === "{") {
      depth += 1;
      pushPending();
      index += 1;
      continue;
    }
    if (char === "}") {
      while (stack.length > 0 && stack[stack.length - 1]?.depth === depth) stack.pop();
      depth = Math.max(0, depth - 1);
      index += 1;
      continue;
    }
    if (char === "(") {
      parens += 1;
      index += 1;
      continue;
    }
    if (char === ")") {
      parens -= 1;
      if (pending && parens === pending.parens) pending = undefined;
      index += 1;
      continue;
    }
    if (!/[A-Za-z_$]/.test(char)) {
      index += 1;
      continue;
    }
    const word = readIdentifier(body, index);
    if (!word) {
      index += 1;
      continue;
    }
    const previous = body[word.end - word.value.length - 1];
    if (previous === "." || (previous !== undefined && /[A-Za-z0-9_$]/.test(previous))) {
      index = word.end;
      continue;
    }
    if (word.value !== "describe" && word.value !== "it" && word.value !== "test") {
      index = word.end;
      continue;
    }
    let cursor = word.end;
    for (;;) {
      if (body[cursor] !== ".") break;
      const modifier = readIdentifier(body, cursor + 1);
      if (!modifier || !TEST_MODIFIERS.has(modifier.value)) break;
      cursor = modifier.end;
    }
    const open = skipWhitespace(body, cursor);
    if (body[open] !== "(") {
      index = word.end;
      continue;
    }
    const quoted = readQuoted(body, open + 1);
    if (!quoted) {
      index = word.end;
      continue;
    }
    if (word.value === "describe") {
      pending = { title: quoted.value, parens };
    } else {
      const comma = skipWhitespace(body, quoted.end);
      const callback = body[comma] === "," ? readIdentifier(body, comma + 1) : undefined;
      const suites = stack.map((frame) => frame.title);
      if (pending) suites.push(pending.title);
      const at = callback ? callback.end - callback.value.length : -1;
      const visible =
        callback !== undefined && !locallyBound(ranges, callback.value, at);
      found.push({
        suites,
        title: quoted.value,
        callback: visible ? callback.value : undefined,
        line: body.slice(0, word.end).split("\n").length,
      });
    }
    index = open;
  }
  return found;
}

/** 1-based lines where this full reporter name is registered. */
export function registrationLines(body: string, registeredAs: string): number[] {
  return collectRegistrations(body)
    .filter((registration) => {
      const full = [...registration.suites, registration.title].join(" > ");
      return full === registeredAs;
    })
    .map((registration) => registration.line);
}

/** Suite names wrapping this `it`/`test` callback, from the outermost `describe`. */
export function registeredSuites(body: string, exportName: string, title: string): string[][] {
  return collectRegistrations(body)
    .filter((registration) => registration.callback === exportName && registration.title === title)
    .map((registration) => registration.suites);
}

/** Full `suite > title` names registered more than once across these sources. */
export function duplicateFullNamesAcross(bodies: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const body of bodies) {
    for (const registration of collectRegistrations(body)) {
      const full = [...registration.suites, registration.title].join(" > ");
      counts.set(full, (counts.get(full) ?? 0) + 1);
    }
  }
  return [...counts.entries()].filter((entry) => entry[1] > 1).map((entry) => entry[0]);
}

/** Full `suite > title` names registered more than once. One passing row cannot choose among them. */
export function duplicateFullNames(body: string): string[] {
  return duplicateFullNamesAcross([body]);
}

function stringSpans(body: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let index = 0;
  while (index < body.length) {
    const char = body[index] ?? "";
    if (char === "/" && body[index + 1] === "/") {
      const next = body.indexOf("\n", index);
      const end = next < 0 ? body.length : next + 1;
      spans.push([index, end]);
      index = end;
      continue;
    }
    if (char === "/" && body[index + 1] === "*") {
      const next = body.indexOf("*/", index + 2);
      const end = next < 0 ? body.length : next + 2;
      // `/*` is one comment. A nested `/**` inside it is not a JSDoc block.
      if (body[index + 2] !== "*") spans.push([index, end]);
      index = end;
      continue;
    }
    if (char === "'" || char === '"') {
      const end = skipQuoted(body, index);
      spans.push([index, end]);
      index = end;
      continue;
    }
    if (char === "`") {
      let start = index;
      index += 1;
      let closed = false;
      while (index < body.length) {
        const current = body[index] ?? "";
        if (current === "\\") {
          index += 2;
          continue;
        }
        if (current === "`") {
          index += 1;
          spans.push([start, index]);
          closed = true;
          break;
        }
        if (current === "$" && body[index + 1] === "{") {
          spans.push([start, index]);
          index += 2;
          let depth = 1;
          while (index < body.length && depth > 0) {
            const nested = body[index] ?? "";
            if (nested === "'" || nested === '"') {
              const end = skipQuoted(body, index);
              spans.push([index, end]);
              index = end;
              continue;
            }
            if (nested === "`") {
              const nestedStart = index;
              index += 1;
              while (index < body.length && body[index] !== "`") {
                if (body[index] === "\\") index += 2;
                else index += 1;
              }
              index = Math.min(body.length, index + 1);
              spans.push([nestedStart, index]);
              continue;
            }
            if (nested === "/" && body[index + 1] === "/") {
              const next = body.indexOf("\n", index);
              const end = next < 0 ? body.length : next + 1;
              spans.push([index, end]);
              index = end;
              continue;
            }
            if (nested === "/" && body[index + 1] === "*") {
              const next = body.indexOf("*/", index + 2);
              index = next < 0 ? body.length : next + 2;
              continue;
            }
            if (nested === "{") depth += 1;
            else if (nested === "}") depth -= 1;
            index += 1;
          }
          start = index;
          continue;
        }
        index += 1;
      }
      if (!closed) spans.push([start, index]);
      continue;
    }
    if (char === "/" && regexCanStart(body, index)) {
      index = skipRegex(body, index);
      continue;
    }
    index += 1;
  }
  return spans;
}

function insideSpan(spans: ReadonlyArray<readonly [number, number]>, index: number): boolean {
  return spans.some((span) => index >= span[0] && index < span[1]);
}

function registersNamedTest(body: string, registeredAs: string, exportName: string): boolean {
  const parts = registeredAs.split(" > ");
  const title = parts.at(-1);
  if (!title) return false;
  const suites = parts.slice(0, -1);
  return registeredSuites(body, exportName, title).some(
    (path) => path.length === suites.length && path.every((suite, index) => suite === suites[index]),
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `quota` must not match a citation of `quota-v2`. */
function citesAnchor(text: string, doc: string, anchor: string): boolean {
  const pattern = `@evidence ${escapeRegExp(doc)}#${escapeRegExp(anchor)}(?![A-Za-z0-9._:-])`;
  return new RegExp(pattern).test(text);
}

/** The block comment immediately above this export, ignoring matches inside strings. */
function adjacentExportComment(body: string, exportName: string): string | undefined {
  const fn = escapeRegExp(exportName);
  const pattern = new RegExp(
    `\\/\\*\\*((?:(?!\\*\\/)[\\s\\S])*)\\*\\/\\s*export\\s+(?:async\\s+)?function\\s+${fn}\\b`,
    "g",
  );
  const hidden = stringSpans(body);
  for (const match of body.matchAll(pattern)) {
    if (match.index !== undefined && insideSpan(hidden, match.index)) continue;
    return match[1];
  }
  return undefined;
}

/** The doc comment on the exported test must cite this requirement, not only share its file. */
export function citesRequirement(
  body: string,
  exportName: string,
  doc: string,
  anchor: string,
): boolean {
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
  const hidden = stringSpans(body);
  const covered = new Set<string>();
  for (const match of body.matchAll(
    /\/\*\*((?:(?!\*\/)[\s\S])*)\*\/\s*export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/g,
  )) {
    if (match.index !== undefined && insideSpan(hidden, match.index)) continue;
    const comment = match[1] ?? "";
    const name = match[2];
    if (!name) continue;
    const implementation = evidenceTargets(comment).filter((target) =>
      isImplementationTarget(target, doc, anchor),
    );
    if (!names.has(name)) {
      if (implementation.length > 0) return { kind: "unregistered", name };
      continue;
    }
    if (!own.has(name)) continue;
    if (implementation.length === 0) continue;
    if (implementation.some((target) => !citesProduction(target, scope.file, scope.production))) {
      return { kind: "foreign", name };
    }
    covered.add(name);
  }
  for (const name of registered) {
    if (!covered.has(name)) return "";
  }
  return undefined;
}

/** Two inventory rows must not claim the same active heading. */
export function duplicateRequirementAnchors(
  requirements: readonly { doc: string; anchor: string }[],
): string[] {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const requirement of requirements) {
    const pair = `${requirement.doc}#${requirement.anchor}`;
    if (seen.has(pair)) duplicates.push(pair);
    else seen.add(pair);
  }
  return duplicates;
}

export function productionFileCites(body: string, doc: string, anchor: string): boolean {
  const hidden = stringSpans(body);
  for (const match of body.matchAll(/\/\*\*((?:(?!\*\/)[\s\S])*)\*\//g)) {
    if (!match[1] || match.index === undefined || insideSpan(hidden, match.index)) continue;
    if (!citesAnchor(match[1], doc, anchor)) continue;
    const after = body.slice(match.index + match[0].length);
    // A // note may sit between the doc block and the export. Another block comment may not.
    const exportFollows = new RegExp(
      "^(?:\\s|//[^\\n]*(?:\\n|$))*export\\s+(?:default\\s+)?(?:async\\s+)?(?:function|const)\\b",
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

const TEST_SOURCE = /(?:^|\/)[^/]+\.(?:test|spec)\.[cm]?tsx?$/;
const PRELOAD_FLAGS = ["--preload", "--require"] as const;

function preloadValue(arg: string): string | undefined {
  for (const flag of PRELOAD_FLAGS) {
    if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1);
  }
  return undefined;
}

/** Modules imported before the test files. They are not test targets. */
function preloadArguments(args: readonly string[]): string[] {
  const files: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg === "--") break;
    if (arg === "--preload" || arg === "--require") {
      const next = args[index + 1];
      if (next && !next.startsWith("-")) {
        files.push(next);
        index += 1;
      }
      continue;
    }
    const inline = preloadValue(arg);
    if (inline !== undefined) files.push(inline);
  }
  return files;
}

function commandedTestFiles(args: readonly string[]): string[] {
  const files: string[] = [];
  let patterns = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (!patterns && arg === "--") {
      patterns = true;
      continue;
    }
    if (!patterns && (arg === "--preload" || arg === "--require")) {
      index += 1;
      continue;
    }
    if (!patterns && preloadValue(arg) !== undefined) continue;
    if (!patterns && arg.startsWith("-")) continue;
    const normalized = arg.replaceAll("\\", "/");
    if (TEST_SOURCE.test(normalized)) files.push(normalized);
  }
  return files;
}

function sameCommandFile(cwd: string, target: string, inventoried: string): boolean {
  const wanted = target.replaceAll("\\", "/").replace(/^\.\//, "");
  const file = inventoried.replaceAll("\\", "/");
  const fromCwd = relative(cwd, file).replaceAll("\\", "/");
  if (wanted === file || wanted === fromCwd) return true;
  if (!isAbsolute(target)) return false;
  return resolve(target) === resolve(cwd, fromCwd);
}

/** Test paths named by the command that are not already inventory entries for that command. */
export function uninventoriedCommandTargets(
  args: readonly string[],
  cwd: string,
  inventoried: readonly string[],
): string[] {
  return commandedTestFiles(args).filter(
    (target) => !inventoried.some((file) => sameCommandFile(cwd, target, file)),
  );
}

function localPreloadFiles(cwd: string, args: readonly string[]): string[] {
  const names = preloadArguments(args);
  const bunfig = join(cwd, "bunfig.toml");
  if (existsSync(bunfig)) {
    const text = readFileSync(bunfig, "utf8");
    for (const match of text.matchAll(/preload\s*=\s*\[([^\]]*)\]/g)) {
      for (const item of match[1]?.matchAll(/"([^"]+)"|'([^']+)'/g) ?? []) {
        const value = item[1] ?? item[2];
        if (value) names.push(value);
      }
    }
  }
  const files: string[] = [];
  for (const name of names) {
    const path = resolve(cwd, name);
    if (existsSync(path)) files.push(path);
  }
  return files;
}

const RELATIVE_IMPORT = /(?:from\s+|import\s*\(\s*|import\s+)["'](\.[^"']+)["']/g;

function resolveRelativeImport(fromFile: string, spec: string): string | undefined {
  const base = resolve(dirname(fromFile), spec);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mts`,
    `${base}.cts`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

/** The file plus the local modules it imports, so a helper registration stays visible. */
export function sourceGraph(files: readonly string[]): string[] {
  const seen = new Set<string>();
  const bodies: string[] = [];
  const queue = [...files];
  while (queue.length > 0) {
    const file = queue.pop();
    if (!file || !existsSync(file)) continue;
    const real = realpathSync(file);
    if (seen.has(real)) continue;
    seen.add(real);
    if (real.split(/[/\\]/).includes("node_modules")) continue;
    const body = readFileSync(real, "utf8");
    bodies.push(body);
    const hidden = stringSpans(body);
    for (const match of body.matchAll(RELATIVE_IMPORT)) {
      if (match.index !== undefined && insideSpan(hidden, match.index)) continue;
      const spec = match[1];
      if (!spec) continue;
      const next = resolveRelativeImport(real, spec);
      if (next) queue.push(next);
    }
  }
  return bodies;
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

function samePopulation(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const counts = new Map<string, number>();
  for (const item of left) counts.set(item, (counts.get(item) ?? 0) + 1);
  for (const item of right) {
    const count = counts.get(item);
    if (!count) return false;
    if (count === 1) counts.delete(item);
    else counts.set(item, count - 1);
  }
  return counts.size === 0;
}

function referencePopulation(reference: unknown): string[] {
  const references = Array.isArray(reference) ? reference : [reference];
  const files: string[] = [];
  for (const entry of references) {
    if (!entry || typeof entry !== "object" || !("files" in entry)) continue;
    const value = entry.files;
    if (!Array.isArray(value)) continue;
    for (const file of value) {
      if (typeof file === "string") files.push(file);
    }
  }
  return files;
}

const enabledClaimHosts = [
  {
    name: "active requirements have production implementations",
    type: "typescript",
    symbols: ["function", "property"],
    files: productionFiles,
    references: ["docs/requirements/active/**/*.md"],
    referenceType: "markdown",
    referenceSymbols: ["h2"],
  },
  {
    name: "active requirements have executed test hosts",
    type: "typescript",
    symbols: ["function"],
    files: testFiles,
    references: ["docs/requirements/active/**/*.md"],
    referenceType: "markdown",
    referenceSymbols: ["h2"],
  },
  {
    name: "executed tests cite the implementation they run",
    type: "typescript",
    symbols: ["function"],
    files: testFiles,
    references: productionFiles,
    referenceType: "typescript",
    referenceSymbols: ["property", "function"],
  },
] as const;

function symbolPopulation(symbol: unknown): string[] {
  if (typeof symbol === "string") return [symbol];
  if (!Array.isArray(symbol)) return [];
  const names: string[] = [];
  for (const item of symbol) {
    if (typeof item === "string") names.push(item);
  }
  return names;
}

function referenceEntries(reference: unknown): object[] {
  const references = Array.isArray(reference) ? reference : [reference];
  const entries: object[] = [];
  for (const entry of references) {
    if (entry && typeof entry === "object") entries.push(entry);
  }
  return entries;
}

function referenceTypes(reference: unknown): string[] {
  const types: string[] = [];
  for (const entry of referenceEntries(reference)) {
    const type = (entry as { type?: unknown }).type;
    if (typeof type === "string") types.push(type);
  }
  return types;
}

function referenceSymbolPopulation(reference: unknown): string[] {
  const symbols: string[] = [];
  for (const entry of referenceEntries(reference)) {
    symbols.push(...symbolPopulation((entry as { symbol?: unknown }).symbol));
  }
  return symbols;
}

function referenceFlag(reference: unknown, flag: "requireReview" | "noEvidenceExclude"): boolean {
  const entries = referenceEntries(reference);
  if (entries.length === 0) return false;
  return entries.every((entry) => (entry as Record<string, unknown>)[flag] === true);
}

/** The loaded `evidence/graph` rule must be the same object inventory validates. */
export function graphRuleFailures(rules: { readonly ["evidence/graph"]?: unknown } | undefined): string[] {
  const graphRule = rules?.["evidence/graph"];
  if (!Array.isArray(graphRule) || graphRule[0] !== "error" || graphRule[1] !== evidenceGraph) {
    return ["evidence/graph must load evidenceGraph at error severity"];
  }
  return [];
}

export const formatIncludeRoots = [
  "evidence.config.ts",
  "lint.config.ts",
  "lint.format.config.ts",
  "tools/evidence-host.ts",
  "tools/evidence-inventory.ts",
  "tools/evidence-check.ts",
  "tools/evidence-smoke.ts",
  "tools/format-check.ts",
];

function segmentGlob(pattern: string, part: string): boolean {
  if (pattern === "*") return true;
  const source = pattern
    .split("*")
    .map((piece) => piece.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join("[^/]*");
  return new RegExp(`^${source}$`).test(part);
}

/** `**` matches any number of directories, including none. `*` stays in one segment. */
function excludeGlobMatches(pattern: readonly string[], parts: readonly string[]): boolean {
  let patternIndex = 0;
  let partIndex = 0;
  let star = -1;
  let mark = -1;
  while (partIndex < parts.length) {
    const token = pattern[patternIndex];
    if (patternIndex < pattern.length && token === "**") {
      star = patternIndex;
      mark = partIndex;
      patternIndex += 1;
      continue;
    }
    if (
      patternIndex < pattern.length &&
      token !== undefined &&
      segmentGlob(token, parts[partIndex] ?? "")
    ) {
      patternIndex += 1;
      partIndex += 1;
      continue;
    }
    if (star < 0) return false;
    patternIndex = star + 1;
    mark += 1;
    partIndex = mark;
  }
  while (patternIndex < pattern.length && pattern[patternIndex] === "**") patternIndex += 1;
  return patternIndex === pattern.length;
}

function lastGlobSegment(glob: string): string {
  return glob.split("/").at(-1) ?? glob;
}

/**
 * Exact path, basename, `*` / `**` glob, or an extensionless directory.
 * `tools` excludes `tools/evidence-smoke.ts`. A trailing slash does too.
 */
function formatExcludeDropsRoot(pattern: string, rel: string): boolean {
  const glob = pattern.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (glob.length === 0 || glob === ".") return false;
  const rooted = glob.includes("/") ? glob : `**/${glob}`;
  const parts = rel.split("/");
  if (excludeGlobMatches(rooted.split("/"), parts)) return true;
  const fileLike = glob.includes("*") || lastGlobSegment(glob).includes(".");
  if (fileLike) return false;
  return excludeGlobMatches(`${rooted}/**`.split("/"), parts);
}

/** Root format config must lint these roots and fail when a file is unformatted. */
export function formatGateFailures(options?: { tsconfigText?: string; severity?: unknown }): string[] {
  const text = options?.tsconfigText ?? readFileSync(join(root, "tsconfig.format.json"), "utf8");
  const failures: string[] = [];
  let plugins: Array<{ transform?: string; configFile?: string; enabled?: boolean }> = [];
  let include: unknown;
  let exclude: unknown;
  try {
    const parsed = JSON.parse(text) as {
      compilerOptions?: {
        plugins?: Array<{ transform?: string; configFile?: string; enabled?: boolean }>;
      };
      include?: unknown;
      exclude?: unknown;
    };
    plugins = parsed.compilerOptions?.plugins ?? [];
    include = parsed.include;
    exclude = parsed.exclude;
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
  const lint = plugins.find((plugin) => plugin.transform === "@ttsc/lint");
  if (!lint || lint.enabled === false || lint.configFile !== "./lint.format.config.ts") {
    failures.push("tsconfig.format.json must enable @ttsc/lint for lint.format.config.ts");
  }
  if (!Array.isArray(include)) {
    failures.push("tsconfig.format.json must include the format roots");
  } else {
    for (const rel of formatIncludeRoots) {
      if (!include.includes(rel)) failures.push(`tsconfig.format.json include dropped ${rel}`);
    }
  }
  if (exclude !== undefined) {
    const patterns = Array.isArray(exclude) ? exclude : [];
    const strings = patterns.every((entry) => typeof entry === "string");
    if (!Array.isArray(exclude) || !strings) {
      failures.push("tsconfig.format.json exclude must be a list of strings");
    } else {
      for (const rel of formatIncludeRoots) {
        if (patterns.some((pattern) => formatExcludeDropsRoot(pattern, rel))) {
          failures.push(`tsconfig.format.json exclude dropped ${rel}`);
        }
      }
    }
  }
  const severity = options?.severity ?? formatConfig.format?.severity;
  if (severity !== "error") failures.push("format.severity must be error");
  return failures;
}

/** Requirement documents join the protected population next to their hosts. */
export function missingProtectedDocs(
  docs: readonly string[],
  protectedFiles: readonly string[],
): string[] {
  return docs.filter((doc) => !protectedFiles.includes(doc));
}

/** Each enabled evidence claim must keep its symbols, hosts, and reference review flags. */
export function enabledClaimFailures(
  claims: readonly {
    name?: string;
    disabled?: boolean;
    type?: unknown;
    symbol?: unknown;
    files?: readonly string[];
    reference?: unknown;
  }[] = evidenceGraph.claims,
): string[] {
  const failures: string[] = [];
  const enabled = claims.filter((claim) => !claim.disabled && claim.name !== undefined);
  for (const expected of enabledClaimHosts) {
    const matches = enabled.filter((claim) => claim.name === expected.name);
    if (matches.length !== 1) {
      fail(failures, `enabled claim ${expected.name} must appear once`);
      continue;
    }
    const claim = matches[0];
    if (claim?.type !== expected.type) {
      fail(failures, `enabled claim ${expected.name} type is not ${expected.type}`);
    }
    if (!claim || !samePopulation(symbolPopulation(claim.symbol), expected.symbols)) {
      fail(failures, `enabled claim ${expected.name} symbols are not its symbol population`);
    }
    if (!claim || !samePopulation(claim.files ?? [], expected.files)) {
      fail(failures, `enabled claim ${expected.name} files are not its host population`);
    }
    if (!claim || !samePopulation(referencePopulation(claim.reference), expected.references)) {
      fail(failures, `enabled claim ${expected.name} references are not its reference population`);
    }
    if (!claim || !samePopulation(referenceTypes(claim.reference), [expected.referenceType])) {
      fail(
        failures,
        `enabled claim ${expected.name} reference type is not ${expected.referenceType}`,
      );
    }
    if (
      !claim ||
      !samePopulation(referenceSymbolPopulation(claim.reference), expected.referenceSymbols)
    ) {
      fail(
        failures,
        `enabled claim ${expected.name} reference symbols are not its reference symbol population`,
      );
    }
    if (!claim || !referenceFlag(claim.reference, "requireReview")) {
      fail(failures, `enabled claim ${expected.name} reference requireReview is not true`);
    }
    if (!claim || !referenceFlag(claim.reference, "noEvidenceExclude")) {
      fail(failures, `enabled claim ${expected.name} reference noEvidenceExclude is not true`);
    }
  }
  return failures;
}

/** Reporter flags are options, so they stay before a `--` pattern separator. */
export function junitReporterArgs(args: readonly string[], reportPath: string): string[] {
  const flags = ["--reporter=junit", "--reporter-outfile", reportPath];
  const separator = args.indexOf("--");
  if (separator < 0) return [...args, ...flags];
  return [...args.slice(0, separator), ...flags, ...args.slice(separator)];
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
      const inventoriedFiles = [...new Set(commandBodies)];
      const commandCwd = join(projectRoot, test.cwd);
      const extras = uninventoriedCommandTargets(test.args, test.cwd, inventoriedFiles);
      if (extras.length > 0) {
        fail(failures, `${requirement.id} command runs uninventoried tests: ${extras.join(", ")}`);
      }
      const commandSources = sourceGraph([
        ...inventoriedFiles.map((file) => join(projectRoot, file)),
        ...localPreloadFiles(commandCwd, test.args),
      ]);
      if (duplicateFullNamesAcross(commandSources).includes(test.registeredAs)) {
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
  const graphRule = loadedRules["evidence/graph"];
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
    const reportDir = mkdtempSync(join(tmpdir(), "idlekit-evidence-"));
    const reportPath = join(reportDir, "junit.xml");
    const command = [process.execPath, ...junitReporterArgs(first.args, reportPath)];
    const proc = Bun.spawnSync(command, {
      cwd: resolve(projectRoot, first.cwd),
      stdout: "pipe",
      stderr: "pipe",
      env: plainTestEnv(),
    });
    let output = "";
    try {
      output = readFileSync(reportPath, "utf8");
    } catch {
      output = "";
    }
    rmSync(reportDir, { recursive: true, force: true });
    failures.push(
      ...assertExecutedTests(
        output,
        proc.exitCode ?? 1,
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
