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

  it("retains a batch larger than the engine's argument limit", () => {
    const count = 2_000_000;
    const events = Array.from({ length: count }, () => ({ type: "action.applied" as const, actionId: "buy" }));
    const eventTimeline = events.map((event, t) => ({ t, event }));
    const open = createEventBuffer<number>({ enabled: true });
    open.pushRun({ events, eventTimeline, eventLog: { enabled: true, totalSeen: count, dropped: 0, retained: count } });
    expect(open.snapshot().events).toHaveLength(count);

    const capped = createEventBuffer<number>({ enabled: true, maxEvents: count - 1 });
    capped.pushRun({ events, eventTimeline, eventLog: { enabled: true, totalSeen: count, dropped: 0, retained: count } });
    expect(capped.snapshot().events).toHaveLength(count - 1);
    expect(capped.snapshot().eventLog.dropped).toBe(1);
  });
});
