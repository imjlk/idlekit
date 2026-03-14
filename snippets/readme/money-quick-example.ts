import {
  createBreakInfinityEngine,
  deserializeMoneyState,
  formatMoney,
  serializeMoneyState,
  tickMoney,
} from "@idlekit/money";

const E = createBreakInfinityEngine();
const unit = { code: "COIN" as const };

const result = tickMoney({
  E,
  state: {
    money: { unit, amount: E.from("1e6") },
    bucket: E.zero(),
  },
  delta: { unit, amount: E.from("25") },
  policy: { mode: "accumulate", maxLogGap: 6 },
});

const saved = serializeMoneyState(E, result.state, { engineName: "break_infinity.js" });
const restored = deserializeMoneyState(E, saved);

console.log(formatMoney(E, restored.money));
