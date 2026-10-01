/** Comments, strings, and template text are blank. A `${...}` expression stays executable. */
function executableText(source: string): string {
  const out = new Array<string>(source.length);
  for (let cursor = 0; cursor < source.length; cursor += 1) out[cursor] = source[cursor] ?? "";
  let index = 0;
  let template = false;
  const groups: number[] = [];
  const blank = (from: number, to: number): void => {
    for (let cursor = from; cursor < to; cursor += 1) {
      if (out[cursor] !== "\n") out[cursor] = " ";
    }
  };
  while (index < out.length) {
    const char = out[index] ?? "";
    if (template) {
      if (char === "\\") {
        blank(index, Math.min(out.length, index + 2));
        index += 2;
        continue;
      }
      if (char === "$" && out[index + 1] === "{") {
        blank(index, index + 2);
        groups.push(0);
        template = false;
        index += 2;
        continue;
      }
      if (char === "`") {
        out[index] = " ";
        template = false;
        index += 1;
        continue;
      }
      if (char !== "\n") out[index] = " ";
      index += 1;
      continue;
    }
    if (char === "/" && out[index + 1] === "/") {
      const next = source.indexOf("\n", index);
      const end = next < 0 ? out.length : next;
      blank(index, end);
      index = end;
      continue;
    }
    if (char === "/" && out[index + 1] === "*") {
      const next = source.indexOf("*/", index + 2);
      const end = next < 0 ? out.length : next + 2;
      blank(index, end);
      index = end;
      continue;
    }
    if (char === "'" || char === '"') {
      const start = index;
      const quote = char;
      index += 1;
      while (index < out.length && out[index] !== quote) {
        if (out[index] === "\\") index += 2;
        else if (out[index] === "\n") break;
        else index += 1;
      }
      if (out[index] === quote) index += 1;
      blank(start, index);
      continue;
    }
    if (char === "`") {
      out[index] = " ";
      template = true;
      index += 1;
      continue;
    }
    if (groups.length > 0 && char === "{") {
      groups[groups.length - 1] = (groups.at(-1) ?? 0) + 1;
    } else if (groups.length > 0 && char === "}") {
      const depth = groups.at(-1) ?? 0;
      if (depth === 0) {
        out[index] = " ";
        groups.pop();
        template = true;
      } else {
        groups[groups.length - 1] = depth - 1;
      }
    }
    index += 1;
  }
  return out.join("");
}

/** Default `{ stepOnce }` and `d.stepOnce(`, ignoring comments, strings, and template text. */
export function plannerStepOnceBound(source: string): boolean {
  const code = executableText(source);
  const bindsDefault = /\(\{\s*stepOnce\s*[,}]/.test(code);
  const callsStep = /(?:^|[^A-Za-z0-9_$])d\.stepOnce\s*\(/.test(code);
  return bindsDefault && callsStep;
}
