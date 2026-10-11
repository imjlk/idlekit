import { validateScenarioStructure } from "./scenarioContract";

const accepted = {
  schemaVersion: 1,
  unit: { code: "COIN" },
  policy: { mode: "drop" },
  model: { id: "m", version: 1 },
  initial: { wallet: { unit: "COIN", amount: "1e400" } },
  clock: { stepSec: 1, durationSec: 1 },
};

const rejected = {
  ...accepted,
  policy: { mode: "nope" },
};

const ok = validateScenarioStructure(accepted);
const bad = validateScenarioStructure(rejected);
if (!ok.success || bad.success) {
  console.error("contract-bad");
  process.exit(1);
}
console.log("contract-ok");
