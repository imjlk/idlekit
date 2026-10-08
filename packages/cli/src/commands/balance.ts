import { defineCommand, option } from "../runtime/command";
import { z } from "zod";
import { refreshBalanceWorkflow } from "../balance/workflow";
import { usageError } from "../errors";
import { pluginOptions } from "./_shared/plugin";
import { writeStdout } from "../runtime/bun";

export default defineCommand({
  name: "balance",
  description: "Refresh a typed CSV balance sheet into scenario, pacing checks, and result sheets",
  options: {
    ...pluginOptions(),
    check: option(z.coerce.boolean().default(false), { description: "Check result freshness without rerunning simulations" }),
  },
  async handler({ flags, positional }) {
    if (positional.length !== 1) throw usageError("Usage: idk balance <workflow.json> [--check] [plugin options]");
    const result = await refreshBalanceWorkflow(positional[0]!, flags, flags.check);
    await writeStdout(JSON.stringify(result, null, 2) + "\n");
    if (flags.check && "state" in result && result.state !== "current") process.exitCode = 1;
    if ("outcome" in result && !result.outcome.ok) process.exitCode = 1;
  },
});
