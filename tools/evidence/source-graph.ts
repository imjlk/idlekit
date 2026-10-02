import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "fs";
import { dirname, join, resolve } from "path";

import {
  argumentBoundary,
  localRanges,
  locallyBound,
  readIdentifier,
  readQuoted,
  readStaticTemplate,
  regexCanStart,
  skipPair,
  skipQuoted,
  skipRegex,
  skipSpaceAndComments,
  skipTemplateLiteral,
  spanEndAt,
  stringSpans,
  wordBefore,
} from "./lex";
import { runnerSignal } from "./runner-registry";

type LocalRequire = { kind: "static"; spec: string } | { kind: "dynamic" };

/** True when this `require` is the member `module.require`. Other members stay hidden. */
function moduleDotRequire(body: string, index: number): boolean {
  if (body[index - 1] !== ".") return false;
  return wordBefore(body, index - 1) === "module";
}

/** `import.meta.require`, including spaces around the dots. Other members stay hidden. */
function importMetaRequire(body: string, index: number): boolean {
  if (body[index - 1] !== ".") return false;
  if (wordBefore(body, index - 1) !== "meta") return false;
  let metaEnd = index - 2;
  while (metaEnd >= 0 && /\s/.test(body[metaEnd] ?? "")) metaEnd -= 1;
  const metaStart = metaEnd - "meta".length + 1;
  if (metaStart < 0 || body.slice(metaStart, metaEnd + 1) !== "meta") return false;
  let dot = metaStart - 1;
  while (dot >= 0 && /\s/.test(body[dot] ?? "")) dot -= 1;
  if (body[dot] !== ".") return false;
  if (wordBefore(body, dot) !== "import") return false;
  let importEnd = dot - 1;
  while (importEnd >= 0 && /\s/.test(body[importEnd] ?? "")) importEnd -= 1;
  const importStart = importEnd - "import".length + 1;
  if (importStart < 0 || body.slice(importStart, importEnd + 1) !== "import") return false;
  const before = body[importStart - 1];
  if (before === undefined) return true;
  if (before === "." || /[A-Za-z0-9_$]/.test(before)) return false;
  return true;
}

type BindingScan = { binds: boolean; end: number };

function forLoopBinding(body: string, at: number): boolean {
  let cursor = at - 1;
  while (cursor >= 0 && /\s/.test(body[cursor] ?? "")) cursor -= 1;
  if (body[cursor] !== "(") return false;
  const word = wordBefore(body, cursor);
  if (word === "for") return true;
  if (word !== "await") return false;
  let mark = cursor - 1;
  while (mark >= 0 && /\s/.test(body[mark] ?? "")) mark -= 1;
  return wordBefore(body, mark - word.length + 1) === "for";
}

function skipExpression(body: string, at: number): number {
  let index = at;
  let depth = 0;
  while (index < body.length) {
    index = skipSpaceAndComments(body, index);
    const char = body[index] ?? "";
    if (char === "") return index;
    if (depth === 0 && (char === "," || char === "}" || char === "]" || char === ";")) return index;
    if (char === "'" || char === '"') {
      index = skipQuoted(body, index);
      continue;
    }
    if (char === "`") {
      const end = skipTemplateLiteral(body, index);
      index = end < 0 ? index + 1 : end;
      continue;
    }
    if (char === "/" && regexCanStart(body, index)) {
      const end = skipRegex(body, index);
      index = end < 0 ? index + 1 : end;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") {
      depth += 1;
      index += 1;
      continue;
    }
    if (char === ")" || char === "]" || char === "}") {
      if (depth === 0) return index;
      depth -= 1;
      index += 1;
      continue;
    }
    index += 1;
  }
  return index;
}

function skipInitializer(body: string, at: number): number {
  const index = skipSpaceAndComments(body, at);
  if (body[index] !== "=") return index;
  return skipExpression(body, index + 1);
}

function bindingPattern(body: string, at: number): BindingScan {
  let index = skipSpaceAndComments(body, at);
  if (body.startsWith("...", index)) index = skipSpaceAndComments(body, index + 3);
  const char = body[index] ?? "";
  if (char === "{") return objectPattern(body, index);
  if (char === "[") return arrayPattern(body, index);
  const word = readIdentifier(body, index);
  if (!word) return { binds: false, end: Math.min(body.length, index + 1) };
  return { binds: word.value === "require", end: word.end };
}

function objectPattern(body: string, open: number): BindingScan {
  let index = open + 1;
  let binds = false;
  while (index < body.length) {
    index = skipSpaceAndComments(body, index);
    const char = body[index] ?? "";
    if (char === "}") return { binds, end: index + 1 };
    if (char === ",") {
      index += 1;
      continue;
    }
    if (char === "'" || char === '"') {
      const quoted = skipQuoted(body, index);
      const after = skipSpaceAndComments(body, quoted);
      if (body[after] !== ":") {
        index = quoted;
        continue;
      }
      const bound = bindingPattern(body, after + 1);
      binds = binds || bound.binds;
      index = skipInitializer(body, bound.end);
      continue;
    }
    if (char === "[") {
      const end = skipPair(body, index);
      const after = skipSpaceAndComments(body, end < 0 ? index + 1 : end);
      if (body[after] !== ":") {
        index = after;
        continue;
      }
      const bound = bindingPattern(body, after + 1);
      binds = binds || bound.binds;
      index = skipInitializer(body, bound.end);
      continue;
    }
    if (body.startsWith("...", index)) {
      const rest = bindingPattern(body, index + 3);
      binds = binds || rest.binds;
      index = skipInitializer(body, rest.end);
      continue;
    }
    const key = readIdentifier(body, index);
    if (!key) {
      index += 1;
      continue;
    }
    const after = skipSpaceAndComments(body, key.end);
    if (body[after] === ":") {
      const bound = bindingPattern(body, after + 1);
      binds = binds || bound.binds;
      index = skipInitializer(body, bound.end);
      continue;
    }
    if (key.value === "require") binds = true;
    index = skipInitializer(body, key.end);
  }
  return { binds, end: index };
}

function arrayPattern(body: string, open: number): BindingScan {
  let index = open + 1;
  let binds = false;
  while (index < body.length) {
    index = skipSpaceAndComments(body, index);
    const char = body[index] ?? "";
    if (char === "]") return { binds, end: index + 1 };
    if (char === ",") {
      index += 1;
      continue;
    }
    const pattern = bindingPattern(body, index);
    binds = binds || pattern.binds;
    index = skipInitializer(body, pattern.end);
  }
  return { binds, end: index };
}

function declarationBindsRequire(body: string, at: number): boolean {
  let index = at;
  while (index < body.length) {
    index = skipSpaceAndComments(body, index);
    const char = body[index] ?? "";
    if (char === "" || char === ";" || char === "\n") return false;
    if (char === ",") {
      index += 1;
      continue;
    }
    const pattern = bindingPattern(body, index);
    if (pattern.binds) return true;
    const next = skipSpaceAndComments(body, skipInitializer(body, pattern.end));
    if (body[next] !== ",") return false;
    index = next;
  }
  return false;
}

function importSpecifiersBindRequire(body: string, open: number): BindingScan {
  let index = open + 1;
  let binds = false;
  while (index < body.length) {
    index = skipSpaceAndComments(body, index);
    const char = body[index] ?? "";
    if (char === "}") return { binds, end: index + 1 };
    if (char === ",") {
      index += 1;
      continue;
    }
    const name = readIdentifier(body, index);
    if (!name) {
      index += 1;
      continue;
    }
    const afterName = skipSpaceAndComments(body, name.end);
    const next = readIdentifier(body, afterName);
    if (name.value === "type" && next && next.value !== "as") {
      index = next.end;
      const aliasAt = skipSpaceAndComments(body, index);
      const alias = readIdentifier(body, aliasAt);
      if (alias?.value === "as") {
        const local = readIdentifier(body, skipSpaceAndComments(body, alias.end));
        index = local?.end ?? alias.end;
      }
      continue;
    }
    let local = name.value;
    index = name.end;
    if (next?.value === "as") {
      const bound = readIdentifier(body, skipSpaceAndComments(body, next.end));
      if (bound) {
        local = bound.value;
        index = bound.end;
      }
    }
    if (local === "require") binds = true;
  }
  return { binds, end: index };
}

function importBindsRequire(body: string, at: number): boolean {
  let index = skipSpaceAndComments(body, at);
  const opener = body[index] ?? "";
  if (opener === "." || opener === "'" || opener === '"' || opener === "`") return false;
  const first = readIdentifier(body, index);
  if (first?.value === "type") {
    const after = skipSpaceAndComments(body, first.end);
    const next = body[after] ?? "";
    if (next === "{" || next === "*" || /[A-Za-z_$]/.test(next)) return false;
  }
  let binds = false;
  while (index < body.length) {
    index = skipSpaceAndComments(body, index);
    const char = body[index] ?? "";
    if (char === "" || char === ";" || char === ".") return binds;
    if (char === "'" || char === '"') {
      index = skipQuoted(body, index);
      continue;
    }
    if (char === "`") {
      const end = skipTemplateLiteral(body, index);
      index = end < 0 ? index + 1 : end;
      continue;
    }
    const fromWord = body.startsWith("from", index);
    const fromTail = body[index + 4] ?? "";
    if (fromWord && !/[A-Za-z0-9_$]/.test(fromTail)) return binds;
    if (char === "{") {
      const group = importSpecifiersBindRequire(body, index);
      binds = binds || group.binds;
      index = group.end;
      continue;
    }
    if (char === "*") {
      const asWord = readIdentifier(body, skipSpaceAndComments(body, index + 1));
      if (asWord?.value !== "as") return binds;
      const name = readIdentifier(body, skipSpaceAndComments(body, asWord.end));
      if (name?.value === "require") binds = true;
      index = name?.end ?? asWord.end;
      continue;
    }
    if (char === ",") {
      index += 1;
      continue;
    }
    const ident = readIdentifier(body, index);
    if (!ident) {
      index += 1;
      continue;
    }
    const after = skipSpaceAndComments(body, ident.end);
    const equals =
      body[after] === "=" && body[after + 1] !== "=" && body[after + 1] !== ">";
    if (equals) {
      if (ident.value === "require") binds = true;
      index = skipImportEqualsRhs(body, after + 1);
      continue;
    }
    if (ident.value === "require") binds = true;
    index = ident.end;
  }
  return binds;
}

/** `import helper = require("./helper")` binds `helper`, not `require`. */
function skipImportEqualsRhs(body: string, at: number): number {
  let cursor = skipSpaceAndComments(body, at);
  const name = readIdentifier(body, cursor);
  if (name?.value === "require") {
    cursor = skipSpaceAndComments(body, name.end);
    if (body[cursor] === "<") {
      const typeEnd = skipPair(body, cursor);
      if (typeEnd < 0) return cursor + 1;
      cursor = skipSpaceAndComments(body, typeEnd);
    }
    if (body[cursor] === "(") {
      const close = skipPair(body, cursor);
      return close < 0 ? cursor + 1 : close;
    }
  }
  while (cursor < body.length && body[cursor] !== ";" && body[cursor] !== "\n") cursor += 1;
  return cursor < body.length ? cursor + 1 : cursor;
}

function isParameterList(body: string, open: number, close: number): boolean {
  const word = wordBefore(body, open);
  if (word === "function" || word === "catch") return true;
  if (word.length > 0) {
    let mark = open - 1;
    while (mark >= 0 && /\s/.test(body[mark] ?? "")) mark -= 1;
    if (wordBefore(body, mark - word.length + 1) === "function") return true;
  }
  return body.startsWith("=>", skipSpaceAndComments(body, close));
}

function parameterListBindsRequire(body: string, open: number, close: number): boolean {
  let index = open + 1;
  while (index < close) {
    index = skipSpaceAndComments(body, index);
    if (index >= close) return false;
    if (body[index] === ",") {
      index += 1;
      continue;
    }
    const pattern = bindingPattern(body, index);
    if (pattern.binds) return true;
    let after = skipInitializer(body, pattern.end);
    after = skipSpaceAndComments(body, after);
    if (body[after] === ":") after = skipExpression(body, after + 1);
    index = after;
  }
  return false;
}

/** Bodies whose parameter list binds `require`, including `function hide(require)`. */
function parameterRequireRanges(body: string): Array<[number, number]> {
  const hidden = stringSpans(body);
  const ranges: Array<[number, number]> = [];
  let index = 0;
  while (index < body.length) {
    const hiddenEnd = spanEndAt(hidden, index);
    if (hiddenEnd >= 0) {
      index = hiddenEnd;
      continue;
    }
    if (body[index] === "/" && body[index + 1] === "*") {
      const comment = body.indexOf("*/", index + 2);
      index = comment < 0 ? body.length : comment + 2;
      continue;
    }
    if (body[index] === "/" && regexCanStart(body, index)) {
      const end = skipRegex(body, index);
      index = end < 0 ? index + 1 : end;
      continue;
    }
    if (body[index] !== "(") {
      index += 1;
      continue;
    }
    const close = skipPair(body, index);
    const listed = close > 0 && isParameterList(body, index, close);
    const parameters = listed && parameterListBindsRequire(body, index, close);
    if (parameters) {
      let bodyAt = skipSpaceAndComments(body, close);
      const arrow = body.startsWith("=>", bodyAt);
      if (arrow) bodyAt = skipSpaceAndComments(body, bodyAt + 2);
      if (body[bodyAt] === "{") {
        const end = skipPair(body, bodyAt);
        if (end > 0) ranges.push([bodyAt, end]);
      } else if (arrow) ranges.push([bodyAt, skipExpression(body, bodyAt)]);
    }
    index += 1;
  }
  return ranges;
}

/** A module-level `require` binding hides every bare `require()` in that file. */
function moduleBindsRequire(body: string): boolean {
  const hidden = stringSpans(body);
  let index = 0;
  let depth = 0;
  while (index < body.length) {
    const hiddenEnd = spanEndAt(hidden, index);
    if (hiddenEnd >= 0) {
      index = hiddenEnd;
      continue;
    }
    if (body[index] === "/" && body[index + 1] === "*") {
      const close = body.indexOf("*/", index + 2);
      index = close < 0 ? body.length : close + 2;
      continue;
    }
    if (body[index] === "/" && regexCanStart(body, index)) {
      const end = skipRegex(body, index);
      index = end < 0 ? index + 1 : end;
      continue;
    }
    const char = body[index] ?? "";
    if (char === "{") {
      depth += 1;
      index += 1;
      continue;
    }
    if (char === "}") {
      if (depth > 0) depth -= 1;
      index += 1;
      continue;
    }
    if (depth > 0 || body[index - 1] === "." || !/[A-Za-z_$]/.test(char)) {
      index += 1;
      continue;
    }
    const word = readIdentifier(body, index);
    if (!word) {
      index += 1;
      continue;
    }
    if (word.value === "function") {
      const name = readIdentifier(body, skipSpaceAndComments(body, word.end));
      if (name?.value === "require") return true;
      index = word.end;
      continue;
    }
    if (word.value === "import") {
      const after = skipSpaceAndComments(body, word.end);
      if (body[after] !== "(" && importBindsRequire(body, word.end)) return true;
      index = word.end;
      continue;
    }
    const declaration = word.value === "const" || word.value === "let" || word.value === "var";
    if (declaration && !forLoopBinding(body, index) && declarationBindsRequire(body, word.end)) {
      return true;
    }
    index = word.end;
  }
  return false;
}

/** `import helper = require("./helper")` loads a module. A local `require` binding does not. */
function importEqualsRequire(body: string, requireAt: number): boolean {
  const equalsAt = previousCodeIndex(body, requireAt);
  if (equalsAt < 0 || body[equalsAt] !== "=") return false;
  if (body[equalsAt + 1] === "=" || body[equalsAt + 1] === ">") return false;
  const nameEnd = previousCodeIndex(body, equalsAt);
  if (nameEnd < 0) return false;
  const name = wordEndingAt(body, nameEnd);
  if (!name) return false;
  const nameStart = nameEnd - name.value.length + 1;
  if (memberReceiver(body, nameStart)) return false;
  const beforeName = previousCodeIndex(body, nameStart);
  if (beforeName < 0) return false;
  const keyword = wordEndingAt(body, beforeName);
  if (keyword?.value === "type") return false;
  return keyword?.value === "import";
}

function wordAt(body: string, index: number, word: string): boolean {
  if (!body.startsWith(word, index)) return false;
  const previous = body[index - 1];
  const tail = body[index + word.length];
  if (previous !== undefined && /[A-Za-z0-9_$]/.test(previous)) return false;
  if (tail !== undefined && /[A-Za-z0-9_$]/.test(tail)) return false;
  return true;
}

function createRequireBinding(body: string, fromAt: number): string | undefined {
  const brace = body.lastIndexOf("{", fromAt);
  if (brace < 0 || fromAt - brace > 400) return undefined;
  let cursor = brace + 1;
  while (cursor < fromAt) {
    cursor = skipSpaceAndComments(body, cursor);
    if (cursor >= fromAt || body[cursor] === "}") return undefined;
    if (body[cursor] === ",") {
      cursor += 1;
      continue;
    }
    const name = readIdentifier(body, cursor);
    if (!name) return undefined;
    const next = readIdentifier(body, skipSpaceAndComments(body, name.end));
    if (name.value === "type" && next && next.value !== "as") {
      cursor = next.end;
      continue;
    }
    let imported = name.value;
    let local = name.value;
    cursor = name.end;
    if (next?.value === "as") {
      const bound = readIdentifier(body, skipSpaceAndComments(body, next.end));
      if (!bound) return undefined;
      local = bound.value;
      cursor = bound.end;
    }
    if (imported === "createRequire") return local;
  }
  return undefined;
}

function importedCreateRequire(
  body: string,
  hidden: ReadonlyArray<readonly [number, number]>,
): string[] {
  const names: string[] = [];
  let index = 0;
  while (index < body.length) {
    const hiddenEnd = spanEndAt(hidden, index);
    if (hiddenEnd >= 0) {
      index = hiddenEnd;
      continue;
    }
    if (!wordAt(body, index, "from")) {
      index += 1;
      continue;
    }
    const specAt = skipSpaceAndComments(body, index + 4);
    const spec = readQuoted(body, specAt) ?? readStaticTemplate(body, specAt);
    if (!spec) {
      index += 4;
      continue;
    }
    const moduleSpec = spec.value === "module" || spec.value === "node:module";
    if (moduleSpec) {
      const local = createRequireBinding(body, index);
      if (local) names.push(local);
    }
    index = spec.end;
  }
  return names;
}

function createRequireFactories(
  body: string,
  hidden: ReadonlyArray<readonly [number, number]>,
): string[] {
  return ["createRequire", ...importedCreateRequire(body, hidden)];
}

function createRequireAliases(
  body: string,
  hidden: ReadonlyArray<readonly [number, number]>,
  factories: readonly string[],
): string[] {
  const aliases: string[] = [];
  let index = 0;
  while (index < body.length) {
    const hiddenEnd = spanEndAt(hidden, index);
    if (hiddenEnd >= 0) {
      index = hiddenEnd;
      continue;
    }
    let keyword = "";
    if (wordAt(body, index, "const")) keyword = "const";
    else if (wordAt(body, index, "let")) keyword = "let";
    else if (wordAt(body, index, "var")) keyword = "var";
    if (keyword.length === 0) {
      index += 1;
      continue;
    }
    const name = readIdentifier(body, skipSpaceAndComments(body, index + keyword.length));
    if (!name) {
      index += keyword.length;
      continue;
    }
    const equalsAt = skipSpaceAndComments(body, name.end);
    const factory = readIdentifier(body, skipSpaceAndComments(body, equalsAt + 1));
    const plainEquals =
      body[equalsAt] === "=" && body[equalsAt + 1] !== "=" && body[equalsAt + 1] !== ">";
    const called = factory ? factories.includes(factory.value) : false;
    const open = factory ? skipSpaceAndComments(body, factory.end) : -1;
    if (plainEquals && called && body[open] === "(") aliases.push(name.value);
    index = name.end;
  }
  return aliases;
}

function callOpens(body: string, index: number, name: string): number {
  if (!wordAt(body, index, name)) return -1;
  const previous = body[index - 1];
  if (previous === "." || (previous !== undefined && /[A-Za-z0-9_$]/.test(previous))) return -1;
  if (wordBefore(body, index) === "function") return -1;
  const open = skipSpaceAndComments(body, index + name.length);
  if (body[open] !== "(") return -1;
  return open;
}

function readCallSpec(body: string, open: number): LocalRequire {
  const argAt = skipSpaceAndComments(body, open + 1);
  const quoted = readQuoted(body, argAt) ?? readStaticTemplate(body, argAt);
  if (quoted && argumentBoundary(body, quoted.end)) {
    return { kind: "static", spec: quoted.value };
  }
  return { kind: "dynamic" };
}

/** `const req = createRequire(import.meta.url); req("./helper")` loads `helper`. */
function createRequireCalls(
  body: string,
  hidden: ReadonlyArray<readonly [number, number]>,
): LocalRequire[] {
  const factories = createRequireFactories(body, hidden);
  const aliases = createRequireAliases(body, hidden, factories);
  const found: LocalRequire[] = [];
  let index = 0;
  while (index < body.length) {
    const hiddenEnd = spanEndAt(hidden, index);
    if (hiddenEnd >= 0) {
      index = hiddenEnd;
      continue;
    }
    const alias = aliases.find((name) => callOpens(body, index, name) >= 0);
    if (alias) {
      const open = callOpens(body, index, alias);
      found.push(readCallSpec(body, open));
      const close = skipPair(body, open);
      index = close < 0 ? open + 1 : close;
      continue;
    }
    const factory = factories.find((name) => callOpens(body, index, name) >= 0);
    if (factory) {
      const open = callOpens(body, index, factory);
      const close = skipPair(body, open);
      if (close < 0) {
        index = open + 1;
        continue;
      }
      const next = skipSpaceAndComments(body, close);
      if (body[next] === "(") {
        found.push(readCallSpec(body, next));
        const end = skipPair(body, next);
        index = end < 0 ? next + 1 : end;
        continue;
      }
      index = close;
      continue;
    }
    index += 1;
  }
  return found;
}

/** `require("./helper")`, a static template require, and `module.require`. */
function localRequireCalls(
  body: string,
  hidden: ReadonlyArray<readonly [number, number]>,
): LocalRequire[] {
  const ranges = localRanges(body);
  const moduleShadow = moduleBindsRequire(body);
  const parameterRanges = moduleShadow ? [] : parameterRequireRanges(body);
  const found: LocalRequire[] = [];
  let index = 0;
  while (index < body.length) {
    const hiddenEnd = spanEndAt(hidden, index);
    if (hiddenEnd >= 0) {
      index = hiddenEnd;
      continue;
    }
    if (!body.startsWith("require", index)) {
      index += 1;
      continue;
    }
    const previous = body[index - 1];
    const tail = body[index + "require".length] ?? "";
    const memberRequire =
      previous === "." && !moduleDotRequire(body, index) && !importMetaRequire(body, index);
    if (
      memberRequire ||
      (previous !== undefined && /[A-Za-z0-9_$]/.test(previous)) ||
      /[A-Za-z0-9_$]/.test(tail) ||
      wordBefore(body, index) === "function"
    ) {
      index += "require".length;
      continue;
    }
    const open = skipSpaceAndComments(body, index + "require".length);
    if (body[open] !== "(") {
      index += "require".length;
      continue;
    }
    const parameterShadow = parameterRanges.some(([from, to]) => index >= from && index < to);
    const equalsImport = importEqualsRequire(body, index);
    if (
      !equalsImport &&
      (moduleShadow || locallyBound(ranges, "require", index) || parameterShadow)
    ) {
      const close = skipPair(body, open);
      index = close < 0 ? open + 1 : close;
      continue;
    }
    const argAt = skipSpaceAndComments(body, open + 1);
    const quoted = readQuoted(body, argAt) ?? readStaticTemplate(body, argAt);
    if (quoted && argumentBoundary(body, quoted.end)) {
      found.push({ kind: "static", spec: quoted.value });
    } else found.push({ kind: "dynamic" });
    const close = skipPair(body, open);
    index = close < 0 ? open + 1 : close;
  }
  return found;
}

/** `import("./helper")` is static. `import("./" + "helper")` is not a resolvable local file. */
function importCalls(
  body: string,
  hidden: ReadonlyArray<readonly [number, number]>,
): LocalRequire[] {
  const found: LocalRequire[] = [];
  let index = 0;
  while (index < body.length) {
    const hiddenEnd = spanEndAt(hidden, index);
    if (hiddenEnd >= 0) {
      index = hiddenEnd;
      continue;
    }
    if (!body.startsWith("import", index)) {
      index += 1;
      continue;
    }
    const previous = body[index - 1];
    const tail = body[index + "import".length] ?? "";
    if (
      previous === "." ||
      (previous !== undefined && /[A-Za-z0-9_$]/.test(previous)) ||
      /[A-Za-z0-9_$]/.test(tail)
    ) {
      index += "import".length;
      continue;
    }
    const open = skipSpaceAndComments(body, index + "import".length);
    if (body[open] !== "(") {
      index += "import".length;
      continue;
    }
    const argAt = skipSpaceAndComments(body, open + 1);
    const quoted = readQuoted(body, argAt) ?? readStaticTemplate(body, argAt);
    if (quoted && argumentBoundary(body, quoted.end)) {
      found.push({ kind: "static", spec: quoted.value });
    } else found.push({ kind: "dynamic" });
    const close = skipPair(body, open);
    index = close < 0 ? open + 1 : close;
  }
  return found;
}

const PACKAGE_SIGNAL = /\b(?:it|test|describe|eval|Function)\s*\(|\bplugin\b/;

const DATA_LOADERS = new Set(["bytes", "file", "text"]);

/** `type` inside `with { ... }` or `assert { ... }`. Other keys stay ignored. */
function attributeType(body: string, open: number, close: number): string | undefined {
  let index = open + 1;
  while (index < close) {
    index = skipSpaceAndComments(body, index);
    if (index >= close || body[index] === "}") break;
    if (body[index] === ",") {
      index += 1;
      continue;
    }
    let key = "";
    if (body[index] === "'" || body[index] === '"') {
      const quoted = readQuoted(body, index);
      if (!quoted || quoted.end > close) return undefined;
      key = quoted.value;
      index = quoted.end;
    } else {
      const ident = readIdentifier(body, index);
      if (!ident || ident.end > close) return undefined;
      key = ident.value;
      index = ident.end;
    }
    index = skipSpaceAndComments(body, index);
    if (body[index] !== ":") return undefined;
    index = skipSpaceAndComments(body, index + 1);
    const value = readQuoted(body, index);
    if (!value || value.end > close) return undefined;
    if (key === "type") return value.value;
    index = value.end;
  }
  return undefined;
}

/** Bun returns `text`, `file`, and `bytes` imports as data instead of running them. */
function dataImportSpecifier(body: string, afterSpec: number): boolean {
  const cursor = skipSpaceAndComments(body, afterSpec);
  const word = readIdentifier(body, cursor);
  if (!word || (word.value !== "with" && word.value !== "assert")) return false;
  const brace = skipSpaceAndComments(body, word.end);
  if (body[brace] !== "{") return false;
  const close = skipPair(body, brace);
  if (close < 0) return false;
  const loader = attributeType(body, brace, close);
  return loader !== undefined && DATA_LOADERS.has(loader);
}

/** Static `from` and side-effect `import` specifiers. Comments may sit before the string. */
function staticImportSpecifiers(
  body: string,
  hidden: ReadonlyArray<readonly [number, number]>,
): Array<{ spec: string; at: number }> {
  const found: Array<{ spec: string; at: number }> = [];
  let index = 0;
  while (index < body.length) {
    const hiddenEnd = spanEndAt(hidden, index);
    if (hiddenEnd >= 0) {
      index = hiddenEnd;
      continue;
    }
    if (body.startsWith("//", index) || body.startsWith("/*", index)) {
      const next = skipSpaceAndComments(body, index);
      index = next > index ? next : index + 1;
      continue;
    }
    if (body[index] === "/" && regexCanStart(body, index)) {
      const next = skipRegex(body, index);
      index = next > index ? next : index + 1;
      continue;
    }
    const ident = readIdentifier(body, index);
    if (!ident || ident.end <= index) {
      index += 1;
      continue;
    }
    const start = ident.end - ident.value.length;
    const previous = body[start - 1];
    const member =
      previous === "." || (previous !== undefined && /[A-Za-z0-9_$]/.test(previous));
    const clause = ident.value === "from" || ident.value === "import";
    if (clause && !member) {
      const quoted = readQuoted(body, skipSpaceAndComments(body, ident.end));
      if (quoted) {
        if (!dataImportSpecifier(body, quoted.end)) {
          found.push({ spec: quoted.value, at: start });
        }
        index = quoted.end;
        continue;
      }
    }
    index = ident.end;
  }
  return found;
}

/** Query suffixes are the file Bun loads. A fragment before `?` is not a file. */
function importSpecifier(spec: string): { kind: "path"; spec: string } | { kind: "opaque" } {
  const query = spec.indexOf("?");
  const hash = spec.indexOf("#");
  if (hash >= 0 && (query < 0 || hash < query)) return { kind: "opaque" };
  if (query < 0) return { kind: "path", spec };
  const path = spec.slice(0, query);
  if (path.length === 0) return { kind: "opaque" };
  return { kind: "path", spec: path };
}

function typescriptImportCandidates(base: string): string[] {
  const replacements = [
    [".mjs", [".mts"]],
    [".cjs", [".cts"]],
    [".jsx", [".tsx"]],
    [".js", [".ts", ".tsx"]],
  ] as const;
  for (const [extension, targets] of replacements) {
    if (!base.endsWith(extension)) continue;
    const stem = base.slice(0, -extension.length);
    return targets.map((target) => `${stem}${target}`);
  }
  return [];
}

function fileCandidates(base: string): string | undefined {
  const candidates = [
    base,
    ...typescriptImportCandidates(base),
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mts`,
    `${base}.cts`,
    `${base}.js`,
    `${base}.mjs`,
    `${base}.cjs`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
    join(base, "index.js"),
    join(base, "index.mjs"),
    join(base, "index.cjs"),
  ];
  return candidates.find((candidate) => {
    try {
      return statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
}

/** The file Bun executes for a directory import. `exports` replaces `module` and `main`. */
function directoryPackageFile(base: string, style: ModuleStyle): string | undefined {
  let info: { isDirectory(): boolean };
  try {
    info = statSync(base);
  } catch {
    return undefined;
  }
  if (!info.isDirectory()) return undefined;
  const manifest = join(base, "package.json");
  if (!existsSync(manifest)) return undefined;
  let parsed: { exports?: unknown; module?: unknown; main?: unknown };
  try {
    parsed = JSON.parse(readFileSync(manifest, "utf8")) as typeof parsed;
  } catch {
    return undefined;
  }
  const pkg: WorkspacePackage = {
    name: "",
    dir: base,
    exports: parsed.exports,
    module: typeof parsed.module === "string" ? parsed.module : undefined,
    main: typeof parsed.main === "string" ? parsed.main : undefined,
  };
  const target = runtimePackageEntry(pkg, style);
  if (!target) return undefined;
  const resolved = resolve(base, target);
  if (resolved === resolve(base)) return undefined;
  return fileCandidates(resolved);
}

function resolveExistingFile(base: string, style: ModuleStyle = "import"): string | undefined {
  let directory = false;
  try {
    directory = statSync(base).isDirectory();
  } catch {
    directory = false;
  }
  if (directory) {
    const entry = directoryPackageFile(base, style);
    if (entry) return entry;
  }
  return fileCandidates(base);
}

function resolveRelativeImport(
  fromFile: string,
  spec: string,
  style: ModuleStyle,
): string | undefined {
  return resolveExistingFile(resolve(dirname(fromFile), spec), style);
}

type ResolvedSpec = { kind: "external" } | { kind: "file"; file: string } | { kind: "missing" };

type PathConfig = { baseDir: string; paths: Record<string, string[]> };

const pathConfigByFileDir = new Map<string, PathConfig | null>();
const nearestTsconfigByDir = new Map<string, string | undefined>();
const loadedPathConfig = new Map<string, PathConfig | null>();
const workspacePackagesByRoot = new Map<string, WorkspacePackage[]>();

type WorkspacePackage = {
  name: string;
  dir: string;
  exports?: unknown;
  types?: string;
  module?: string;
  main?: string;
};

function stripConfigComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

function readConfigObject(
  file: string,
): { extends?: unknown; compilerOptions?: unknown } | undefined {
  try {
    const raw = readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as { extends?: unknown; compilerOptions?: unknown };
    return parsed;
  } catch {
    try {
      return JSON.parse(stripConfigComments(readFileSync(file, "utf8"))) as {
        extends?: unknown;
        compilerOptions?: unknown;
      };
    } catch {
      return undefined;
    }
  }
}

function nearestTsconfig(startDir: string): string | undefined {
  const seen: string[] = [];
  let dir = startDir;
  for (;;) {
    const known = nearestTsconfigByDir.get(dir);
    if (known !== undefined || nearestTsconfigByDir.has(dir)) {
      for (const item of seen) nearestTsconfigByDir.set(item, known);
      return known;
    }
    seen.push(dir);
    const candidate = join(dir, "tsconfig.json");
    if (existsSync(candidate)) {
      for (const item of seen) nearestTsconfigByDir.set(item, candidate);
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      for (const item of seen) nearestTsconfigByDir.set(item, undefined);
      return undefined;
    }
    dir = parent;
  }
}

function loadPathConfig(file: string, stack: Set<string>): PathConfig | null {
  let real = file;
  try {
    real = realpathSync(file);
  } catch {
    return null;
  }
  const cached = loadedPathConfig.get(real);
  if (cached !== undefined || loadedPathConfig.has(real)) return cached ?? null;
  if (stack.has(real)) return null;
  stack.add(real);
  const parsed = readConfigObject(real);
  if (!parsed) {
    loadedPathConfig.set(real, null);
    return null;
  }
  const dir = dirname(real);
  let baseDir = dir;
  let paths: Record<string, string[]> | undefined;
  let extendList: unknown[] = [];
  if (Array.isArray(parsed.extends)) extendList = parsed.extends;
  else if (parsed.extends !== undefined) extendList = [parsed.extends];
  for (const entry of extendList) {
    if (typeof entry !== "string" || !entry.startsWith(".")) continue;
    const resolved = resolve(dir, entry);
    let extended: string | undefined;
    if (existsSync(resolved)) extended = resolved;
    else if (existsSync(`${resolved}.json`)) extended = `${resolved}.json`;
    if (!extended) continue;
    const parent = loadPathConfig(extended, stack);
    if (!parent) continue;
    baseDir = parent.baseDir;
    paths = parent.paths;
  }
  const options =
    parsed.compilerOptions && typeof parsed.compilerOptions === "object"
      ? (parsed.compilerOptions as { baseUrl?: unknown; paths?: unknown })
      : undefined;
  if (options && typeof options.baseUrl === "string") baseDir = resolve(dir, options.baseUrl);
  const pathTable = options?.paths;
  if (pathTable && typeof pathTable === "object" && !Array.isArray(pathTable)) {
    const next: Record<string, string[]> = {};
    for (const [pattern, replacements] of Object.entries(pathTable)) {
      if (!Array.isArray(replacements)) continue;
      const targets = replacements.filter((item): item is string => typeof item === "string");
      if (targets.length > 0) next[pattern] = targets;
    }
    paths = next;
  }
  const config = paths ? { baseDir, paths } : null;
  loadedPathConfig.set(real, config);
  return config;
}

function pathsForFile(file: string): PathConfig | null {
  const dir = dirname(file);
  const cached = pathConfigByFileDir.get(dir);
  if (cached !== undefined || pathConfigByFileDir.has(dir)) return cached ?? null;
  const configPath = nearestTsconfig(dir);
  const config = configPath ? loadPathConfig(configPath, new Set()) : null;
  pathConfigByFileDir.set(dir, config);
  return config;
}

function substituteStar(pattern: string, wild: string): string {
  const star = pattern.indexOf("*");
  if (star < 0) return pattern;
  return pattern.slice(0, star) + wild + pattern.slice(star + 1);
}

function mappedPathFile(spec: string, config: PathConfig): string | undefined {
  let winner: { score: number; wild: string; replacements: string[] } | undefined;
  for (const [pattern, replacements] of Object.entries(config.paths)) {
    const star = pattern.indexOf("*");
    if (star < 0) {
      if (pattern !== spec) continue;
      if (!winner || pattern.length > winner.score) {
        winner = { score: pattern.length, wild: "", replacements };
      }
      continue;
    }
    const prefix = pattern.slice(0, star);
    const suffix = pattern.slice(star + 1);
    if (!spec.startsWith(prefix) || !spec.endsWith(suffix)) continue;
    if (spec.length < prefix.length + suffix.length) continue;
    if (winner && prefix.length <= winner.score) continue;
    winner = {
      score: prefix.length,
      wild: spec.slice(prefix.length, spec.length - suffix.length),
      replacements,
    };
  }
  if (!winner) return undefined;
  for (const replacement of winner.replacements) {
    const target = substituteStar(replacement, winner.wild);
    const file = resolveExistingFile(resolve(config.baseDir, target));
    if (!file) continue;
    let real = file;
    try {
      real = realpathSync(file);
    } catch {
      real = file;
    }
    if (real.split(/[/\\]/).includes("node_modules")) continue;
    return file;
  }
  return undefined;
}

function pathAliasStatus(file: string, spec: string): "none" | "file" | "missing" {
  const config = pathsForFile(file);
  if (!config) return "none";
  let matched = false;
  for (const pattern of Object.keys(config.paths)) {
    const star = pattern.indexOf("*");
    if (star < 0) {
      if (pattern === spec) matched = true;
    } else {
      const prefix = pattern.slice(0, star);
      const suffix = pattern.slice(star + 1);
      if (
        spec.startsWith(prefix) &&
        spec.endsWith(suffix) &&
        spec.length >= prefix.length + suffix.length
      ) {
        matched = true;
      }
    }
    if (matched) break;
  }
  if (!matched) return "none";
  return mappedPathFile(spec, config) ? "file" : "missing";
}

function workspaceGlobs(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (!value || typeof value !== "object") return [];
  const packages = (value as { packages?: unknown }).packages;
  if (!Array.isArray(packages)) return [];
  return packages.filter((item): item is string => typeof item === "string");
}

function workspacePackageDirs(rootDir: string, pattern: string): string[] {
  if (!pattern.includes("*")) {
    const dir = resolve(rootDir, pattern);
    return existsSync(join(dir, "package.json")) ? [dir] : [];
  }
  const star = pattern.indexOf("*");
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  const parentRel = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  const parent = resolve(rootDir, parentRel === "" ? "." : parentRel);
  let names: string[] = [];
  try {
    names = readdirSync(parent);
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const name of names) {
    if (suffix.length > 0 && !name.endsWith(suffix)) continue;
    const dir = join(parent, name);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    if (existsSync(join(dir, "package.json"))) found.push(dir);
  }
  return found;
}

function readWorkspacePackage(dir: string): WorkspacePackage | undefined {
  let parsed: {
    name?: unknown;
    exports?: unknown;
    types?: unknown;
    module?: unknown;
    main?: unknown;
  };
  try {
    parsed = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as typeof parsed;
  } catch {
    return undefined;
  }
  if (typeof parsed.name !== "string" || parsed.name.length === 0) return undefined;
  return {
    name: parsed.name,
    dir,
    exports: parsed.exports,
    types: typeof parsed.types === "string" ? parsed.types : undefined,
    module: typeof parsed.module === "string" ? parsed.module : undefined,
    main: typeof parsed.main === "string" ? parsed.main : undefined,
  };
}

const workspaceRootByDir = new Map<string, string | undefined>();

function nearestWorkspaceRoot(startDir: string): string | undefined {
  const seen: string[] = [];
  let dir = startDir;
  for (;;) {
    if (workspaceRootByDir.has(dir)) {
      const known = workspaceRootByDir.get(dir);
      for (const item of seen) workspaceRootByDir.set(item, known);
      return known;
    }
    seen.push(dir);
    const manifest = join(dir, "package.json");
    if (existsSync(manifest)) {
      try {
        const parsed = JSON.parse(readFileSync(manifest, "utf8")) as { workspaces?: unknown };
        if (workspaceGlobs(parsed.workspaces).length > 0) {
          for (const item of seen) workspaceRootByDir.set(item, dir);
          return dir;
        }
      } catch {
        // A broken manifest does not hide a workspace root above it.
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      for (const item of seen) workspaceRootByDir.set(item, undefined);
      return undefined;
    }
    dir = parent;
  }
}

function workspacePackages(rootDir: string): WorkspacePackage[] {
  const cached = workspacePackagesByRoot.get(rootDir);
  if (cached) return cached;
  let globs: string[] = [];
  try {
    const parsed = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8")) as {
      workspaces?: unknown;
    };
    globs = workspaceGlobs(parsed.workspaces);
  } catch {
    globs = [];
  }
  const packages: WorkspacePackage[] = [];
  for (const pattern of globs) {
    for (const dir of workspacePackageDirs(rootDir, pattern)) {
      const pkg = readWorkspacePackage(dir);
      if (pkg) packages.push(pkg);
    }
  }
  workspacePackagesByRoot.set(rootDir, packages);
  return packages;
}

type ModuleStyle = "import" | "require";

type ConditionHit =
  | { kind: "target"; value: string }
  | { kind: "blocked" }
  | { kind: "none" };

/** Conditions Bun honors for an ESM import, matched in key order. */
const IMPORT_CONDITIONS = new Set(["bun", "node", "import", "default"]);

/** Conditions Bun honors for a CommonJS require, matched in key order. */
const REQUIRE_CONDITIONS = new Set(["bun", "node", "require", "default"]);

/**
 * First active condition in insertion order.
 * `null` blocks the specifier. An object with no active key falls through.
 */
function resolveCondition(entry: unknown, style: ModuleStyle): ConditionHit {
  if (entry === null) return { kind: "blocked" };
  if (typeof entry === "string") return { kind: "target", value: entry };
  if (Array.isArray(entry)) {
    for (const item of entry) {
      const found = resolveCondition(item, style);
      if (found.kind === "none") continue;
      return found;
    }
    return { kind: "none" };
  }
  if (typeof entry !== "object") return { kind: "none" };
  const active = style === "require" ? REQUIRE_CONDITIONS : IMPORT_CONDITIONS;
  const record = entry as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!active.has(key)) continue;
    const found = resolveCondition(record[key], style);
    if (found.kind === "none") continue;
    return found;
  }
  return { kind: "none" };
}

function conditionTarget(entry: unknown, style: ModuleStyle): string | undefined {
  const found = resolveCondition(entry, style);
  if (found.kind === "target") return found.value;
  return undefined;
}

function exportTarget(
  exportsField: unknown,
  subpath: string,
  style: ModuleStyle,
): string | undefined {
  if (typeof exportsField === "string") return subpath === "." ? exportsField : undefined;
  if (!exportsField || typeof exportsField !== "object" || Array.isArray(exportsField)) {
    return undefined;
  }
  const table = exportsField as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(table, subpath)) {
    return conditionTarget(table[subpath], style);
  }
  let winner: { score: number; target: string } | undefined;
  for (const key of Object.keys(table)) {
    const star = key.indexOf("*");
    if (star < 0) continue;
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) continue;
    if (subpath.length < prefix.length + suffix.length) continue;
    const raw = conditionTarget(table[key], style);
    if (!raw) continue;
    const wild = subpath.slice(prefix.length, subpath.length - suffix.length);
    if (winner && prefix.length <= winner.score) continue;
    winner = { score: prefix.length, target: substituteStar(raw, wild) };
  }
  return winner?.target;
}

function packageEntry(
  pkg: WorkspacePackage,
  subpath: string,
  style: ModuleStyle,
): string | undefined {
  if (pkg.exports !== undefined) return exportTarget(pkg.exports, subpath, style);
  if (subpath !== ".") return undefined;
  if (pkg.module) return pkg.module;
  return pkg.main;
}

/** Runtime entry. Type declarations are not the file Bun loads. */
function runtimePackageEntry(pkg: WorkspacePackage, style: ModuleStyle): string | undefined {
  return packageEntry(pkg, ".", style);
}

function declarationFile(file: string): boolean {
  return file.endsWith(".d.ts") || file.endsWith(".d.mts") || file.endsWith(".d.cts");
}

function workspaceFile(
  startDir: string,
  spec: string,
  style: ModuleStyle,
): "none" | "file" | "missing" {
  const rootDir = nearestWorkspaceRoot(startDir);
  if (!rootDir) return "none";
  let owner: WorkspacePackage | undefined;
  let subpath = "";
  for (const pkg of workspacePackages(rootDir)) {
    if (spec !== pkg.name && !spec.startsWith(`${pkg.name}/`)) continue;
    if (owner && pkg.name.length <= owner.name.length) continue;
    owner = pkg;
    subpath = spec === pkg.name ? "." : `./${spec.slice(pkg.name.length + 1)}`;
  }
  if (!owner) return "none";
  const target = packageEntry(owner, subpath, style);
  if (!target) return "missing";
  const file = resolveExistingFile(resolve(owner.dir, target), style);
  if (!file || declarationFile(file)) return "missing";
  let real = file;
  try {
    real = realpathSync(file);
  } catch {
    real = file;
  }
  if (real.split(/[/\\]/).includes("node_modules")) return "missing";
  return "file";
}

function resolveWorkspaceFile(
  startDir: string,
  spec: string,
  style: ModuleStyle,
): string | undefined {
  const rootDir = nearestWorkspaceRoot(startDir);
  if (!rootDir) return undefined;
  let owner: WorkspacePackage | undefined;
  let subpath = "";
  for (const pkg of workspacePackages(rootDir)) {
    if (spec !== pkg.name && !spec.startsWith(`${pkg.name}/`)) continue;
    if (owner && pkg.name.length <= owner.name.length) continue;
    owner = pkg;
    subpath = spec === pkg.name ? "." : `./${spec.slice(pkg.name.length + 1)}`;
  }
  if (!owner) return undefined;
  const target = packageEntry(owner, subpath, style);
  if (!target) return undefined;
  const file = resolveExistingFile(resolve(owner.dir, target), style);
  if (!file || declarationFile(file)) return undefined;
  return file;
}

function installedPackageFile(fromFile: string, spec: string): string | undefined {
  let resolved = "";
  try {
    resolved = Bun.resolveSync(spec, dirname(fromFile));
  } catch {
    return undefined;
  }
  if (!resolved || !existsSync(resolved) || declarationFile(resolved)) return undefined;
  let real = resolved;
  try {
    real = realpathSync(resolved);
  } catch {
    real = resolved;
  }
  if (!real.split(/[/\\]/).includes("node_modules")) return undefined;
  return real;
}

function rememberPackageRoot(file: string, roots: string[]): void {
  let real = file;
  try {
    real = realpathSync(file);
  } catch {
    return;
  }
  if (!real.split(/[/\\]/).includes("node_modules")) return;
  const root = packageRootOf(real);
  if (!root || roots.includes(root)) return;
  roots.push(root);
}

function queueNonRelative(
  fromFile: string,
  spec: string,
  queue: string[],
  faults: string[],
  style: ModuleStyle,
  roots: string[],
): void {
  const resolved = resolveNonRelative(fromFile, spec, style);
  if (resolved.kind === "file") {
    rememberPackageRoot(resolved.file, roots);
    queue.push(resolved.file);
  } else if (resolved.kind === "missing") faults.push(spec);
}

function bareScheme(spec: string): string | undefined {
  const match = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(spec);
  return match?.[1]?.toLowerCase();
}

/** Path aliases and workspace packages are local source. Other bare specifiers are packages. */
function resolveNonRelative(fromFile: string, spec: string, style: ModuleStyle): ResolvedSpec {
  const scheme = bareScheme(spec);
  if (scheme === "bun" || scheme === "node" || scheme === "npm") return { kind: "external" };
  if (scheme) return { kind: "missing" };
  const alias = pathAliasStatus(fromFile, spec);
  if (alias === "missing") return { kind: "missing" };
  if (alias === "file") {
    const config = pathsForFile(fromFile);
    const file = config ? mappedPathFile(spec, config) : undefined;
    if (file) return { kind: "file", file };
    return { kind: "missing" };
  }
  const workspace = workspaceFile(dirname(fromFile), spec, style);
  if (workspace === "none") {
    const installed = installedPackageFile(fromFile, spec);
    if (installed) return { kind: "file", file: installed };
    return { kind: "external" };
  }
  if (workspace === "missing") return { kind: "missing" };
  const file = resolveWorkspaceFile(dirname(fromFile), spec, style);
  if (!file) return { kind: "missing" };
  return { kind: "file", file };
}

function typeOnlyImport(body: string, fromIndex: number): boolean {
  let depth = 0;
  let keywordAt = -1;
  for (let cursor = fromIndex - 1; cursor >= 0; cursor -= 1) {
    const char = body[cursor] ?? "";
    if (char === "'" || char === '"') {
      const quote = char;
      cursor -= 1;
      while (cursor >= 0 && body[cursor] !== quote) {
        if (body[cursor] === "\\") cursor -= 1;
        cursor -= 1;
      }
      continue;
    }
    if (char === "}" || char === ")") {
      depth += 1;
      continue;
    }
    if (char === "{" || char === "(") {
      if (depth > 0) depth -= 1;
      continue;
    }
    if (depth !== 0) continue;
    if (char === ";") break;
    if (!/[A-Za-z0-9_$]/.test(char)) continue;
    let start = cursor;
    while (start > 0 && /[A-Za-z0-9_$]/.test(body[start - 1] ?? "")) start -= 1;
    const word = body.slice(start, cursor + 1);
    cursor = start;
    if (word === "import" || word === "export") {
      keywordAt = start;
      break;
    }
  }
  if (keywordAt < 0) return false;
  const clause = body.slice(keywordAt, fromIndex);
  const head = clause.trimStart();
  if (head.startsWith("import type") || head.startsWith("export type")) return true;
  const braceAt = clause.indexOf("{");
  if (braceAt < 0) return false;
  const beforeBrace = clause.slice(0, braceAt).replace(/^\s*(?:import|export)\s+/, "");
  if (/[A-Za-z_$]/.test(beforeBrace.replace(/\btype\b/g, ""))) return false;
  const inside = clause.slice(braceAt + 1).replace(/\}[\s\S]*$/, "");
  let sawSpecifier = false;
  for (const part of inside.split(",")) {
    const text = part.replace(/\/\*[\s\S]*?\*\//g, "").trim();
    if (text.length === 0) continue;
    sawSpecifier = true;
    if (!/^type\s+[A-Za-z_$]/.test(text)) return false;
  }
  return sawSpecifier;
}

type SourceWalk = { bodies: string[]; faults: string[]; files: string[] };

function packageRootOf(file: string): string | undefined {
  let dir = dirname(file);
  while (true) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function inDirectory(file: string, root: string): boolean {
  return file === root || file.startsWith(`${root}/`) || file.startsWith(`${root}\\`);
}

/** Package roots of explicit node_modules entries. Their local files stay visible. */
function preloadPackageRoots(files: readonly string[]): string[] {
  const roots: string[] = [];
  for (const file of files) {
    if (!existsSync(file)) continue;
    let real = file;
    try {
      real = realpathSync(file);
    } catch {
      continue;
    }
    if (!real.split(/[/\\]/).includes("node_modules")) continue;
    const root = packageRootOf(real);
    if (!root || roots.includes(root)) continue;
    roots.push(root);
  }
  return roots;
}

function allowedPackageFile(real: string, roots: readonly string[]): boolean {
  return roots.some((root) => inDirectory(real, root));
}

function acceptLocalFile(
  next: string,
  fromReal: string,
  roots: readonly string[],
  faults: string[],
  spec: string,
): boolean {
  let real = next;
  try {
    real = realpathSync(next);
  } catch {
    return true;
  }
  if (!real.split(/[/\\]/).includes("node_modules")) return true;
  if (allowedPackageFile(real, roots)) return true;
  if (allowedPackageFile(fromReal, roots)) faults.push(spec);
  return false;
}

function publishPackageBody(body: string): boolean {
  if (!PACKAGE_SIGNAL.test(body)) return false;
  if (loaderPluginRegistration(body)) return true;
  return runnerSignal(body) !== "none";
}

function queueSpecifier(
  fromReal: string,
  spec: string,
  style: ModuleStyle,
  queue: string[],
  faults: string[],
  roots: string[],
  relativeFault: boolean,
): void {
  const usable = importSpecifier(spec);
  if (usable.kind === "opaque") {
    faults.push(spec);
    return;
  }
  if (!usable.spec.startsWith(".")) {
    queueNonRelative(fromReal, usable.spec, queue, faults, style, roots);
    return;
  }
  const next = resolveRelativeImport(fromReal, usable.spec, style);
  if (!next) {
    if (relativeFault || usable.spec !== spec) faults.push(spec);
    return;
  }
  if (acceptLocalFile(next, fromReal, roots, faults, spec)) queue.push(next);
}

function walkSources(files: readonly string[]): SourceWalk {
  const packageRoots = preloadPackageRoots(files);
  const seen = new Set<string>();
  const bodies: string[] = [];
  const faults: string[] = [];
  const locals: string[] = [];
  const queue = [...files];
  while (queue.length > 0) {
    const file = queue.pop();
    if (!file || !existsSync(file)) continue;
    const real = realpathSync(file);
    if (seen.has(real)) continue;
    seen.add(real);
    if (
      real.split(/[/\\]/).includes("node_modules") &&
      !allowedPackageFile(real, packageRoots)
    ) {
      continue;
    }
    const body = readFileSync(real, "utf8");
    const packaged = real.split(/[/\\]/).includes("node_modules");
    locals.push(real);
    if (!packaged || publishPackageBody(body)) bodies.push(body);
    const hidden = stringSpans(body);
    for (const imported of staticImportSpecifiers(body, hidden)) {
      if (typeOnlyImport(body, imported.at)) continue;
      queueSpecifier(real, imported.spec, "import", queue, faults, packageRoots, false);
    }
    const requiredCalls = [...localRequireCalls(body, hidden), ...createRequireCalls(body, hidden)];
    for (const required of requiredCalls) {
      if (required.kind === "dynamic") {
        if (!packaged) faults.push("dynamic require");
        continue;
      }
      queueSpecifier(real, required.spec, "require", queue, faults, packageRoots, true);
    }
    for (const imported of importCalls(body, hidden)) {
      if (imported.kind === "dynamic") {
        if (!packaged) faults.push("dynamic import");
        continue;
      }
      queueSpecifier(real, imported.spec, "import", queue, faults, packageRoots, true);
    }
  }
  return { bodies, faults, files: locals };
}

/** The file plus local import and `require("./...")` modules, so a helper stays visible. */
export function sourceGraph(files: readonly string[]): string[] {
  return walkSources(files).bodies;
}

/** Relative requires that do not resolve, and requires whose specifier is not a literal. */
export function unresolvedLocalRequires(files: readonly string[]): string[] {
  return walkSources(files).faults;
}

/** Local and scanned package files whose bytes the test command can execute. */
export function sourceFiles(files: readonly string[]): string[] {
  return walkSources(files).files;
}

const BINDING_KEYWORDS = new Set([
  "await",
  "case",
  "class",
  "const",
  "export",
  "extends",
  "function",
  "import",
  "in",
  "instanceof",
  "let",
  "new",
  "of",
  "return",
  "throw",
  "typeof",
  "var",
  "void",
  "yield",
]);

function previousCodeIndex(body: string, index: number): number {
  let cursor = index - 1;
  while (cursor >= 0) {
    const char = body[cursor] ?? "";
    if (/\s/.test(char)) {
      cursor -= 1;
      continue;
    }
    if (char === "/" && body[cursor - 1] === "/") {
      const line = body.lastIndexOf("\n", cursor);
      cursor = line < 0 ? -1 : line - 1;
      continue;
    }
    if (char === "/" && body[cursor - 1] === "*") {
      const open = body.lastIndexOf("/*", cursor - 1);
      cursor = open < 0 ? -1 : open - 1;
      continue;
    }
    return cursor;
  }
  return -1;
}

function wordEndingAt(body: string, index: number): { value: string } | undefined {
  if (!/[A-Za-z0-9_$]/.test(body[index] ?? "")) return undefined;
  let start = index;
  while (start > 0 && /[A-Za-z0-9_$]/.test(body[start - 1] ?? "")) start -= 1;
  return { value: body.slice(start, index + 1) };
}

function memberReceiver(body: string, identStart: number): boolean {
  const previous = previousCodeIndex(body, identStart);
  return previous >= 0 && body[previous] === ".";
}

function bareReceiver(body: string, identEnd: number): boolean {
  const next = skipSpaceAndComments(body, identEnd);
  if (body.startsWith("?.", next)) return false;
  return body[next] !== "." && body[next] !== "[";
}

function staticPluginKey(body: string, bracketAt: number): boolean {
  const keyAt = skipSpaceAndComments(body, bracketAt + 1);
  const quoted = readQuoted(body, keyAt) ?? readStaticTemplate(body, keyAt);
  if (!quoted || quoted.value !== "plugin") return false;
  const after = skipSpaceAndComments(body, quoted.end);
  return body[after] === "]";
}

/** `.plugin`, `?.plugin`, or a static `["plugin"]` / `` [`plugin`] `` access. */
function pluginAccess(body: string, bunEnd: number): boolean {
  let cursor = skipSpaceAndComments(body, bunEnd);
  if (body.startsWith("?.", cursor)) cursor = skipSpaceAndComments(body, cursor + 2);
  else if (body[cursor] === ".") cursor = skipSpaceAndComments(body, cursor + 1);
  else if (body[cursor] === "[") return staticPluginKey(body, cursor);
  else return false;
  if (body[cursor] === "[") return staticPluginKey(body, cursor);
  const member = readIdentifier(body, cursor);
  return member?.value === "plugin";
}

function matchOpenBrace(body: string, closeAt: number): number {
  let depth = 0;
  for (let cursor = closeAt; cursor >= 0; cursor -= 1) {
    const char = body[cursor] ?? "";
    if (char === "'" || char === '"') {
      cursor -= 1;
      while (cursor >= 0 && body[cursor] !== char) {
        if (body[cursor] === "\\") cursor -= 1;
        cursor -= 1;
      }
      continue;
    }
    if (char === "/" && body[cursor - 1] === "*") {
      const open = body.lastIndexOf("/*", cursor - 1);
      cursor = open < 0 ? -1 : open;
      continue;
    }
    if (char === "}") depth += 1;
    else if (char === "{") {
      depth -= 1;
      if (depth === 0) return cursor;
    }
  }
  return -1;
}

function skipPatternValue(body: string, index: number, limit: number): number {
  let cursor = index;
  let depth = 0;
  while (cursor < limit) {
    const char = body[cursor] ?? "";
    if (char === "'" || char === '"') {
      const quoted = readQuoted(body, cursor);
      cursor = quoted ? quoted.end : cursor + 1;
      continue;
    }
    if (char === "/" && body[cursor + 1] === "/") {
      const line = body.indexOf("\n", cursor);
      cursor = line < 0 ? limit : line + 1;
      continue;
    }
    if (char === "/" && body[cursor + 1] === "*") {
      const close = body.indexOf("*/", cursor + 2);
      cursor = close < 0 ? limit : close + 2;
      continue;
    }
    if (char === "(" || char === "{" || char === "[") {
      depth += 1;
      cursor += 1;
      continue;
    }
    if (char === ")" || char === "}" || char === "]") {
      if (depth === 0) return cursor;
      depth -= 1;
      cursor += 1;
      continue;
    }
    if (depth === 0 && char === ",") return cursor;
    cursor += 1;
  }
  return cursor;
}

/** True when a depth-1 key of this object pattern is `plugin`. */
function patternPullsPlugin(body: string, open: number, close: number): boolean {
  let index = open + 1;
  while (index < close) {
    index = skipSpaceAndComments(body, index);
    if (index >= close) return false;
    if (body.startsWith("...", index)) {
      index = skipSpaceAndComments(body, index + 3);
      const rest = readIdentifier(body, index);
      index = rest ? rest.end : index + 1;
      continue;
    }
    const char = body[index] ?? "";
    if (char === ",") {
      index += 1;
      continue;
    }
    if (char === "[") {
      if (staticPluginKey(body, index)) return true;
      const bracketEnd = skipPatternValue(body, index + 1, close);
      index = body[bracketEnd] === "]" ? bracketEnd + 1 : bracketEnd;
      index = skipPatternValue(body, index, close);
      continue;
    }
    if (char === "{" || char === "(") {
      const nestedEnd = skipPatternValue(body, index + 1, close);
      index = nestedEnd < close ? nestedEnd + 1 : nestedEnd;
      continue;
    }
    if (char === "'" || char === '"') {
      const quoted = readQuoted(body, index);
      index = quoted ? quoted.end : index + 1;
      continue;
    }
    const ident = readIdentifier(body, index);
    if (!ident || ident.end > close) {
      index += 1;
      continue;
    }
    const after = skipSpaceAndComments(body, ident.end);
    const shorthand = after >= close || body[after] === "," || body[after] === "}";
    if (body[after] === ":" || body[after] === "=" || shorthand) {
      if (ident.value === "plugin") return true;
      if (body[after] === ":" || body[after] === "=") {
        index = skipPatternValue(body, after + 1, close);
        continue;
      }
    }
    index = ident.end;
  }
  return false;
}

/** Record `const ns = Bun`. A `{ plugin } = Bun` binding is already a registration. */
function pullsPluginBinding(body: string, identStart: number, aliases: Set<string>): boolean {
  const eq = previousCodeIndex(body, identStart);
  if (eq < 0 || body[eq] !== "=") return false;
  const before = previousCodeIndex(body, eq);
  if (before < 0) return false;
  const mark = body[before] ?? "";
  if ("=!<>+-*/%&|^?".includes(mark)) return false;
  if (mark === "}") {
    const open = matchOpenBrace(body, before);
    if (open < 0) return false;
    return patternPullsPlugin(body, open, before);
  }
  const word = wordEndingAt(body, before);
  if (!word || BINDING_KEYWORDS.has(word.value)) return false;
  aliases.add(word.value);
  return false;
}

/** A `Bun.plugin` reference. Comments, strings, and other receivers do not count. */
export function loaderPluginRegistration(body: string): boolean {
  const spans = stringSpans(body);
  const aliases = new Set<string>(["Bun"]);
  let index = 0;
  while (index < body.length) {
    const hidden = spanEndAt(spans, index);
    if (hidden >= 0) {
      index = hidden;
      continue;
    }
    if (body.startsWith("/*", index)) {
      const close = body.indexOf("*/", index + 2);
      index = close < 0 ? body.length : close + 2;
      continue;
    }
    if (body.startsWith("//", index)) {
      const line = body.indexOf("\n", index);
      index = line < 0 ? body.length : line + 1;
      continue;
    }
    if (body[index] === "/" && regexCanStart(body, index)) {
      const next = skipRegex(body, index);
      index = next > index ? next : index + 1;
      continue;
    }
    const ident = readIdentifier(body, index);
    if (!ident || ident.end <= index) {
      index += 1;
      continue;
    }
    const identStart = ident.end - ident.value.length;
    if (aliases.has(ident.value) && !memberReceiver(body, identStart)) {
      if (pluginAccess(body, ident.end)) return true;
      if (
        bareReceiver(body, ident.end) &&
        pullsPluginBinding(body, identStart, aliases)
      ) {
        return true;
      }
    }
    index = ident.end;
  }
  return false;
}

/** `mock.module(...)` replaces the file `sourceGraph` would otherwise trust. */
function mockModuleCall(body: string, moduleAt: number): boolean {
  let cursor = moduleAt - 1;
  while (cursor >= 0 && /\s/.test(body[cursor] ?? "")) cursor -= 1;
  if (body[cursor] !== ".") return false;
  cursor -= 1;
  if (body[cursor] === "?") cursor -= 1;
  while (cursor >= 0 && /\s/.test(body[cursor] ?? "")) cursor -= 1;
  if (wordEndingAt(body, cursor)?.value !== "mock") return false;
  const after = skipSpaceAndComments(body, moduleAt + "module".length);
  return body[after] === "(";
}

/** A `mock.module` call. Comments, strings, and other receivers do not count. */
export function mockModuleRegistration(body: string): boolean {
  const spans = stringSpans(body);
  let index = 0;
  while (index < body.length) {
    const hidden = spanEndAt(spans, index);
    if (hidden >= 0) {
      index = hidden;
      continue;
    }
    if (body.startsWith("/*", index)) {
      const close = body.indexOf("*/", index + 2);
      index = close < 0 ? body.length : close + 2;
      continue;
    }
    if (body.startsWith("//", index)) {
      const line = body.indexOf("\n", index);
      index = line < 0 ? body.length : line + 1;
      continue;
    }
    if (body[index] === "/" && regexCanStart(body, index)) {
      const next = skipRegex(body, index);
      index = next > index ? next : index + 1;
      continue;
    }
    const ident = readIdentifier(body, index);
    if (!ident || ident.end <= index) {
      index += 1;
      continue;
    }
    if (ident.value === "module" && mockModuleCall(body, ident.end - ident.value.length)) {
      return true;
    }
    index = ident.end;
  }
  return false;
}
