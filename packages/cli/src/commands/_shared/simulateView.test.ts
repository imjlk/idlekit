import { describe, expect, it } from "bun:test";
import { buildOfflineSummary, resolveEventLog } from "./simulateView";

describe("simulate view helpers", () => {
  it("keeps default event log when no override is provided", () => {
    const resolved = resolveEventLog({
      defaultEventLog: {
        enabled: true,
        maxEvents: 100,
      },
      eventLogEnabled: undefined,
      eventLogMax: undefined,
    });
    expect(resolved).toEqual({
      enabled: true,
      maxEvents: 100,
    });
  });

  it("applies partial event log overrides", () => {
    const resolved = resolveEventLog({
      defaultEventLog: {
        enabled: false,
        maxEvents: 10,
      },
      eventLogEnabled: true,
      eventLogMax: undefined,
    });
    expect(resolved).toEqual({
      enabled: true,
      maxEvents: 10,
    });
  });

  it("builds offline summary from offline run payload", () => {
    const summary = buildOfflineSummary({
      offline: {
        requestedSec: 120,
        preDecaySec: 120,
        effectiveSec: 110,
        simulatedSec: 110,
        stepSec: 1,
        fullSteps: 110,
        remainderSec: 0,
        usedStrategy: true,
        overflow: { clamped: false },
        decay: { kind: "none" },
      },
    });
    expect(summary).toEqual({
      requestedSec: 120,
      preDecaySec: 120,
      effectiveSec: 110,
      simulatedSec: 110,
      stepSec: 1,
      fullSteps: 110,
      remainderSec: 0,
      usedStrategy: true,
      overflow: { clamped: false },
      decay: { kind: "none" },
    });
  });
});
