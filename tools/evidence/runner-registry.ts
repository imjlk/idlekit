import {
  localRanges,
  locallyBound,
  readDirectCallback,
  readIdentifier,
  readTestTitle,
  regexCanStart,
  skipEachTable,
  skipPair,
  skipQuoted,
  skipRegex,
  skipSpaceAndComments,
  skipTemplateLiteral,
  skipWhitespace,
  spanEndAt,
  stringSpans,
} from "./lex";
import {
  aliasAt,
  assignmentAt,
  findBindingEquals,
  isFunctionValue,
  isRunnerKind,
  namespaceRunnerMember,
  readDestructuredRunnerImport,
  readDottedModifiers,
  readImportRunnerAliases,
  readRunnerRef,
  titleCallAt,
  type Registration,
  type RunnerAlias,
  type RunnerKind,
} from "./runner-bind";

/** Every `it`/`test` title in this source, including ones inside a false condition. */
function collectRegistrations(
  body: string,
  unresolved: string[] = [],
  prefix: readonly string[] = [],
  expanding?: Set<string>,
  lookupSource?: string,
): Registration[] {
  const source = lookupSource ?? body;
  const ranges = localRanges(body);
  const found: Registration[] = [];
  const stack: { title: string; depth: number }[] = [];
  const aliases: RunnerAlias[] = [];
  const rewritten = new Set<string>();
  const forParens: number[] = [];
  let depth = 0;
  let parens = 0;
  let pending: { title: string; parens: number } | undefined;
  let index = 0;
  let inTemplate = false;
  const templateCloseDepths: number[] = [];

  const pushPending = (): void => {
    if (!pending) return;
    stack.push({ title: pending.title, depth });
    pending = undefined;
  };

  while (index < body.length) {
    const char = body[index] ?? "";
    if (inTemplate) {
      if (char === "\\") {
        index += 2;
        continue;
      }
      if (char === "$" && body[index + 1] === "{") {
        inTemplate = false;
        templateCloseDepths.push(depth + 1);
        index += 1;
        continue;
      }
      if (char === "`") {
        inTemplate = false;
        index += 1;
        continue;
      }
      index += 1;
      continue;
    }
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
      inTemplate = true;
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
      while (aliases.length > 0 && aliases[aliases.length - 1]?.depth === depth) aliases.pop();
      const closedDepth = depth;
      depth = Math.max(0, depth - 1);
      if (templateCloseDepths.at(-1) === closedDepth) {
        templateCloseDepths.pop();
        inTemplate = true;
      }
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
      if (forParens.at(-1) === parens) forParens.pop();
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
    if (word.value === "for") {
      let next = skipSpaceAndComments(body, word.end);
      const ahead = readIdentifier(body, next);
      if (ahead?.value === "await") next = skipSpaceAndComments(body, ahead.end);
      if (body[next] === "(") forParens.push(parens);
      index = word.end;
      continue;
    }
    if (word.value === "import") {
      const imported = readImportRunnerAliases(body, word.end);
      if (imported) {
        for (const entry of imported.entries) {
          aliases.push({ name: entry.name, kind: entry.kind, modifiers: [], depth });
        }
        for (const name of imported.namespaces) {
          aliases.push({ name, kind: undefined, modifiers: [], depth, namespace: true });
        }
        index = imported.end;
        continue;
      }
      index = word.end;
      continue;
    }
    if (word.value === "const" || word.value === "let" || word.value === "var") {
      let bindingAt = skipSpaceAndComments(body, word.end);
      const bindingDepth = forParens.length > 0 ? depth + 1 : depth;
      for (;;) {
        if (body[bindingAt] === "{") {
          const destructured = readDestructuredRunnerImport(body, bindingAt);
          if (!destructured) break;
          for (const entry of destructured.entries) {
            aliases.push({
              name: entry.name,
              kind: entry.kind,
              modifiers: [],
              depth: bindingDepth,
            });
          }
          bindingAt = skipSpaceAndComments(body, destructured.end);
          if (body[bindingAt] !== ",") break;
          bindingAt = skipSpaceAndComments(body, bindingAt + 1);
          continue;
        }
        if (body[bindingAt] === "[") break;
        const ident = readIdentifier(body, bindingAt);
        if (!ident) break;
        const after = skipSpaceAndComments(body, ident.end);
        let equalsAt = after;
        if (body[after] === ":") {
          const found = findBindingEquals(body, after + 1);
          if (found < 0) {
            aliases.push({
              name: ident.value,
              kind: undefined,
              modifiers: [],
              depth: bindingDepth,
            });
            break;
          }
          equalsAt = found;
        }
        if (body[equalsAt] !== "=") {
          aliases.push({ name: ident.value, kind: undefined, modifiers: [], depth: bindingDepth });
          break;
        }
        const ref = readRunnerRef(body, equalsAt + 1, aliases);
        if (!ref && isFunctionValue(body, equalsAt + 1)) {
          if (isRunnerKind(ident.value)) {
            aliases.push({
              name: ident.value,
              kind: undefined,
              modifiers: [],
              depth: bindingDepth,
            });
          }
          break;
        }
        aliases.push({
          name: ident.value,
          kind: ref?.kind,
          modifiers: ref?.modifiers ?? [],
          depth: bindingDepth,
        });
        if (!ref) break;
        bindingAt = skipSpaceAndComments(body, ref.end);
        if (body[bindingAt] !== ",") break;
        bindingAt = skipSpaceAndComments(body, bindingAt + 1);
      }
      index = word.end;
      continue;
    }
    const alias = aliasAt(aliases, word.value);
    const assigned = assignmentAt(body, word.end);
    if (assigned && alias) {
      const ref = assigned.plain ? readRunnerRef(body, assigned.at + 1, aliases) : undefined;
      aliases.push({
        name: word.value,
        kind: ref?.kind,
        modifiers: ref?.modifiers ?? [],
        depth: forParens.length > 0 ? depth + 1 : depth,
      });
      index = word.end;
      continue;
    }
    if (assigned && !locallyBound(ranges, word.value, index)) rewritten.add(word.value);
    let callFrom = word.end;
    let kind: RunnerKind | undefined;
    let modifiers: string[] = [];
    if (alias?.namespace) {
      const member = namespaceRunnerMember(body, word.end);
      if (!member) {
        if (optionalNamespaceRunner(body, word.end)) unresolved.push(word.value);
        index = word.end;
        continue;
      }
      kind = member.kind;
      callFrom = member.end;
    } else if (alias) {
      if (alias.kind) {
        kind = alias.kind;
        modifiers = [...alias.modifiers];
      }
    } else if (isRunnerKind(word.value)) {
      kind = word.value;
    }
    if (!kind) {
      if (alias && titleCallAt(body, word.end)) unresolved.push(word.value);
      index = word.end;
      continue;
    }
    const dotted = readDottedModifiers(body, callFrom, modifiers);
    if (dotted < 0) {
      unresolved.push(word.value);
      index = word.end;
      continue;
    }
    const parameterized = modifiers.includes("each");
    let open = skipWhitespace(body, dotted);
    if (parameterized) {
      const tableEnd = skipEachTable(body, dotted);
      if (tableEnd < 0) {
        index = word.end;
        continue;
      }
      open = skipWhitespace(body, tableEnd);
    }
    if (body[open] !== "(") {
      const optional =
        optionalRunnerCall(body, open) || optionalCallAfterGrouping(body, open);
      if (isIndirectInvoke(body, index) || closesThenCalls(body, open) || optional) {
        unresolved.push(word.value);
      }
      index = word.end;
      continue;
    }
    const quoted = readTestTitle(body, open + 1);
    if (!quoted) {
      unresolved.push(word.value);
      index = word.end;
      continue;
    }
    if (kind === "describe") {
      const comma = skipWhitespace(body, quoted.end);
      const named = body[comma] === "," ? readDirectCallback(body, comma + 1) : undefined;
      if (named) {
        const suites = [...prefix, ...stack.map((frame) => frame.title)];
        if (pending) suites.push(pending.title);
        suites.push(quoted.value);
        const seen = expanding ?? new Set<string>();
        const hidden = locallyBound(ranges, named.value, named.at);
        if (hidden || seen.has(named.value)) unresolved.push(named.value);
        else {
          const block = namedCallbackBody(source, named.value);
          if (!block) unresolved.push(named.value);
          else {
            seen.add(named.value);
            found.push(...collectRegistrations(block, unresolved, suites, seen, source));
            seen.delete(named.value);
          }
        }
      } else {
        pending = { title: quoted.value, parens };
      }
    } else {
      const comma = skipWhitespace(body, quoted.end);
      const callback = body[comma] === "," ? readDirectCallback(body, comma + 1) : undefined;
      const suites = [...prefix, ...stack.map((frame) => frame.title)];
      if (pending) suites.push(pending.title);
      const visible =
        callback !== undefined &&
        !locallyBound(ranges, callback.value, callback.at) &&
        !rewritten.has(callback.value);
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

/** Title calls through a binding that is not `it`, `test`, or `describe`. */
export function unresolvedRunnerCalls(body: string): string[] {
  const unresolved: string[] = [];
  collectRegistrations(body, unresolved);
  return unresolved;
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

/**
 * Suite or title text that itself contains ` > `. Bun encodes that the same way as
 * the nesting separator, and reversing the classname can credit a different callback.
 */
export function ambiguousSuiteSeparators(bodies: readonly string[]): string[] {
  const found: string[] = [];
  for (const body of bodies) {
    for (const registration of collectRegistrations(body)) {
      for (const suite of registration.suites) {
        if (suite.includes(" > ") && !found.includes(suite)) found.push(suite);
      }
      if (registration.title.includes(" > ") && !found.includes(registration.title)) {
        found.push(registration.title);
      }
    }
  }
  return found;
}

export function registersNamedTest(body: string, registeredAs: string, exportName: string): boolean {
  const parts = registeredAs.split(" > ");
  const title = parts.at(-1);
  if (!title) return false;
  const suites = parts.slice(0, -1);
  return registeredSuites(body, exportName, title).some(
    (path) => path.length === suites.length && path.every((suite, index) => suite === suites[index]),
  );
}

/** Return type, stopping at the function body `{` or an arrow `=>`. */
function skipReturnType(source: string, index: number): number {
  let cursor = skipSpaceAndComments(source, index);
  while (cursor < source.length) {
    const char = source[cursor] ?? "";
    if (char === "'" || char === '"') {
      cursor = skipQuoted(source, cursor);
      continue;
    }
    if (char === "`") {
      const end = skipTemplateLiteral(source, cursor);
      if (end < 0) return -1;
      cursor = end;
      continue;
    }
    if (char === "/" && source[cursor + 1] === "/") {
      const line = source.indexOf("\n", cursor);
      cursor = line < 0 ? source.length : line + 1;
      continue;
    }
    if (char === "/" && source[cursor + 1] === "*") {
      const close = source.indexOf("*/", cursor + 2);
      cursor = close < 0 ? source.length : close + 2;
      continue;
    }
    if (char === "(" || char === "[" || char === "<") {
      const end = skipPair(source, cursor);
      if (end < 0) return -1;
      cursor = end;
      continue;
    }
    if (char === "{") {
      const end = skipPair(source, cursor);
      if (end < 0) return -1;
      const after = skipSpaceAndComments(source, end);
      if (source[after] === "{" || source.startsWith("=>", after)) {
        cursor = after;
        continue;
      }
      return cursor;
    }
    if (source.startsWith("=>", cursor)) return cursor;
    cursor += 1;
  }
  return -1;
}

/** `{ ... }` body of a function or arrow. A braceless arrow has no body to attribute. */
function readFunctionBlock(source: string, index: number, arrow: boolean): string | undefined {
  let cursor = skipSpaceAndComments(source, index);
  if (!arrow) {
    if (source[cursor] === "*") cursor = skipSpaceAndComments(source, cursor + 1);
    const named = readIdentifier(source, cursor);
    const afterName = named ? skipSpaceAndComments(source, named.end) : cursor;
    if (named && source[afterName] === "(") cursor = named.end;
  }
  cursor = skipSpaceAndComments(source, cursor);
  if (source[cursor] === "<") {
    const after = skipPair(source, cursor);
    if (after < 0) return undefined;
    cursor = skipSpaceAndComments(source, after);
  }
  if (source[cursor] !== "(") {
    if (!arrow) return undefined;
    const single = readIdentifier(source, cursor);
    if (!single) return undefined;
    cursor = skipSpaceAndComments(source, single.end);
  } else {
    const close = skipPair(source, cursor);
    if (close < 0) return undefined;
    cursor = skipSpaceAndComments(source, close);
    if (source[cursor] === ":") {
      cursor = skipReturnType(source, cursor + 1);
      if (cursor < 0) return undefined;
    }
  }
  if (arrow) {
    if (!source.startsWith("=>", cursor)) return undefined;
    cursor = skipSpaceAndComments(source, cursor + 2);
  }
  if (source[cursor] !== "{") return undefined;
  const end = skipPair(source, cursor);
  if (end < 0) return undefined;
  return source.slice(cursor, end);
}

function readAssignedFunctionBlock(source: string, index: number): string | undefined {
  let cursor = skipSpaceAndComments(source, index);
  const word = readIdentifier(source, cursor);
  if (word?.value === "async") {
    cursor = skipSpaceAndComments(source, word.end);
    const next = readIdentifier(source, cursor);
    if (next?.value === "function") return readFunctionBlock(source, next.end, false);
    return readFunctionBlock(source, cursor, true);
  }
  if (word?.value === "function") return readFunctionBlock(source, word.end, false);
  return readFunctionBlock(source, cursor, true);
}

/** Body of `function name` or `const name = () => {}` in this source. */
function namedCallbackBody(source: string, name: string): string | undefined {
  const hidden = stringSpans(source);
  let index = 0;
  while (index < source.length) {
    const hiddenEnd = spanEndAt(hidden, index);
    if (hiddenEnd >= 0) {
      index = hiddenEnd;
      continue;
    }
    const word = readIdentifier(source, index);
    if (!word) {
      index += 1;
      continue;
    }
    const start = word.end - word.value.length;
    if (start !== index) {
      index = start;
      continue;
    }
    const previous = source[index - 1];
    if (previous === "." || (previous !== undefined && /[A-Za-z0-9_$]/.test(previous))) {
      index = word.end;
      continue;
    }
    if (word.value === "function") {
      let next = skipSpaceAndComments(source, word.end);
      if (source[next] === "*") next = skipSpaceAndComments(source, next + 1);
      const ident = readIdentifier(source, next);
      if (ident?.value === name) {
        const block = readFunctionBlock(source, ident.end, false);
        if (block) return block;
      }
      index = word.end;
      continue;
    }
    if (word.value === "async") {
      const next = skipSpaceAndComments(source, word.end);
      const fn = readIdentifier(source, next);
      if (fn?.value === "function") {
        let nameAt = skipSpaceAndComments(source, fn.end);
        if (source[nameAt] === "*") nameAt = skipSpaceAndComments(source, nameAt + 1);
        const ident = readIdentifier(source, nameAt);
        if (ident?.value === name) {
          const block = readFunctionBlock(source, ident.end, false);
          if (block) return block;
        }
      }
      index = word.end;
      continue;
    }
    if (word.value === "const" || word.value === "let" || word.value === "var") {
      const ident = readIdentifier(source, skipSpaceAndComments(source, word.end));
      if (ident?.value === name) {
        const eq = skipSpaceAndComments(source, ident.end);
        if (source[eq] === "=") {
          const block = readAssignedFunctionBlock(source, eq + 1);
          if (block) return block;
        }
      }
      index = word.end;
      continue;
    }
    index = word.end;
  }
  return undefined;
}

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

function isGroupedBinding(body: string, openParen: number): boolean {
  const equalsAt = previousCodeIndex(body, openParen);
  if (equalsAt < 0 || body[equalsAt] !== "=") return false;
  if (body[equalsAt + 1] === "=" || body[equalsAt + 1] === ">") return false;
  const left = previousCodeIndex(body, equalsAt);
  if (left < 0) return false;
  const mark = body[left] ?? "";
  return !"=!<>+-*/%&|^?".includes(mark);
}

function wordEndingAt(body: string, index: number): { value: string; start: number } | undefined {
  if (!/[A-Za-z0-9_$]/.test(body[index] ?? "")) return undefined;
  let start = index;
  while (start > 0 && /[A-Za-z0-9_$]/.test(body[start - 1] ?? "")) start -= 1;
  return { value: body.slice(start, index + 1), start };
}

function callOpenBefore(body: string, index: number): number {
  let depth = 0;
  for (let cursor = index; cursor >= 0; cursor -= 1) {
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
    if (char === ")" || char === "}" || char === "]") {
      depth += 1;
      continue;
    }
    if (char === "(" || char === "{" || char === "[") {
      if (depth === 0) return char === "(" ? cursor : -1;
      depth -= 1;
    }
  }
  return -1;
}

/** A `.` / `?.` chain that reaches a call parenthesis. */
function callChainHasParen(body: string, index: number): boolean {
  let cursor = skipWhitespace(body, index);
  let sawCall = false;
  while (cursor < body.length) {
    const char = body[cursor] ?? "";
    if (char === "(" || char === "[") {
      const close = skipPair(body, cursor);
      if (close < 0) return false;
      if (char === "(") sawCall = true;
      cursor = skipWhitespace(body, close);
      continue;
    }
    if (char === "?" && body[cursor + 1] === ".") {
      cursor = skipWhitespace(body, cursor + 2);
      continue;
    }
    if (char === ".") {
      cursor = skipWhitespace(body, cursor + 1);
      continue;
    }
    if (/[A-Za-z_$]/.test(char)) {
      const ident = readIdentifier(body, cursor);
      if (!ident) return false;
      cursor = skipWhitespace(body, ident.end);
      continue;
    }
    break;
  }
  return sawCall;
}

/** `it?.("title", callback)` and `it?.failing("title", callback)` still run the test. */
function optionalRunnerCall(body: string, index: number): boolean {
  const cursor = skipWhitespace(body, index);
  if (body[cursor] !== "?" || body[cursor + 1] !== ".") return false;
  return callChainHasParen(body, cursor);
}

/** `(it)?.("title", callback)` after the grouped runner reference. */
function optionalCallAfterGrouping(body: string, index: number): boolean {
  let cursor = index;
  if (body[cursor] !== ")") return false;
  while (body[cursor] === ")") cursor = skipWhitespace(body, cursor + 1);
  return optionalRunnerCall(body, cursor);
}

/** `runner?.it("title", callback)` on a namespace import. Other members stay ignored. */
function optionalNamespaceRunner(body: string, index: number): boolean {
  const cursor = skipWhitespace(body, index);
  if (body[cursor] !== "?" || body[cursor + 1] !== ".") return false;
  const member = readIdentifier(body, skipWhitespace(body, cursor + 2));
  if (!member || !isRunnerKind(member.value)) return false;
  return callChainHasParen(body, member.end);
}

/** `(it)("title", callback)` and `((it.failing))("title", callback)` still invoke the runner. */
function closesThenCalls(body: string, index: number): boolean {
  let cursor = index;
  let closes = 0;
  while (cursor < body.length && body[cursor] === ")") {
    closes += 1;
    cursor = skipWhitespace(body, cursor + 1);
  }
  return closes > 0 && body[cursor] === "(";
}

/**
 * `Reflect.apply(it, ...)` and `obj.apply(it, ...)` run a runner without calling it.
 * `wrap(it)` only passes the binding onward, which the alias scan already rejects.
 */
function isIndirectInvoke(body: string, wordStart: number): boolean {
  const word = readIdentifier(body, wordStart);
  if (!word) return false;
  if (body[skipSpaceAndComments(body, word.end)] === ":") return false;
  const prevAt = previousCodeIndex(body, wordStart);
  if (prevAt < 0) return false;
  const prev = body[prevAt] ?? "";
  let open = -1;
  if (prev === "(") open = prevAt;
  else if (prev === ",") open = callOpenBefore(body, prevAt);
  if (open < 0 || isGroupedBinding(body, open)) return false;
  const methodAt = previousCodeIndex(body, open);
  const method = methodAt < 0 ? undefined : wordEndingAt(body, methodAt);
  if (!method) return false;
  const indirectMethod =
    method.value === "apply" ||
    method.value === "call" ||
    method.value === "bind" ||
    method.value === "construct";
  if (!indirectMethod) return false;
  const dot = previousCodeIndex(body, method.start);
  return dot >= 0 && body[dot] === ".";
}
