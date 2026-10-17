import assert from "assert/strict";
import { applyRetentionPatch, observeCohort, planRetentionPatch, simulateSessionPattern,
  type CompiledScenario, type SimState, type ScenarioV1 } from "@idlekit/core";
import { createBreakInfinityEngine } from "@idlekit/money";
import fixture from "../../../fixtures/regressions/research-tower.json";

/** Replays recorded game boundaries against public SDK exports, without importing the game. */
export function checkResearchTower(): number {
  const cohortScenario = fixture.cohort.scenario as ScenarioV1;
  const originalCohort = JSON.stringify(fixture.cohort);
  const observation = observeCohort(fixture.cohort.rows, fixture.cohort.observedThroughDay);
  assert.equal(observation.users, 3, "complete install denominator includes inactive users");
  const plan = planRetentionPatch(observation, cohortScenario.monetization?.retention);
  assert.equal(plan.status, "ready");
  assert.deepEqual(plan.retention, { d1: 1 / 3, d7: 1 / 3 });
  const calibrated = applyRetentionPatch({ scenario: cohortScenario, observation });
  assert.deepEqual(calibrated.monetization?.retention, {
    ...cohortScenario.monetization?.retention, d1: 1 / 3, d7: 1 / 3, d30: 0.09, d90: 0.04,
  });
  assert.equal(fixture.cohort.revenue, "not-collected");
  assert.deepEqual(calibrated.monetization?.revenue, cohortScenario.monetization?.revenue);
  assert.throws(() => applyRetentionPatch({ scenario: cohortScenario,
    observation: observeCohort(fixture.cohort.rows.filter(row => row.day === 0), 1) }), /requires-review/);
  assert.equal(JSON.stringify(fixture.cohort), originalCohort, "cohort input preserved");
  const E = createBreakInfinityEngine();
  type N = ReturnType<typeof E.from>;
  type Vars = Record<string, unknown>;
  type State = SimState<N, "MANA", Vars>;
  type Snapshot = { t: number; money: string; bucket: string; maxMoneyEver: string;
    prestige: { count: number; points: string; multiplier: string }; vars: Vars };
  const unit = { code: "MANA" as const };
  const unpack = (saved: Snapshot): State => ({ t: saved.t, vars: structuredClone(saved.vars),
    wallet: { money: { unit, amount: E.from(saved.money) }, bucket: E.from(saved.bucket) },
    maxMoneyEver: { unit, amount: E.from(saved.maxMoneyEver) },
    prestige: { count: saved.prestige.count, points: E.from(saved.prestige.points), multiplier: E.from(saved.prestige.multiplier) } });
  const checkState = (state: State, saved: Snapshot, label: string) => {
    assert.equal(state.t, saved.t, `${label}: reward clock`);
    assert.equal(E.toString(state.wallet.money.amount), saved.money, `${label}: wallet`);
    assert.equal(E.toString(state.wallet.bucket), saved.bucket, `${label}: bucket`);
    assert.equal(E.toString(state.maxMoneyEver.amount), saved.maxMoneyEver, `${label}: maximum`);
    assert.equal(state.prestige.count, saved.prestige.count, `${label}: prestige count`);
    assert.equal(E.toString(state.prestige.points), saved.prestige.points, `${label}: prestige points`);
    assert.equal(E.toString(state.prestige.multiplier), saved.prestige.multiplier, `${label}: prestige multiplier`);
    assert.deepEqual(state.vars, saved.vars, `${label}: game state`);
  };
  assert.equal(fixture.cases.length, 6);
  for (const item of fixture.cases) {
    let segmentIndex = 0;
    let offlineTicks = 0;
    const before = () => segmentIndex === 0 ? item.initial : item.segments[segmentIndex - 1]!.after;
    const scenario: CompiledScenario<N, "MANA", Vars> = {
      ctx: { E, unit, tickPolicy: { mode: "drop" } }, initial: unpack(item.initial),
      run: { stepSec: 600, offline: { actions: { mode: "none" } }, eventLog: { enabled: false } },
      // Online decisions are game-owned: replay their recorded result once per active segment.
      model: { id: "tower-recorded-online", version: 1, actions: () => [],
        income: (_ctx, state) => {
          assert.equal(item.segments[segmentIndex]!.kind, "active");
          checkState(state, before(), `${item.name}: active entry`);
          return { unit, amount: E.zero() };
        },
        evolve: (_ctx, state, dt) => {
          const segment = item.segments[segmentIndex++]!;
          assert.equal(dt, segment.wallEnd - segment.wallStart);
          return { ...unpack(segment.after), t: state.t };
        },
      },
    };
    const original = JSON.stringify(scenario.initial);
    const result = simulateSessionPattern({ scenario,
      pattern: { id: "twice-daily", days: 1, schedule: [
        { day: 0, startOffsetSec: 0, durationSec: 600 }, { day: 0, startOffsetSec: 45000, durationSec: 600 },
      ] },
      prepareOffline: ({ state, seconds, wallStartT, wallEndT }) => {
        const segment = item.segments[segmentIndex]!;
        assert.equal(segment.kind, "offline");
        assert.ok(segment.cap !== undefined && segment.credited !== undefined && segment.reward !== undefined);
        checkState(state, before(), `${item.name}: offline entry`);
        assert.deepEqual([seconds, wallStartT, wallEndT], [segment.wallEnd - segment.wallStart, segment.wallStart, segment.wallEnd]);
        const reward = E.from(segment.reward);
        const credited = segment.credited;
        return { policy: { maxSec: segment.cap }, stepSec: Math.max(credited, 1), model: {
          id: "tower-recorded-absence", version: 1, actions: () => [],
          income: () => ({ unit, amount: E.div(reward, credited || 1) }),
          evolve: (_ctx, current, dt) => {
            assert.equal(dt, credited, `${item.name}: one atomic settlement`);
            // Game manaText rounds decimal mantissas; check reconstructed credit relatively,
            // then pack the authoritative game settlement exactly as the real adapter does.
            const settled = E.from(segment.after.money);
            assert.ok(E.isFinite(current.wallet.money.amount), `${item.name}: finite credit`);
            assert.ok(Math.abs(E.toNumber(E.divN(current.wallet.money.amount, settled)) - 1) <= 1e-12,
              `${item.name}: credited reward`);
            offlineTicks++;
            segmentIndex++;
            return { ...unpack(segment.after), t: current.t };
          },
        } };
      },
    });
    assert.equal(segmentIndex, item.segments.length, item.name);
    assert.equal(offlineTicks, 2, `${item.name}: once per return`);
    checkState(result.end, item.segments.at(-1)!.after, item.name);
    for (const key of ["elapsedSec", "activeSec", "offlineCreditedSec", "lostRewardSec"] as const) {
      assert.equal(result.summary[key], item.expected[key], `${item.name}: ${key}`);
    }
    assert.equal(JSON.stringify(scenario.initial), original, `${item.name}: input preserved`);
  }
  return fixture.cases.length;
}
