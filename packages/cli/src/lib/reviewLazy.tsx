/** @jsxImportSource @opentui/react */
import { useRuntime } from "@bunli/runtime/app";
import { createElement, useEffect, useState, type ComponentType } from "react";
import { useKeyboard } from "@opentui/react";

type Loader<TProps> = () => Promise<ComponentType<TProps>>;

type LazyReviewOptions<TProps> = Readonly<{
  title: string;
  description: string;
  loader: Loader<TProps>;
  props: TProps;
}>;

function sectionLines(title: string, lines: readonly string[]) {
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

export function createLazyReviewElement<TProps>(options: LazyReviewOptions<TProps>) {
  function LazyReviewScreen() {
    const runtime = useRuntime();
    const [Component, setComponent] = useState<ComponentType<TProps> | null>(null);
    const [error, setError] = useState<string | null>(null);

    useKeyboard((key) => {
      if (key.name === "q" || key.name === "escape" || (key.ctrl === true && key.name === "c")) {
        runtime.exit();
      }
    });

    useEffect(() => {
      let cancelled = false;
      void (async () => {
        try {
          const loaded = await options.loader();
          if (cancelled) return;
          setComponent(() => loaded);
        } catch (cause) {
          if (cancelled) return;
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })();

      return () => {
        cancelled = true;
      };
    }, []);

    if (error) {
      return createElement(
        "box",
        {
          style: {
            flexDirection: "column",
            padding: 1,
            gap: 1,
          },
        },
        createElement("text", { content: options.title, fg: "#fca5a5" }),
        sectionLines("Error", [error]),
        createElement("text", {
          content: "Press q, Esc, or Ctrl+C to exit.",
          fg: "#94a3b8",
        }),
      );
    }

    if (!Component) {
      return createElement(
        "box",
        {
          style: {
            flexDirection: "column",
            padding: 1,
            gap: 1,
          },
        },
        createElement("text", { content: options.title, fg: "#86efac" }),
        sectionLines("Loading", [options.description, "Preparing interactive dashboard..."]),
        createElement("text", {
          content: "Press q, Esc, or Ctrl+C to exit.",
          fg: "#94a3b8",
        }),
      );
    }

    return createElement(Component as ComponentType<any>, options.props as any);
  }

  return createElement(LazyReviewScreen);
}
