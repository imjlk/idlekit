import { describe, expect, it } from "bun:test";
import { createNumberEngine } from "../engine/breakInfinity";
import { VisibilityTracker } from "./visibilityTracker";

const E = createNumberEngine();
const unit = { code: "COIN" as const };

describe("VisibilityTracker", () => {
  it("detects visible string changes", () => {
    const tracker = new VisibilityTracker(E, { significantDigits: 3 });

    const first = tracker.observe({ unit, amount: 999 });
    expect(first.changed).toBeFalse();

    const second = tracker.observe({ unit, amount: 1001 });
    expect(second.changed).toBeTrue();
    expect(second.previous).toBeDefined();
    expect(second.current).not.toBe(second.previous);
  });

  it("can reset state", () => {
    const tracker = new VisibilityTracker(E);
    tracker.observe({ unit, amount: 1 });
    tracker.reset();
    expect(tracker.current()).toBeUndefined();
  });
});
