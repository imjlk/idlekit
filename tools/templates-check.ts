import { resolve } from "path";
import { stableStringify } from "../packages/cli/src/io/outputMeta";
import { buildCanonicalPersonalBuilderExamples, buildInitTemplatePlan } from "../packages/cli/src/templates/scenario";

function assertEqual(label: string, actual: unknown, expected: unknown): void {
  if (stableStringify(actual) === stableStringify(expected)) return;
  throw new Error(`${label} drift detected`);
}

const root = process.cwd();
const canonical = buildCanonicalPersonalBuilderExamples();

assertEqual(
  "examples/tutorials/11-my-game-v1.json",
  await Bun.file(resolve(root, "examples/tutorials/11-my-game-v1.json")).json(),
  canonical.base,
);
assertEqual(
  "examples/tutorials/12-my-game-compare-b.json",
  await Bun.file(resolve(root, "examples/tutorials/12-my-game-compare-b.json")).json(),
  canonical.compare,
);
assertEqual(
  "examples/tutorials/13-my-game-tune.json",
  await Bun.file(resolve(root, "examples/tutorials/13-my-game-tune.json")).json(),
  canonical.tune,
);

const namedPlan = buildInitTemplatePlan({
  track: "personal",
  preset: "builder",
  outPath: resolve(root, "tmp", "space-miner-v1.json"),
  name: "Space Miner",
});

const namedBase = namedPlan.find((file) => file.kind === "scenario");
const namedCompare = namedPlan.find((file) => file.kind === "compare");
const namedTune = namedPlan.find((file) => file.kind === "tune");

if (!namedBase || !namedCompare || !namedTune) {
  throw new Error("Named personal bundle plan is incomplete");
}

if (!namedBase.path.endsWith("space-miner-v1.json")) {
  throw new Error("Named personal bundle base path mismatch");
}
if (!namedCompare.path.endsWith("space-miner-v1-compare-b.json")) {
  throw new Error("Named personal bundle compare path mismatch");
}
if (!namedTune.path.endsWith("space-miner-v1-tune.json")) {
  throw new Error("Named personal bundle tune path mismatch");
}

const namedBaseContent = namedBase.content as Record<string, any>;
const namedCompareContent = namedCompare.content as Record<string, any>;
const namedTuneContent = namedTune.content as Record<string, any>;

if (namedBaseContent.meta?.id !== "space-miner-v1" || namedBaseContent.meta?.title !== "Space Miner V1 Template") {
  throw new Error("Named personal bundle base metadata mismatch");
}
if (namedCompareContent.meta?.id !== "space-miner-v1-compare-b") {
  throw new Error("Named personal bundle compare metadata mismatch");
}
if (namedTuneContent.meta?.id !== "space-miner-v1-tune") {
  throw new Error("Named personal bundle tune metadata mismatch");
}

console.log("OK: template fixtures and named personal bundle match canonical sources");
