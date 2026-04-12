/** @jsxImportSource @opentui/react */
import { createElement } from "react";
import { useKeyboard } from "@opentui/react";
import { useRuntime } from "@bunli/runtime/app";
import { runSelfCliJson } from "../runtime/selfCli";
import { createReviewSummaryGrid, reviewExitHint, reviewSection } from "./reviewUi";

type DoctorOutput = Readonly<{
  ok: boolean;
  cli: {
    name: string;
    version: string;
  };
  runtime: {
    currentBun: string;
    requiredBun: string;
  };
  checks: ReadonlyArray<{
    id: string;
    ok: boolean;
    detail?: string;
  }>;
  fixes?: ReadonlyArray<{
    id: string;
    status: string;
    detail?: string;
  }>;
}>;

export type ReviewDoctorFlags = Readonly<{
  shell: "detect" | "zsh" | "bash" | "fish" | "powershell";
  rc?: string;
}>;

export type ReviewDoctorRunner = (args: readonly string[]) => DoctorOutput;

export function buildReviewDoctorArgs(flags: ReviewDoctorFlags): string[] {
  const args = ["doctor", "--format", "json", "--shell", flags.shell];
  if (flags.rc) args.push("--rc", flags.rc);
  return args;
}

export function loadReviewDoctorData(
  flags: ReviewDoctorFlags,
  runner: ReviewDoctorRunner = runSelfCliJson,
): DoctorOutput {
  return runner(buildReviewDoctorArgs(flags));
}

function summarizeChecks(output: DoctorOutput): string[] {
  return output.checks.map((check) => {
    const status = check.ok ? "pass" : "fail";
    return `${status.padEnd(4)} ${check.id}${check.detail ? ` | ${check.detail}` : ""}`;
  });
}

function fixLines(output: DoctorOutput): string[] {
  if (!output.fixes || output.fixes.length === 0) {
    return ["No fixes applied in this run.", "Run `idk doctor --fix true` to apply managed setup changes."];
  }
  return output.fixes.map((fix) => `${fix.status.padEnd(7)} ${fix.id}${fix.detail ? ` | ${fix.detail}` : ""}`);
}

function nextStepLines(output: DoctorOutput): string[] {
  if (output.ok) {
    return [
      "- idk review evaluate <scenario> --image-mode auto",
      "- idk setup plugin-trust --plugin ./custom-econ-plugin.ts --out ./.idk/plugin-trust.json",
    ];
  }
  return [
    "- idk doctor --fix true --shell zsh",
    "- idk setup completions --shell zsh",
    "- idk setup plugin-trust --plugin ./custom-econ-plugin.ts --out ./.idk/plugin-trust.json",
  ];
}

function summaryStats(output: DoctorOutput) {
  const passing = output.checks.filter((check) => check.ok).length;
  const failing = output.checks.length - passing;
  const appliedFixes = (output.fixes ?? []).filter((fix) => fix.status === "applied").length;
  return { passing, failing, appliedFixes };
}

export function createReviewDoctorElement(args: { output: DoctorOutput }) {
  function ReviewDoctorScreen() {
    const runtime = useRuntime();
    const stats = summaryStats(args.output);
    useKeyboard((key) => {
      if (key.name === "q" || key.name === "escape" || (key.ctrl === true && key.name === "c")) {
        runtime.exit();
      }
    });

    return createElement(
      "box",
      {
        style: {
          flexDirection: "column",
          padding: 1,
          gap: 1,
        },
      },
      createElement("text", {
        content: `${args.output.cli.name}@${args.output.cli.version} doctor review`,
        fg: args.output.ok ? "#86efac" : "#fca5a5",
      }),
      createElement("text", {
        content: `Bun ${args.output.runtime.currentBun} | required ${args.output.runtime.requiredBun} | overall ${args.output.ok ? "pass" : "fail"}`,
      }),
      createReviewSummaryGrid([
        { title: "Overall", value: args.output.ok ? "pass" : "fail", detail: `${stats.passing} pass / ${stats.failing} fail`, tone: args.output.ok ? "good" : "warn" },
        { title: "Runtime", value: args.output.runtime.currentBun, detail: `Requires ${args.output.runtime.requiredBun}`, tone: "info" },
        { title: "Applied fixes", value: String(stats.appliedFixes), detail: stats.appliedFixes > 0 ? "Managed fixes were applied." : "No managed fixes in this run.", tone: stats.appliedFixes > 0 ? "good" : "info" },
      ]),
      reviewSection("Checks", summarizeChecks(args.output)),
      reviewSection("Fixes", fixLines(args.output)),
      reviewSection("Next", nextStepLines(args.output)),
      reviewExitHint(),
    );
  }

  return createElement(ReviewDoctorScreen);
}
