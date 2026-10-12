import type { Money } from "../money/types";
import { tickMoney } from "../policy/tickMoney";
import { decidePrestigeCooldown } from "./constraints";
import type { Action, BulkQuote, Model, ScenarioConstraints, SimContext, SimEvent, SimState } from "./types";

export type ResetSnapshot = Readonly<{
  t: number;
  money: string;
  points: string;
  multiplier: string;
  count: number;
}>;

/**
 * One committed reset action.
 * `rewardDelta` is the prestige point change from this action.
 * A cycle adapter may replace it with its own metric before notifying.
 */
export type CommittedResetFact = Readonly<{
  actionId: string;
  kind: "prestige" | "custom";
  t: number;
  wallT: number | null;
  cost: Readonly<{ unit: string; decimal: string }> | null;
  rewardDelta: string;
  before: ResetSnapshot;
  after: ResetSnapshot;
}>;

export type StepDecision<N, U extends string, Vars> = Readonly<{
  action: Action<N, U, Vars>;
  bulkSize?: number;
  /** Position of `action` among the same `id` and `kind` in the list the caller selected from. */
  occurrence?: number;
}>;

export type StepInput<N, U extends string, Vars> = Readonly<{
  ctx: SimContext<N, U, Vars>;
  model: Model<N, U, Vars>;
  state: SimState<N, U, Vars>;

  dt: number;

  decisions?: readonly StepDecision<N, U, Vars>[];

  /** Checks the action a decision re-resolves to. A rejected one is dropped without an event. */
  admits?: (action: Action<N, U, Vars>) => boolean;

  constraints?: ScenarioConstraints;

  fast?: Readonly<{
    enabled: boolean;
    kind?: "log-domain";
    disableMoneyEvents?: boolean;
  }>;
}>;

export type StepOutput<N, U extends string, Vars> = Readonly<{
  prev: SimState<N, U, Vars>;
  next: SimState<N, U, Vars>;

  events: readonly SimEvent<N>[];

  actionsApplied?: readonly Readonly<{
    t: number;
    actionId: string;
    label?: string;
    bulkSize?: number;
  }>[];

  /**
   * Money counters for this committed tick.
   * Present even when `disableMoneyEvents` omits the money event from `events`.
   */
  observedMoney?: Readonly<{
    applied: number;
    dropped: number;
    queued: number;
    flushed: number;
    blocked: number;
    /** True when this tick applied or flushed a positive amount. */
    rewarded: boolean;
  }>;

  /** Decision-time `t` of a prestige action that committed on this tick. */
  prestigeResetT?: number;

  walletDelta?: Money<N, U>;

  /**
   * Prestige or custom actions that committed in this call.
   * Absent when none committed. A count change without one of these is not a reset.
   */
  committedResets?: readonly CommittedResetFact[];
}>;

/**
 * Buy size that still pays `Action.cost`.
 * A larger integer size pays one matching `BulkQuote` instead.
 *
 * @evidence docs/requirements/active/bulk-quote-settlement.md#req-pr01-bulk-quote-settlement Size 1 stays on Action.cost. bulkSize greater than this constant is a quoted bulk buy.
 * @evidenceReview docs/requirements/active/bulk-quote-settlement.md#req-pr01-bulk-quote-settlement #f2fb3d7 Re-read the section: omitted and size 1 pay Action.cost, and a larger integer pays the matching quote.
 */
export const singleBuySize = 1;

function actionPriceKey<N, U extends string, Vars>(
  action: Action<N, U, Vars>,
  ctx: SimContext<N, U, Vars>,
  state: SimState<N, U, Vars>,
): string | undefined {
  try {
    const cost = action.cost(ctx, state);
    const label = action.label ?? "";
    if (cost == null) return `${label}\0`;
    if (!ctx.E.isFinite(cost.amount)) return undefined;
    return `${label}\0${cost.unit.code}\0${ctx.E.toString(cost.amount)}`;
  } catch {
    return undefined;
  }
}

/**
 * `occurrence` is the duplicate's place in the list from the start of the step.
 * Match that action's price first, so a same-length swap keeps the same buy.
 * When the price moved and the length did not, keep the slot.
 */
function alignFreshDuplicate<N, U extends string, Vars>(
  baseline: readonly Action<N, U, Vars>[],
  fresh: readonly Action<N, U, Vars>[],
  ctx: SimContext<N, U, Vars>,
  state: SimState<N, U, Vars>,
  occurrence: number,
): Action<N, U, Vars> | undefined {
  const origin = baseline[occurrence];
  if (!origin) return undefined;
  const originKey = actionPriceKey(origin, ctx, state);
  if (originKey !== undefined) {
    const used = new Set<number>();
    for (const action of fresh) {
      const key = actionPriceKey(action, ctx, state);
      if (key === undefined) continue;
      let index = -1;
      for (let cursor = 0; cursor < baseline.length; cursor += 1) {
        if (used.has(cursor)) continue;
        if (actionPriceKey(baseline[cursor]!, ctx, state) === key) {
          index = cursor;
          break;
        }
      }
      if (index < 0) continue;
      used.add(index);
      if (index === occurrence) return action;
    }
  }
  // The price moved and the list length did not. Keep the slot.
  if (fresh.length === baseline.length) return fresh[occurrence];
  return undefined;
}

function currentAction<N, U extends string, Vars>(
  model: Model<N, U, Vars>,
  ctx: SimContext<N, U, Vars>,
  state: SimState<N, U, Vars>,
  selected: Action<N, U, Vars>,
  occurrence: number | undefined,
  baseline: () => readonly Action<N, U, Vars>[],
): Action<N, U, Vars> | undefined {
  const fresh = model.actions(ctx, state);
  const byRef = fresh.find((candidate) => candidate === selected);
  if (byRef) return byRef;
  const sameIdentity = (candidate: Action<N, U, Vars>) =>
    candidate.id === selected.id && candidate.kind === selected.kind;
  const matches = fresh.filter(sameIdentity);
  if (matches.length === 1) return matches[0];
  if (occurrence === undefined) return undefined;
  return alignFreshDuplicate(baseline().filter(sameIdentity), matches, ctx, state, occurrence);
}

function rejectBulk<N>(events: SimEvent<N>[], actionId: string, code: string, detail: unknown): void {
  events.push({ type: "warning", code, detail });
  events.push({ type: "action.skipped", actionId, reason: "invalidQuote" });
}

function isQuotedBulkSize(size: number): boolean {
  return Number.isInteger(size) && size > singleBuySize;
}

function exactDecimal(text: string): { sign: -1 | 0 | 1; coeff: bigint; exp: bigint } | undefined {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(text.trim());
  if (!match) return undefined;
  const whole = match[2] ?? "";
  const frac = match[3] ?? "";
  let exp = match[4] ? BigInt(match[4]) : 0n;
  exp -= BigInt(frac.length);
  const digits = `${whole}${frac}`.replace(/^0+(?=\d)/, "");
  if (digits === "0") return { sign: 0, coeff: 0n, exp: 0n };
  return { sign: match[1] === "-" ? -1 : 1, coeff: BigInt(digits), exp };
}

function exactTextOrder(leftText: string, rightText: string): -1 | 0 | 1 | undefined {
  const left = exactDecimal(leftText);
  const right = exactDecimal(rightText);
  if (!left || !right) return undefined;
  if (left.sign === 0 || right.sign === 0) {
    return left.sign === right.sign ? 0 : left.sign === 0 ? (right.sign < 0 ? 1 : -1) : left.sign;
  }
  if (left.sign !== right.sign) return left.sign < right.sign ? -1 : 1;
  const leftDigits = left.coeff.toString();
  const rightDigits = right.coeff.toString();
  const leftScale = left.exp + BigInt(leftDigits.length);
  const rightScale = right.exp + BigInt(rightDigits.length);
  if (leftScale !== rightScale) {
    const magnitude = leftScale < rightScale ? -1 : 1;
    if (left.sign === 1) return magnitude;
    return magnitude === -1 ? 1 : -1;
  }
  const width = Math.max(leftDigits.length, rightDigits.length);
  const leftPadded = leftDigits.padEnd(width, "0");
  const rightPadded = rightDigits.padEnd(width, "0");
  const magnitude = leftPadded < rightPadded ? -1 : leftPadded > rightPadded ? 1 : 0;
  if (magnitude === 0 || left.sign === 1) return magnitude;
  return magnitude === -1 ? 1 : -1;
}

type ExactEngine<N> = {
  toString(value: N): string;
  exactOrder?(left: N, right: N): -1 | 0 | 1;
  isFinite?(value: N): boolean;
};

/** Settlement boundaries ignore `cmp`, which treats an epsilon-sized gap as equality. */
function exactAmountOrder<N>(engine: ExactEngine<N>, left: N, right: N): -1 | 0 | 1 | undefined {
  const leftText = engine.toString(left);
  const rightText = engine.toString(right);
  if (leftText === "NaN" || rightText === "NaN") return undefined;
  if (rightText === "Infinity" || rightText === "-Infinity") {
    const finiteText = engine.isFinite?.(right) === true;
    if (finiteText && engine.exactOrder) return engine.exactOrder(left, right);
    return undefined;
  }
  if ((leftText === "Infinity" || leftText === "-Infinity") && exactDecimal(rightText)) {
    return leftText === "-Infinity" ? -1 : 1;
  }
  const parsed = exactTextOrder(leftText, rightText);
  if (parsed !== undefined) return parsed;
  return engine.exactOrder?.(left, right);
}

/** True when the wallet can pay the cost without `cmp` or a rounded `toNumber`. */
export function canSettleCost<N>(engine: ExactEngine<N>, wallet: N, cost: N): boolean {
  const order = exactAmountOrder(engine, wallet, cost);
  return order !== undefined && order >= 0;
}

function matchingQuotes<N, U extends string>(
  quotes: readonly BulkQuote<N, U>[],
  size: number,
): BulkQuote<N, U>[] {
  const matched: BulkQuote<N, U>[] = [];
  for (const quote of quotes) {
    if (quote && quote.size === size) matched.push(quote);
  }
  return matched;
}

function isQuoteList<N, U extends string>(
  value: readonly BulkQuote<N, U>[] | undefined,
): value is readonly BulkQuote<N, U>[] {
  return Array.isArray(value);
}

function moneyUnitCode(money: { unit?: { code?: unknown } | null } | null | undefined): string | undefined {
  const code = money?.unit?.code;
  return typeof code === "string" && code.length > 0 ? code : undefined;
}

function payQuote<N, U extends string, Vars>(
  ctx: SimContext<N, U, Vars>,
  state: SimState<N, U, Vars>,
  actionId: string,
  cost: Money<N, U> | null | undefined,
  events: SimEvent<N>[],
): SimState<N, U, Vars> | undefined {
  if (cost == null) {
    if (cost === null) return state;
    rejectBulk(events, actionId, "INVALID_BULK_COST", { actionId, reason: "missingCost" });
    return undefined;
  }
  const costCode = moneyUnitCode(cost);
  const walletCode = moneyUnitCode(state.wallet.money);
  if (!costCode || cost.amount == null) {
    rejectBulk(events, actionId, "INVALID_BULK_COST", { actionId, reason: "malformedCost" });
    return undefined;
  }
  if (!walletCode || walletCode !== costCode) {
    rejectBulk(events, actionId, "UNIT_MISMATCH_ON_COST", {
      actionId,
      wallet: walletCode,
      cost: costCode,
    });
    return undefined;
  }
  const { E } = ctx;
  if (!E.isFinite(cost.amount)) {
    rejectBulk(events, actionId, "INVALID_BULK_COST", { actionId });
    return undefined;
  }
  const costOrder = exactAmountOrder(E, cost.amount, E.zero());
  if (costOrder === undefined || costOrder < 0) {
    rejectBulk(events, actionId, "INVALID_BULK_COST", { actionId });
    return undefined;
  }
  const afford = exactAmountOrder(E, state.wallet.money.amount, cost.amount);
  if (afford === undefined || afford < 0) {
    const behavior = ctx.payment?.onInsufficientFunds ?? "skip";
    if (behavior === "throw") {
      throw new Error(`Insufficient funds for action ${actionId}`);
    }
    if (behavior === "warn") {
      events.push({
        type: "warning",
        code: "INSUFFICIENT_FUNDS",
        detail: { actionId },
      });
    }
    events.push({
      type: "action.skipped",
      actionId,
      reason: "insufficientFunds",
    });
    return undefined;
  }
  return {
    ...state,
    wallet: {
      ...state.wallet,
      money: {
        ...state.wallet.money,
        amount: E.sub(state.wallet.money.amount, cost.amount),
      },
    },
  };
}

function settleBulk<N, U extends string, Vars>(
  ctx: SimContext<N, U, Vars>,
  action: Action<N, U, Vars>,
  state: SimState<N, U, Vars>,
  size: number,
  events: SimEvent<N>[],
): { state: SimState<N, U, Vars>; cost: Money<N, U> | null } | undefined {
  if (typeof size !== "number" || !isQuotedBulkSize(size)) {
    rejectBulk(events, action.id, "INVALID_BULK_SIZE", { actionId: action.id, size });
    return undefined;
  }
  const raw = action.bulk?.(ctx, state);
  if (!isQuoteList(raw)) {
    rejectBulk(events, action.id, "MISSING_BULK_QUOTE", { actionId: action.id, size });
    return undefined;
  }
  const matched = matchingQuotes(raw, size);
  if (matched.length === 0) {
    rejectBulk(events, action.id, "MISSING_BULK_QUOTE", { actionId: action.id, size });
    return undefined;
  }
  if (matched.length > 1) {
    rejectBulk(events, action.id, "AMBIGUOUS_BULK_QUOTE", { actionId: action.id, size });
    return undefined;
  }
  const quote = matched[0];
  if (!quote) return undefined;
  const paid = payQuote(ctx, state, action.id, quote.cost, events);
  if (!paid) return undefined;
  return { state: paid, cost: quote.cost };
}

function resetSnapshot<N, U extends string, Vars>(
  ctx: SimContext<N, U, Vars>,
  state: SimState<N, U, Vars>,
): ResetSnapshot {
  return {
    t: state.t,
    money: ctx.E.toString(state.wallet.money.amount),
    points: ctx.E.toString(state.prestige.points),
    multiplier: ctx.E.toString(state.prestige.multiplier),
    count: state.prestige.count,
  };
}

/**
 * Wall time of a decision at reward time t. The segment clock records where the segment began on both clocks, and
 * wall time advances with reward time inside it, up to the segment's wall end.
 */
function wallNow<N, U extends string, Vars>(ctx: SimContext<N, U, Vars>, t: number): number | null {
  const clocks = ctx.clocks;
  if (!clocks || typeof clocks.wallT !== "number" || !Number.isFinite(clocks.wallT)) return null;
  const offset = Number.isFinite(clocks.rewardT) ? Math.max(0, t - clocks.rewardT) : 0;
  const wall = clocks.wallT + offset;
  return Number.isFinite(clocks.wallEndT) ? Math.min(wall, clocks.wallEndT) : wall;
}

/**
 * Pay and apply already chosen actions.
 * This is the payment path inside `stepOnce`. It does not tick income, evolve, or advance `t`.
 * Each decision re-reads `model.actions` for the state so far, so a later buy is quoted after earlier applies.
 *
 * @evidence docs/requirements/active/reset-cycle-execution.md#req-pr10-committed-reset A reset commits through this payment path and does not mint a tick of income.
 * @evidenceReview docs/requirements/active/reset-cycle-execution.md#req-pr10-committed-reset #22d7a8a Re-read the section: the reset call does not tick income or advance t.
 */
export function applyDecisions<N, U extends string, Vars>(args: {
  ctx: SimContext<N, U, Vars>;
  model: Model<N, U, Vars>;
  state: SimState<N, U, Vars>;
  decisions?: readonly StepDecision<N, U, Vars>[];
  constraints?: ScenarioConstraints;
  admits?: (action: Action<N, U, Vars>) => boolean;
  resetKinds?: ReadonlySet<"prestige" | "custom">;
  /**
   * Default true: re-read `model.actions` and drop a decision the model no longer lists.
   * A reset adapter passes false. Its action was built for this state and may not be a model action.
   */
  resolveAgainstModel?: boolean;
}): {
  state: SimState<N, U, Vars>;
  events: SimEvent<N>[];
  actionsApplied: Array<{ t: number; actionId: string; label?: string; bulkSize?: number }>;
  prestigeResetT?: number;
  committedResets: CommittedResetFact[];
} {
  const { ctx, model, constraints } = args;
  const { E } = ctx;
  const resetKinds = args.resetKinds ?? new Set<"prestige" | "custom">(["prestige"]);
  let next = args.state;
  const events: SimEvent<N>[] = [];
  const actionsApplied: Array<{ t: number; actionId: string; label?: string; bulkSize?: number }> = [];
  const committedResets: CommittedResetFact[] = [];
  let baseline: readonly Action<N, U, Vars>[] | undefined;
  const baselineActions = () => (baseline ??= model.actions(ctx, args.state));
  let prestigeResetT: number | undefined;
  const maxActionsPerStep = constraints?.maxActionsPerStep ?? Number.POSITIVE_INFINITY;
  const decisions = (args.decisions ?? []).slice(0, Math.max(0, maxActionsPerStep));

  const resolveAgainstModel = args.resolveAgainstModel ?? true;
  for (const d of decisions) {
    const action = resolveAgainstModel
      ? currentAction(model, ctx, next, d.action, d.occurrence, baselineActions)
      : d.action;
    if (!action) {
      events.push({
        type: "action.skipped",
        actionId: d.action.id,
        reason: "cannotApply",
      });
      continue;
    }
    if (args.admits && !args.admits(action)) continue;
    if (!action.canApply(ctx, next)) {
      events.push({
        type: "action.skipped",
        actionId: action.id,
        reason: "cannotApply",
      });
      continue;
    }

    if (action.kind === "prestige") {
      const cooldown = decidePrestigeCooldown({
        nowT: next.t,
        minIntervalSec: constraints?.minPrestigeIntervalSec,
        // A reset committed earlier in this tick is the newest anchor.
        lastResetT: prestigeResetT ?? constraints?.lastPrestigeResetT,
      });
      if (cooldown.warning) {
        events.push({
          type: "warning",
          code: "PRESTIGE_COOLDOWN_UNANCHORED",
          detail: { actionId: action.id },
        });
      }
      if (!cooldown.allowed) {
        events.push({
          type: "warning",
          code: "PRESTIGE_COOLDOWN",
          detail: { actionId: action.id, readyAtT: cooldown.readyAtT, nowT: next.t },
        });
        events.push({
          type: "action.skipped",
          actionId: action.id,
          reason: "cooldown",
        });
        continue;
      }
    }

    // Only an action that can emit a reset fact needs the before snapshot.
    const resetKind = (action.kind === "prestige" || action.kind === "custom") && resetKinds.has(action.kind);
    const before = resetKind ? resetSnapshot(ctx, next) : undefined;
    let settledSize = d.bulkSize;
    let paid: Money<N, U> | null = null;
    if (d.bulkSize !== undefined && d.bulkSize !== singleBuySize) {
      const settled = settleBulk(ctx, action, next, d.bulkSize, events);
      if (!settled) continue;
      next = settled.state;
      paid = settled.cost;
      settledSize = d.bulkSize;
    } else {
      const cost = action.cost(ctx, next);
      if (cost) {
        if (next.wallet.money.unit.code !== cost.unit.code) {
          events.push({
            type: "warning",
            code: "UNIT_MISMATCH_ON_COST",
            detail: {
              actionId: action.id,
              wallet: next.wallet.money.unit.code,
              cost: cost.unit.code,
            },
          });
          continue;
        }

        if (!E.isFinite(cost.amount)) {
          events.push({
            type: "action.skipped",
            actionId: action.id,
            reason: "invalidQuote",
          });
          continue;
        }
        const singleCost = exactAmountOrder(E, cost.amount, E.zero());
        if (singleCost === undefined || singleCost < 0) {
          events.push({
            type: "action.skipped",
            actionId: action.id,
            reason: "invalidQuote",
          });
          continue;
        }
        const singleAfford = exactAmountOrder(E, next.wallet.money.amount, cost.amount);
        if (singleAfford === undefined || singleAfford < 0) {
          const behavior = ctx.payment?.onInsufficientFunds ?? "skip";
          if (behavior === "throw") {
            throw new Error(`Insufficient funds for action ${action.id}`);
          }
          if (behavior === "warn") {
            events.push({
              type: "warning",
              code: "INSUFFICIENT_FUNDS",
              detail: { actionId: action.id },
            });
          }
          events.push({
            type: "action.skipped",
            actionId: action.id,
            reason: "insufficientFunds",
          });
          continue;
        }

        next = {
          ...next,
          wallet: {
            ...next.wallet,
            money: {
              ...next.wallet.money,
              amount: E.sub(next.wallet.money.amount, cost.amount),
            },
          },
        };
        paid = cost;
      }
    }

    const decisionT = next.t;
    const pointsBefore = next.prestige.points;
    next = action.apply(ctx, next, settledSize);
    if (action.kind === "prestige") prestigeResetT = decisionT;
    events.push({
      type: "action.applied",
      actionId: action.id,
      label: action.label,
      detail: settledSize ? { bulkSize: settledSize } : undefined,
    });
    actionsApplied.push({
      t: next.t,
      actionId: action.id,
      label: action.label,
      bulkSize: settledSize,
    });
    if ((action.kind === "prestige" || action.kind === "custom") && before !== undefined) {
      committedResets.push({
        actionId: action.id,
        kind: action.kind,
        t: decisionT,
        wallT: wallNow(ctx, decisionT),
        cost: paid
          ? { unit: paid.unit.code, decimal: E.toString(paid.amount) }
          : null,
        rewardDelta: E.toString(E.sub(next.prestige.points, pointsBefore)),
        before,
        after: resetSnapshot(ctx, next),
      });
    }
  }

  return {
    state: next,
    events,
    actionsApplied,
    ...(prestigeResetT !== undefined ? { prestigeResetT } : {}),
    committedResets,
  };
}

/**
 * Single source of truth for one tick.
 * An omitted size or `singleBuySize` pays `Action.cost` once, then `apply` once.
 * A larger integer size pays the matching `BulkQuote.cost` once, then `apply` once.
 * `apply` does not pay again. A rejected quote leaves this state unchanged.
 * Plugin callbacks are not a transaction.
 *
 * @evidence docs/requirements/active/bulk-quote-settlement.md#req-pr01-bulk-quote-settlement Pays the current matching BulkQuote once for a quoted bulk size and keeps the single-cost path for size 1.
 * @evidenceReview docs/requirements/active/bulk-quote-settlement.md#req-pr01-bulk-quote-settlement #f2fb3d7 Re-read the section: size 10 pays the quote total, a missing quote does not fall back to the unit cost, and a failed check does not change wallet or vars.
 */
export function stepOnce<N, U extends string, Vars>(
  input: StepInput<N, U, Vars>,
): StepOutput<N, U, Vars> {
  const { ctx, model, dt, constraints, fast } = input;
  const prev = input.state;
  const { E } = ctx;

  const applied = applyDecisions({
    ctx,
    model,
    state: prev,
    decisions: input.decisions,
    constraints,
    ...(input.admits ? { admits: input.admits } : {}),
  });
  let next = applied.state;
  const events = applied.events;
  const actionsApplied = applied.actionsApplied;
  const prestigeResetT = applied.prestigeResetT;

  const income = model.income(ctx, next);
  const scaledIncome = {
    ...income,
    amount: E.mul(income.amount, dt),
  };
  const retainMoneyEvents = ctx.collectMoneyEvents ?? !fast?.disableMoneyEvents;
  const moneyTick = tickMoney({
    E,
    state: next.wallet,
    delta: scaledIncome,
    policy: ctx.tickPolicy,
    options: { collectEvents: retainMoneyEvents, collectFacts: !retainMoneyEvents },
  });
  // A reward is any positive amount. `cmp` would call an epsilon-sized income zero.
  const observedMoney = { applied: 0, dropped: 0, queued: 0, flushed: 0, blocked: 0, rewarded: false };
  if (moneyTick.facts) {
    observedMoney.applied = moneyTick.facts.applied;
    observedMoney.dropped = moneyTick.facts.dropped;
    observedMoney.queued = moneyTick.facts.queued;
    observedMoney.flushed = moneyTick.facts.flushed;
    observedMoney.blocked = moneyTick.facts.blocked;
    observedMoney.rewarded =
      (moneyTick.appliedDelta !== undefined && exactAmountOrder(E, moneyTick.appliedDelta, E.zero()) === 1) ||
      (moneyTick.flushedBucket !== undefined && exactAmountOrder(E, moneyTick.flushedBucket, E.zero()) === 1);
  }
  for (const moneyEvent of moneyTick.events) {
    if (moneyEvent.type === "applied") {
      observedMoney.applied += 1;
      if (exactAmountOrder(E, moneyEvent.delta, E.zero()) === 1) observedMoney.rewarded = true;
    }
    if (moneyEvent.type === "dropped") observedMoney.dropped += 1;
    if (moneyEvent.type === "queued") observedMoney.queued += 1;
    if (moneyEvent.type === "flushed") {
      observedMoney.flushed += 1;
      if (exactAmountOrder(E, moneyEvent.bucketFlushed, E.zero()) === 1) observedMoney.rewarded = true;
    }
    if (moneyEvent.type === "blocked") observedMoney.blocked += 1;
  }

  next = {
    ...next,
    wallet: moneyTick.state,
  };

  if (retainMoneyEvents && moneyTick.events.length > 0) {
    events.push({ type: "money", events: moneyTick.events });
  }

  if (model.evolve) {
    next = model.evolve(ctx, next, dt);
  }

  const milestones = model.milestones?.(ctx, prev, next) ?? [];
  for (const key of milestones) {
    events.push({ type: "milestone", key });
  }

  if (E.cmp(next.wallet.money.amount, next.maxMoneyEver.amount) > 0) {
    next = {
      ...next,
      maxMoneyEver: next.wallet.money,
    };
  }

  next = {
    ...next,
    t: next.t + dt,
  };

  if (events.length > 0 && ctx.emit) {
    ctx.emit(events);
  }

  const walletDelta: Money<N, U> = {
    unit: next.wallet.money.unit,
    amount: E.sub(next.wallet.money.amount, prev.wallet.money.amount),
  };

  return {
    prev,
    next,
    events,
    actionsApplied: actionsApplied.length > 0 ? actionsApplied : undefined,
    observedMoney,
    ...(prestigeResetT !== undefined ? { prestigeResetT } : {}),
    ...(applied.committedResets.length > 0 ? { committedResets: applied.committedResets } : {}),
    walletDelta,
  };
}
