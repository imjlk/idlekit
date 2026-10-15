import { defineCommand, option } from "../runtime/command";
import { z } from "zod";
import { resolve } from "path";
import { refreshBalanceWorkflow } from "../balance/workflow";
import { renderBalanceFreshness, renderBalanceReport } from "../balance/report";
import type { PacingReport } from "../balance/pacing";
import { usageError } from "../errors";
import { pluginOptions } from "./_shared/plugin";
import { readTextFile, writeStdout } from "../runtime/bun";

export default defineCommand({
  name: "balance",
  description: "Refresh a typed CSV balance sheet into scenario, pacing checks, and result sheets",
  options: {
    ...pluginOptions(),
    check: option(z.coerce.boolean().default(false), { description: "Check result freshness without rerunning simulations" }),
    format: option(z.enum(["json", "md"]).default("json"), { description: "JSON manifest or human-readable target explanations" }),
  },
  async handler({ flags, positional }) {
    if (positional.length !== 1) throw usageError("Usage: idk balance <workflow.json> [--check] [plugin options]");
    const result = await refreshBalanceWorkflow(positional[0]!, flags, flags.check);
    const body = flags.format === "json" ? JSON.stringify(result, null, 2) : "state" in result
      ? renderBalanceFreshness(result)
      : renderBalanceReport(JSON.parse(await readTextFile(resolve(result.generationPath, "results.json"))) as PacingReport, result.generationPath);
    await writeStdout(body + "\n");
    if (flags.check && "state" in result && result.state !== "current") process.exitCode = 1;
    if ("outcome" in result && !result.outcome.ok) process.exitCode = 1;
  },
});
