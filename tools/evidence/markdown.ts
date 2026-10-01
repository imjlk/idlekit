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

/** How many blockquote markers open this line. */
function blockquoteDepth(line: string): number {
  let rest = line;
  let depth = 0;
  for (;;) {
    const marker = /^ {0,3}> ?/.exec(rest);
    if (!marker) return depth;
    depth += 1;
    rest = rest.slice(marker[0].length);
  }
}

/** Strip exactly `depth` blockquote markers. A deeper or shallower line does not match. */
function stripBlockquotes(line: string, depth: number): string | undefined {
  let rest = line;
  for (let count = 0; count < depth; count += 1) {
    const marker = /^ {0,3}> ?/.exec(rest);
    if (!marker) return undefined;
    rest = rest.slice(marker[0].length);
  }
  if (/^ {0,3}>/.test(rest)) return undefined;
  return rest;
}

/** One list marker and the column where its content starts. Indented code is not a list. */
function listContainer(line: string): { indent: number; text: string } | undefined {
  const match = /^( {0,3})([-*+]|\d{1,9}[.)])([ \t]+)(.*)$/.exec(line);
  if (!match) return undefined;
  const leading = match[1] ?? "";
  const marker = match[2] ?? "";
  const gap = match[3] ?? "";
  const rest = match[4] ?? "";
  const markerEnd = leading.length + marker.length;
  if (gap.length === 1 || gap.length >= 5) {
    const text = gap.length === 1 ? rest : `${gap.slice(1)}${rest}`;
    return { indent: markerEnd + 1, text };
  }
  return { indent: markerEnd + gap.length, text: rest };
}

/** A setext underline after the shared list indent. Column 0 is not inside the item. */
function setextMarker(line: string, listIndent: number): "-" | "=" | undefined {
  let rest = line;
  if (listIndent > 0) {
    if (!rest.startsWith(" ".repeat(listIndent))) return undefined;
    rest = rest.slice(listIndent);
  }
  const underlineText = rest.replace(/^ {0,3}/, "");
  const underline = /^(-+|=+)[ \t]*$/.exec(underlineText);
  const token = underline?.[1];
  if (!token) return undefined;
  return token.startsWith("-") ? "-" : "=";
}

/** Blockquote and list markers can wrap an ATX heading. A setext pair shares its quote prefix. */
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
  let pending: { text: string; depth: number; listIndent: number } | undefined;
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
      if (htmlBlockClosed(atxText(rawLine), htmlBlock)) htmlBlock = undefined;
      continue;
    }
    // CommonMark: a backtick opener whose info string contains a backtick is not a fence.
    if (opener && !(opener.startsWith("`") && info.includes("`"))) {
      fenceChar = opener.startsWith("`") ? "`" : "~";
      fenceLength = opener.length;
      pending = undefined;
      continue;
    }
    const htmlLine = atxText(rawLine);
    const htmlStart = htmlBlockStart(htmlLine, pending !== undefined);
    if (htmlStart) {
      pending = undefined;
      if (!htmlBlockClosed(htmlLine, htmlStart)) htmlBlock = htmlStart;
      continue;
    }
    const commentAt = indexOutsideInline(rawLine, "<!--");
    const line = commentAt === -1 ? rawLine : rawLine.slice(0, commentAt);
    const commentCloses = commentAt !== -1 && rawLine.indexOf("-->", commentAt + 4) !== -1;
    if (commentAt !== -1 && !commentCloses) inComment = true;
    const depth = blockquoteDepth(line);
    const opened = stripBlockquotes(line, depth) ?? line;
    const heading = opened.replace(/^ {0,3}/, "");
    if (pending) {
      const sameQuote = stripBlockquotes(line, pending.depth);
      const marker =
        sameQuote === undefined ? undefined : setextMarker(sameQuote, pending.listIndent);
      if (marker) {
        if (marker === "-") {
          const setext = /\{#([A-Za-z0-9][A-Za-z0-9._:-]*)\}[ \t]*$/.exec(pending.text.trim());
          anchors.push(setext?.[1] ?? "");
        }
        pending = undefined;
        continue;
      }
    }
    const atx = atxText(heading);
    // CommonMark lets an ATX heading close with a space and a run of hashes.
    const match =
      /^##[ \t]+.+\{#([A-Za-z0-9][A-Za-z0-9._:-]*)\}(?:[ \t]+#+)?[ \t]*$/.exec(atx);
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
    const listed = listContainer(opened);
    const paragraphSource = listed ? listed.text : heading;
    const paragraph = paragraphSource.trim();
    pending =
      paragraph.length > 0 && isSetextParagraph(paragraph)
        ? { text: paragraphSource, depth, listIndent: listed?.indent ?? 0 }
        : undefined;
  }
  return anchors;
}
