import { describe, expect, it } from "bun:test";
import { createNumberEngine } from "../engine/breakInfinity";
import { tickMoney } from "./tickMoney";

const E = createNumberEngine();

describe("tickMoney", () => {
  it("blocks unit mismatch", () => {
    const r = tickMoney({
      E,
      state: {
        money: { unit: { code: "COIN" as const }, amount: 10 },
        bucket: 0,
      },
      delta: {
        unit: { code: "GEM" as const },
        amount: 1,
      },
      policy: { mode: "drop" },
    });

    expect(r.status).toBe("blocked");
    expect(r.events[0]?.type).toBe("blocked");
  });

  it("drops too small delta in drop mode", () => {
    const r = tickMoney({
      E,
      state: {
        money: { unit: { code: "COIN" as const }, amount: 1e12 },
        bucket: 0,
      },
      delta: {
        unit: { code: "COIN" as const },
        amount: 1,
      },
      policy: { mode: "drop", maxLogGap: 3 },
    });

    expect(r.status).toBe("ok");
    expect(r.state.money.amount).toBe(1e12);
    expect(r.events.some((e) => e.type === "dropped")).toBeTrue();
  });

  it("queues and flushes in accumulate mode", () => {
    const queued = tickMoney({
      E,
      state: {
        money: { unit: { code: "COIN" as const }, amount: 1e9 },
        bucket: 0,
      },
      delta: {
        unit: { code: "COIN" as const },
        amount: 1,
      },
      policy: { mode: "accumulate", maxLogGap: 3 },
    });

    expect(queued.state.bucket).toBe(1);
    expect(queued.events.some((e) => e.type === "queued")).toBeTrue();

    const flushed = tickMoney({
      E,
      state: queued.state,
      delta: {
        unit: { code: "COIN" as const },
        amount: 1e8,
      },
      policy: { mode: "accumulate", maxLogGap: 3 },
    });

    expect(flushed.state.bucket).toBe(0);
    expect(flushed.events.some((e) => e.type === "flushed")).toBeTrue();
    expect(flushed.events.some((e) => e.type === "applied")).toBeTrue();
  });
});
