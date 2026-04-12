/** @jsxImportSource @opentui/react */
import { createElement } from "react";

export type ReviewCardTone = "good" | "warn" | "info";

export function reviewSection(title: string, lines: readonly string[]) {
  return createElement(
    "box",
    {
      border: true,
      padding: 1,
      style: { flexDirection: "column", gap: 0 },
    },
    createElement("text", { key: `${title}-title`, content: title, fg: "#93c5fd" }),
    ...lines.map((line, index) => createElement("text", { key: `${title}-${index}`, content: line })),
  );
}

export function reviewSummaryCard(title: string, value: string, detail: string, tone: ReviewCardTone) {
  const fg = tone === "good" ? "#86efac" : tone === "warn" ? "#fca5a5" : "#93c5fd";
  return createElement(
    "box",
    {
      border: true,
      padding: 1,
      style: {
        flexDirection: "column",
        width: 30,
      },
    },
    createElement("text", { content: title, fg }),
    createElement("text", { content: value }),
    createElement("text", { content: detail, fg: "#94a3b8" }),
  );
}

export function reviewExitHint() {
  return createElement("text", {
    content: "Press q, Esc, or Ctrl+C to exit.",
    fg: "#94a3b8",
  });
}
