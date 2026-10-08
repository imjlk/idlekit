import { syntaxRanges, type ScopeMode } from "./scope-ranges";

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

/** Lexical bindings and erased type spans, using their original source offsets. */
export function localRanges(body: string, mode: ScopeMode = "bindings"): Array<[string, number, number]> {
  return syntaxRanges(body, mode);
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
