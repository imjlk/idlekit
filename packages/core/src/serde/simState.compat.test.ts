import { describe, expect, it } from "bun:test";
import { resolve } from "path";
import { createNumberEngine } from "../engine/breakInfinity";
import { deserializeSimState, parseSimStateJSON } from "./simState";

const E = createNumberEngine();
const FIXTURE = resolve(import.meta.dir, "../../../../fixtures/compat/v1/state/sim-state.v1.json");

describe("simState compatibility fixtures", () => {
  it("parses and deserializes the frozen v1 fixture", async () => {
    const parsed = parseSimStateJSON(await Bun.file(FIXTURE).json());
    expect(parsed.v).toBe(1);
    expect(parsed.meta?.runId).toBe("compat-sim-state-v1");
    expect(parsed.strategy?.id).toBe("greedy");

    const restored = deserializeSimState<number, "TOKEN", Record<string, unknown>>(E, parsed, {
      expectedUnit: "TOKEN",
      unitFactory: (code) => ({ code: code as "TOKEN" }),
    });
    expect(restored.wallet.money.unit.code).toBe("TOKEN");
    expect(restored.t).toBeGreaterThan(0);
    expect(typeof restored.vars).toBe("object");
  });
});
