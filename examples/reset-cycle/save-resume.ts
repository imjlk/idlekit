import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  createNumberEngine,
  executeResetCycles,
  type CompiledScenario,
  type ResetCycleCheckpoint,
  type ResetCycleExecution,
} from "../../packages/core/src/index";
import { checkResetCycleResume } from "../../packages/core/src/testkit/conformance";

type Scenario = CompiledScenario<number, "COIN", Record<string, never>>;
type Checkpoint = ResetCycleCheckpoint<number, "COIN", Record<string, never>>;
type Execution = ResetCycleExecution<number, "COIN", Record<string, never>>;
const policy = { kind: "fixed-interval", intervalSec: 10, cycles: 3 } as const;

function createScenario(): Scenario {
  const E = createNumberEngine();
  const unit = { code: "COIN" } as const;
  const money = { unit, amount: 0 };
  return {
    ctx: { E, unit, tickPolicy: { mode: "drop" } },
    model: {
      id: "checkpoint-example",
      version: 1,
      income: () => ({ unit, amount: 1 }),
      actions: () => [],
      prestige: {
        pointsFrom: () => 1,
        multiplierFrom: () => 1,
        resetState: (_ctx, state, gainedPoints) => ({
          ...state,
          prestige: {
            count: state.prestige.count + 1,
            points: E.add(state.prestige.points, gainedPoints),
            multiplier: 1,
          },
        }),
      },
    },
    initial: {
      t: 0,
      wallet: { money, bucket: 0 },
      maxMoneyEver: money,
      prestige: { count: 0, points: 0, multiplier: 1 },
      vars: {},
    },
    strategy: { id: "checkpoint-example-idle", decide: () => [] },
    run: { stepSec: 1, fast: { enabled: false }, eventLog: { enabled: false } },
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function completed(runs: readonly Execution[]) {
  // A budget-cut row is provisional. The resumed run supplies its completed replacement.
  return runs.flatMap((run) => run.artifact.cycles.filter((row) => row.resetAtSec !== null));
}

const checkpointPath = resolve(process.argv[2] ?? "tmp/reset-cycle-example/checkpoint.json");
const continuous = executeResetCycles({ scenario: createScenario(), policy });
const cut = executeResetCycles({ scenario: createScenario(), policy, budgetSteps: 3 });
assert(cut.checkpoint.pendingSec === 3 && cut.checkpoint.nextIndex === 0, "expected a cut inside cycle zero");
await mkdir(dirname(checkpointPath), { recursive: true });
await Bun.write(checkpointPath, `${JSON.stringify(cut.checkpoint, null, 2)}\n`);

// This example uses the number engine and JSON-compatible vars, so no engine-specific codec is needed.
const saved = (await Bun.file(checkpointPath).json()) as Checkpoint;
const resumed = executeResetCycles({
  scenario: createScenario(),
  policy: { ...policy, cycles: policy.cycles - saved.nextIndex },
  resume: saved,
});
assert(JSON.stringify(resumed.checkpoint) === JSON.stringify(continuous.checkpoint), "saved/resumed checkpoint differs");
assert(JSON.stringify(completed([cut, resumed])) === JSON.stringify(completed([continuous])), "completed rows differ");
assert(resumed.state.t === 30 && resumed.state.wallet.money.amount === 30, "expected 30 seconds and 30 coins");
assert(resumed.state.prestige.points === 3 && resumed.state.prestige.count === 3, "expected three committed resets");
assert(resumed.checkpoint.accumulatedReward === 3 && resumed.checkpoint.nextIndex === 3, "expected all cycles complete");

// The equivalence relation is declared only for this constant-income, stateless fixture.
const midCycle = checkResetCycleResume(true, createScenario(), policy, { budgetSteps: 3 });
const boundary = checkResetCycleResume(true, createScenario(), policy, { cycles: 1 });
assert(midCycle.applicable && midCycle.ok && boundary.applicable && boundary.ok, "reset resume conformance failed");
console.log(
  JSON.stringify({
    checkpointPath,
    cut: {
      elapsedSec: saved.elapsedSec,
      nextIndex: saved.nextIndex,
      pendingSec: saved.pendingSec,
      pendingDurationSec: saved.pendingDurationSec,
    },
    final: {
      elapsedSec: resumed.checkpoint.elapsedSec,
      nextIndex: resumed.checkpoint.nextIndex,
      coins: resumed.state.wallet.money.amount,
      points: resumed.state.prestige.points,
      accumulatedReward: resumed.checkpoint.accumulatedReward,
    },
    completedRows: completed([cut, resumed]),
    matchesContinuous: true,
    conformance: { midCycle, boundary },
  }, null, 2),
);
