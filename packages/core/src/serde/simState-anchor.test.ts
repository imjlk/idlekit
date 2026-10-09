import { expect, test } from "bun:test";
import { createNumberEngine } from "../engine/breakInfinity";
import { deserializeSimState, parseSimStateJSON, serializeSimState } from "./simState";

const E = createNumberEngine();
const unit = { code: "COIN" };
const state = {
  t: 20,
  wallet: { money: { unit, amount: 80 }, bucket: 0 },
  maxMoneyEver: { unit, amount: 80 },
  prestige: { count: 1, points: 0, multiplier: 1 },
  vars: {},
};

test("sim state metadata round-trips a zero prestige anchor without requiring other metadata", () => {
  const saved = serializeSimState(E, state, { lastPrestigeResetT: 0 });
  const parsed = parseSimStateJSON(JSON.parse(JSON.stringify(saved)));
  expect(parsed.meta?.lastPrestigeResetT).toBe(0);
  expect(deserializeSimState(E, parsed)).toEqual(state);
});

test("sim state anchors are finite past times and remain optional for older files", () => {
  const legacy = serializeSimState(E, state);
  expect(parseSimStateJSON(legacy).meta?.lastPrestigeResetT).toBeUndefined();
  expect(parseSimStateJSON({ ...legacy, meta: { lastPrestigeResetT: -1 } }).meta?.lastPrestigeResetT).toBe(-1);
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, "0", 21]) {
    expect(() => parseSimStateJSON({ ...legacy, meta: { lastPrestigeResetT: value } })).toThrow("Invalid sim state json");
  }
});
