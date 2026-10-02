import { fail } from "./program";

export function plainTestEnv(): Record<string, string | undefined> {
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

/** `&#10;` and `&#x0A;` are one character. An out-of-range reference stays text. */
function numericCharacter(entity: string): string | undefined {
  const hex = entity.startsWith("&#x") || entity.startsWith("&#X");
  const digits = hex ? entity.slice(3, -1) : entity.slice(2, -1);
  if (digits.length === 0) return undefined;
  const code = Number.parseInt(digits, hex ? 16 : 10);
  if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return undefined;
  return String.fromCodePoint(code);
}

/** One XML layer. `&gt;` becomes `>`, `&amp;#10;` stays `&#10;`, and `&#10;` becomes a newline. */
function decodeXmlText(text: string): string {
  return text.replace(/&(?:amp|gt|lt|quot|apos|#[xX][0-9A-Fa-f]+|#\d+);/g, (entity) => {
    const named = XML_TEXT[entity];
    if (named !== undefined) return named;
    return numericCharacter(entity) ?? entity;
  });
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
export function reporterNameMatches(reported: string, registered: string): boolean {
  return reported === registered;
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

/** Reporter flags are options, so they stay before a `--` pattern separator. */
export function junitReporterArgs(args: readonly string[], reportPath: string): string[] {
  const flags = ["--reporter=junit", "--reporter-outfile", reportPath];
  const separator = args.indexOf("--");
  if (separator < 0) return [...args, ...flags];
  return [...args.slice(0, separator), ...flags, ...args.slice(separator)];
}
