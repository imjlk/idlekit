import { validateScenarioStructure } from "@idlekit/core";

const accepted = validateScenarioStructure({
  schemaVersion: 1,
  unit: { code: "COIN" },
  policy: { mode: "drop" },
  model: { id: "m", version: 1 },
  initial: { wallet: { unit: "COIN", amount: "1e400" } },
  clock: { stepSec: 1, durationSec: 1 },
});
const rejected = validateScenarioStructure({
  schemaVersion: 1,
  unit: { code: "COIN" },
  policy: { mode: "nope" },
  model: { id: "m", version: 1 },
  initial: { wallet: { unit: "COIN", amount: "1" } },
  clock: { stepSec: 1, durationSec: 1 },
});
if (!accepted.success || rejected.success) throw new Error("published validator mismatch");
console.log("published-ok");
