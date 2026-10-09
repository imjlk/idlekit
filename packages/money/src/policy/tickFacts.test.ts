import { describe, expect, it } from "bun:test";
import { createBreakInfinityEngine, createNumberEngine } from "../engine/breakInfinity";
import type { Engine } from "../engine/types";
import { tickMoney } from "./tickMoney";

function checksFacts<N>(E: Engine<N>): void {
  const unit = { code: "COIN" as const };
  const cases = [
    { mode: "drop" as const, base: "25", bucket: "0", delta: "1", otherUnit: false },
    { mode: "drop" as const, base: "1e12", bucket: "0", delta: "1", otherUnit: false },
    { mode: "accumulate" as const, base: "1e9", bucket: "0", delta: "1", otherUnit: false },
    { mode: "accumulate" as const, base: "1e9", bucket: "1e7", delta: "1", otherUnit: false },
    { mode: "accumulate" as const, base: "25", bucket: "10", delta: "-11", otherUnit: false },
    { mode: "drop" as const, base: "0", bucket: "0", delta: "1e-13", otherUnit: false },
    { mode: "drop" as const, base: "25", bucket: "0", delta: "0", otherUnit: false },
    { mode: "drop" as const, base: "25", bucket: "0", delta: "1", otherUnit: true },
  ];
  for (const value of cases) {
    const args = {
      E,
      state: { money: { unit, amount: E.from(value.base) }, bucket: E.from(value.bucket) },
      delta: { unit: { code: value.otherUnit ? "GEM" : "COIN" }, amount: E.from(value.delta) },
      policy: { mode: value.mode, maxLogGap: 3 },
    };
    const full = tickMoney(args);
    expect(Object.hasOwn(full, "facts")).toBe(false);
    const counts = { applied: 0, dropped: 0, queued: 0, flushed: 0, blocked: 0 };
    for (const event of full.events) counts[event.type]++;
    for (const collectEvents of [true, false]) {
      const facts = tickMoney({ ...args, options: { collectEvents, collectFacts: true } });
      expect(facts.facts).toEqual(counts);
      expect(facts.status).toBe(full.status);
      expect(E.toString(facts.state.money.amount)).toBe(E.toString(full.state.money.amount));
      expect(E.toString(facts.state.bucket)).toBe(E.toString(full.state.bucket));
      expect(facts.events.length).toBe(collectEvents ? full.events.length : 0);
      const applied = full.events.find((event) => event.type === "applied");
      const flushed = full.events.find((event) => event.type === "flushed");
      expect(facts.appliedDelta === undefined ? undefined : E.toString(facts.appliedDelta)).toBe(applied === undefined ? undefined : E.toString(applied.delta));
      expect(facts.flushedBucket === undefined ? undefined : E.toString(facts.flushedBucket)).toBe(flushed === undefined ? undefined : E.toString(flushed.bucketFlushed));
    }
  }
}

describe("compact tick facts", () => {
  it("matches retained events without allocating them for both engines", () => {
    checksFacts(createNumberEngine());
    checksFacts(createBreakInfinityEngine());
  });
});
