import { validateScenarioStructure } from "@idlekit/core";

const accepted = validateScenarioStructure({
  schemaVersion: 1,
  unit: { code: "COIN" },
  policy: { mode: "drop" },
  model: { id: "m", version: 1 },
  initial: { wallet: { unit: "COIN", amount: "1" } },
  clock: { stepSec: 1, durationSec: 1 },
});
if (!accepted.success) throw new Error("types");
export const code: string = accepted.data.unit.code;
