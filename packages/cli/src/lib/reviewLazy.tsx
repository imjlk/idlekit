/** @jsxImportSource @opentui/react */
import { useRuntime } from "@bunli/runtime/app";
import { createElement, useEffect, useState, type ComponentType } from "react";
import { useKeyboard } from "@opentui/react";
import { reviewExitHint, reviewSection } from "./reviewUi";

type Loader<TProps> = () => Promise<ComponentType<TProps>>;

type LazyReviewOptions<TProps> = Readonly<{
  title: string;
  description: string;
  loader: Loader<TProps>;
  props: TProps;
}>;

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
        reviewSection("Error", [error]),
        reviewExitHint(),
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
        reviewSection("Loading", [options.description, "Preparing interactive dashboard..."]),
        reviewExitHint(),
      );
    }

    return createElement(Component as ComponentType<any>, options.props as any);
  }

  return createElement(LazyReviewScreen);
}
