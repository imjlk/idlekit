import { defineCommand, option, type RenderArgs } from "@bunli/core";
import { z } from "zod";
import { usageError } from "../errors";
import {
  createReviewDoctorElement,
  loadReviewDoctorData,
  type ReviewDoctorFlags,
} from "../lib/reviewDoctor";

function ensureInteractiveReview(terminal: { isInteractive: boolean; isCI: boolean }, command: string): void {
  if (terminal.isInteractive && !terminal.isCI) return;
  throw usageError(`${command} requires an interactive terminal.`, "Use `idk doctor --format md|json` for automation-friendly output.");
}

type Flags = ReviewDoctorFlags;

export function renderReviewDoctor(
  args: RenderArgs<Flags>,
  loadData: (flags: Flags) => ReturnType<typeof loadReviewDoctorData> = loadReviewDoctorData,
) {
  const output = loadData(args.flags as Flags);
  return createReviewDoctorElement({ output });
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
