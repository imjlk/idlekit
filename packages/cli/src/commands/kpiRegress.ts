import { defineCommand, option } from "@bunli/core";
import { resolve } from "path";
import { z } from "zod";
import { buildOutputMeta } from "../io/outputMeta";
import { writeOutput } from "../io/writeOutput";
import { readJsonFile } from "../runtime/bun";

type Side = "a" | "b";
type Horizon = "at7d" | "at30d" | "at90d";

function toLog10(value: unknown): number {
  if (typeof value === "number") {
    if (value <= 0) return Number.NEGATIVE_INFINITY;
    return Math.log10(value);
  }
  if (typeof value !== "string") {
    throw new Error(`Expected numeric string, got ${typeof value}`);
  }

  const s = value.trim().toLowerCase();
  if (!s || s === "0") return Number.NEGATIVE_INFINITY;

  const asNum = Number(s);
  if (Number.isFinite(asNum) && asNum > 0) return Math.log10(asNum);

  const sci = s.match(/^([+-]?\d+(?:\.\d+)?)e([+-]?\d+)$/);
  if (sci) {
    const m = Number(sci[1] ?? "");
    const e = Number(sci[2] ?? "");
    if (!Number.isFinite(m) || !Number.isFinite(e) || m <= 0) {
      throw new Error(`Invalid numeric string: ${value}`);
    }
    return Math.log10(m) + e;
  }

  throw new Error(`Unsupported numeric string: ${value}`);
}

function readHorizon(report: any, side: Side, horizon: Horizon): any {
  const row = report?.ltv?.[side]?.summary?.[horizon];
  if (!row || typeof row !== "object") {
    throw new Error(`Missing horizon '${horizon}' for side '${side}'`);
  }
  return row;
}

export default defineCommand({
  name: "regress",
  description: "Run long-horizon KPI regression gate",
  options: {
    baseline: option(z.string().default("examples/bench/kpi-baseline.json"), {
      description: "Baseline KPI report path",
    }),
    current: option(z.string().default("tmp/kpi-report.json"), {
      description: "Current KPI report path",
    }),
    "min-worth-ratio": option(z.coerce.number().positive().default(0.97), {
      description: "Minimum allowed current/baseline endNetWorth ratio",
    }),
    "max-stall-delta": option(z.coerce.number().nonnegative().default(0.03), {
      description: "Maximum allowed stallRatio increase",
    }),
    "max-dropped-delta": option(z.coerce.number().nonnegative().default(0.03), {
      description: "Maximum allowed droppedRate increase",
    }),
    out: option(z.string().optional(), { description: "Output path" }),
    format: option(z.enum(["json", "md", "csv"]).default("json"), { description: "Output format" }),
  },
  async handler({ flags }) {
    const baselinePath = resolve(flags.baseline);
    const currentPath = resolve(flags.current);
    const baseline = await readJsonFile<any>(baselinePath);
    const current = await readJsonFile<any>(currentPath);

    const horizons: Horizon[] = ["at7d", "at30d", "at90d"];
    const sides: Side[] = ["a", "b"];
    const checks: Array<{
      side: Side;
      horizon: Horizon;
      baseline: {
        endNetWorth: string;
        stallRatio: number;
        droppedRate: number;
      };
      current: {
        endNetWorth: string;
        stallRatio: number;
        droppedRate: number;
      };
      deltas: {
        endWorthLog10: number;
        stallRatio: number;
        droppedRate: number;
      };
      thresholds: {
        minWorthLog10Delta: number;
        maxStallDelta: number;
        maxDroppedDelta: number;
      };
      pass: {
        worth: boolean;
        stallRatio: boolean;
        droppedRate: boolean;
        overall: boolean;
      };
    }> = [];

    const minWorthLog10Delta = Math.log10(flags["min-worth-ratio"]);
    for (const side of sides) {
      for (const horizon of horizons) {
        const b = readHorizon(baseline, side, horizon);
        const c = readHorizon(current, side, horizon);
        const bWorth = String(b.endNetWorth ?? "");
        const cWorth = String(c.endNetWorth ?? "");
        const bStall = Number(b.guardrails?.stallRatio ?? 0);
        const cStall = Number(c.guardrails?.stallRatio ?? 0);
        const bDropped = Number(b.guardrails?.droppedRate ?? 0);
        const cDropped = Number(c.guardrails?.droppedRate ?? 0);

        const worthDeltaLog10 = toLog10(cWorth) - toLog10(bWorth);
        const stallDelta = cStall - bStall;
        const droppedDelta = cDropped - bDropped;

        const worthPass = worthDeltaLog10 >= minWorthLog10Delta;
        const stallPass = stallDelta <= flags["max-stall-delta"];
        const droppedPass = droppedDelta <= flags["max-dropped-delta"];

        checks.push({
          side,
          horizon,
          baseline: {
            endNetWorth: bWorth,
            stallRatio: bStall,
            droppedRate: bDropped,
          },
          current: {
            endNetWorth: cWorth,
            stallRatio: cStall,
            droppedRate: cDropped,
          },
          deltas: {
            endWorthLog10: worthDeltaLog10,
            stallRatio: stallDelta,
            droppedRate: droppedDelta,
          },
          thresholds: {
            minWorthLog10Delta,
            maxStallDelta: flags["max-stall-delta"],
            maxDroppedDelta: flags["max-dropped-delta"],
          },
          pass: {
            worth: worthPass,
            stallRatio: stallPass,
            droppedRate: droppedPass,
            overall: worthPass && stallPass && droppedPass,
          },
        });
      }
    }

    const pass = checks.every((x) => x.pass.overall);
    const output = {
      baselinePath,
      currentPath,
      generatedAt: new Date().toISOString(),
      thresholds: {
        minWorthRatio: flags["min-worth-ratio"],
        maxStallDelta: flags["max-stall-delta"],
        maxDroppedDelta: flags["max-dropped-delta"],
      },
      pass,
      checks,
    };

    await writeOutput({
      format: flags.format,
      outPath: flags.out,
      data: output,
      meta: buildOutputMeta({ command: "kpi.regress" }),
    });

    if (!pass) {
      process.exit(2);
    }
  },
});
