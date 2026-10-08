export function skipWhitespace(body: string, index: number): number {
  let cursor = index;
  while (cursor < body.length && /\s/.test(body[cursor] ?? "")) cursor += 1;
  return cursor;
}

export function skipQuoted(body: string, index: number): number {
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

function simpleEscape(next: string): string | undefined {
  if (next === "b") return "\b";
  if (next === "f") return "\f";
  if (next === "n") return "\n";
  if (next === "r") return "\r";
  if (next === "t") return "\t";
  if (next === "v") return "\v";
  if (next === "0") return "\0";
  if (next === "\\") return "\\";
  if (next === "'") return "'";
  if (next === '"') return '"';
  return undefined;
}

/** One JavaScript escape starting at a backslash. Invalid strict-mode escapes do not decode. */
function readEscape(body: string, index: number): { value: string; end: number } | undefined {
  if (body[index] !== "\\") return undefined;
  const next = body[index + 1];
  if (next === undefined) return undefined;
  if (next === "\n") return { value: "", end: index + 2 };
  if (next === "\r") return { value: "", end: body[index + 2] === "\n" ? index + 3 : index + 2 };
  if (next === "0" && /[0-9]/.test(body[index + 2] ?? "")) return undefined;
  const simple = simpleEscape(next);
  if (simple !== undefined) return { value: simple, end: index + 2 };
  if (next === "x") {
    const hex = body.slice(index + 2, index + 4);
    if (!/^[0-9a-fA-F]{2}$/.test(hex)) return undefined;
    return { value: String.fromCharCode(Number.parseInt(hex, 16)), end: index + 4 };
  }
  if (next === "u") {
    if (body[index + 2] === "{") {
      const close = body.indexOf("}", index + 3);
      if (close < 0) return undefined;
      const hex = body.slice(index + 3, close);
      if (!/^[0-9a-fA-F]{1,6}$/.test(hex)) return undefined;
      const code = Number.parseInt(hex, 16);
      if (code > 0x10ffff) return undefined;
      return { value: String.fromCodePoint(code), end: close + 1 };
    }
    const hex = body.slice(index + 2, index + 6);
    if (!/^[0-9a-fA-F]{4}$/.test(hex)) return undefined;
    return { value: String.fromCharCode(Number.parseInt(hex, 16)), end: index + 6 };
  }
  if (/[0-9]/.test(next)) return undefined;
  return { value: next, end: index + 2 };
}

function decodeQuotedContents(body: string, from: number, to: number): string | undefined {
  let value = "";
  let at = from;
  while (at < to) {
    if (body[at] === "\\") {
      const escaped = readEscape(body, at);
      if (!escaped || escaped.end > to) return undefined;
      value += escaped.value;
      at = escaped.end;
      continue;
    }
    value += body[at] ?? "";
    at += 1;
  }
  return value;
}

export function readQuoted(body: string, index: number): { value: string; end: number } | undefined {
  const cursor = skipWhitespace(body, index);
  const quote = body[cursor];
  if (quote !== "'" && quote !== '"') return undefined;
  const end = skipQuoted(body, cursor);
  if (body[end - 1] !== quote) return undefined;
  const value = decodeQuotedContents(body, cursor + 1, end - 1);
  if (value === undefined) return undefined;
  return { value, end };
}

/** A static template title. Interpolation and an unclosed backtick are not titles. */
export function readStaticTemplate(
  body: string,
  index: number,
): { value: string; end: number } | undefined {
  const cursor = skipWhitespace(body, index);
  if (body[cursor] !== "`") return undefined;
  let value = "";
  let cursorAt = cursor + 1;
  while (cursorAt < body.length) {
    const char = body[cursorAt] ?? "";
    if (char === "\\") {
      const escaped = readEscape(body, cursorAt);
      if (!escaped) return undefined;
      value += escaped.value;
      cursorAt = escaped.end;
      continue;
    }
    if (char === "$" && body[cursorAt + 1] === "{") return undefined;
    if (char === "`") return { value, end: cursorAt + 1 };
    value += char;
    cursorAt += 1;
  }
  return undefined;
}

export function readTestTitle(body: string, index: number): { value: string; end: number } | undefined {
  return readQuoted(body, index) ?? readStaticTemplate(body, index);
}

export function regexCanStart(body: string, index: number): boolean {
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

export function skipRegex(body: string, index: number): number {
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

export function readIdentifier(body: string, index: number): { value: string; end: number } | undefined {
  const cursor = skipWhitespace(body, index);
  const match = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(body.slice(cursor));
  if (!match) return undefined;
  return { value: match[0], end: cursor + match[0].length };
}

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

export function localRanges(
  body: string,
  mode: "bindings" | "parameters" | "classes" | "annotations" = "bindings",
): Array<[string, number, number]> {
  const parametersOnly = mode !== "bindings";
  const ranges: Array<[string, number, number]> = [];
  const scopes: {
    start: number;
    names: string[];
    parameters: Array<[string, number]>;
    classes: Array<[string, number]>;
  }[] = [{ start: 0, names: [], parameters: [], classes: [] }];
  let pending: string[] = [];
  let pendingParameters: Array<[string, number]> = [];
  let pendingClasses: Array<[string, number]> = [];
  const functionHeaders = new Set<number>();
  let index = 0;

  const declareHere = (name: string): void => {
    if (scopes.length <= 1) return;
    scopes[scopes.length - 1]?.names.push(name);
  };
  const openScope = (start: number): void => {
    scopes.push({ start, names: pending, parameters: pendingParameters, classes: pendingClasses });
    pending = [];
    pendingParameters = [];
    pendingClasses = [];
  };
  const closeScope = (end: number): void => {
    const scope = scopes.pop();
    if (!scope || scopes.length === 0) return;
    if (mode === "classes") {
      for (const [name, start] of scope.classes) ranges.push([name, start, end]);
    } else if (mode === "parameters") {
      for (const [name, start] of scope.parameters) ranges.push([name, start, end]);
    } else if (mode === "bindings") {
      for (const name of scope.names) ranges.push([name, scope.start, end]);
    }
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
  const skipNested = (cursor: number, limit: number, typeAnnotation = false): number => {
    let depth = 0;
    while (cursor < limit) {
      const mark = body[cursor] ?? "";
      if (mark === "'" || mark === '"') {
        cursor = skipQuoted(body, cursor);
        continue;
      }
      if (typeAnnotation && body.startsWith("=>", cursor)) {
        cursor += 2;
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
      if (depth === 0 && char === "=") {
        cursor = skipNested(cursor + 1, close);
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
    const annotationEnd = (start: number): number => {
      const end = skipNested(start + 1, close, true);
      if (mode === "annotations") ranges.push(["", start, end]);
      return end;
    };
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
        if (body[cursor] === ":") cursor = annotationEnd(cursor);
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
      if (body[cursor] === "?") cursor = skipSpaceAndComments(cursor + 1);
      if (body[cursor] === ":") cursor = annotationEnd(cursor);
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
  const afterGroup = (open: number): number => {
    if (body[open] !== "[") return skipPair(body, open);
    const close = matchingGroup(body, open, "[", "]");
    return close < 0 ? -1 : close + 1;
  };
  const expressionEnd = (from: number): number => {
    let cursor = from;
    while (cursor < body.length) {
      const beforeSpace = cursor;
      cursor = skipSpaceAndComments(cursor);
      const char = body[cursor] ?? "";
      const nextWord = readIdentifier(body, cursor)?.value;
      if (
        beforeSpace > from && /[\r\n]/.test(body.slice(beforeSpace, cursor)) &&
        /[\w$)\]}"'`]/.test(body[beforeSpace - 1] ?? "") &&
        (char === "{" || (nextWord && !["in", "instanceof", "as", "satisfies"].includes(nextWord))) &&
        !["await", "yield", "new", "typeof", "void", "delete"].includes(previousWord(beforeSpace))
      ) return beforeSpace;
      if (",;)]}".includes(char) && char !== "") return cursor;
      if (char === "'" || char === '"') cursor = skipQuoted(body, cursor);
      else if (char === "`") {
        const end = skipTemplateLiteral(body, cursor);
        cursor = end < 0 ? body.length : end;
      } else if (char === "/" && regexCanStart(body, cursor)) cursor = skipRegex(body, cursor);
      else if (char === "(" || char === "[" || char === "{") {
        const end = afterGroup(cursor);
        cursor = end < 0 ? body.length : end;
      } else cursor += 1;
    }
    return cursor;
  };
  const afterReturnType = (from: number): number => {
    let cursor = skipSpaceAndComments(from);
    if (body[cursor] !== ":") return cursor;
    cursor += 1;
    while (cursor < body.length && !body.startsWith("=>", cursor)) {
      cursor = skipSpaceAndComments(cursor);
      const char = body[cursor] ?? "";
      if (char === "(" || char === "[" || char === "<" || char === "{") {
        const end = afterGroup(cursor);
        if (end < 0) return cursor;
        cursor = end;
      } else if (char === ";" || char === "=" || char === "}") return cursor;
      else cursor += 1;
    }
    return cursor;
  };
  const functionBodyAt = (from: number): number => {
    let cursor = skipSpaceAndComments(from);
    if (body[cursor] !== ":") return cursor;
    cursor = skipSpaceAndComments(cursor + 1);
    // An object return type precedes the body, e.g. `(): { value: number } { ... }`.
    if (body[cursor] === "{") cursor = skipSpaceAndComments(afterGroup(cursor));
    while (cursor < body.length) {
      const char = body[cursor] ?? "";
      if (char === "{" || char === ";" || char === "=" || char === "}") return cursor;
      if (char === "(" || char === "[" || char === "<") {
        const end = afterGroup(cursor);
        if (end < 0) return cursor;
        cursor = end;
      } else cursor += 1;
    }
    return cursor;
  };
  const arrowParameters = (names: string[], start: number, arrow: number): void => {
    const value = skipSpaceAndComments(arrow + 2);
    if (body[value] === "{") {
      bindNames(names, true);
      pendingParameters.push(...names.map((name): [string, number] => [name, start]));
    } else {
      const end = expressionEnd(value);
      if (mode === "bindings" || mode === "parameters") {
        for (const name of names) ranges.push([name, parametersOnly ? start : value, end]);
      }
    }
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
      const functionHeader = word === "function" || word === "catch" || functionHeaders.has(index);
      let previous = index - 1;
      while (previous >= 0 && /\s/.test(body[previous] ?? "")) previous -= 1;
      const rawAfter = close < 0 ? index : skipSpaceAndComments(close + 1);
      const after = functionHeader || body[previous] === "?" ? rawAfter : afterReturnType(rawAfter);
      const params =
        close >= 0 && (functionHeader || body.startsWith("=>", after));
      if (params && close >= 0) {
        const names = parameterNames(index, close);
        if (body.startsWith("=>", after)) arrowParameters(names, index, after);
        else if (body[functionBodyAt(close + 1)] === "{") {
          bindNames(names, true);
          pendingParameters.push(...names.map((name): [string, number] => [name, index]));
        } else if (mode === "parameters") {
          for (const name of names) ranges.push([name, index, close + 1]);
        }
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
      if (parametersOnly) {
        let cursor = skipSpaceAndComments(word.end);
        const ident = readIdentifier(body, cursor);
        if (ident) cursor = skipSpaceAndComments(ident.end);
        else if (body[cursor] === "{" || body[cursor] === "[") cursor = skipSpaceAndComments(afterGroup(cursor));
        index = body[cursor] === ":" ? skipNested(cursor + 1, body.length, true) : word.end;
        continue;
      }
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
        if (word.value === "function") {
          let open = skipSpaceAndComments(name.end);
          if (body[open] === "<") open = skipSpaceAndComments(skipPair(body, open));
          if (body[open] === "(") functionHeaders.add(open);
        }
        const intro = previousWord(index);
        let markAt = index;
        if (intro === "async") markAt = index - intro.length;
        let cursor = markAt - 1;
        while (cursor >= 0 && /\s/.test(body[cursor] ?? "")) cursor -= 1;
        const mark = cursor < 0 ? "" : (body[cursor] ?? "");
        const declared =
          intro === "export" || mark === "" || mark === "{" || mark === "}" || mark === ";";
        if (declared) {
          declareHere(name.value);
          if (word.value === "class") {
            const scope = scopes.at(-1);
            scope?.classes.push([name.value, scope.start]);
          }
        } else {
          pending.push(name.value);
          if (word.value === "class") pendingClasses.push([name.value, index]);
        }
        index = name.end;
      } else index = word.end;
      continue;
    }
    const ahead = skipSpaceAndComments(word.end);
    if (body.startsWith("=>", ahead)) arrowParameters([word.value], index, ahead);
    index = word.end;
  }
  while (scopes.length > 1) closeScope(body.length);
  if (mode === "classes") {
    for (const [name, start] of scopes[0]?.classes ?? []) ranges.push([name, start, body.length]);
  }
  return ranges;
}

export function locallyBound(
  ranges: ReadonlyArray<readonly [string, number, number]>,
  name: string,
  at: number,
): boolean {
  return ranges.some(([bound, from, to]) => bound === name && at >= from && at < to);
}

export function skipSpaceAndComments(body: string, index: number): number {
  let cursor = index;
  while (cursor < body.length) {
    const char = body[cursor] ?? "";
    if (/\s/.test(char)) {
      cursor += 1;
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
    break;
  }
  return cursor;
}

/** A `` `...` `` literal, including `${...}` substitutions that themselves contain code. */
export function skipTemplateLiteral(body: string, index: number): number {
  if (body[index] !== "`") return -1;
  let cursor = index + 1;
  while (cursor < body.length) {
    const char = body[cursor] ?? "";
    if (char === "\\") {
      cursor += 2;
      continue;
    }
    if (char === "$" && body[cursor + 1] === "{") {
      const end = skipPair(body, cursor + 1);
      if (end < 0) return -1;
      cursor = end;
      continue;
    }
    if (char === "`") return cursor + 1;
    cursor += 1;
  }
  return -1;
}

function pairClose(open: string): string {
  if (open === "(") return ")";
  if (open === "{") return "}";
  if (open === "<") return ">";
  return "";
}

/** The group that starts at `index` (`()`, `{}`, or `<>`). `=>` is not a `>` closer. */
export function skipPair(body: string, index: number): number {
  const open = body[index] ?? "";
  const close = pairClose(open);
  if (close === "") return -1;
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
    if (char === open) depth += 1;
    else if (char === close && !(open === "<" && body[cursor - 1] === "=")) depth -= 1;
    cursor += 1;
  }
  return depth === 0 ? cursor : -1;
}

/** Table argument of `it.each` / `test.each`: optional type args, then `(` or a template. */
export function skipEachTable(body: string, index: number): number {
  let cursor = skipSpaceAndComments(body, index);
  if (body[cursor] === "<") {
    const after = skipPair(body, cursor);
    if (after < 0) return -1;
    cursor = skipSpaceAndComments(body, after);
  }
  if (body[cursor] === "(" || body[cursor] === "`") return skipPairOrTemplate(body, cursor);
  return -1;
}

function skipPairOrTemplate(body: string, index: number): number {
  if (body[index] === "`") return skipTemplateLiteral(body, index);
  if (body[index] === "(") return skipPair(body, index);
  return -1;
}

export function argumentBoundary(body: string, index: number): boolean {
  const cursor = skipSpaceAndComments(body, index);
  const char = body[cursor];
  return char === undefined || char === ")" || char === ",";
}

/** Type text after `as` / `satisfies`, stopping at the callback argument's comma or `)`. */
function skipTypeExpression(body: string, index: number): number {
  let cursor = skipSpaceAndComments(body, index);
  let depth = 0;
  while (cursor < body.length) {
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
    if (char === "(" || char === "{" || char === "[" || char === "<") {
      depth += 1;
      cursor += 1;
      continue;
    }
    if (char === ")" || char === "}" || char === "]" || char === ">") {
      if (depth === 0) return cursor;
      depth -= 1;
      cursor += 1;
      continue;
    }
    if (depth === 0 && (char === "&" || char === "|" || char === "?")) {
      const next = body[cursor + 1] ?? "";
      if (char === "?" || next === char) return -1;
    }
    if (depth === 0 && char === ",") return cursor;
    cursor += 1;
  }
  return cursor;
}

export function skipTypeOnlySuffix(body: string, index: number): number {
  let cursor = skipSpaceAndComments(body, index);
  while (body[cursor] === "!" && body[cursor + 1] !== "=") {
    cursor = skipSpaceAndComments(body, cursor + 1);
  }
  const word = readIdentifier(body, cursor);
  if (word && (word.value === "as" || word.value === "satisfies")) {
    const typeEnd = skipTypeExpression(body, word.end);
    if (typeEnd < 0) return -1;
    return skipTypeOnlySuffix(body, typeEnd);
  }
  if (body[cursor] === "<") {
    const after = skipPair(body, cursor);
    if (after < 0) return -1;
    if (body[skipSpaceAndComments(body, after)] === "(") return -1;
    return skipTypeOnlySuffix(body, after);
  }
  return cursor;
}

/**
 * The callback is one identifier, optionally wrapped or followed by type-only syntax.
 * `citedExport && unrelated` is not that identifier: Bun invokes the other operand.
 */
export function readDirectCallback(
  body: string,
  index: number,
): { value: string; at: number; end: number } | undefined {
  const cursor = skipSpaceAndComments(body, index);
  if (body[cursor] === "(") {
    const inner = readDirectCallback(body, cursor + 1);
    if (!inner) return undefined;
    const close = skipSpaceAndComments(body, inner.end);
    if (body[close] !== ")") return undefined;
    const end = skipTypeOnlySuffix(body, close + 1);
    if (end < 0 || !argumentBoundary(body, end)) return undefined;
    return { value: inner.value, at: inner.at, end };
  }
  const ident = readIdentifier(body, cursor);
  if (!ident) return undefined;
  const end = skipTypeOnlySuffix(body, ident.end);
  if (end < 0 || !argumentBoundary(body, end)) return undefined;
  const at = ident.end - ident.value.length;
  return { value: ident.value, at, end };
}

export function stringSpans(body: string): Array<[number, number]> {
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

export function insideSpan(spans: ReadonlyArray<readonly [number, number]>, index: number): boolean {
  return spans.some((span) => index >= span[0] && index < span[1]);
}

export function spanEndAt(
  spans: ReadonlyArray<readonly [number, number]>,
  index: number,
): number {
  for (const span of spans) {
    if (index >= span[0] && index < span[1]) return span[1];
  }
  return -1;
}

export function wordBefore(body: string, index: number): string {
  let cursor = index - 1;
  while (cursor >= 0 && /\s/.test(body[cursor] ?? "")) cursor -= 1;
  const match = /[A-Za-z_$][A-Za-z0-9_$]*$/.exec(body.slice(0, cursor + 1));
  if (!match || match.index + match[0].length !== cursor + 1) return "";
  return match[0];
}
