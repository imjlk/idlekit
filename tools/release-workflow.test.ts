import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { createRequire } from "module";
import { resolve } from "path";

const { parse } = createRequire(resolve(import.meta.dir, "../packages/cli/package.json"))("yaml") as {
  parse: (input: string) => unknown;
};

type Step = {
  name: string;
  uses?: string;
  run?: string;
  with?: Record<string, string>;
  env?: Record<string, string>;
};
type Job = { if: string; permissions: Record<string, string>; steps: Step[] };
type Workflow = {
  on: { push: { branches: string[] }; workflow_dispatch: { inputs: { publish: { type: string; default: boolean } } } };
  permissions: Record<string, string>;
  jobs: { prepare: Job; publish: Job };
};
const workflow = parse(readFileSync(resolve(import.meta.dir, "../.github/workflows/release.yml"), "utf8")) as Workflow;

/** Evaluate only the boolean/string subset used by these job guards. */
function allows(guard: string, event: string, ref: string, publish: boolean): boolean {
  const expression = guard
    .replaceAll("github.event_name", JSON.stringify(event))
    .replaceAll("github.ref", JSON.stringify(ref))
    .replaceAll("inputs.publish", String(publish));
  if (!/^(?:\s|'[^'\\]*'|"[^"\\]*"|true|false|&&|\|\||!|==|\(|\))*$/.test(expression)) {
    throw new Error("Unsupported release guard syntax");
  }
  return Boolean(Function(`return (${expression})`)());
}

describe("release preparation and publishing", () => {
  it("publishes only on an explicit manual request on main", () => {
    const cases = [
      ["push", "refs/heads/main", false, true, false],
      ["push", "refs/heads/main", true, true, false],
      ["workflow_dispatch", "refs/heads/main", false, true, false],
      ["workflow_dispatch", "refs/heads/main", true, false, true],
      ["workflow_dispatch", "refs/heads/feature", false, false, false],
      ["workflow_dispatch", "refs/heads/feature", true, false, false],
      ["pull_request", "refs/heads/main", true, false, false],
    ] as const;
    for (const [event, ref, publish, prepareAllowed, publishAllowed] of cases) {
      expect(allows(workflow.jobs.prepare.if, event, ref, publish)).toBe(prepareAllowed);
      expect(allows(workflow.jobs.publish.if, event, ref, publish)).toBe(publishAllowed);
    }
    expect(workflow.on.push.branches).toEqual(["main"]);
    expect(workflow.on.workflow_dispatch.inputs.publish).toMatchObject({ type: "boolean", default: false });
  });

  it("keeps publish commands and registry credentials out of preparation", () => {
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.jobs.prepare.permissions["id-token"]).toBeUndefined();
    expect(workflow.jobs.publish.permissions["id-token"]).toBe("write");
    const preparation = JSON.stringify(workflow.jobs.prepare);
    expect(preparation).not.toContain("NPM_TOKEN");
    expect(preparation).not.toContain("NODE_AUTH_TOKEN");
    expect(preparation).not.toContain("setup-node@");
    for (const [jobName, job] of Object.entries(workflow.jobs)) {
      const actions = job.steps.filter((step) => step.uses?.startsWith("bruits/sampo/"));
      expect(actions).toHaveLength(1);
      expect(actions[0]?.with?.command).toBe(jobName === "prepare" ? "release" : "publish");
      expect(actions[0]?.with?.command).not.toBe("auto");
    }
    const registrySteps = workflow.jobs.publish.steps.filter((step) => step.env?.NODE_AUTH_TOKEN);
    expect(registrySteps).toHaveLength(1);
    expect(registrySteps[0]?.with?.command).toBe("publish");
    expect(workflow.jobs.publish.steps.findIndex((step) => step.name === "Require consumed changesets"))
      .toBeLessThan(workflow.jobs.publish.steps.findIndex((step) => step.with?.command === "publish"));
  });
});
