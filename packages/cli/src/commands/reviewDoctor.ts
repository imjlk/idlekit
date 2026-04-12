import { defineCommand, option, type RenderArgs } from "@bunli/core";
import { z } from "zod";
import { usageError } from "../errors";
import { createLazyReviewElement } from "../lib/reviewLazy";
import type { ReviewDoctorFlags } from "../lib/reviewDoctor";

function ensureInteractiveReview(terminal: { isInteractive: boolean; isCI: boolean }, command: string): void {
  if (terminal.isInteractive && !terminal.isCI) return;
  throw usageError(`${command} requires an interactive terminal.`, "Use `idk doctor --format md|json` for automation-friendly output.");
}

type Flags = ReviewDoctorFlags;

export function renderReviewDoctor(
  args: RenderArgs<Flags>,
) {
  return createLazyReviewElement({
    title: "idlekit review doctor",
    description: "Loading setup and completions health checks for interactive review.",
    loader: async () => {
      const module = await import("../lib/reviewDoctor");
      return function ReviewDoctorLoaded() {
        const output = module.loadReviewDoctorData(args.flags as Flags);
        return module.createReviewDoctorElement({ output });
      };
    },
    props: undefined as never,
  });
}

export default defineCommand({
  name: "doctor",
  description: "Interactive doctor dashboard for human setup review",
  tui: {
    renderer: {
      bufferMode: "alternate",
    },
  },
  options: {
    shell: option(z.enum(["detect", "zsh", "bash", "fish", "powershell"]).default("detect"), {
      description: "Completion shell to validate",
    }),
    rc: option(z.string().optional(), {
      description: "Optional shell rc/profile path for completion installation checks",
    }),
  },
  handler({ terminal }) {
    ensureInteractiveReview(terminal, "idk review doctor");
  },
  render(args) {
    return renderReviewDoctor(args as RenderArgs<Flags>);
  },
});
