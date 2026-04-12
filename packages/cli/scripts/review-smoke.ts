/** @jsxImportSource @opentui/react */
import { RuntimeProvider } from "@bunli/runtime/app";
import { testRender } from "@opentui/react/test-utils";
import { act, createElement } from "react";
import type { ResolvedTuiImageOptions } from "@bunli/core";
import { resolve } from "path";
import { REPO_ROOT, runCliJsonFromRepoRoot } from "../src/testkit/bun";
import { createLazyReviewElement } from "../src/lib/reviewLazy";
import { createReviewCompareElement, loadReviewCompareData, resolveReviewCompareImagePlan } from "../src/lib/reviewCompare";
import { createReviewDoctorElement, loadReviewDoctorData } from "../src/lib/reviewDoctor";
import { createReviewEvaluateElement, loadReviewEvaluateData, resolveReviewEvaluateImagePlan } from "../src/lib/reviewEvaluate";

const IMAGE_AUTO: ResolvedTuiImageOptions = {
  mode: "auto",
  protocol: "auto",
};

async function waitForFrameContains(
  renderOnce: () => Promise<void>,
  capture: () => string,
  patterns: readonly string[],
  timeoutMs = 12000,
): Promise<string> {
  const started = Date.now();
  let last = "";
  while (Date.now() - started < timeoutMs) {
    await act(async () => {
      await renderOnce();
    });
    last = capture();
    if (patterns.every((pattern) => last.includes(pattern))) return last;
    await act(async () => {
      await Bun.sleep(50);
    });
  }
  throw new Error(`Timed out waiting for '${patterns.join(", ")}'. Last frame:\n${last}`);
}

async function smokeElement(name: string, element: ReturnType<typeof createElement>, expected: readonly string[]) {
  const rendered = await testRender(createElement(RuntimeProvider as any, { onExit() {} }, element), {
    width: 120,
    height: 40,
  });

  try {
    await rendered.renderOnce();
    const firstFrame = rendered.captureCharFrame();
    if (!firstFrame.includes("Preparing interactive dashboard")) {
      throw new Error(`${name} did not render the shared loading shell first.\n${firstFrame}`);
    }

    const finalFrame = await waitForFrameContains(rendered.renderOnce, rendered.captureCharFrame, expected);
    if (!expected.every((pattern) => finalFrame.includes(pattern))) {
      throw new Error(`${name} did not reach expected content '${expected.join(", ")}'.`);
    }
  } finally {
    rendered.renderer.destroy();
  }
}

async function main() {
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    const message = args.map((arg) => String(arg)).join(" ");
    if (message.includes("not wrapped in act")) return;
    originalConsoleError(...args);
  };

  try {
  const scenarioA = resolve(REPO_ROOT, "examples/tutorials/11-my-game-v1.json");
  const scenarioB = resolve(REPO_ROOT, "examples/tutorials/12-my-game-compare-b.json");

  const runner = <T,>(args: readonly string[]) => runCliJsonFromRepoRoot<T>([...args]);

  await smokeElement(
    "review doctor",
    createLazyReviewElement({
      title: "idlekit review doctor",
      description: "Loading setup and completions health checks for interactive review.",
      loader: async () => function ReviewDoctorLoaded() {
        const output = loadReviewDoctorData({ shell: "detect" }, runner);
        return createReviewDoctorElement({ output });
      },
      props: undefined as never,
    }),
    ["completions.installed"],
  );

  await smokeElement(
    "review evaluate",
    createLazyReviewElement({
      title: "idlekit review evaluate",
      description: "Loading simulate, experience, and LTV summaries for the design dashboard.",
      loader: async () => function ReviewEvaluateLoaded() {
        const flags = {
          plugin: "",
          "allow-plugin": false,
          "plugin-root": "",
          "plugin-sha256": "",
          "plugin-trust-file": "",
          fast: false,
          horizons: "30m,2h,24h",
          days: 1,
          draws: 1,
          "session-pattern": "short-bursts",
        } as const;
        const output = loadReviewEvaluateData(scenarioA, flags, runner);
        const imagePlan = resolveReviewEvaluateImagePlan({
          output,
          image: IMAGE_AUTO,
        });
        return createReviewEvaluateElement({
          output,
          image: IMAGE_AUTO,
          imagePlan,
        });
      },
      props: undefined as never,
    }),
    ["progress.first-upgrade"],
  );

  await smokeElement(
    "review compare",
    createLazyReviewElement({
      title: "idlekit review compare",
      description: "Loading comparison bundle and overlay charts for the review dashboard.",
      loader: async () => function ReviewCompareLoaded() {
        const flags = {
          plugin: "",
          "allow-plugin": false,
          "plugin-root": "",
          "plugin-sha256": "",
          "plugin-trust-file": "",
          fast: false,
          "max-duration": 3600,
          bundle: "design",
          days: 1,
          draws: 1,
          "session-pattern": "short-bursts",
        } as const;
        const output = loadReviewCompareData(scenarioA, scenarioB, flags, runner);
        const imagePlan = resolveReviewCompareImagePlan({
          aPath: scenarioA,
          bPath: scenarioB,
          flags,
          image: IMAGE_AUTO,
        });
        return createReviewCompareElement({
          aPath: scenarioA,
          bPath: scenarioB,
          output,
          image: IMAGE_AUTO,
          imagePlan,
          loadImagePlan: () =>
            resolveReviewCompareImagePlan({
              aPath: scenarioA,
              bPath: scenarioB,
              flags,
              image: IMAGE_AUTO,
              eager: true,
            }),
        });
      },
      props: undefined as never,
    }),
    ["timeToMilestone", "endNetWorth"],
  );

  const doctor = runCliJsonFromRepoRoot<any>(["doctor", "--format", "json"]);
  if (typeof doctor.ok !== "boolean") {
    throw new Error("doctor JSON output was not produced during review smoke verification.");
  }

  console.log("review smoke passed");
  } finally {
    console.error = originalConsoleError;
  }
}

await main();
