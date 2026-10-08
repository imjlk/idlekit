import {
  localRanges,
  locallyBound,
  readDirectCallback,
  readIdentifier,
  readQuoted,
  readStaticTemplate,
  readTestTitle,
  regexCanStart,
  skipEachTable,
  skipPair,
  skipQuoted,
  skipRegex,
  skipSpaceAndComments,
  skipTemplateLiteral,
  skipWhitespace,
  insideSpan,
  spanEndAt,
  stringSpans,
  wordBefore,
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
  readDirectModuleRunner,
  readRunnerNamespaceValue,
  readRunnerRef,
  titleCallAt,
  type Registration,
  type RunnerAlias,
  type RunnerKind,
} from "./runner-bind";

function skipObjectValue(body: string, index: number, limit: number): number {
  let cursor = index;
  let depth = 0;
  while (cursor < limit) {
    const char = body[cursor] ?? "";
    if (char === "'" || char === '"') {
      const quoted = readQuoted(body, cursor);
      cursor = quoted ? quoted.end : cursor + 1;
      continue;
    }
    if (char === "`") {
      const end = skipTemplateLiteral(body, cursor);
      cursor = end < 0 ? cursor + 1 : end;
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

/**
 * `{ ...{ run: it } }`, `{ ...runners }`, and `{ ...bt }` store a runner when the
 * operand is a literal that holds one, a binding already known to hold one, or a
 * runner namespace. `{ ...state }` of ordinary data is not a runner.
 */
function spreadStoresRunner(
  body: string,
  dots: number,
  aliases: readonly RunnerAlias[],
): boolean {
  let operand = skipSpaceAndComments(body, dots + 3);
  while (body[operand] === "(") operand = skipSpaceAndComments(body, operand + 1);
  const grouped = body[operand] === "{" || body[operand] === "[";
  if (grouped) return valueHoldsRunner(body, operand, aliases);
  const ident = readIdentifier(body, operand);
  if (!ident) return false;
  // Spreading a function copies no callable, so `...it` or a local `test` stores no
  // runner. A bare binding that holds runners as properties, or a runner namespace,
  // does. `...runners.seeds`, `...runners?.seeds`, and `...make()` spread other data.
  let after = skipSpaceAndComments(body, ident.end);
  // `hidden!`, `hidden as Runners`, and `hidden satisfies Runners` still spread `hidden`.
  if (body[after] === "!") after = skipSpaceAndComments(body, after + 1);
  const keyword = readIdentifier(body, after);
  if (keyword?.value === "as" || keyword?.value === "satisfies") return bareRunnerBinding(ident.value, aliases);
  const bare = after >= body.length || ",}])".includes(body[after] ?? "");
  if (!bare) return false;
  return bareRunnerBinding(ident.value, aliases);
}

function bareRunnerBinding(name: string, aliases: readonly RunnerAlias[]): boolean {
  const alias = aliasAt(aliases, name);
  return alias?.objectRunner === true || alias?.namespace === true;
}

/** An array or object element that stores a runner, including one nested inside. */
function valueHoldsRunner(
  body: string,
  at: number,
  aliases: readonly RunnerAlias[],
): boolean {
  const cursor = skipSpaceAndComments(body, at);
  if (body[cursor] === "[") return arrayHoldsRunner(body, cursor, aliases);
  if (body[cursor] === "{") return objectHoldsRunner(body, cursor, aliases);
  return readRunnerRef(body, at, aliases) !== undefined;
}

/** `[it]` or `[register]` keeps a runner behind an index call. */
function arrayHoldsRunner(
  body: string,
  open: number,
  aliases: readonly RunnerAlias[],
): boolean {
  const bracket = skipSpaceAndComments(body, open);
  if (body[bracket] !== "[") return false;
  const close = skipBracketGroup(body, bracket);
  if (close < 0) return false;
  let index = bracket + 1;
  while (index < close - 1) {
    index = skipSpaceAndComments(body, index);
    if (index >= close - 1) return false;
    if (body[index] === ",") {
      index += 1;
      continue;
    }
    if (body.startsWith("...", index)) {
      if (spreadStoresRunner(body, index, aliases)) return true;
      index = skipObjectValue(body, index + 3, close);
      continue;
    }
    if (valueHoldsRunner(body, index, aliases)) return true;
    index = skipObjectValue(body, index, close);
  }
  return false;
}

/** `{ it }` or `{ run: it }` keeps a runner behind a property access. */
function objectHoldsRunner(
  body: string,
  open: number,
  aliases: readonly RunnerAlias[],
): boolean {
  const brace = skipSpaceAndComments(body, open);
  if (body[brace] !== "{") return false;
  const close = skipPair(body, brace);
  if (close < 0) return false;
  const methods = new Map(localRanges(body, "objectMethods").map(([, start, end]) => [start, end]));
  let index = brace + 1;
  while (index < close - 1) {
    index = skipSpaceAndComments(body, index);
    if (index >= close - 1) return false;
    const methodEnd = methods.get(index);
    if (methodEnd !== undefined) {
      index = methodEnd;
      continue;
    }
    if (body[index] === ",") {
      index += 1;
      continue;
    }
    if (body.startsWith("...", index)) {
      if (spreadStoresRunner(body, index, aliases)) return true;
      index = skipObjectValue(body, index + 3, close);
      continue;
    }
    if (body[index] === "[") {
      const bracketEnd = skipObjectValue(body, index + 1, close);
      index = body[bracketEnd] === "]" ? bracketEnd + 1 : bracketEnd;
      index = skipSpaceAndComments(body, index);
      if (body[index] !== ":") continue;
      if (valueHoldsRunner(body, index + 1, aliases)) return true;
      index = skipObjectValue(body, index + 1, close);
      continue;
    }
    if (body[index] === "'" || body[index] === '"') {
      const quoted = readQuoted(body, index);
      index = quoted ? quoted.end : index + 1;
      index = skipSpaceAndComments(body, index);
      if (body[index] !== ":") continue;
      if (valueHoldsRunner(body, index + 1, aliases)) return true;
      index = skipObjectValue(body, index + 1, close);
      continue;
    }
    const ident = readIdentifier(body, index);
    if (!ident || ident.end > close) {
      index += 1;
      continue;
    }
    const after = skipSpaceAndComments(body, ident.end);
    if (body[after] === "(") {
      const end = skipPair(body, after);
      index = end < 0 ? after + 1 : end;
      continue;
    }
    if (body[after] === ":") {
      if (valueHoldsRunner(body, after + 1, aliases)) return true;
      index = skipObjectValue(body, after + 1, close);
      continue;
    }
    if (readRunnerRef(body, ident.end - ident.value.length, aliases)) return true;
    index = ident.end;
  }
  return false;
}

/** `carrier.run = it` and `carrier["run"] = it` store a runner behind a property. */
function propertyAssignedRunner(
  body: string,
  index: number,
  aliases: readonly RunnerAlias[],
): boolean {
  let cursor = skipSpaceAndComments(body, index);
  let sawProperty = false;
  while (cursor < body.length) {
    if (body[cursor] === ".") {
      const member = readIdentifier(body, skipSpaceAndComments(body, cursor + 1));
      if (!member) return false;
      sawProperty = true;
      cursor = skipSpaceAndComments(body, member.end);
      continue;
    }
    if (body[cursor] === "[") {
      const close = skipBracketGroup(body, cursor);
      if (close < 0) return false;
      sawProperty = true;
      cursor = skipSpaceAndComments(body, close);
      continue;
    }
    break;
  }
  if (!sawProperty) return false;
  const assigned = assignmentAt(body, cursor);
  if (assigned?.plain !== true) return false;
  return valueHoldsRunner(body, assigned.at + 1, aliases);
}

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
  const parameters = new Map<number, Array<[string, number, boolean]>>();
  const typeAnnotations = new Map<number, number>();
  const typedBindingEquals = new Set<number>();
  const enumValues = localRanges(body, "enumValues");
  for (const [, start, end] of localRanges(body, "annotations")) typeAnnotations.set(start, end);
  for (const mode of ["bindings", "parameters", "classes", "functions", "destructuring"] as const) {
    for (const [name, start, end] of localRanges(body, mode)) {
      const entries = parameters.get(start) ?? [];
      entries.push([name, end, mode === "classes" || mode === "functions"]);
      parameters.set(start, entries);
    }
  }
  const found: Registration[] = [];
  const stack: { title: string; depth: number }[] = [];
  const aliases: RunnerAlias[] = [];
  const rewritten = new Set<string>();
  const reboundSuites = new Set<string>();
  const forParens: number[] = [];
  const classDepths: number[] = [];
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
    for (let cursor = aliases.length - 1; cursor >= 0; cursor -= 1) {
      const end = aliases[cursor]?.scopeEnd;
      if (end !== undefined && index >= end) aliases.splice(cursor, 1);
    }
    for (const [name, end, nonRunner] of parameters.get(index) ?? []) {
      aliases.push({ name, kind: undefined, modifiers: [], depth: -1, scopeEnd: end, nonRunner });
    }
    const annotationEnd = typeAnnotations.get(index);
    if (annotationEnd !== undefined) {
      index = annotationEnd;
      continue;
    }
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
      const classBody = opensClassBody(body, index);
      depth += 1;
      if (classBody) classDepths.push(depth);
      pushPending();
      index += 1;
      continue;
    }
    if (char === "}") {
      while (stack.length > 0 && stack[stack.length - 1]?.depth === depth) stack.pop();
      for (let cursor = aliases.length - 1; cursor >= 0; cursor -= 1) {
        if (aliases[cursor]?.depth === depth) aliases.splice(cursor, 1);
      }
      const closedDepth = depth;
      if (classDepths.at(-1) === closedDepth) classDepths.pop();
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
    if (char === "=" && body[index + 1] === ">") {
      if (arrowReturnsRunner(body, index + 2, aliases)) unresolved.push("return");
      index += 2;
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
    if (
      dynamicCodeName(word.value) &&
      wordBefore(body, index) !== "function" &&
      dynamicCodeCall(body, word.end)
    ) {
      unresolved.push(word.value);
      index = word.end;
      continue;
    }
    if (previous === "." || (previous !== undefined && /[A-Za-z0-9_$]/.test(previous))) {
      index = word.end;
      continue;
    }
    if (propertyAssignedRunner(body, word.end, aliases)) {
      unresolved.push(word.value);
      index = word.end;
      continue;
    }
    if (
      classFieldHoldsRunner(body, index, word.end, classDepths.at(-1) === depth, aliases)
    ) {
      unresolved.push(word.value);
    }
    if (word.value === "return" && returnedRunnerValue(body, word.end, aliases)) {
      unresolved.push(word.value);
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
          aliases.push({
            name,
            kind: undefined,
            modifiers: [],
            depth,
            namespace: true,
            spec: imported.moduleSpec,
          });
        }
        for (const name of imported.opaque ?? []) {
          aliases.push({ name, kind: undefined, modifiers: [], depth });
        }
        index = imported.end;
        continue;
      }
      if (!readDirectModuleRunner(body, index)) {
        index = word.end;
        continue;
      }
    }
    if (word.value === "const" || word.value === "let" || word.value === "var") {
      let bindingAt = skipSpaceAndComments(body, word.end);
      const bindingDepth = forParens.length > 0 ? depth + 1 : depth;
      for (;;) {
        if (body[bindingAt] === "{") {
          const destructured = readDestructuredRunnerImport(body, bindingAt, aliases);
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
          typeAnnotations.set(after, found);
          typedBindingEquals.add(found);
        }
        if (body[equalsAt] !== "=") {
          aliases.push({ name: ident.value, kind: undefined, modifiers: [], depth: bindingDepth });
          break;
        }
        const namespace = readRunnerNamespaceValue(body, equalsAt + 1);
        if (namespace) {
          aliases.push({
            name: ident.value,
            kind: undefined,
            modifiers: [],
            depth: bindingDepth,
            namespace: true,
            spec: namespace.spec,
          });
          bindingAt = skipSpaceAndComments(body, namespace.end);
          if (body[bindingAt] !== ",") break;
          bindingAt = skipSpaceAndComments(body, bindingAt + 1);
          continue;
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
          objectRunner:
            !ref &&
            (objectHoldsRunner(body, equalsAt + 1, aliases) ||
              arrayHoldsRunner(body, equalsAt + 1, aliases)),
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
    const storedRunner =
      assigned?.plain === true &&
      (objectHoldsRunner(body, assigned.at + 1, aliases) ||
        arrayHoldsRunner(body, assigned.at + 1, aliases));
    if (storedRunner) {
      aliases.push({
        name: word.value,
        kind: undefined,
        modifiers: [],
        depth: forParens.length > 0 ? depth + 1 : depth,
        scopeEnd: alias?.scopeEnd,
        objectRunner: true,
      });
      index = word.end;
      continue;
    }
    if (assigned && alias) {
      const ref = assigned.plain ? readRunnerRef(body, assigned.at + 1, aliases) : undefined;
      const namespace =
        !ref && assigned.plain ? readRunnerNamespaceValue(body, assigned.at + 1) : undefined;
      const next: RunnerAlias = {
        name: word.value,
        kind: ref?.kind,
        modifiers: ref?.modifiers ?? [],
        depth: forParens.length > 0 ? depth + 1 : depth,
        scopeEnd: alias.scopeEnd,
      };
      if (namespace) {
        next.namespace = true;
        next.spec = namespace.spec;
      }
      aliases.push(next);
      index = word.end;
      continue;
    }
    if (assigned && !locallyBound(ranges, word.value, index)) {
      rewritten.add(word.value);
      if (!declaratorInitializer(body, index)) reboundSuites.add(word.value);
    }
    let callFrom = word.end;
    let kind: RunnerKind | undefined;
    let modifiers: string[] = [];
    const direct =
      word.value === "require" || word.value === "import" || word.value === "await"
        ? readDirectModuleRunner(body, index)
        : undefined;
    if (direct) {
      kind = direct.kind;
      callFrom = direct.callFrom;
    } else if (alias?.objectRunner) {
      const next = skipSpaceAndComments(body, word.end);
      const member =
        body.startsWith("?.", next) || body[next] === "." || body[next] === "[";
      if (member) unresolved.push(word.value);
    } else if (alias?.namespace) {
      const member = namespaceRunnerMember(body, word.end, alias.spec);
      if (!member) {
        const reflected =
          !recognizedNamespaceMember(body, word.end) &&
          !optionalNamespaceRunner(body, word.end) &&
          !bracketNamespaceRunner(body, word.end) &&
          !destructuredNamespaceSource(body, index, aliases);
        if (
          optionalNamespaceRunner(body, word.end) ||
          bracketNamespaceRunner(body, word.end) ||
          reflected
        ) {
          unresolved.push(word.value);
        }
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
      if (alias && !alias.nonRunner && titleCallAt(body, word.end)) unresolved.push(word.value);
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
      const forwarded = passedAsArgument(body, index, open);
      const storedOnProperty =
        !typedBindingEquals.has(previousCodeIndex(body, index)) && assignedToProperty(body, index);
      const storedOnField = assignedToClassField(body, index, classDepths.at(-1) === depth);
      const returned = returnedFromFunction(body, index);
      const storedInEnum = enumValues.some(([, start, end]) => index >= start && index < end);
      if (
        isIndirectInvoke(body, index) ||
        closesThenCalls(body, open) ||
        optional ||
        forwarded ||
        storedOnProperty ||
        storedOnField ||
        storedInEnum ||
        returned
      ) {
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
    // Bun printf-formats `.each` titles, so a `%` title is not the JUnit name.
    if (parameterized && quoted.value.includes("%")) {
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
        const rebound = reboundSuites.has(named.value);
        if (hidden || seen.has(named.value) || rebound) unresolved.push(named.value);
        else {
          const block = namedCallbackBody(source, named.value);
          if (!block) unresolved.push(named.value);
          else {
            seen.add(named.value);
            found.push(...collectRegistrations(block, unresolved, suites, seen, source));
            seen.delete(named.value);
          }
        }
      } else if (body[comma] !== "," || isFunctionValue(body, comma + 1)) {
        pending = { title: quoted.value, parens };
      } else {
        unresolved.push(word.value);
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

// Keyed by source text. The inventory asks the same questions of the same core
// modules for every command; a body always scans the same way.
const scannedByBody = new Map<string, { found: Registration[]; unresolved: string[] }>();

function scanRegistrations(body: string): { found: Registration[]; unresolved: string[] } {
  const cached = scannedByBody.get(body);
  if (cached) return cached;
  const unresolved: string[] = [];
  const found = collectRegistrations(body, unresolved);
  const scanned = { found, unresolved };
  scannedByBody.set(body, scanned);
  return scanned;
}

/** Title calls through a binding that is not `it`, `test`, or `describe`. */
export function unresolvedRunnerCalls(body: string): string[] {
  return [...scanRegistrations(body).unresolved];
}

/** 1-based lines where this full reporter name is registered. */
export function registrationLines(body: string, registeredAs: string): number[] {
  return scanRegistrations(body).found
    .filter((registration) => {
      const full = [...registration.suites, registration.title].join(" > ");
      return full === registeredAs;
    })
    .map((registration) => registration.line);
}

/** Suite names wrapping this `it`/`test` callback, from the outermost `describe`. */
export function registeredSuites(body: string, exportName: string, title: string): string[][] {
  return scanRegistrations(body).found
    .filter((registration) => registration.callback === exportName && registration.title === title)
    .map((registration) => registration.suites);
}

/** Full `suite > title` names registered more than once across these sources. */
export function duplicateFullNamesAcross(bodies: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const body of bodies) {
    for (const registration of scanRegistrations(body).found) {
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
    for (const registration of scanRegistrations(body).found) {
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

function declaratorInitializer(body: string, nameAt: number): boolean {
  const keywordAt = previousCodeIndex(body, nameAt);
  if (keywordAt < 0) return false;
  const word = wordEndingAt(body, keywordAt);
  if (!word) return false;
  return word.value === "const" || word.value === "let" || word.value === "var";
}

/** A package file hides tests when it registers one, or runs dynamic code. */
export function runnerSignal(body: string): "dynamic" | "registration" | "none" {
  const { found, unresolved } = scanRegistrations(body);
  if (unresolved.some((name) => dynamicCodeName(name))) return "dynamic";
  if (found.length > 0) return "registration";
  return "none";
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

/** Index after the `[]` group at `index`. `skipPair` does not treat brackets as a group. */
function skipBracketGroup(body: string, index: number): number {
  if (body[index] !== "[") return -1;
  let cursor = index + 1;
  let depth = 1;
  while (cursor < body.length && depth > 0) {
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
      const closeComment = body.indexOf("*/", cursor + 2);
      cursor = closeComment < 0 ? body.length : closeComment + 2;
      continue;
    }
    if (char === "/" && regexCanStart(body, cursor)) {
      cursor = skipRegex(body, cursor);
      continue;
    }
    if (char === "[") depth += 1;
    else if (char === "]") depth -= 1;
    cursor += 1;
  }
  return depth === 0 ? cursor : -1;
}

/** `.expect` and `?.expect` name a member. `Reflect.get(runner, "it")` does not. */
function recognizedNamespaceMember(body: string, index: number): boolean {
  let cursor = skipSpaceAndComments(body, index);
  let optional = false;
  if (body[cursor] === "?" && body[cursor + 1] === ".") {
    optional = true;
    cursor = skipSpaceAndComments(body, cursor + 2);
  }
  if (body[cursor] === ".") {
    return readIdentifier(body, skipSpaceAndComments(body, cursor + 1)) !== undefined;
  }
  if (optional && readIdentifier(body, cursor)) return true;
  if (body[cursor] !== "[") return false;
  const keyAt = skipSpaceAndComments(body, cursor + 1);
  const quoted = readQuoted(body, keyAt) ?? readStaticTemplate(body, keyAt);
  if (!quoted) return false;
  return body[skipSpaceAndComments(body, quoted.end)] === "]";
}

/** `const { it } = runner` is already a modeled binding. */
function destructuredNamespaceSource(
  body: string,
  wordStart: number,
  aliases: readonly RunnerAlias[],
): boolean {
  const prevAt = previousCodeIndex(body, wordStart);
  if (prevAt < 0 || body[prevAt] !== "=") return false;
  if (body[prevAt + 1] === "=" || body[prevAt + 1] === ">") return false;
  const closeAt = previousCodeIndex(body, prevAt);
  if (closeAt < 0 || body[closeAt] !== "}") return false;
  const open = braceOpenBefore(body, closeAt);
  if (open < 0) return false;
  const parsed = readDestructuredRunnerImport(body, open, aliases);
  if (!parsed) return false;
  return parsed.end > wordStart;
}

function braceOpenBefore(body: string, close: number): number {
  let depth = 0;
  for (let cursor = close; cursor >= 0; cursor -= 1) {
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
    if (char === "}") {
      depth += 1;
      continue;
    }
    if (char === "{") {
      depth -= 1;
      if (depth === 0) return cursor;
    }
  }
  return -1;
}

/** `runner["it"](...)` and `runner[name](...)`. A static non-runner member stays ignored. */
function bracketNamespaceRunner(body: string, index: number): boolean {
  let cursor = skipWhitespace(body, index);
  if (body[cursor] === "?" && body[cursor + 1] === ".") {
    cursor = skipWhitespace(body, cursor + 2);
  }
  if (body[cursor] !== "[") return false;
  const keyAt = skipWhitespace(body, cursor + 1);
  const quoted = readQuoted(body, keyAt) ?? readStaticTemplate(body, keyAt);
  if (quoted && body[skipWhitespace(body, quoted.end)] === "]" && !isRunnerKind(quoted.value)) {
    return false;
  }
  const close = skipBracketGroup(body, cursor);
  if (close < 0) return false;
  return callChainHasParen(body, close);
}

/** `runner?.it("title", callback)` on a namespace import. Other members stay ignored. */
function optionalNamespaceRunner(body: string, index: number): boolean {
  const cursor = skipWhitespace(body, index);
  if (body[cursor] !== "?" || body[cursor + 1] !== ".") return false;
  const member = readIdentifier(body, skipWhitespace(body, cursor + 2));
  if (!member || !isRunnerKind(member.value)) return false;
  return callChainHasParen(body, member.end);
}

const DYNAMIC_CODE = new Set([
  "Function",
  "compileFunction",
  "eval",
  "runInContext",
  "runInNewContext",
  "runInThisContext",
]);

function dynamicCodeName(name: string): boolean {
  return DYNAMIC_CODE.has(name);
}

/** `(it)("title", callback)` and `((it.failing))("title", callback)` still invoke the runner. */
/** `eval(...)`, `new Function(...)`, `runInNewContext(...)`, and `(eval)(...)`. */
function dynamicCodeCall(body: string, index: number): boolean {
  let cursor = skipSpaceAndComments(body, index);
  if (body[cursor] === "?" && body[cursor + 1] === ".") {
    cursor = skipSpaceAndComments(body, cursor + 2);
  }
  if (body[cursor] === "(") return true;
  return closesThenCalls(body, cursor);
}

function closesThenCalls(body: string, index: number): boolean {
  let cursor = index;
  let closes = 0;
  while (cursor < body.length && body[cursor] === ")") {
    closes += 1;
    cursor = skipWhitespace(body, cursor + 1);
  }
  return closes > 0 && body[cursor] === "(";
}

/** A newline outside a block comment ends `return`. An arrow may cross a newline. */
function lineBreaksReturn(body: string, from: number, to: number): boolean {
  const between = body.slice(from, to);
  let index = 0;
  while (index < between.length) {
    if (between.startsWith("//", index)) return true;
    if (between.startsWith("/*", index)) {
      const close = between.indexOf("*/", index + 2);
      if (close < 0) return true;
      index = close + 2;
      continue;
    }
    if (between[index] === "\n") return true;
    index += 1;
  }
  return false;
}

/** Parenthesized `{ it }` / `[it]` still holds a runner. A call does not. */
function runnerExpression(
  body: string,
  at: number,
  aliases: readonly RunnerAlias[],
): boolean {
  let cursor = skipSpaceAndComments(body, at);
  for (let guard = 0; guard < 4; guard += 1) {
    if (body[cursor] !== "(") break;
    const inner = skipSpaceAndComments(body, cursor + 1);
    const grouped = body[inner] === "{" || body[inner] === "[" || body[inner] === "(";
    if (!grouped) break;
    cursor = inner;
  }
  return valueHoldsRunner(body, cursor, aliases);
}

/** `return it` and `return { it }`. A newline after `return` is a different statement. */
function returnedRunnerValue(
  body: string,
  at: number,
  aliases: readonly RunnerAlias[],
): boolean {
  const valueAt = skipSpaceAndComments(body, at);
  if (lineBreaksReturn(body, at, valueAt)) return false;
  return runnerExpression(body, valueAt, aliases);
}

/** `() => it` returns a runner. `() => { ... }` is a block, not a value. */
function arrowReturnsRunner(
  body: string,
  at: number,
  aliases: readonly RunnerAlias[],
): boolean {
  const cursor = skipSpaceAndComments(body, at);
  if (body[cursor] === "{") return false;
  return runnerExpression(body, cursor, aliases);
}

/** `return it`, `return (it)`, and `() => it`. `const name = it` stays a binding. */
function returnedFromFunction(body: string, wordStart: number): boolean {
  let cursor = wordStart;
  for (let guard = 0; guard < 8; guard += 1) {
    const prev = previousCodeIndex(body, cursor);
    if (prev < 0) return false;
    if (body[prev] === "(") {
      cursor = prev;
      continue;
    }
    if (body[prev] === ">" && prev > 0 && body[prev - 1] === "=") return true;
    const word = wordEndingAt(body, prev);
    if (word?.value !== "return") return false;
    return !lineBreaksReturn(body, prev + 1, cursor);
  }
  return false;
}

const FIELD_MODIFIERS = new Set([
  "abstract",
  "accessor",
  "declare",
  "override",
  "private",
  "protected",
  "public",
  "readonly",
  "static",
]);

/** `{` after `class Name` or `class Name extends Base`. A method body is not a class body. */
function opensClassBody(body: string, braceAt: number): boolean {
  let cursor = braceAt - 1;
  let nested = 0;
  let angles = 0;
  while (cursor >= 0 && braceAt - cursor < 500) {
    const char = body[cursor] ?? "";
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
    if (char === ">" && body[cursor - 1] === "=" && nested === 0 && angles === 0) return false;
    if (char === ">") {
      angles += 1;
      cursor -= 1;
      continue;
    }
    if (char === "<") {
      if (angles > 0) angles -= 1;
      cursor -= 1;
      continue;
    }
    if (char === "=" && nested === 0 && angles === 0) return false;
    if (/[A-Za-z0-9_$]/.test(char)) {
      const word = wordEndingAt(body, cursor);
      if (!word) {
        cursor -= 1;
        continue;
      }
      const headerWord =
        word.value === "function" ||
        word.value === "catch" ||
        word.value === "if" ||
        word.value === "for" ||
        word.value === "while" ||
        word.value === "switch" ||
        word.value === "do";
      if (nested === 0 && headerWord) return false;
      if (nested === 0 && word.value === "class") return true;
      cursor = word.start - 1;
      continue;
    }
    if (char === "}") nested += 1;
    else if (char === "{") {
      if (nested === 0) return false;
      nested -= 1;
    }
    cursor -= 1;
  }
  return false;
}

function hasFieldModifier(body: string, nameStart: number): boolean {
  let cursor = previousCodeIndex(body, nameStart);
  if (cursor < 0) return false;
  if (body[cursor] === "#") return true;
  let saw = false;
  while (cursor >= 0) {
    const word = wordEndingAt(body, cursor);
    if (!word || !FIELD_MODIFIERS.has(word.value)) break;
    saw = true;
    cursor = previousCodeIndex(body, word.start);
    if (cursor >= 0 && body[cursor] === "#") return true;
  }
  return saw;
}

function isClassField(body: string, nameStart: number, inClass: boolean): boolean {
  if (hasFieldModifier(body, nameStart)) return true;
  if (!inClass) return false;
  const before = previousCodeIndex(body, nameStart);
  if (before < 0) return false;
  const mark = body[before] ?? "";
  return mark === "{" || mark === ";" || mark === "}";
}

function fieldNameStart(body: string, lhsEnd: number): number {
  if (body[lhsEnd] === "]") {
    let nested = 1;
    let cursor = lhsEnd - 1;
    while (cursor >= 0 && nested > 0) {
      const char = body[cursor] ?? "";
      if (char === "]") nested += 1;
      else if (char === "[") nested -= 1;
      if (nested === 0) return cursor;
      cursor -= 1;
    }
    return -1;
  }
  const ident = wordEndingAt(body, lhsEnd);
  if (!ident) return -1;
  return ident.start;
}

function classFieldAssignment(body: string, equalsAt: number, inClass: boolean): boolean {
  if (body[equalsAt] !== "=") return false;
  if (body[equalsAt + 1] === "=" || body[equalsAt + 1] === ">") return false;
  const lhsEnd = previousCodeIndex(body, equalsAt);
  if (lhsEnd < 0) return false;
  const nameStart = fieldNameStart(body, lhsEnd);
  if (nameStart < 0) return false;
  return isClassField(body, nameStart, inClass);
}

/** `static run = it` and `class Carrier { run = it }`. `const name = it` stays a binding. */
function assignedToClassField(body: string, wordStart: number, inClass: boolean): boolean {
  let cursor = wordStart;
  for (let guard = 0; guard < 4; guard += 1) {
    const prev = previousCodeIndex(body, cursor);
    if (prev < 0) return false;
    if (body[prev] === "(") {
      cursor = prev;
      continue;
    }
    return classFieldAssignment(body, prev, inClass);
  }
  return false;
}

function classFieldHoldsRunner(
  body: string,
  nameStart: number,
  nameEnd: number,
  inClass: boolean,
  aliases: readonly RunnerAlias[],
): boolean {
  const assigned = assignmentAt(body, nameEnd);
  if (assigned?.plain !== true) return false;
  if (!isClassField(body, nameStart, inClass)) return false;
  return valueHoldsRunner(body, assigned.at + 1, aliases);
}

/** `obj.prop = it` and `obj["prop"] = it`. A plain `const name = it` stays a binding. */
function assignedToProperty(body: string, wordStart: number): boolean {
  const equalsAt = previousCodeIndex(body, wordStart);
  if (equalsAt < 0 || body[equalsAt] !== "=") return false;
  if (body[equalsAt + 1] === "=" || body[equalsAt + 1] === ">") return false;
  const lhsEnd = previousCodeIndex(body, equalsAt);
  if (lhsEnd < 0) return false;
  if (body[lhsEnd] === "]") return true;
  const ident = wordEndingAt(body, lhsEnd);
  if (!ident) return false;
  const before = previousCodeIndex(body, ident.start);
  return before >= 0 && body[before] === ".";
}

const CALL_HEADER = new Set(["catch", "for", "function", "if", "switch", "while", "with"]);

const STATEMENT_WORD = new Set([
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "do",
  "else",
  "enum",
  "export",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "interface",
  "let",
  "return",
  "switch",
  "throw",
  "try",
  "type",
  "var",
  "while",
]);

/** `register(...)` and `helper?.(`. `if (` / `function (` open a header, not a call. */
function isCallParen(body: string, open: number): boolean {
  const prev = previousCodeIndex(body, open);
  if (prev < 0) return false;
  const mark = body[prev] ?? "";
  if (mark === ")" || mark === "]") return true;
  if (mark === "?" && body[prev - 1] === ".") return true;
  const word = wordEndingAt(body, prev);
  if (!word) return false;
  return !CALL_HEADER.has(word.value);
}

/** `{` of a function, class, or control-flow body. An object literal stays an expression. */
function braceIsBlock(body: string, braceAt: number): boolean {
  if (opensClassBody(body, braceAt)) return true;
  const prev = previousCodeIndex(body, braceAt);
  if (prev < 0) return true;
  const mark = body[prev] ?? "";
  if (mark === ")") return true;
  if (mark === ">" && body[prev - 1] === "=") return true;
  const word = wordEndingAt(body, prev);
  if (!word) return false;
  return (
    word.value === "do" ||
    word.value === "else" ||
    word.value === "finally" ||
    word.value === "try"
  );
}

function spanStartContaining(
  spans: ReadonlyArray<readonly [number, number]>,
  index: number,
): number {
  for (let cursor = spans.length - 1; cursor >= 0; cursor -= 1) {
    const span = spans[cursor];
    if (!span) continue;
    if (index >= span[0] && index < span[1]) return span[0];
  }
  return -1;
}

/**
 * A runner token nested in a call argument, such as `register(true ? it : test)`.
 * Bindings and function bodies stay registrations.
 */
function nestedInCallArgument(body: string, wordStart: number): boolean {
  const spans = stringSpans(body);
  let depth = 0;
  let cursor = wordStart - 1;
  while (cursor >= 0) {
    if (insideSpan(spans, cursor)) {
      const start = spanStartContaining(spans, cursor);
      cursor = start < 0 ? cursor - 1 : start - 1;
      continue;
    }
    const char = body[cursor] ?? "";
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
    if (/\s/.test(char)) {
      cursor -= 1;
      continue;
    }
    if (char === ")" || char === "]" || char === "}") {
      depth += 1;
      cursor -= 1;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") {
      if (depth > 0) {
        depth -= 1;
        cursor -= 1;
        continue;
      }
      if (char === "(" && isCallParen(body, cursor)) return true;
      if (char === "{" && braceIsBlock(body, cursor)) return false;
      cursor -= 1;
      continue;
    }
    if (depth === 0 && char === ";") return false;
    if (depth === 0 && /[A-Za-z0-9_$]/.test(char)) {
      const word = wordEndingAt(body, cursor);
      if (word && STATEMENT_WORD.has(word.value)) return false;
      cursor = word ? word.start - 1 : cursor - 1;
      continue;
    }
    cursor -= 1;
  }
  return false;
}

/** `register(it)` and `register(true ? it : test)` forward a runner the scanner cannot see. */
function passedAsArgument(body: string, wordStart: number, afterExpr: number): boolean {
  const word = readIdentifier(body, wordStart);
  if (!word) return false;
  const prevAt = previousCodeIndex(body, wordStart);
  if (prevAt >= 0) {
    const prev = body[prevAt] ?? "";
    let open = -1;
    if (prev === "(") open = prevAt;
    else if (prev === ",") open = callOpenBefore(body, prevAt);
    if (open >= 0 && !isGroupedBinding(body, open)) {
      const next = body[skipSpaceAndComments(body, afterExpr)] ?? "";
      if (next === "," || next === ")") return true;
    }
  }
  return nestedInCallArgument(body, wordStart);
}

/**
 * `Reflect.apply(it, ...)` and `obj.apply(it, ...)` run a runner without calling it.
 * `register(it)` is rejected by `passedAsArgument` instead.
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
