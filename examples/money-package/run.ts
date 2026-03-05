import {
  VisibilityTracker,
  createNumberEngine,
  deserializeMoneyState,
  formatMoney,
  parseMoney,
  serializeMoneyState,
  tickMoney,
  type MoneyState,
} from "../../packages/money/src/index";

const E = createNumberEngine();
const unit = { code: "COIN" as const, symbol: "C" };

let state: MoneyState<number, "COIN"> = {
  money: { unit, amount: 1e9 },
  bucket: 0,
};

const policy = { mode: "accumulate" as const, maxLogGap: 6 };
const tracker = new VisibilityTracker(E, { significantDigits: 3, showUnit: true });

function applyDelta(delta: number): void {
  const out = tickMoney({
    E,
    state,
    delta: { unit, amount: delta },
    policy,
    options: { collectEvents: true },
  });

  state = out.state;
  const vis = tracker.observe(state.money);

  console.log(`delta=${delta}`);
  console.log(`money=${formatMoney(E, state.money, { showUnit: true })}, bucket=${E.toString(state.bucket)}`);
  console.log(`events=${out.events.map((e) => e.type).join(",") || "(none)"}`);
  if (vis.changed) {
    console.log(`visible change: ${vis.previous} -> ${vis.current}`);
  }
  console.log("-");
}

console.log("Money package demo start");
console.log(`initial=${formatMoney(E, state.money, { showUnit: true })}`);
console.log("=");

applyDelta(1);
applyDelta(2);
applyDelta(5e5);

const parsed = parseMoney(E, "12.3aa COIN", {
  suffix: { kind: "alphaInfinite", minLen: 2 },
  allowUnitInString: true,
});
console.log(`parsed(12.3aa COIN)=${E.toString(parsed.amount)}`);

const json = serializeMoneyState(E, state, { engineName: "number", engineVersion: "1" });
const restored = deserializeMoneyState(E, json);
console.log(`serde restored=${formatMoney(E, restored.money, { showUnit: true })}`);
console.log("Money package demo complete");
