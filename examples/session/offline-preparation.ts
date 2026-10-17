import { simulateSessionPattern, type CompiledScenario } from "@idlekit/core";
import { createBreakInfinityEngine } from "@idlekit/money";

const E = createBreakInfinityEngine();
type Amount = ReturnType<typeof E.from>;
type Vars = { rate: Amount; capSeconds: number; returns: number };
const unit = { code: "MANA" as const };
const scenario: CompiledScenario<Amount, "MANA", Vars> = {
  ctx: { E, unit, tickPolicy: { mode: "drop" } },
  model: { id: "online", version: 1,
    income: (ctx, state) => ({ unit: ctx.unit, amount: state.vars.rate }), actions: () => [] },
  initial: { t: 0, vars: { rate: E.from("1e400"), capSeconds: 2, returns: 0 },
    wallet: { money: { unit, amount: E.zero() }, bucket: E.zero() },
    maxMoneyEver: { unit, amount: E.zero() },
    prestige: { count: 0, points: E.zero(), multiplier: E.from(1) } },
  run: { stepSec: 1, offline: { actions: { mode: "none" } } },
};
const absences: Array<{ wallStartT: number; wallEndT: number }> = [];
const session = simulateSessionPattern({ scenario,
  pattern: { id: "offline-heavy", days: 1, schedule: [{ day: 0, startOffsetSec: 0, durationSec: 1 }] },
  prepareOffline: ({ state, ctx, seconds, wallStartT, wallEndT }) => {
    absences.push({ wallStartT, wallEndT });
    // A real game can call its settlement routine once here, on the provided snapshot,
    // using wallStartT/wallEndT for expiry and state.vars for state-dependent caps.
    const credited = Math.min(seconds, state.vars.capSeconds);
    const settledVars = { ...state.vars, returns: state.vars.returns + 1 };
    return { policy: { maxSec: state.vars.capSeconds }, stepSec: Math.max(credited, 1),
      model: { id: "absence", version: 1,
        income: () => ({ unit: ctx.unit, amount: ctx.E.mul(state.vars.rate, 1.3) }),
        evolve: (_ctx, current) => ({ ...current, vars: settledVars }), actions: () => [],
        clocks: { respondsTo: ["wall"] },
      },
    };
  },
});
console.log(JSON.stringify({ absences, money: E.toString(session.end.wallet.money.amount),
  returns: session.end.vars.returns, clocks: session.summary }, null, 2));
