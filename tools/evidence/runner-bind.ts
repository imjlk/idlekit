import {
  localRanges,
  readIdentifier,
  readQuoted,
  readStaticTemplate,
  readTestTitle,
  skipEachTable,
  skipPair,
  skipQuoted,
  skipSpaceAndComments,
  skipTemplateLiteral,
  skipTypeOnlySuffix,
  skipWhitespace,
} from "./lex";

const DIRECT_TEST_MODIFIERS = new Set(["only", "skip", "todo", "failing"]);
const CONDITIONAL_TEST_MODIFIERS = new Set(["skipIf", "todoIf", "if"]);

export type Registration = { suites: string[]; title: string; callback?: string; line: number };

export type RunnerKind = "describe" | "it" | "test";

export type RunnerAlias = {
  name: string;
  kind: RunnerKind | undefined;
  modifiers: string[];
  depth: number;
  namespace?: boolean;
  /** Runner module of a namespace import, such as `bun:test` or `node:test`. */
  spec?: string;
  /** `{ it }` or `[it]` stores a runner where member calls bypass the scanner. */
  objectRunner?: boolean;
  /** End of a function parameter's lexical scope. */
  scopeEnd?: number;
  /** A declared class or function shadows a runner but is not an opaque test runner. */
  nonRunner?: boolean;
};

export function isRunnerKind(value: string): value is RunnerKind {
  return value === "describe" || value === "it" || value === "test";
}

/** `suite` from `node:test` is a describe-style suite in Bun. `bun:test` has no `suite`. */
function runnerKindForImport(spec: string, imported: string): RunnerKind | undefined {
  if (isRunnerKind(imported)) return imported;
  if (spec === "node:test" && imported === "suite") return "describe";
  return undefined;
}

export function aliasAt(aliases: readonly RunnerAlias[], name: string): RunnerAlias | undefined {
  for (let index = aliases.length - 1; index >= 0; index -= 1) {
    if (aliases[index]?.name === name) return aliases[index];
  }
  return undefined;
}

function bindingBoundary(body: string, index: number): boolean {
  const cursor = skipSpaceAndComments(body, index);
  const char = body[cursor];
  if (
    char === undefined ||
    char === "," ||
    char === ";" ||
    char === ")" ||
    char === "}" ||
    char === "{" ||
    char === "]"
  ) {
    return true;
  }
  const word = readIdentifier(body, cursor);
  if (!word) return false;
  return word.value !== "in" && word.value !== "instanceof";
}

/**
 * `.only` / `.skip` / `.todo` / `.failing` / `.each` stay on this call.
 * `.skipIf` / `.todoIf` / `.if` take one argument and return the runner.
 * Any other member is unrecognized (`-1`) so the call is not skipped.
 */
export function readDottedModifiers(body: string, index: number, modifiers: string[]): number {
  let at = index;
  for (;;) {
    const dot = skipSpaceAndComments(body, at);
    if (body[dot] !== ".") return at;
    const modifier = readIdentifier(body, dot + 1);
    if (!modifier) return -1;
    if (modifier.value === "each" || DIRECT_TEST_MODIFIERS.has(modifier.value)) {
      modifiers.push(modifier.value);
      at = modifier.end;
      continue;
    }
    if (!CONDITIONAL_TEST_MODIFIERS.has(modifier.value)) return -1;
    const open = skipSpaceAndComments(body, modifier.end);
    if (body[open] !== "(") return -1;
    const close = skipPair(body, open);
    if (close < 0) return -1;
    modifiers.push(modifier.value);
    at = close;
  }
}

/** `=` that ends a binding type. `=>` and `==` stay inside the type. */
export function findBindingEquals(body: string, index: number): number {
  const annotation = localRanges(body, "annotations").find(([, start]) => start === index - 1);
  if (annotation) {
    const after = skipSpaceAndComments(body, annotation[2]);
    return body[after] === "=" ? after : -1;
  }
  let cursor = index;
  let depth = 0;
  const endsBefore = (from: number, to: number): boolean => {
    if (depth !== 0 || !/[\r\n]/.test(body.slice(from, to))) return false;
    const before = body.slice(index, from).trimEnd();
    if (!before || /[|&?:]$/.test(before) || /\b(typeof|keyof|readonly|infer)$/.test(before)) return false;
    const next = readIdentifier(body, to)?.value;
    return next !== undefined && [
      "const", "let", "var", "function", "class", "export", "import", "declare",
    ].includes(next);
  };
  while (cursor < body.length) {
    const next = skipSpaceAndComments(body, cursor);
    if (endsBefore(cursor, next)) return -1;
    cursor = next;
    const char = body[cursor] ?? "";
    if (char === "'" || char === '"') {
      cursor = skipQuoted(body, cursor);
      continue;
    }
    if (char === "`") {
      const end = skipTemplateLiteral(body, cursor);
      if (end < 0) return -1;
      cursor = end;
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
    if (body.startsWith("=>", cursor)) {
      cursor += 2;
      continue;
    }
    if (char === "(" || char === "{" || char === "[" || char === "<") {
      depth += 1;
      cursor += 1;
      continue;
    }
    if (char === ")" || char === "}" || char === "]" || char === ">") {
      if (depth === 0) return -1;
      depth -= 1;
      cursor += 1;
      continue;
    }
    if (
      depth === 0 &&
      char === "=" &&
      body[cursor + 1] !== "=" &&
      body[cursor + 1] !== ">" &&
      body[cursor - 1] !== "="
    ) {
      return cursor;
    }
    if (depth === 0 && (char === "," || char === ";")) return -1;
    cursor += 1;
  }
  return -1;
}

export function assignmentAt(body: string, index: number): { at: number; plain: boolean; logical?: "&&" | "||" | "??" } | undefined {
  const cursor = skipSpaceAndComments(body, index);
  const operators = [
    ">>>=",
    "<<=",
    ">>=",
    "**=",
    "&&=",
    "||=",
    "??=",
    "+=",
    "-=",
    "*=",
    "/=",
    "%=",
    "&=",
    "|=",
    "^=",
    "=",
  ];
  for (const op of operators) {
    if (!body.startsWith(op, cursor)) continue;
    if (op === "=" && (body[cursor + 1] === "=" || body[cursor + 1] === ">")) return undefined;
    return {
      at: cursor,
      plain: op === "=",
      logical: op === "&&=" ? "&&" : op === "||=" ? "||" : op === "??=" ? "??" : undefined,
    };
  }
  return undefined;
}

/** A call whose first argument is a title and whose second argument is present. */
export function titleCallAt(body: string, index: number): boolean {
  const modifiers: string[] = [];
  const dotted = readDottedModifiers(body, index, modifiers);
  if (dotted < 0) return false;
  let open = skipWhitespace(body, dotted);
  if (modifiers.includes("each")) {
    const tableEnd = skipEachTable(body, dotted);
    if (tableEnd < 0) return false;
    open = skipWhitespace(body, tableEnd);
  }
  if (body[open] !== "(") return false;
  const quoted = readTestTitle(body, open + 1);
  if (!quoted) return false;
  return body[skipWhitespace(body, quoted.end)] === ",";
}

function staticBracketKey(
  body: string,
  index: number,
): { value: string; end: number } | undefined {
  const open = skipSpaceAndComments(body, index);
  if (body[open] !== "[") return undefined;
  const keyAt = skipSpaceAndComments(body, open + 1);
  const quoted = readQuoted(body, keyAt) ?? readStaticTemplate(body, keyAt);
  if (!quoted) return undefined;
  const close = skipSpaceAndComments(body, quoted.end);
  if (body[close] !== "]") return undefined;
  return { value: quoted.value, end: close + 1 };
}

function runnerKindForMember(spec: string | undefined, member: string): RunnerKind | undefined {
  if (isRunnerKind(member)) return member;
  if (!spec) return undefined;
  return runnerKindForImport(spec, member);
}

/** `.it` / `["it"]` on a namespace import. `node:test`'s `suite` is a describe. */
export function namespaceRunnerMember(
  body: string,
  index: number,
  spec?: string,
): { kind: RunnerKind; end: number } | undefined {
  const bracket = staticBracketKey(body, index);
  if (bracket) {
    const kind = runnerKindForMember(spec, bracket.value);
    if (!kind) return undefined;
    return { kind, end: bracket.end };
  }
  const dot = skipSpaceAndComments(body, index);
  if (body[dot] !== ".") return undefined;
  const member = readIdentifier(body, skipSpaceAndComments(body, dot + 1));
  if (!member) return undefined;
  const kind = runnerKindForMember(spec, member.value);
  if (!kind) return undefined;
  return { kind, end: member.end };
}

/** An arrow or `function` value is a helper, not a binding of `it` / `test` / `describe`. */
export function isFunctionValue(body: string, index: number): boolean {
  let cursor = skipSpaceAndComments(body, index);
  if (body.startsWith("async", cursor) && /\s|\(/.test(body[cursor + 5] ?? "")) {
    const afterAsync = skipSpaceAndComments(body, cursor + 5);
    if (body.startsWith("function", afterAsync)) return true;
    cursor = afterAsync;
  }
  if (body.startsWith("function", cursor)) return true;
  if (body[cursor] === "<") {
    const close = skipPair(body, cursor);
    if (close < 0) return false;
    cursor = skipSpaceAndComments(body, close);
  }
  const ident = readIdentifier(body, cursor);
  if (ident) return body.startsWith("=>", skipSpaceAndComments(body, ident.end));
  if (body[cursor] !== "(") return false;
  const close = skipPair(body, cursor);
  if (close < 0) return false;
  let after = skipSpaceAndComments(body, close);
  if (body[after] === ":") return typeAnnotationEndsAtArrow(body, after + 1);
  return body.startsWith("=>", after);
}

function typeAnnotationEndsAtArrow(body: string, index: number): boolean {
  let cursor = index;
  let depth = 0;
  while (cursor < body.length) {
    const char = body[cursor] ?? "";
    if (char === "'" || char === '"') {
      cursor = skipQuoted(body, cursor);
      continue;
    }
    if (char === "`") {
      const end = skipTemplateLiteral(body, cursor);
      if (end < 0) return false;
      cursor = end;
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
    if (char === "(" || char === "{" || char === "[" || char === "<") {
      depth += 1;
      cursor += 1;
      continue;
    }
    const closesGroup =
      char === ")" || char === "}" || char === "]" || (char === ">" && body[cursor - 1] !== "=");
    if (closesGroup) {
      depth = Math.max(0, depth - 1);
      cursor += 1;
      continue;
    }
    if (depth === 0 && body.startsWith("=>", cursor)) return true;
    if (depth === 0 && (char === ";" || char === "," || char === "\n")) return false;
    cursor += 1;
  }
  return false;
}

/** `const register = it.only` and `const again = register` name the same runner. */
export function readRunnerRef(
  body: string,
  index: number,
  aliases: readonly RunnerAlias[],
): { kind: RunnerKind; modifiers: string[]; end: number } | undefined {
  const cursor = skipSpaceAndComments(body, index);
  if (body[cursor] === "(") {
    const inner = readRunnerRef(body, cursor + 1, aliases);
    if (!inner) return undefined;
    const close = skipSpaceAndComments(body, inner.end);
    if (body[close] !== ")") return undefined;
    const modifiers = [...inner.modifiers];
    const dotted = readDottedModifiers(body, close + 1, modifiers);
    if (dotted < 0) return undefined;
    const end = skipTypeOnlySuffix(body, dotted);
    if (end < 0 || !bindingBoundary(body, end)) return undefined;
    return { kind: inner.kind, modifiers, end };
  }
  const ident = readIdentifier(body, cursor);
  if (!ident) return undefined;
  let kind: RunnerKind | undefined;
  let modifiers: string[] = [];
  let afterIdent = ident.end;
  const alias = aliasAt(aliases, ident.value);
  if (alias) {
    if (alias?.namespace) {
      const member = namespaceRunnerMember(body, ident.end, alias.spec);
      if (!member) return undefined;
      kind = member.kind;
      afterIdent = member.end;
    } else if (alias?.kind) {
      kind = alias.kind;
      modifiers = [...alias.modifiers];
    } else {
      return undefined;
    }
  } else if (isRunnerKind(ident.value)) kind = ident.value;
  else return undefined;
  const dotted = readDottedModifiers(body, afterIdent, modifiers);
  if (dotted < 0) return undefined;
  const end = skipTypeOnlySuffix(body, dotted);
  if (end < 0 || !bindingBoundary(body, end)) return undefined;
  return { kind, modifiers, end };
}

export function readImportRunnerAliases(
  body: string,
  index: number,
): {
  entries: Array<{ name: string; kind: RunnerKind }>;
  namespaces: string[];
  /** Local names imported from `./` or `../`. A title call through one is unresolved. */
  opaque?: string[];
  moduleSpec?: string;
  end: number;
} | undefined {
  let cursor = skipSpaceAndComments(body, index);
  if (readIdentifier(body, cursor)?.value === "type") return undefined;
  if (body[cursor] === "*") {
    const asWord = readIdentifier(body, skipSpaceAndComments(body, cursor + 1));
    if (asWord?.value !== "as") return undefined;
    const local = readIdentifier(body, skipSpaceAndComments(body, asWord.end));
    if (!local) return undefined;
    const fromWord = readIdentifier(body, skipSpaceAndComments(body, local.end));
    if (fromWord?.value !== "from") return undefined;
    const spec = readQuoted(body, fromWord.end) ?? readStaticTemplate(body, fromWord.end);
    if (!spec) return undefined;
    // A local wrapper can re-export a runner and discard the cited callback.
    if (!runnerModuleSpec(spec.value)) return { entries: [], namespaces: [], end: spec.end };
    return { entries: [], namespaces: [local.value], moduleSpec: spec.value, end: spec.end };
  }
  let defaultLocal: string | undefined;
  if (body[cursor] !== "{") {
    const first = readIdentifier(body, cursor);
    if (!first || first.value === "type") return undefined;
    const afterName = skipSpaceAndComments(body, first.end);
    const fromHere = readIdentifier(body, afterName);
    if (body[afterName] !== "," && fromHere?.value !== "from") return undefined;
    defaultLocal = first.value;
    cursor = afterName;
    if (body[cursor] === ",") cursor = skipSpaceAndComments(body, cursor + 1);
  }
  const pending: Array<{ name: string; imported: string }> = [];
  if (body[cursor] === "{") {
    cursor += 1;
    while (cursor < body.length) {
      cursor = skipSpaceAndComments(body, cursor);
      if (body[cursor] === "}") {
        cursor += 1;
        break;
      }
      let imported = readIdentifier(body, cursor);
      if (!imported) return undefined;
      let typeOnly = false;
      if (imported.value === "type") {
        typeOnly = true;
        const named = readIdentifier(body, skipSpaceAndComments(body, imported.end));
        if (!named) return undefined;
        imported = named;
      }
      cursor = skipSpaceAndComments(body, imported.end);
      let local = imported.value;
      const asWord = readIdentifier(body, cursor);
      if (asWord?.value === "as") {
        const renamed = readIdentifier(body, asWord.end);
        if (!renamed) return undefined;
        local = renamed.value;
        cursor = skipSpaceAndComments(body, renamed.end);
      }
      if (!typeOnly) pending.push({ name: local, imported: imported.value });
      if (body[cursor] === ",") {
        cursor += 1;
        continue;
      }
      if (body[cursor] === "}") {
        cursor += 1;
        break;
      }
      return undefined;
    }
  } else if (defaultLocal === undefined) {
    return undefined;
  }
  cursor = skipSpaceAndComments(body, cursor);
  const fromWord = readIdentifier(body, cursor);
  if (fromWord?.value !== "from") return undefined;
  const spec = readQuoted(body, fromWord.end) ?? readStaticTemplate(body, fromWord.end);
  if (!spec) return undefined;
  if (!runnerModuleSpec(spec.value)) {
    if (!relativeModuleSpec(spec.value)) return { entries: [], namespaces: [], end: spec.end };
    const opaque = pending.map((item) => item.name);
    if (defaultLocal !== undefined) opaque.push(defaultLocal);
    return { entries: [], namespaces: [], opaque, end: spec.end };
  }
  const entries: Array<{ name: string; kind: RunnerKind }> = [];
  for (const item of pending) {
    const kind = runnerKindForImport(spec.value, item.imported);
    if (kind) entries.push({ name: item.name, kind });
  }
  // The default export of node:test is the test runner. bun:test has none.
  if (defaultLocal !== undefined && spec.value === "node:test") {
    entries.push({ name: defaultLocal, kind: "test" });
  }
  return { entries, namespaces: [], end: spec.end };
}

function runnerModuleSpec(spec: string): boolean {
  return spec === "bun:test" || spec === "node:test";
}

function relativeModuleSpec(spec: string): boolean {
  return spec.startsWith("./") || spec.startsWith("../");
}

/**
 * `const runner = await import("bun:test")` and `const runner = require("bun:test")`.
 * A following member, such as `.then`, is a different value.
 */
export function readRunnerNamespaceValue(
  body: string,
  index: number,
): { end: number; spec: string } | undefined {
  const imported = readDynamicRunnerImport(body, index) ?? readRunnerRequire(body, index);
  if (!imported) return undefined;
  const end = skipTypeOnlySuffix(body, imported.end);
  if (end < 0 || body[skipSpaceAndComments(body, end)] === ".") return undefined;
  if (!bindingBoundary(body, end)) return undefined;
  return { end, spec: imported.spec };
}

/** `require("bun:test").it(...)` and `await import("bun:test").suite(...)`. */
export function readDirectModuleRunner(
  body: string,
  index: number,
): { kind: RunnerKind; callFrom: number } | undefined {
  const imported = readRunnerRequire(body, index) ?? readDynamicRunnerImport(body, index);
  if (!imported) return undefined;
  let cursor = imported.end;
  const grouped = skipSpaceAndComments(body, cursor);
  if (body[grouped] === ")") cursor = grouped + 1;
  const dot = skipSpaceAndComments(body, cursor);
  if (body[dot] !== ".") return undefined;
  const member = readIdentifier(body, skipSpaceAndComments(body, dot + 1));
  if (!member) return undefined;
  const kind = runnerKindForImport(imported.spec, member.value);
  if (!kind) return undefined;
  return { kind, callFrom: member.end };
}

/** `await import("bun:test")`, including one pair of parentheses around the call. */
function readDynamicRunnerImport(
  body: string,
  index: number,
): { end: number; spec: string } | undefined {
  let cursor = skipSpaceAndComments(body, index);
  if (body[cursor] === "(") {
    const inner = readDynamicRunnerImport(body, cursor + 1);
    if (!inner) return undefined;
    const close = skipSpaceAndComments(body, inner.end);
    if (body[close] !== ")") return undefined;
    return { end: close + 1, spec: inner.spec };
  }
  const awaitWord = readIdentifier(body, cursor);
  if (awaitWord?.value === "await") cursor = skipSpaceAndComments(body, awaitWord.end);
  const importWord = readIdentifier(body, cursor);
  if (importWord?.value !== "import") return undefined;
  const open = skipSpaceAndComments(body, importWord.end);
  if (body[open] !== "(") return undefined;
  const spec = readQuoted(body, open + 1) ?? readStaticTemplate(body, open + 1);
  if (!spec || !runnerModuleSpec(spec.value)) return undefined;
  const close = skipPair(body, open);
  if (close < 0) return undefined;
  return { end: close, spec: spec.value };
}

/**
 * `const { it: register } = await import("bun:test")` names `register` as `it`.
 * `const { it: register } = require("bun:test")` is the same binding.
 * `const { it: register } = runner` follows a namespace import of a runner module.
 * A nested pattern or any other module is not a runner binding.
 */
export function readDestructuredRunnerImport(
  body: string,
  index: number,
  aliases: readonly RunnerAlias[] = [],
): { entries: Array<{ name: string; kind: RunnerKind }>; end: number } | undefined {
  if (body[index] !== "{") return undefined;
  const pending: Array<{ name: string; imported: string }> = [];
  let cursor = index + 1;
  while (cursor < body.length) {
    cursor = skipSpaceAndComments(body, cursor);
    if (body[cursor] === "}") {
      cursor += 1;
      break;
    }
    if (body.startsWith("...", cursor)) {
      const rest = readIdentifier(body, cursor + 3);
      if (!rest) return undefined;
      cursor = skipSpaceAndComments(body, rest.end);
    } else {
      const imported = readIdentifier(body, cursor);
      if (!imported) return undefined;
      cursor = skipSpaceAndComments(body, imported.end);
      let local = imported.value;
      if (body[cursor] === ":") {
        const renamed = readIdentifier(body, skipSpaceAndComments(body, cursor + 1));
        if (!renamed) return undefined;
        local = renamed.value;
        cursor = skipSpaceAndComments(body, renamed.end);
      }
      if (body[cursor] === "=") return undefined;
      pending.push({ name: local, imported: imported.value });
    }
    if (body[cursor] === ",") {
      cursor += 1;
      continue;
    }
    if (body[cursor] === "}") {
      cursor += 1;
      break;
    }
    return undefined;
  }
  cursor = skipSpaceAndComments(body, cursor);
  if (body[cursor] !== "=") return undefined;
  const imported =
    readDynamicRunnerImport(body, cursor + 1) ?? readRunnerRequire(body, cursor + 1);
  if (imported) {
    const entries: Array<{ name: string; kind: RunnerKind }> = [];
    for (const item of pending) {
      const kind = runnerKindForImport(imported.spec, item.imported);
      if (kind) entries.push({ name: item.name, kind });
    }
    return { entries, end: imported.end };
  }
  const ident = readIdentifier(body, cursor + 1);
  if (!ident) return undefined;
  const alias = aliasAt(aliases, ident.value);
  if (!alias?.namespace || !alias.spec) return undefined;
  if (!bindingBoundary(body, ident.end)) return undefined;
  const entries: Array<{ name: string; kind: RunnerKind }> = [];
  for (const item of pending) {
    const kind = runnerKindForImport(alias.spec, item.imported);
    if (kind) entries.push({ name: item.name, kind });
  }
  return { entries, end: ident.end };
}

/** `require("bun:test")`, including one pair of parentheses around the call. */
function readRunnerRequire(body: string, index: number): { end: number; spec: string } | undefined {
  let cursor = skipSpaceAndComments(body, index);
  if (body[cursor] === "(") {
    const inner = readRunnerRequire(body, cursor + 1);
    if (!inner) return undefined;
    const close = skipSpaceAndComments(body, inner.end);
    if (body[close] !== ")") return undefined;
    return { end: close + 1, spec: inner.spec };
  }
  const word = readIdentifier(body, cursor);
  if (word?.value !== "require") return undefined;
  const open = skipSpaceAndComments(body, word.end);
  if (body[open] !== "(") return undefined;
  const spec = readQuoted(body, open + 1) ?? readStaticTemplate(body, open + 1);
  if (!spec || !runnerModuleSpec(spec.value)) return undefined;
  const close = skipPair(body, open);
  if (close < 0) return undefined;
  return { end: close, spec: spec.value };
}
