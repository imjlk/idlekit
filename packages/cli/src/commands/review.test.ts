import { describe, expect, it } from "bun:test";
import { resolve } from "path";
import { runInitWizard } from "../lib/initWizard";
import { buildInitTemplatePlan } from "../templates/scenario";
import { createTempDir, removePath, runCli, runCliFailure, runCliJson } from "../testkit/bun";
const interactiveTerminal = { width: 120, height: 40, isInteractive: true, isCI: false, supportsColor: true, supportsMouse: false } as const;

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

});

describe("review report aliases", () => {
  const a = "../../examples/tutorials/01-cafe-baseline.json";
  const b = "../../examples/tutorials/03-cafe-compare-b.json";
  it("prints an evaluate Markdown report without requiring a TTY", () => {
    const result = runCli(["review", "evaluate", a, "--days", "1", "--horizons", "10s", "--step", "60"]);
    expect(result.stdout).toContain("# Evaluate Report");
  });
  it("keeps the compare JSON report contract available", () => {
    const report = runCliJson(["review", "compare", a, b, "--duration", "2", "--bundle", "economy", "--format", "json"]);
    expect(report.bundle).toBe("economy");
    expect(report.results.map((result: { metric: string }) => result.metric)).toEqual(["endMoney", "endNetWorth", "droppedRate"]);
    expect(report._meta.command).toBe("compare");
  });
  it("prints a doctor Markdown report without requiring a TTY", () => {
    const result = runCli(["review", "doctor"]);
    expect(result.stdout).toContain("# Doctor Report");
  });
});
