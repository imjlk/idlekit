import { describe, expect, it } from "bun:test";
import { createEventBuffer } from "./eventBuffer";

describe("event buffer", () => {
  it("aggregates dropped counts from retained nested runs", () => {
    const buffer = createEventBuffer<number>({ enabled: true });

    buffer.pushRun({
      events: [{ type: "action.applied", actionId: "buy.producer" }],
      eventTimeline: [{ t: 1, event: { type: "action.applied", actionId: "buy.producer" } }],
      eventLog: { enabled: true, totalSeen: 5, dropped: 4, retained: 1 },
    });

    const snapshot = buffer.snapshot();
    expect(snapshot.eventLog.totalSeen).toBe(5);
    expect(snapshot.eventLog.dropped).toBe(4);
    expect(snapshot.eventLog.retained).toBe(1);
    expect(snapshot.events).toHaveLength(1);
  });
});
