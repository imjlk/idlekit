import { defineCommand, option } from "@bunli/core";
import { compareScenarios, validateScenarioV1 } from "@idlekit/core";
import { z } from "zod";
import { readScenarioFile } from "../io/readScenario";
import { writeOutput } from "../io/writeOutput";

export default defineCommand({
  name: "compare",
  description: "Compare two scenarios",
  options: {
    metric: option(
      z.enum(["endMoney", "endNetWorth", "etaToTargetWorth", "droppedRate"]).default("endNetWorth"),
      { description: "Comparison metric" },
    ),
    out: option(z.string().optional(), { description: "Output path" }),
    format: option(z.enum(["json", "md", "csv"]).default("json"), { description: "Output format" }),
  },
  async handler({ flags, positional }) {
    const aPath = positional[0];
    const bPath = positional[1];
    if (!aPath || !bPath) {
      throw new Error("Usage: econ compare <A> <B> [--metric endNetWorth|etaToTargetWorth|droppedRate]");
    }

    const [aInput, bInput] = await Promise.all([readScenarioFile(aPath), readScenarioFile(bPath)]);

    const va = validateScenarioV1(aInput);
    const vb = validateScenarioV1(bInput);

    if (!va.ok || !va.scenario) {
      throw new Error(`Scenario A invalid: ${va.issues.map((i) => i.message).join("; ")}`);
    }
    if (!vb.ok || !vb.scenario) {
      throw new Error(`Scenario B invalid: ${vb.issues.map((i) => i.message).join("; ")}`);
    }

    const result = compareScenarios({
      a: va.scenario,
      b: vb.scenario,
      metric: flags.metric,
    });

    await writeOutput({
      format: flags.format,
      outPath: flags.out,
      data: {
        metric: flags.metric,
        better: result.better,
        detail: result.detail,
      },
    });
  },
});
