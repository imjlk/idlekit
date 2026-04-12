/** @jsxImportSource @opentui/react */
import { useTerminalDimensions } from "@opentui/react";
import { createElement } from "react";

export type ReviewCardTone = "good" | "warn" | "info";
export type ReviewSummaryCardData = Readonly<{
  title: string;
  value: string;
  detail: string;
  tone: ReviewCardTone;
}>;

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

export function reviewSummaryCard(title: string, value: string, detail: string, tone: ReviewCardTone, width = 28) {
  const fg = tone === "good" ? "#86efac" : tone === "warn" ? "#fca5a5" : "#93c5fd";
  return createElement(
    "box",
    {
      border: true,
      padding: 1,
      style: {
        flexDirection: "column",
        width,
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

function resolveColumns(width: number, cardCount: number, minCardWidth = 28, gap = 1): number {
  const usableWidth = Math.max(width - 4, width);
  for (let columns = Math.min(cardCount, 4); columns >= 1; columns -= 1) {
    const cardWidth = Math.floor((usableWidth - gap * (columns - 1)) / columns);
    if (cardWidth >= minCardWidth) return columns;
  }
  return 1;
}

function chunk<T>(values: readonly T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    rows.push(values.slice(index, index + size) as T[]);
  }
  return rows;
}

export function createReviewSummaryGrid(cards: readonly ReviewSummaryCardData[]) {
  function ReviewSummaryGrid() {
    const { width } = useTerminalDimensions();
    const columns = resolveColumns(width, cards.length);
    const cardWidth = Math.max(24, Math.floor((Math.max(width - 4, 24 * columns) - (columns - 1)) / columns));
    const rows = chunk(cards, columns);

    return createElement(
      "box",
      {
        style: {
          flexDirection: "column",
          gap: 1,
        },
      },
      ...rows.map((row, rowIndex) =>
        createElement(
          "box",
          {
            key: `review-card-row-${rowIndex}`,
            style: {
              flexDirection: "row",
              gap: 1,
            },
          },
          ...row.map((card, cardIndex) =>
            createElement(
              "box",
              {
                key: `review-card-${rowIndex}-${cardIndex}`,
              },
              reviewSummaryCard(card.title, card.value, card.detail, card.tone, cardWidth),
            ),
          ),
        ),
      ),
    );
  }

  return createElement(ReviewSummaryGrid);
}
