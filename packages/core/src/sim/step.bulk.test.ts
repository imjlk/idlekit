import { describe, expect, it } from "bun:test";
import { createBreakInfinityEngine, createNumberEngine, type Decimal } from "../engine/breakInfinity";
import type { Engine } from "../engine/types";
import type { Money } from "../money/types";
import { checkBulk, checkNonNegative, expectProperty } from "../testkit/conformanceRun";
import { buildSimStats } from "./analysis/ux";
import { canSettleCost, singleBuySize, stepOnce } from "./step";
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
 * @evidence ./step.ts#canSettleCost A zero wallet cannot pay 1e-13, and it can pay a zero cost.
 * @evidenceReview ./step.ts#canSettleCost #af1aab3 Re-read canSettleCost: a zero wallet cannot pay 1e-13, and it can pay a zero cost, without using cmp.
 * @evidence ./step.ts#stepOnce Calls stepOnce for the quoted buy and the rejected quotes.
 * @evidenceReview ./step.ts#stepOnce #c0f480b Re-read stepOnce: each decision re-reads model.actions for the state so far, a quoted size pays BulkQuote.cost once through exact decimal order scaled to the smaller exponent, a non-finite cost is skipped before toString, duplicate id and kind match the start-of-step price when a same-length list swaps order and keep that slot when the price moved, a removed or inserted sibling still matches the start-of-step price, an action-free tick does not enumerate actions, and a rejected quote does not apply. Re-read the group fixes too: a prestige decision is gated by decidePrestigeCooldown with a reset committed earlier in the same tick as the newest anchor, prestigeResetT reports that reset, and observedMoney counts the money tick even when disableMoneyEvents drops the money event. The buys in this test are not prestige actions, so the gate does not skip them. Ran this function: a sentinel amount whose toString throws was skipped as invalidQuote, and the second same-id action paid 40.
 */
export function settlesQuotedBulkAndRejectsBadQuotes(): void {
  expect(singleBuySize).toBe(1);
  const engine = createNumberEngine();
  expect(canSettleCost(engine, 0, 1e-13)).toBe(false);
  expect(canSettleCost(engine, 0, 0)).toBe(true);
  expect(canSettleCost(engine, Number.POSITIVE_INFINITY, 1)).toBe(true);
  expect(canSettleCost(engine, Number.NEGATIVE_INFINITY, 1)).toBe(false);
  expect(canSettleCost(engine, Number.NaN, 1)).toBe(false);
  expect(canSettleCost(engine, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)).toBe(false);
  expect(canSettleCost(engine, 1, Number.POSITIVE_INFINITY)).toBe(false);
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

  const unsafe = throwingNonFiniteEngine();
  const unsafeAction: Action<number, UnitCode, Vars> = {
    id: "buy",
    kind: "buy",
    canApply: () => true,
    cost: () => coin(unsafe, nonFiniteSentinel),
    bulk: () => [{ size: formulaSize, cost: coin(unsafe, nonFiniteSentinel) }],
    apply: (_ctx, current) => ({ ...current, vars: { ...current.vars, owned: 1 } }),
  };
  const unsafeBulk = stepOnce({
    ctx: context(unsafe),
    model: zeroIncomeModel(unsafe, unsafeAction),
    state: state(unsafe, 1000),
    dt: 0,
    decisions: [{ action: unsafeAction, bulkSize: formulaSize }],
  });
  expect(skippedReason(unsafeBulk.events)).toBe("invalidQuote");
  expect(unsafeBulk.next.wallet.money.amount).toBe(1000);
  expect(unsafeBulk.next.vars.owned).toBe(0);
  const unsafeSingle = stepOnce({
    ctx: context(unsafe),
    model: zeroIncomeModel(unsafe, unsafeAction),
    state: state(unsafe, 1000),
    dt: 0,
    decisions: [{ action: unsafeAction }],
  });
  expect(skippedReason(unsafeSingle.events)).toBe("invalidQuote");
  expect(unsafeSingle.next.wallet.money.amount).toBe(1000);
  expect(unsafeSingle.next.vars.owned).toBe(0);

  const duplicate = (slot: 0 | 1): Action<number, UnitCode, Vars> => ({
    id: "buy",
    kind: "buy",
    canApply: () => true,
    cost: () => coin(engine, slot === 0 ? 10 : 40),
    apply: (_ctx, current) => ({
      ...current,
      vars: { ...current.vars, owned: current.vars.owned + (slot === 0 ? 1 : 5) },
    }),
  });
  const duplicateModel: Model<number, UnitCode, Vars> = {
    id: "duplicate-buy",
    version: 1,
    income: () => coin(engine, engine.zero()),
    actions: () => [duplicate(0), duplicate(1)],
  };
  const ambiguousDuplicate = stepOnce({
    ctx,
    model: duplicateModel,
    state: state(engine, 1000),
    dt: 0,
    decisions: [{ action: duplicate(1) }],
  });
  expect(skippedReason(ambiguousDuplicate.events)).toBe("cannotApply");
  expect(ambiguousDuplicate.next.wallet.money.amount).toBe(1000);
  expect(ambiguousDuplicate.next.vars.owned).toBe(0);
  const secondDuplicate = stepOnce({
    ctx,
    model: duplicateModel,
    state: state(engine, 1000),
    dt: 0,
    decisions: [{ action: duplicate(1), occurrence: 1 }],
  });
  expect(secondDuplicate.next.wallet.money.amount).toBe(960);
  expect(secondDuplicate.next.vars.owned).toBe(5);

  const wide = createBreakInfinityEngine();
  const wideWallet = wide.from(1);
  wideWallet.exponent = 1e21;
  const wideCost = wide.from(1);
  wideCost.exponent = 1e20;
  expect(canSettleCost(wide, wideWallet, wideWallet)).toBe(true);
  expect(canSettleCost(wide, wideCost, wideWallet)).toBe(false);

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

const nonFiniteSentinel = 7;

function throwingNonFiniteEngine(): Engine<number> {
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
    exactOrder: (a, b) => (a < b ? -1 : a > b ? 1 : 0),
    absLog10: (a) => inner.absLog10(a),
    isFinite: (value) => value !== nonFiniteSentinel && inner.isFinite(value),
    toString: (value) => {
      if (value === nonFiniteSentinel) throw new Error("toString refused a non-finite amount");
      return inner.toString(value);
    },
    toNumber: (value) => inner.toNumber(value),
  };
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
    exactOrder: (a, b) => (a < b ? -1 : a > b ? 1 : 0),
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

  it("orders negative decimals by signed scale and defers lossy infinity text", () => {
    const engine = createNumberEngine();
    expect(canSettleCost(engine, -10, -2)).toBe(false);
    expect(canSettleCost(engine, -2, -10)).toBe(true);
    const lossy = {
      toString: () => "Infinity",
      isFinite: () => true,
      exactOrder: () => 1 as const,
    };
    expect(canSettleCost(lossy, { tag: "wallet" }, { tag: "cost" })).toBe(true);
  });

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

  it("keeps a duplicate when an earlier sibling leaves or a new one is inserted", () => {
    const engine = createNumberEngine();
    let hideFirst = false;
    let inserted = false;
    const removedModel: Model<number, UnitCode, Vars> = {
      id: "shift-remove",
      version: 1,
      income: () => coin(engine, engine.zero()),
      actions: () => {
        const first: Action<number, UnitCode, Vars> = {
          id: "buy",
          kind: "buy",
          canApply: () => true,
          cost: () => coin(engine, engine.from(10)),
          apply: (_ctx, current) => {
            hideFirst = true;
            return { ...current, vars: { ...current.vars, owned: current.vars.owned + 1 } };
          },
        };
        const second: Action<number, UnitCode, Vars> = {
          id: "buy",
          kind: "buy",
          canApply: () => true,
          cost: () => coin(engine, engine.from(40)),
          apply: (_ctx, current) => ({
            ...current,
            vars: { ...current.vars, owned: current.vars.owned + 5 },
          }),
        };
        return hideFirst ? [second] : [first, second];
      },
    };
    const removedStart = state(engine, 1000);
    const removedInitial = removedModel.actions(context(engine), removedStart);
    const removed = stepOnce({
      ctx: context(engine),
      model: removedModel,
      state: removedStart,
      dt: 0,
      decisions: [
        { action: removedInitial[0]!, occurrence: 0 },
        { action: removedInitial[1]!, occurrence: 1 },
      ],
    });
    expect(removed.next.vars.owned).toBe(6);
    expect(engine.toNumber(removed.next.wallet.money.amount)).toBe(950);
    expect(skippedReason(removed.events)).toBeUndefined();

    const insertedModel: Model<number, UnitCode, Vars> = {
      id: "shift-insert",
      version: 1,
      income: () => coin(engine, engine.zero()),
      actions: () => {
        const first: Action<number, UnitCode, Vars> = {
          id: "buy",
          kind: "buy",
          canApply: () => true,
          cost: () => coin(engine, engine.from(10)),
          apply: (_ctx, current) => {
            inserted = true;
            return { ...current, vars: { ...current.vars, owned: current.vars.owned + 1 } };
          },
        };
        const second: Action<number, UnitCode, Vars> = {
          id: "buy",
          kind: "buy",
          canApply: () => true,
          cost: () => coin(engine, engine.from(40)),
          apply: (_ctx, current) => ({
            ...current,
            vars: { ...current.vars, bonus: current.vars.bonus + 5 },
          }),
        };
        const extra: Action<number, UnitCode, Vars> = {
          id: "buy",
          kind: "buy",
          canApply: () => true,
          cost: () => coin(engine, engine.from(7)),
          apply: (_ctx, current) => ({
            ...current,
            vars: { ...current.vars, tier: current.vars.tier + 9 },
          }),
        };
        return inserted ? [extra, first, second] : [first, second];
      },
    };
    const insertedStart = state(engine, 1000);
    const insertedInitial = insertedModel.actions(context(engine), insertedStart);
    const shifted = stepOnce({
      ctx: context(engine),
      model: insertedModel,
      state: insertedStart,
      dt: 0,
      decisions: [
        { action: insertedInitial[0]!, occurrence: 0 },
        { action: insertedInitial[1]!, occurrence: 1 },
      ],
    });
    expect(shifted.next.vars.owned).toBe(1);
    expect(shifted.next.vars.bonus).toBe(5);
    expect(shifted.next.vars.tier).toBe(0);
    expect(engine.toNumber(shifted.next.wallet.money.amount)).toBe(950);
    expect(skippedReason(shifted.events)).toBeUndefined();
  });

  it("keeps a duplicate when a later list prices it from the updated state", () => {
    const engine = createNumberEngine();
    const model: Model<number, UnitCode, Vars> = {
      id: "reprice-closure",
      version: 1,
      income: () => coin(engine, engine.zero()),
      actions: (_ctx, current) => {
        const owned = current.vars.owned;
        const first: Action<number, UnitCode, Vars> = {
          id: "buy",
          kind: "buy",
          canApply: () => true,
          cost: () => coin(engine, engine.from(10 + owned)),
          apply: (_ctx, next) => ({ ...next, vars: { ...next.vars, owned: next.vars.owned + 1 } }),
        };
        const second: Action<number, UnitCode, Vars> = {
          id: "buy",
          kind: "buy",
          canApply: () => true,
          cost: () => coin(engine, engine.from(40 + owned)),
          apply: (_ctx, next) => ({ ...next, vars: { ...next.vars, owned: next.vars.owned + 5 } }),
        };
        return [first, second];
      },
    };
    const start = state(engine, 1000);
    const initial = model.actions(context(engine), start);
    const out = stepOnce({
      ctx: context(engine),
      model,
      state: start,
      dt: 0,
      decisions: [
        { action: initial[0]!, occurrence: 0 },
        { action: initial[1]!, occurrence: 1 },
      ],
    });
    expect(out.next.vars.owned).toBe(6);
    expect(engine.toNumber(out.next.wallet.money.amount)).toBe(949);
    expect(skippedReason(out.events)).toBeUndefined();
  });

  it("keeps a duplicate when a same-length list swaps its order", () => {
    const engine = createNumberEngine();
    let swapped = false;
    const model: Model<number, UnitCode, Vars> = {
      id: "swap-order",
      version: 1,
      income: () => coin(engine, engine.zero()),
      actions: () => {
        const cheap: Action<number, UnitCode, Vars> = {
          id: "buy",
          kind: "buy",
          canApply: () => true,
          cost: () => coin(engine, engine.from(10)),
          apply: (_ctx, current) => {
            swapped = true;
            return { ...current, vars: { ...current.vars, owned: current.vars.owned + 1 } };
          },
        };
        const dear: Action<number, UnitCode, Vars> = {
          id: "buy",
          kind: "buy",
          canApply: () => true,
          cost: () => coin(engine, engine.from(40)),
          apply: (_ctx, current) => ({
            ...current,
            vars: { ...current.vars, owned: current.vars.owned + 5 },
          }),
        };
        return swapped ? [dear, cheap] : [cheap, dear];
      },
    };
    const start = state(engine, 1000);
    const initial = model.actions(context(engine), start);
    const out = stepOnce({
      ctx: context(engine),
      model,
      state: start,
      dt: 0,
      decisions: [
        { action: initial[0]!, occurrence: 0 },
        { action: initial[1]!, occurrence: 1 },
      ],
    });
    expect(out.next.vars.owned).toBe(6);
    expect(engine.toNumber(out.next.wallet.money.amount)).toBe(950);
    expect(skippedReason(out.events)).toBeUndefined();
  });

  it("does not price a sole refreshed action before a quoted bulk buy", () => {
    const engine = createNumberEngine();
    let costCalls = 0;
    let bulkCalls = 0;
    const model: Model<number, UnitCode, Vars> = {
      id: "refresh-sole",
      version: 1,
      income: () => coin(engine, engine.zero()),
      actions: () => [
        {
          id: "buy",
          kind: "buy",
          canApply: () => true,
          cost: () => {
            costCalls += 1;
            return coin(engine, engine.from(10));
          },
          bulk: () => {
            bulkCalls += 1;
            return [{ size: 2, cost: coin(engine, engine.from(4)) }];
          },
          apply: (_ctx, current) => current,
        },
      ],
    };
    const start = state(engine, 100);
    const selected = model.actions(context(engine), start)[0];
    expect(selected).toBeDefined();
    costCalls = 0;
    bulkCalls = 0;
    const out = stepOnce({
      ctx: context(engine),
      model,
      state: start,
      dt: 0,
      decisions: [{ action: selected!, occurrence: 0, bulkSize: 2 }],
    });
    expect(costCalls).toBe(0);
    expect(bulkCalls).toBe(1);
    expect(engine.toNumber(out.next.wallet.money.amount)).toBe(96);
    expect(skippedReason(out.events)).toBeUndefined();
  });

  it("does not enumerate actions when the step has no decisions", () => {
    const engine = createNumberEngine();
    const model: Model<number, UnitCode, Vars> = {
      id: "no-decisions",
      version: 1,
      income: () => coin(engine, engine.zero()),
      actions: () => {
        throw new Error("enumerated");
      },
    };
    const start = state(engine, 1000);
    const idle = stepOnce({ ctx: context(engine), model, state: start, dt: 0 });
    const blocked = stepOnce({
      ctx: context(engine),
      model,
      state: start,
      dt: 0,
      decisions: [
        {
          action: {
            id: "buy",
            kind: "buy",
            canApply: () => true,
            cost: () => null,
            apply: (_ctx, current) => current,
          },
        },
      ],
      constraints: { maxActionsPerStep: 0 },
    });
    expect(engine.toNumber(idle.next.wallet.money.amount)).toBe(1000);
    expect(engine.toNumber(blocked.next.wallet.money.amount)).toBe(1000);
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

  it("rejects a negative epsilon quote instead of crediting the wallet", () => {
    const engine = createNumberEngine();
    const action: Action<number, UnitCode, Vars> = {
      id: "buy",
      kind: "buy",
      canApply: () => true,
      cost: () => coin(engine, engine.from(1)),
      bulk: () => [{ size: 2, cost: coin(engine, engine.from(-1e-13)) }],
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

  it("pays a fractional quote whose exponent is smaller than the wallet", () => {
    const engine = createNumberEngine();
    const action: Action<number, UnitCode, Vars> = {
      id: "buy",
      kind: "buy",
      canApply: () => true,
      cost: () => coin(engine, engine.from(1)),
      bulk: () => [{ size: 2, cost: coin(engine, engine.from(11.5)) }],
      apply: (_ctx, current, bulkSize = 1) => ({
        ...current,
        vars: { ...current.vars, owned: current.vars.owned + bulkSize },
      }),
    };
    const out = stepOnce({
      ctx: context(engine),
      model: zeroIncomeModel(engine, action),
      state: state(engine, 100),
      dt: 0,
      decisions: [{ action, bulkSize: 2 }],
    });
    expect(skippedReason(out.events)).toBeUndefined();
    expect(out.next.vars.owned).toBe(2);
    expect(engine.toNumber(out.next.wallet.money.amount)).toBe(88.5);
  });

  it("rejects an epsilon quote that cmp would treat as free", () => {
    const engine = createNumberEngine();
    const action: Action<number, UnitCode, Vars> = {
      id: "buy",
      kind: "buy",
      canApply: () => true,
      cost: () => coin(engine, engine.from(1)),
      bulk: () => [{ size: 2, cost: coin(engine, engine.from(1e-13)) }],
      apply: (_ctx, current, bulkSize = 1) => ({
        ...current,
        vars: { ...current.vars, owned: current.vars.owned + bulkSize },
      }),
    };
    const out = stepOnce({
      ctx: context(engine),
      model: zeroIncomeModel(engine, action),
      state: state(engine, 0),
      dt: 0,
      decisions: [{ action, bulkSize: 2 }],
    });
    expect(skippedReason(out.events)).toBe("insufficientFunds");
    expect(out.next.vars.owned).toBe(0);
    expect(engine.toNumber(out.next.wallet.money.amount)).toBe(0);
  });

  it("pays a break-infinity quote across a huge exponent gap", () => {
    const engine = createBreakInfinityEngine();
    const action: Action<Decimal, UnitCode, Vars> = {
      id: "buy",
      kind: "buy",
      canApply: () => true,
      cost: () => coin(engine, engine.from(1)),
      bulk: () => [{ size: 2, cost: coin(engine, engine.from(1)) }],
      apply: (_ctx, current, bulkSize = 1) => ({
        ...current,
        vars: { ...current.vars, owned: current.vars.owned + bulkSize },
      }),
    };
    const out = stepOnce({
      ctx: context(engine),
      model: zeroIncomeModel(engine, action),
      state: state(engine, engine.from("1e1000000000")),
      dt: 0,
      decisions: [{ action, bulkSize: 2 }],
    });
    expect(skippedReason(out.events)).toBeUndefined();
    expect(out.next.vars.owned).toBe(2);
    expect(engine.cmp(out.next.wallet.money.amount, engine.from("1e999999999"))).toBe(1);
  });

  it("pays a break-infinity quote whose exponent is not a safe integer", () => {
    const engine = createBreakInfinityEngine();
    const wallet = engine.from("1e10000000000000000");
    const action: Action<Decimal, UnitCode, Vars> = {
      id: "buy",
      kind: "buy",
      canApply: () => true,
      cost: () => coin(engine, engine.from(1)),
      bulk: () => [{ size: 2, cost: coin(engine, engine.from(1)) }],
      apply: (_ctx, current, bulkSize = 1) => ({
        ...current,
        vars: { ...current.vars, owned: current.vars.owned + bulkSize },
      }),
    };
    const out = stepOnce({
      ctx: context(engine),
      model: zeroIncomeModel(engine, action),
      state: state(engine, wallet),
      dt: 0,
      decisions: [{ action, bulkSize: 2 }],
    });
    expect(engine.toString(wallet)).toBe("1e10000000000000000");
    expect(skippedReason(out.events)).toBeUndefined();
    expect(out.next.vars.owned).toBe(2);
  });

  it("rejects a non-decimal engine that has no exact order", () => {
    const engine = createCustomEngine();
    delete engine.exactOrder;
    const action: Action<number, UnitCode, Vars> = {
      id: "buy",
      kind: "buy",
      canApply: () => true,
      cost: () => coin(engine, 10),
      bulk: () => [{ size: 2, cost: coin(engine, 20) }],
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
    expect(out.next.vars.owned).toBe(0);
    expect(engine.toString(out.next.wallet.money.amount)).toBe("custom:1000");
  });

  it("asks exactOrder when an infinite wallet meets a non-decimal finite cost", () => {
    const engine = createCustomEngine();
    engine.toString = (amount) => (Number.isFinite(amount) ? `custom:${amount}` : String(amount));
    expect(canSettleCost(engine, Number.POSITIVE_INFINITY, 1)).toBe(true);
    expect(canSettleCost(engine, Number.NEGATIVE_INFINITY, 1)).toBe(false);
    expect(canSettleCost(engine, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)).toBe(false);
    delete engine.exactOrder;
    expect(canSettleCost(engine, Number.POSITIVE_INFINITY, 1)).toBe(false);
  });

  it("uses exactOrder when toNumber collapses distinct amounts", () => {
    const wallet = 9007199254740992n;
    const cost = 9007199254740993n;
    const engine: Engine<bigint> = {
      zero: () => 0n,
      from: (input) => (typeof input === "bigint" ? input : BigInt(Math.trunc(Number(input)))),
      add: (a, b) => a + b,
      sub: (a, b) => a - b,
      mul: (a, k) => a * BigInt(Math.trunc(k)),
      div: (a, k) => a / BigInt(Math.trunc(k)),
      mulN: (a, b) => a * b,
      divN: (a, b) => (b === 0n ? 0n : a / b),
      cmp: (a, b) => (a < b ? -1 : a > b ? 1 : 0),
      exactOrder: (a, b) => (a < b ? -1 : a > b ? 1 : 0),
      absLog10: () => 0,
      isFinite: () => true,
      toString: () => "opaque",
      toNumber: () => 9007199254740992,
    };
    const action: Action<bigint, UnitCode, Vars> = {
      id: "buy",
      kind: "buy",
      canApply: () => true,
      cost: () => coin(engine, cost),
      bulk: () => [{ size: 2, cost: coin(engine, cost) }],
      apply: (_ctx, current, bulkSize = 1) => ({
        ...current,
        vars: { ...current.vars, owned: current.vars.owned + bulkSize },
      }),
    };
    const out = stepOnce({
      ctx: context(engine),
      model: zeroIncomeModel(engine, action),
      state: state(engine, wallet),
      dt: 0,
      decisions: [{ action, bulkSize: 2 }],
    });
    expect(skippedReason(out.events)).toBe("insufficientFunds");
    expect(out.next.vars.owned).toBe(0);
    expect(out.next.wallet.money.amount).toBe(wallet);
  });

  it("keeps maxAffordable on the same exact order as settlement", () => {
    const engine = createNumberEngine();
    const action: Action<number, UnitCode, Vars> = {
      id: "buy",
      kind: "buy",
      canApply: () => true,
      cost: () => coin(engine, engine.from(1)),
      bulk: () => [
        {
          size: 2,
          cost: coin(engine, engine.zero()),
          deltaIncomePerSec: coin(engine, engine.from(1)),
        },
        {
          size: 10,
          cost: coin(engine, engine.from(1e-13)),
          deltaIncomePerSec: coin(engine, engine.from(1)),
        },
      ],
      apply: (_ctx, current, bulkSize = 1) => ({
        ...current,
        vars: { ...current.vars, owned: current.vars.owned + bulkSize },
      }),
    };
    const model = zeroIncomeModel(engine, action);
    const start = state(engine, 0);
    const decisions = createGreedyStrategy<number, UnitCode, Vars>({
      schemaVersion: 1,
      objective: "maximizeIncome",
      bulk: { mode: "maxAffordable" },
    }).decide(context(engine), model, start);
    expect(decisions[0]?.bulkSize).toBe(2);
    const out = stepOnce({
      ctx: context(engine),
      model,
      state: start,
      dt: 0,
      decisions,
    });
    expect(out.next.vars.owned).toBe(2);
    expect(engine.toNumber(out.next.wallet.money.amount)).toBe(0);
  });
});
