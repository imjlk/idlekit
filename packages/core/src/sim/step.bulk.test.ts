import { describe, expect, it } from "bun:test";
import { createBreakInfinityEngine, createNumberEngine } from "../engine/breakInfinity";
import type { Engine } from "../engine/types";
import type { Money } from "../money/types";
import { checkBulk, checkNonNegative, expectProperty } from "../testkit/conformanceRun";
import { buildSimStats } from "./analysis/ux";
import { singleBuySize, stepOnce } from "./step";
import { createGreedyStrategy } from "./strategy/greedy";
import { quotedDecisionSize } from "./strategy/stability";
import type { Action, BulkQuote, Model, SimContext, SimEvent, SimState } from "./types";

type UnitCode = "COIN";
type Vars = { owned: number; bonus: number; tier: number };

const formulaSize = 10;
const formulaUnit = 10;
const formulaTotal = formulaUnit * formulaSize;
const declaredSeed = 0xb011;

function context<N>(
  engine: Engine<N>,
  payment?: SimContext<N, UnitCode, Vars>["payment"],
): SimContext<N, UnitCode, Vars> {
  return {
    E: engine,
    unit: { code: "COIN" },
    tickPolicy: { mode: "drop" },
    payment,
  };
}

function state<N>(engine: Engine<N>, amount: N, vars?: Partial<Vars>): SimState<N, UnitCode, Vars> {
  return {
    t: 0,
    wallet: { money: { unit: { code: "COIN" }, amount }, bucket: engine.zero() },
    maxMoneyEver: { unit: { code: "COIN" }, amount },
    prestige: { count: 0, points: engine.zero(), multiplier: engine.from(1) },
    vars: {
      owned: vars?.owned ?? 0,
      bonus: vars?.bonus ?? 0,
      tier: vars?.tier ?? 0,
    },
  };
}

function coin<N>(engine: Engine<N>, amount: N): Money<N, UnitCode> {
  return { unit: { code: "COIN" }, amount };
}

function snapshot<N>(engine: Engine<N>, current: SimState<N, UnitCode, Vars>): string {
  return JSON.stringify({
    wallet: engine.toString(current.wallet.money.amount),
    owned: current.vars.owned,
    bonus: current.vars.bonus,
  });
}

function flatBuy<N>(engine: Engine<N>, calls: { cost: number; bulk: number; apply: number }): Action<N, UnitCode, Vars> {
  return {
    id: "buy",
    kind: "buy",
    canApply: () => true,
    cost: () => {
      calls.cost += 1;
      return coin(engine, engine.from(formulaUnit));
    },
    bulk: () => {
      calls.bulk += 1;
      return [{ size: formulaSize, cost: coin(engine, engine.from(formulaTotal)) }];
    },
    apply: (_ctx, current, bulkSize = 1) => {
      calls.apply += 1;
      return {
        ...current,
        vars: { ...current.vars, owned: current.vars.owned + bulkSize },
      };
    },
  };
}

function zeroIncomeModel<N>(engine: Engine<N>, action: Action<N, UnitCode, Vars>): Model<N, UnitCode, Vars> {
  return {
    id: "flat-bulk",
    version: 1,
    income: () => coin(engine, engine.zero()),
    actions: () => [action],
  };
}

function warningCodes(events: readonly SimEvent<unknown>[]): string[] {
  return events.filter((event) => event.type === "warning").map((event) => event.code);
}

function skippedReason(events: readonly SimEvent<unknown>[]): string | undefined {
  const skipped = events.find((event) => event.type === "action.skipped");
  return skipped && skipped.type === "action.skipped" ? skipped.reason : undefined;
}

/**
 * @evidence docs/requirements/active/bulk-quote-settlement.md#req-pr01-bulk-quote-settlement Runs the quoted size-10 buy, the rejected quotes, and the declared-equality property.
 * @evidenceReview docs/requirements/active/bulk-quote-settlement.md#req-pr01-bulk-quote-settlement #f2fb3d7 Re-read the section, then ran this function: wallet ends at 900, a missing size-10 quote does not grant 10, and the bonus model stays undeclared.
 * @evidence ./step.ts#singleBuySize Reads the size that must stay on Action.cost.
 * @evidenceReview ./step.ts#singleBuySize #d686b8e The declaration is 1. This test pays Action.cost for that size and does not call bulk.
 * @evidence ./step.ts#stepOnce Calls stepOnce for the quoted buy and the rejected quotes.
 * @evidenceReview ./step.ts#stepOnce #7267272 Re-read stepOnce: each decision re-reads model.actions for the state so far, a quoted size pays BulkQuote.cost once, and a rejected quote does not apply.
 */
export function settlesQuotedBulkAndRejectsBadQuotes(): void {
  expect(singleBuySize).toBe(1);
  const engine = createNumberEngine();
  const calls = { cost: 0, bulk: 0, apply: 0 };
  const action = flatBuy(engine, calls);
  const ctx = context(engine);
  const start = state(engine, 1000);
  const out = stepOnce({
    ctx,
    model: zeroIncomeModel(engine, action),
    state: start,
    dt: 0,
    decisions: [{ action, bulkSize: formulaSize }],
  });

  const fixtureQuote = formulaTotal;
  const executedWallet = out.next.wallet.money.amount;
  expect(formulaTotal).toBe(formulaUnit * formulaSize);
  expect(fixtureQuote).toBe(100);
  expect(executedWallet).toBe(1000 - fixtureQuote);
  expect(out.next.vars.owned).toBe(formulaSize);
  expect(out.next.vars.bonus).toBe(0);
  expect(calls.bulk).toBe(1);
  expect(calls.cost).toBe(0);
  expect(calls.apply).toBe(1);
  expect(start.wallet.money.amount).toBe(1000);
  expect(start.vars.owned).toBe(0);
  expect(checkNonNegative(false, executedWallet < 0).ok).toBe(true);

  const singleCalls = { cost: 0, bulk: 0, apply: 0 };
  const single = flatBuy(engine, singleCalls);
  const singleOut = stepOnce({
    ctx,
    model: zeroIncomeModel(engine, single),
    state: state(engine, 1000),
    dt: 0,
    decisions: [{ action: single, bulkSize: singleBuySize }],
  });
  expect(singleOut.next.wallet.money.amount).toBe(990);
  expect(singleOut.next.vars.owned).toBe(1);
  expect(singleCalls.cost).toBe(1);
  expect(singleCalls.bulk).toBe(0);
  expect(singleCalls.apply).toBe(1);

  const freeCalls = { apply: 0 };
  const free: Action<number, UnitCode, Vars> = {
    id: "grant",
    kind: "grant",
    canApply: () => true,
    cost: () => null,
    bulk: () => [{ size: 4, cost: null }],
    apply: (_ctx, current, bulkSize = 1) => {
      freeCalls.apply += 1;
      return { ...current, vars: { ...current.vars, owned: current.vars.owned + bulkSize } };
    },
  };
  const freeSingle = stepOnce({
    ctx,
    model: zeroIncomeModel(engine, free),
    state: state(engine, 50),
    dt: 0,
    decisions: [{ action: free }],
  });
  const freeBulk = stepOnce({
    ctx,
    model: zeroIncomeModel(engine, free),
    state: state(engine, 50),
    dt: 0,
    decisions: [{ action: free, bulkSize: 4 }],
  });
  expect(freeSingle.next.wallet.money.amount).toBe(50);
  expect(freeSingle.next.vars.owned).toBe(1);
  expect(freeBulk.next.wallet.money.amount).toBe(50);
  expect(freeBulk.next.vars.owned).toBe(4);
  expect(freeCalls.apply).toBe(2);

  const short = state(engine, 50);
  const shortCalls = { apply: 0 };
  const shortAction: Action<number, UnitCode, Vars> = {
    id: "buy",
    kind: "buy",
    canApply: () => true,
    cost: () => coin(engine, 10),
    bulk: () => [{ size: formulaSize, cost: coin(engine, fixtureQuote) }],
    apply: (_ctx, current, bulkSize = 1) => {
      shortCalls.apply += 1;
      return { ...current, vars: { ...current.vars, owned: current.vars.owned + bulkSize } };
    },
  };
  for (const payment of [undefined, { onInsufficientFunds: "skip" as const }, { onInsufficientFunds: "warn" as const }]) {
    const rejected = stepOnce({
      ctx: context(engine, payment),
      model: zeroIncomeModel(engine, shortAction),
      state: short,
      dt: 0,
      decisions: [{ action: shortAction, bulkSize: formulaSize }],
    });
    expect(rejected.next.wallet.money.amount).toBe(50);
    expect(rejected.next.vars.owned).toBe(0);
    expect(skippedReason(rejected.events)).toBe("insufficientFunds");
    if (payment?.onInsufficientFunds === "warn") {
      expect(warningCodes(rejected.events)).toContain("INSUFFICIENT_FUNDS");
    }
  }
  expect(shortCalls.apply).toBe(0);
  expect(short.wallet.money.amount).toBe(50);
  expect(() =>
    stepOnce({
      ctx: context(engine, { onInsufficientFunds: "throw" }),
      model: zeroIncomeModel(engine, shortAction),
      state: short,
      dt: 0,
      decisions: [{ action: shortAction, bulkSize: formulaSize }],
    }),
  ).toThrow("Insufficient funds for action buy");
  expect(short.wallet.money.amount).toBe(50);
  expect(short.vars.owned).toBe(0);

  const missingCalls = { apply: 0 };
  const missing: Action<number, UnitCode, Vars> = {
    id: "buy",
    kind: "buy",
    canApply: () => true,
    cost: () => coin(engine, formulaUnit),
    bulk: () => [{ size: 1, cost: coin(engine, formulaUnit) }],
    apply: (_ctx, current, bulkSize = 1) => {
      missingCalls.apply += 1;
      return { ...current, vars: { ...current.vars, owned: current.vars.owned + bulkSize } };
    },
  };
  const missingOut = stepOnce({
    ctx,
    model: zeroIncomeModel(engine, missing),
    state: state(engine, 1000),
    dt: 0,
    decisions: [{ action: missing, bulkSize: formulaSize }],
  });
  expect(missingOut.next.wallet.money.amount).toBe(1000);
  expect(missingOut.next.vars.owned).toBe(0);
  expect(missingCalls.apply).toBe(0);
  expect(warningCodes(missingOut.events)).toContain("MISSING_BULK_QUOTE");
  expect(skippedReason(missingOut.events)).toBe("invalidQuote");

  const badSizes = [0, -3, 1.5, Number.NaN, Number.POSITIVE_INFINITY];
  for (const size of badSizes) {
    let applied = 0;
    const priced: Action<number, UnitCode, Vars> = {
      id: "buy",
      kind: "buy",
      canApply: () => true,
      cost: () => coin(engine, formulaUnit),
      bulk: () => [{ size: formulaSize, cost: coin(engine, formulaTotal) }],
      apply: (_ctx, current, bulkSize = 1) => {
        applied += 1;
        return { ...current, vars: { ...current.vars, owned: current.vars.owned + bulkSize } };
      },
    };
    const rejected = stepOnce({
      ctx,
      model: zeroIncomeModel(engine, priced),
      state: state(engine, 1000),
      dt: 0,
      decisions: [{ action: priced, bulkSize: size }],
    });
    expect(rejected.next.wallet.money.amount).toBe(1000);
    expect(rejected.next.vars.owned).toBe(0);
    expect(applied).toBe(0);
    expect(warningCodes(rejected.events)).toContain("INVALID_BULK_SIZE");
  }

  const ambiguous: Action<number, UnitCode, Vars> = {
    id: "buy",
    kind: "buy",
    canApply: () => true,
    cost: () => coin(engine, formulaUnit),
    bulk: () => [
      { size: formulaSize, cost: coin(engine, 100) },
      { size: formulaSize, cost: coin(engine, 80) },
    ],
    apply: (_ctx, current) => current,
  };
  const ambiguousOut = stepOnce({
    ctx,
    model: zeroIncomeModel(engine, ambiguous),
    state: state(engine, 1000),
    dt: 0,
    decisions: [{ action: ambiguous, bulkSize: formulaSize }],
  });
  expect(ambiguousOut.next.wallet.money.amount).toBe(1000);
  expect(warningCodes(ambiguousOut.events)).toContain("AMBIGUOUS_BULK_QUOTE");

  const negative: Action<number, UnitCode, Vars> = {
    id: "buy",
    kind: "buy",
    canApply: () => true,
    cost: () => coin(engine, formulaUnit),
    bulk: () => [{ size: formulaSize, cost: coin(engine, -5) }],
    apply: (_ctx, current) => ({ ...current, vars: { ...current.vars, owned: 10 } }),
  };
  const negativeOut = stepOnce({
    ctx,
    model: zeroIncomeModel(engine, negative),
    state: state(engine, 1000),
    dt: 0,
    decisions: [{ action: negative, bulkSize: formulaSize }],
  });
  expect(negativeOut.next.wallet.money.amount).toBe(1000);
  expect(negativeOut.next.vars.owned).toBe(0);
  expect(warningCodes(negativeOut.events)).toContain("INVALID_BULK_COST");

  const infinite: Action<number, UnitCode, Vars> = {
    id: "buy",
    kind: "buy",
    canApply: () => true,
    cost: () => coin(engine, formulaUnit),
    bulk: () => [{ size: formulaSize, cost: coin(engine, Number.POSITIVE_INFINITY) }],
    apply: (_ctx, current) => current,
  };
  const infiniteOut = stepOnce({
    ctx,
    model: zeroIncomeModel(engine, infinite),
    state: state(engine, 1000),
    dt: 0,
    decisions: [{ action: infinite, bulkSize: formulaSize }],
  });
  expect(infiniteOut.next.wallet.money.amount).toBe(1000);
  expect(warningCodes(infiniteOut.events)).toContain("INVALID_BULK_COST");

  const wrongUnit: Action<number, UnitCode, Vars> = {
    id: "buy",
    kind: "buy",
    canApply: () => true,
    cost: () => coin(engine, formulaUnit),
    bulk: () => [{ size: formulaSize, cost: { unit: { code: "GEM" as UnitCode }, amount: fixtureQuote } }],
    apply: (_ctx, current) => current,
  };
  const wrongUnitOut = stepOnce({
    ctx,
    model: zeroIncomeModel(engine, wrongUnit),
    state: state(engine, 1000),
    dt: 0,
    decisions: [{ action: wrongUnit, bulkSize: formulaSize }],
  });
  expect(wrongUnitOut.next.wallet.money.amount).toBe(1000);
  expect(warningCodes(wrongUnitOut.events)).toContain("UNIT_MISMATCH_ON_COST");
  expect(skippedReason(wrongUnitOut.events)).toBe("invalidQuote");

  const first: Action<number, UnitCode, Vars> = {
    id: "first",
    kind: "buy",
    canApply: () => true,
    cost: () => coin(engine, formulaUnit),
    bulk: () => [{ size: formulaSize, cost: coin(engine, fixtureQuote) }],
    apply: (_ctx, current, bulkSize = 1) => ({
      ...current,
      vars: { ...current.vars, owned: current.vars.owned + bulkSize, tier: 1 },
    }),
  };
  const second: Action<number, UnitCode, Vars> = {
    id: "second",
    kind: "buy",
    canApply: () => true,
    cost: () => coin(engine, 1),
    bulk: (_ctx, current) => {
      const amount = current.vars.tier === 0 ? 10 : 40;
      return [{ size: 2, cost: coin(engine, amount) }];
    },
    apply: (_ctx, current, bulkSize = 1) => ({
      ...current,
      vars: { ...current.vars, owned: current.vars.owned + bulkSize },
    }),
  };
  const repriced = stepOnce({
    ctx,
    model: {
      id: "reprice",
      version: 1,
      income: () => coin(engine, engine.zero()),
      actions: () => [first, second],
    },
    state: state(engine, 1000),
    dt: 0,
    decisions: [
      { action: first, bulkSize: formulaSize },
      { action: second, bulkSize: 2 },
    ],
  });
  expect(repriced.next.wallet.money.amount).toBe(860);
  expect(repriced.next.vars.owned).toBe(12);
  expect(repriced.next.vars.tier).toBe(1);

  const big = createBreakInfinityEngine();
  const bigCalls = { cost: 0, bulk: 0, apply: 0 };
  const bigAction = flatBuy(big, bigCalls);
  const bigOut = stepOnce({
    ctx: context(big),
    model: zeroIncomeModel(big, bigAction),
    state: state(big, big.from(1000)),
    dt: 0,
    decisions: [{ action: bigAction, bulkSize: formulaSize }],
  });
  expect(big.cmp(bigOut.next.wallet.money.amount, big.from(900))).toBe(0);
  expect(bigOut.next.vars.owned).toBe(formulaSize);
  expect(bigCalls.apply).toBe(1);

  const custom = createCustomEngine();
  const customCalls = { cost: 0, bulk: 0, apply: 0 };
  const customAction = flatBuy(custom, customCalls);
  const customOut = stepOnce({
    ctx: context(custom),
    model: zeroIncomeModel(custom, customAction),
    state: state(custom, 1000),
    dt: 0,
    decisions: [{ action: customAction, bulkSize: formulaSize }],
  });
  expect(custom.toString(customOut.next.wallet.money.amount)).toBe("custom:900");
  expect(customOut.next.vars.owned).toBe(formulaSize);

  expectProperty({
    predicateId: "declared-flat-bulk",
    testSeed: declaredSeed,
    cases: 4,
    generate: (_index, rng) => rng.int(2, 6),
    shrink: (value) => (value > 2 ? [value - 1] : []),
    predicate: (size) => {
      const repeated = runFlat(engine, size, "repeated");
      const bulk = runFlat(engine, size, "bulk");
      const check = checkBulk(true, repeated, bulk);
      return check.applicable && check.ok;
    },
    describeCase: (size) => ({
      gameSeed: null,
      engineId: "number",
      modelId: "flat-bulk",
      strategyId: null,
      tickSchedule: { stepSec: 0, durationSec: size },
    }),
  });

  const repeatedBonus = runBonus(engine, "repeated");
  const bulkBonus = runBonus(engine, "bulk");
  const undeclared = checkBulk(false, repeatedBonus, bulkBonus);
  expect(undeclared.applicable).toBe(false);
  expect(undeclared.ok).toBe(true);
  expect(repeatedBonus).not.toBe(bulkBonus);
}

function runFlat(engine: Engine<number>, size: number, mode: "bulk" | "repeated"): string {
  const action: Action<number, UnitCode, Vars> = {
    id: "flat",
    kind: "buy",
    canApply: () => true,
    cost: () => coin(engine, formulaUnit),
    bulk: () => [{ size, cost: coin(engine, formulaUnit * size) }],
    apply: (_ctx, current, bulkSize = 1) => ({
      ...current,
      vars: { ...current.vars, owned: current.vars.owned + bulkSize },
    }),
  };
  let current = state(engine, 1000);
  if (mode === "bulk") {
    current = stepOnce({
      ctx: context(engine),
      model: zeroIncomeModel(engine, action),
      state: current,
      dt: 0,
      decisions: [{ action, bulkSize: size }],
    }).next;
  } else {
    for (let index = 0; index < size; index += 1) {
      current = stepOnce({
        ctx: context(engine),
        model: zeroIncomeModel(engine, action),
        state: current,
        dt: 0,
        decisions: [{ action, bulkSize: singleBuySize }],
      }).next;
    }
  }
  return snapshot(engine, current);
}

function runBonus(engine: Engine<number>, mode: "bulk" | "repeated"): string {
  const action: Action<number, UnitCode, Vars> = {
    id: "bonus",
    kind: "buy",
    canApply: () => true,
    cost: () => coin(engine, formulaUnit),
    bulk: () => [{ size: 2, cost: coin(engine, formulaUnit * 2) }],
    apply: (_ctx, current, bulkSize = 1) => {
      let owned = current.vars.owned;
      let bonus = current.vars.bonus;
      if (bulkSize === 1) {
        owned += 1;
        if (owned % 2 === 0) bonus += 5;
      } else {
        owned += bulkSize;
      }
      return { ...current, vars: { ...current.vars, owned, bonus } };
    },
  };
  let current = state(engine, 1000);
  if (mode === "bulk") {
    current = stepOnce({
      ctx: context(engine),
      model: zeroIncomeModel(engine, action),
      state: current,
      dt: 0,
      decisions: [{ action, bulkSize: 2 }],
    }).next;
  } else {
    for (let index = 0; index < 2; index += 1) {
      current = stepOnce({
        ctx: context(engine),
        model: zeroIncomeModel(engine, action),
        state: current,
        dt: 0,
        decisions: [{ action }],
      }).next;
    }
  }
  return snapshot(engine, current);
}

function createCustomEngine(): Engine<number> {
  const inner = createNumberEngine();
  return {
    zero: () => inner.zero(),
    from: (input) => inner.from(input),
    add: (a, b) => inner.add(a, b),
    sub: (a, b) => inner.sub(a, b),
    mul: (a, k) => inner.mul(a, k),
    div: (a, k) => inner.div(a, k),
    mulN: (a, b) => inner.mulN(a, b),
    divN: (a, b) => inner.divN(a, b),
    cmp: (a, b) => inner.cmp(a, b),
    absLog10: (a) => inner.absLog10(a),
    isFinite: (a) => inner.isFinite(a),
    toString: (a) => `custom:${inner.toString(a)}`,
    toNumber: (a) => inner.toNumber(a),
  };
}

function growingQuoteModel<N>(engine: Engine<N>): Model<N, UnitCode, Vars> {
  return {
    id: "growing-quote",
    version: 1,
    income: () => coin(engine, engine.zero()),
    actions: (_ctx, current) => {
      const owned = current.vars.owned;
      const unit = 10;
      const growth = 2;
      return [
        {
          id: "buy",
          kind: "buy",
          canApply: () => true,
          cost: () => coin(engine, engine.from(unit * growth ** owned)),
          bulk: () => {
            const size = 2;
            const total = unit * growth ** owned + unit * growth ** (owned + 1);
            return [{ size, cost: coin(engine, engine.from(total)) }];
          },
          apply: (_ctx, currentState, bulkSize = 1) => ({
            ...currentState,
            vars: { ...currentState.vars, owned: currentState.vars.owned + bulkSize },
          }),
        },
      ];
    },
  };
}

describe("PR-01 bulk quote settlement", () => {
  it("settles a quoted bulk buy and rejects a bad quote", settlesQuotedBulkAndRejectsBadQuotes);

  it("reprices a later buy from the updated ownership", () => {
    const engine = createNumberEngine();
    const model = growingQuoteModel(engine);
    const ctx = context(engine);
    const start = state(engine, 1000);
    const stale = model.actions(ctx, start)[0];
    if (!stale) throw new Error("missing buy");
    const out = stepOnce({
      ctx,
      model,
      state: start,
      dt: 0,
      decisions: [
        { action: stale, bulkSize: 2 },
        { action: stale, bulkSize: 2 },
      ],
    });
    expect(out.next.vars.owned).toBe(4);
    expect(engine.toNumber(out.next.wallet.money.amount)).toBe(850);
  });

  it("keeps a malformed quote size on the settlement path", () => {
    expect(quotedDecisionSize(1)).toBeUndefined();
    expect(quotedDecisionSize(0.5)).toBe(0.5);
    expect(quotedDecisionSize(0)).toBe(0);
    expect(quotedDecisionSize(Number.NaN)).toBeNaN();

    const engine = createNumberEngine();
    const action: Action<number, UnitCode, Vars> = {
      id: "buy",
      kind: "buy",
      canApply: () => true,
      cost: () => coin(engine, engine.from(10)),
      bulk: () => [
        {
          size: Number.NaN,
          cost: coin(engine, engine.from(10)),
          deltaIncomePerSec: coin(engine, engine.from(1)),
        },
      ],
      apply: (_ctx, current, bulkSize = 1) => ({
        ...current,
        vars: { ...current.vars, owned: current.vars.owned + (bulkSize ?? 1) },
      }),
    };
    const model = zeroIncomeModel(engine, action);
    const start = state(engine, 1000);
    const decisions = createGreedyStrategy<number, UnitCode, Vars>({
      schemaVersion: 1,
      objective: "maximizeIncome",
      bulk: { mode: "bestQuote" },
    }).decide(context(engine), model, start);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.bulkSize).toBeNaN();
    const out = stepOnce({
      ctx: context(engine),
      model,
      state: start,
      dt: 0,
      decisions,
    });
    expect(skippedReason(out.events)).toBe("invalidQuote");
    expect(out.next.vars.owned).toBe(0);
    expect(engine.toNumber(out.next.wallet.money.amount)).toBe(1000);
    const stats = buildSimStats(out.events);
    expect(stats.actions.skippedInvalidQuote).toBe(1);
    expect(stats.actions.applied).toBe(0);
  });

  it("rejects a quote that omits its size", () => {
    expect(quotedDecisionSize(undefined)).toBeNaN();
    const engine = createNumberEngine();
    const action: Action<number, UnitCode, Vars> = {
      id: "buy",
      kind: "buy",
      canApply: () => true,
      cost: () => coin(engine, engine.from(10)),
      bulk: () => [
        {
          cost: coin(engine, engine.from(10)),
          deltaIncomePerSec: coin(engine, engine.from(1)),
        } as BulkQuote<number, UnitCode>,
      ],
      apply: (_ctx, current, bulkSize = 1) => ({
        ...current,
        vars: { ...current.vars, owned: current.vars.owned + (bulkSize ?? 1) },
      }),
    };
    const model = zeroIncomeModel(engine, action);
    const start = state(engine, 1000);
    const decisions = createGreedyStrategy<number, UnitCode, Vars>({
      schemaVersion: 1,
      objective: "maximizeIncome",
      bulk: { mode: "bestQuote" },
    }).decide(context(engine), model, start);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.bulkSize).toBeNaN();
    const out = stepOnce({
      ctx: context(engine),
      model,
      state: start,
      dt: 0,
      decisions,
    });
    expect(skippedReason(out.events)).toBe("invalidQuote");
    expect(warningCodes(out.events)).toContain("INVALID_BULK_SIZE");
    expect(out.next.vars.owned).toBe(0);
    expect(engine.toNumber(out.next.wallet.money.amount)).toBe(1000);
  });

  it("rejects a quote cost that has no unit", () => {
    const engine = createNumberEngine();
    const action: Action<number, UnitCode, Vars> = {
      id: "buy",
      kind: "buy",
      canApply: () => true,
      cost: () => coin(engine, engine.from(10)),
      bulk: () => [{ size: 2, cost: { amount: engine.from(10) } as Money<number, UnitCode> }],
      apply: (_ctx, current, bulkSize = 1) => ({
        ...current,
        vars: { ...current.vars, owned: current.vars.owned + bulkSize },
      }),
    };
    const out = stepOnce({
      ctx: context(engine),
      model: zeroIncomeModel(engine, action),
      state: state(engine, 1000),
      dt: 0,
      decisions: [{ action, bulkSize: 2 }],
    });
    expect(skippedReason(out.events)).toBe("invalidQuote");
    expect(warningCodes(out.events)).toContain("INVALID_BULK_COST");
    expect(out.next.vars.owned).toBe(0);
    expect(engine.toNumber(out.next.wallet.money.amount)).toBe(1000);
  });

  it("refreshes the selected action by id and kind", () => {
    const engine = createNumberEngine();
    const buy: Action<number, UnitCode, Vars> = {
      id: "act",
      kind: "buy",
      canApply: () => true,
      cost: () => coin(engine, engine.from(10)),
      apply: (_ctx, current) => ({ ...current, vars: { ...current.vars, bonus: 1 } }),
    };
    const grant: Action<number, UnitCode, Vars> = {
      id: "act",
      kind: "grant",
      canApply: () => true,
      cost: () => null,
      apply: (_ctx, current) => ({ ...current, vars: { ...current.vars, bonus: 7 } }),
    };
    const model: Model<number, UnitCode, Vars> = {
      id: "same-id",
      version: 1,
      income: () => coin(engine, engine.zero()),
      actions: () => [buy, grant],
    };
    const out = stepOnce({
      ctx: context(engine),
      model,
      state: state(engine, 1000),
      dt: 0,
      decisions: [{ action: grant }],
    });
    expect(out.next.vars.bonus).toBe(7);
    expect(engine.toNumber(out.next.wallet.money.amount)).toBe(1000);
    expect(skippedReason(out.events)).toBeUndefined();
  });

  it("skips a later decision when the model no longer offers that action", () => {
    const engine = createNumberEngine();
    let hideSecond = false;
    const first: Action<number, UnitCode, Vars> = {
      id: "first",
      kind: "buy",
      canApply: () => true,
      cost: () => null,
      apply: (_ctx, current) => {
        hideSecond = true;
        return { ...current, vars: { ...current.vars, bonus: 1 } };
      },
    };
    const second: Action<number, UnitCode, Vars> = {
      id: "second",
      kind: "buy",
      canApply: () => true,
      cost: () => coin(engine, engine.from(100)),
      apply: (_ctx, current) => ({ ...current, vars: { ...current.vars, owned: 1 } }),
    };
    const model: Model<number, UnitCode, Vars> = {
      id: "vanish",
      version: 1,
      income: () => coin(engine, engine.zero()),
      actions: () => (hideSecond ? [first] : [first, second]),
    };
    const out = stepOnce({
      ctx: context(engine),
      model,
      state: state(engine, 1000),
      dt: 0,
      decisions: [{ action: first }, { action: second }],
    });
    expect(out.next.vars.bonus).toBe(1);
    expect(out.next.vars.owned).toBe(0);
    expect(engine.toNumber(out.next.wallet.money.amount)).toBe(1000);
    expect(skippedReason(out.events)).toBe("cannotApply");
  });
});
