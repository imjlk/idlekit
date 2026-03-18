import { createCLI, defineCommand, defineGroup } from "@bunli/core";
import { describe, expect, it } from "bun:test";
import { createTempDir, removePath, runCliFailure } from "../testkit/bun";
import { renderReviewCompare } from "./reviewCompare";
import { renderReviewEvaluate } from "./reviewEvaluate";
import { runInitWizard } from "../lib/initWizard";
import { buildInitTemplatePlan } from "../templates/scenario";
import { resolve } from "path";
import { resolveReviewEvaluateImagePlan } from "../lib/reviewEvaluate";
import { resolveReviewCompareImagePlan } from "../lib/reviewCompare";
import { sha256Hex } from "../runtime/bun";

const interactiveTerminal = {
  width: 120,
  height: 40,
  isInteractive: true,
  isCI: false,
  supportsColor: true,
  supportsMouse: false,
} as const;

const reviewEvaluateOutput = {
  scenario: "/tmp/sample.json",
  run: { id: "run-1", seed: 7 },
  simulate: {
    endMoney: "1234",
    endNetWorth: "5678",
    durationSec: 3600,
    stats: { money: { droppedRate: 0.01 } },
  },
  experience: {
    design: {
      intent: "strategic-optimization",
      sessionPattern: { id: "twice-daily" },
    },
    session: {
      activeBlocks: 2,
      totalActiveSec: 3600,
      totalOfflineSec: 82800,
    },
    growth: {
      segments: [
        { tFrom: 0, tTo: 600, slope: 0.01, regime: "exp" },
        { tFrom: 600, tTo: 1200, slope: 0.02, regime: "super-exp" },
      ],
      bottlenecks: [{ t: 1800, reason: "Near-zero growth slope" }],
    },
    milestones: {
      milestones: [
        { key: "progress.first-upgrade", firstSeenSec: 120 },
        { key: "progress.first-automation", firstSeenSec: 840 },
      ],
      firstMilestoneSec: 120,
      firstActionSec: 120,
    },
    perceived: {
      firstVisibleChangeSec: 15,
      visibleChangesPerMinute: 6.5,
      maxNoRewardGapSec: 42,
      avgPostPurchaseFeedbackSec: 5,
      p95PostPurchaseFeedbackSec: 10,
      visibleChangeCount: 120,
      activeSeconds: 3600,
    },
  },
  ltv: {
    summary: {
      at30m: { endNetWorth: "1e3" },
      at2h: { endNetWorth: "1e4" },
      at24h: { endNetWorth: "1e5" },
      at7d: { endNetWorth: "1e6" },
    },
  },
} as const;

const reviewCompareOutput = {
  bundle: "design",
  milestoneKey: "progress.first-upgrade",
  summary: {
    winners: {
      a: 2,
      b: 1,
      tie: 0,
    },
  },
  results: [
    {
      metric: "visibleChangesPerMinute",
      better: "a",
      detail: { source: "measured" },
      insights: {
        drivers: [{ key: "visibleChangesPerMinute", winner: "a", summary: "A changes faster." }],
      },
      measured: { a: { visibleChangesPerMinute: 6.2 }, b: { visibleChangesPerMinute: 4.1 } },
    },
    {
      metric: "timeToMilestone",
      better: "b",
      detail: { source: "measured" },
      insights: {
        drivers: [{ key: "timeToMilestone", winner: "b", summary: "B hits upgrade sooner." }],
      },
      measured: { a: { timeToMilestone: 300 }, b: { timeToMilestone: 180 } },
    },
  ],
} as const;

function createPromptStub(responses: {
  select: readonly unknown[];
  text: readonly string[];
  confirm?: readonly boolean[];
}) {
  const calls: string[] = [];
  let selectIndex = 0;
  let textIndex = 0;
  let confirmIndex = 0;
  const prompt = {
    intro(message: string) {
      calls.push(`intro:${message}`);
    },
    outro(message: string) {
      calls.push(`outro:${message}`);
    },
    note(message: string, title?: string) {
      calls.push(`note:${title ?? ""}:${message}`);
    },
    async select(message: string) {
      calls.push(`select:${message}`);
      return responses.select[selectIndex++] as never;
    },
    async text(message: string) {
      calls.push(`text:${message}`);
      return responses.text[textIndex++] ?? "";
    },
    async confirm(message: string) {
      calls.push(`confirm:${message}`);
      return responses.confirm?.[confirmIndex++] ?? true;
    },
    async group<T extends Record<string, () => Promise<unknown>>>(steps: T) {
      const out: Record<string, unknown> = {};
      for (const [key, step] of Object.entries(steps)) {
        out[key] = await step();
      }
      return out as { [K in keyof T]: Awaited<ReturnType<T[K]>> };
    },
  };
  return { prompt, calls };
}

describe("interactive CLI helpers", () => {
  it("wizard skips track/preset/name prompts when flags already provided", async () => {
    const { prompt, calls } = createPromptStub({
      select: ["strategic-optimization", "twice-daily"],
      text: ["CREDIT", "Cr", "2.5", "40", "1.2", "1.4"],
    });

    const result = await runInitWizard({
      prompt: prompt as never,
      terminal: interactiveTerminal,
      runtimeArgs: ["--track", "personal", "--preset", "builder", "--name", "Orbital Foundry"],
      outPath: "/tmp/orbital-foundry.json",
      initialTrack: "personal",
      initialPreset: "builder",
      initialName: "Orbital Foundry",
    });

    expect(result.track).toBe("personal");
    expect(result.preset).toBe("builder");
    expect(result.name).toBe("Orbital Foundry");
    expect(calls.some((call) => call === "select:Choose a template track")).toBeFalse();
    expect(calls.some((call) => call === "select:Choose a pacing preset")).toBeFalse();
    expect(calls.some((call) => call === "text:Bundle display name")).toBeFalse();

    const plan = buildInitTemplatePlan({
      track: result.track,
      preset: result.preset,
      outPath: "/tmp/orbital-foundry.json",
      name: result.name,
      overrides: result.overrides,
    });
    const base = plan.find((file) => file.kind === "scenario")?.content as any;
    expect(base.unit.code).toBe("CREDIT");
    expect(base.unit.symbol).toBe("Cr");
    expect(base.model.params.incomePerSec).toBe("2.5");
  });

  it("init scenario --wizard fails in non-interactive mode with CLI_USAGE", async () => {
    const dir = await createTempDir("idlekit-wizard");
    try {
      const result = runCliFailure(["init", "scenario", "--wizard", "true", "--out", resolve(dir, "wizard.json")]);
      expect(result.stderr).toContain("[CLI_USAGE]");
      expect(result.stderr).toContain("interactive terminal");
    } finally {
      await removePath(dir);
    }
  });

  it("review evaluate uses the TUI render path in interactive mode", async () => {
    let called = false;
    const cli = await createCLI(
      { name: "idk", version: "test", generated: false },
      {
        getTerminalInfo: () => interactiveTerminal,
        runTuiRender: async (args) => {
          called = true;
          expect(args.command.name).toBe("evaluate");
          const element = renderReviewEvaluate(args as never, () => reviewEvaluateOutput as never);
          expect(element).toBeDefined();
        },
      },
    );
    cli.command(
      defineGroup({
        name: "review",
        description: "review commands",
        commands: [
          defineCommand({
            name: "evaluate",
            description: "review evaluate",
            handler() {},
            render(args) {
              return renderReviewEvaluate(args as never, () => reviewEvaluateOutput as never);
            },
          }),
        ],
      }),
    );

    await cli.execute("review evaluate", ["/tmp/sample.json"]);
    expect(called).toBeTrue();
  });

  it("review compare uses the TUI render path in interactive mode", async () => {
    let called = false;
    const cli = await createCLI(
      { name: "idk", version: "test", generated: false },
      {
        getTerminalInfo: () => interactiveTerminal,
        runTuiRender: async (args) => {
          called = true;
          expect(args.command.name).toBe("compare");
          const element = renderReviewCompare(args as never, () => reviewCompareOutput as never);
          expect(element).toBeDefined();
        },
      },
    );
    cli.command(
      defineGroup({
        name: "review",
        description: "review commands",
        commands: [
          defineCommand({
            name: "compare",
            description: "review compare",
            handler() {},
            render(args) {
              return renderReviewCompare(args as never, () => reviewCompareOutput as never);
            },
          }),
        ],
      }),
    );

    await cli.execute("review compare", ["/tmp/a.json", "/tmp/b.json"]);
    expect(called).toBeTrue();
  });

  it("review evaluate image plan is deterministic and respects image mode", () => {
    const offPlan = resolveReviewEvaluateImagePlan({
      output: reviewEvaluateOutput,
      image: { mode: "off", protocol: "auto" },
    });
    expect(offPlan.charts.length).toBe(0);

    const autoPlan = resolveReviewEvaluateImagePlan({
      output: reviewEvaluateOutput,
      image: { mode: "auto", protocol: "auto" },
      env: { TERM: "xterm-kitty" },
      stdout: { isTTY: true } as never,
    });
    expect(autoPlan.charts.length).toBe(2);
    expect(sha256Hex(autoPlan.charts[0]!.bytes)).toBe(sha256Hex(autoPlan.charts[0]!.bytes));

    expect(() =>
      resolveReviewEvaluateImagePlan({
        output: reviewEvaluateOutput,
        image: { mode: "on", protocol: "auto" },
        env: { TERM: "dumb" },
        stdout: { isTTY: false } as never,
      }),
    ).toThrow("Image preview is not available in this terminal");
  });

  it("review compare image plan supports overlay charts and fallback", () => {
    const offPlan = resolveReviewCompareImagePlan({
      aPath: "/tmp/a.json",
      bPath: "/tmp/b.json",
      flags: {
        plugin: "",
        "allow-plugin": false,
        "plugin-root": "",
        "plugin-sha256": "",
        "plugin-trust-file": "",
        fast: false,
        "max-duration": 86400,
      },
      image: { mode: "off", protocol: "auto" },
    });
    expect(offPlan.charts.length).toBe(0);

    const autoPlan = resolveReviewCompareImagePlan({
      aPath: "/tmp/a.json",
      bPath: "/tmp/b.json",
      flags: {
        plugin: "",
        "allow-plugin": false,
        "plugin-root": "",
        "plugin-sha256": "",
        "plugin-trust-file": "",
        fast: false,
        "max-duration": 86400,
      },
      image: { mode: "auto", protocol: "auto" },
      env: { TERM: "xterm-kitty" },
      stdout: { isTTY: true } as never,
      eager: true,
      overlayLoader: (_path) => ({
        growthSegments: [
          { tTo: 300, slope: 0.01 },
          { tTo: 600, slope: 0.015 },
        ],
        ltvSummary: {
          at30m: { endNetWorth: "1e3" },
          at7d: { endNetWorth: "1e6" },
        },
      }),
    });
    expect(autoPlan.charts.length).toBe(2);
    expect(sha256Hex(autoPlan.charts[0]!.bytes)).toBe(sha256Hex(autoPlan.charts[0]!.bytes));
  });

  it("review commands fail with CLI_USAGE in non-interactive mode", () => {
    const evaluateResult = runCliFailure(["review", "evaluate", "../../examples/tutorials/11-my-game-v1.json"]);
    expect(evaluateResult.stderr).toContain("[CLI_USAGE]");

    const compareResult = runCliFailure([
      "review",
      "compare",
      "../../examples/tutorials/11-my-game-v1.json",
      "../../examples/tutorials/12-my-game-compare-b.json",
    ]);
    expect(compareResult.stderr).toContain("[CLI_USAGE]");
  });
});
