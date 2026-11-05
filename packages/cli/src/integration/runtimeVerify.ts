import {
  compileScenario,
  createNumberEngine,
  runScenario,
  type ModelRegistry,
  type RuntimeAmount,
  type RuntimeEconomyAdapter,
  type RuntimeProbeState,
  type ScenarioV1,
  type SimState,
  type StrategyRegistry,
} from "@idlekit/core";

export const RUNTIME_VERIFY_SCHEMA_REF = "docs/schemas/runtime.verify.output.schema.json";

export type Tolerance = Readonly<{ relative: number; absolute: number }>;

export type MetricSummary = Readonly<{
  metric: string;
  compared: number;
  mismatches: number;
  /** Probes where either side returned null or a non-numeric value. */
  skipped: number;
  maxAbsDiff: number;
  maxRelDiff: number;
}>;

export type MismatchRow = Readonly<{
  sample: number;
  t: number;
  metric: string;
  idlekit: number | null;
  runtime: number | null;
  absDiff: number | null;
  relDiff: number | null;
  vars: Readonly<Record<string, unknown>>;
}>;

export type RuntimeVerifyReport = Readonly<{
  ok: boolean;
  runtime: Readonly<{ id: string; version?: number; description?: string }>;
  scenario: Readonly<{ id?: string; model: string }>;
  seed: number;
  tolerance: Tolerance;
  durationSec: number;
  traceEvery: number;
  samples: number;
  metrics: readonly MetricSummary[];
  firstMismatch: MismatchRow | null;
  mismatches: readonly MismatchRow[];
  truncatedMismatches: number;
}>;

type NumState = SimState<number, string, Record<string, unknown>>;

function toRuntimeNumber(value: RuntimeAmount | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Equal when either the absolute or the relative difference is inside the tolerance. */
export function withinTolerance(a: number, b: number, tolerance: Tolerance): { ok: boolean; abs: number; rel: number } {
  const abs = Math.abs(a - b);
  const scale = Math.max(Math.abs(a), Math.abs(b));
  const rel = scale === 0 ? 0 : abs / scale;
  return { ok: abs <= tolerance.absolute || rel <= tolerance.relative, abs, rel };
}

function probeState(state: NumState, sample: number, seed: number): RuntimeProbeState {
  return {
    t: state.t,
    sample,
    wallet: state.wallet.money.amount,
    vars: { ...(state.vars ?? {}) },
    prestigeCount: state.prestige.count,
    prestigeMultiplier: state.prestige.multiplier,
    seed,
  };
}

/**
 * Run the idlekit simulation, then evaluate the runtime adapter on every traced state and
 * compare income and action prices. Both sides see the same states, so a difference is a
 * formula difference, not a drift in the trajectory.
 */
export function verifyRuntime(args: {
  scenario: ScenarioV1;
  modelRegistry: ModelRegistry;
  strategyRegistry: StrategyRegistry;
  adapter: RuntimeEconomyAdapter;
  seed: number;
  tolerance: Tolerance;
  traceEvery: number;
  durationSec?: number;
  maxRows: number;
}): RuntimeVerifyReport {
  const { scenario, adapter, seed, tolerance } = args;
  const E = createNumberEngine();
  const compiled = compileScenario<number, string, Record<string, unknown>>({
    E,
    scenario,
    registry: args.modelRegistry,
    strategyRegistry: args.strategyRegistry,
    opts: { allowSuffixNotation: true },
  });
  const durationSec = args.durationSec ?? compiled.run.durationSec ?? scenario.clock.durationSec ?? 0;
  if (!(durationSec > 0)) throw new Error("verify runtime needs a positive duration: set clock.durationSec or pass --duration.");
  const ctx = { ...compiled.ctx, seed };
  const run = runScenario({
    ...compiled,
    ctx,
    run: {
      ...compiled.run,
      durationSec,
      until: undefined,
      trace: { everySteps: Math.max(1, args.traceEvery), keepActionsLog: false },
    },
  });
  const trace = (run.trace ?? [run.start, run.end]) as readonly NumState[];

  adapter.init?.({ seed, scenarioId: scenario.meta?.id, modelParams: scenario.model.params });

  const summaries = new Map<string, { compared: number; mismatches: number; skipped: number; maxAbsDiff: number; maxRelDiff: number }>();
  const summary = (metric: string) => {
    let s = summaries.get(metric);
    if (!s) {
      s = { compared: 0, mismatches: 0, skipped: 0, maxAbsDiff: 0, maxRelDiff: 0 };
      summaries.set(metric, s);
    }
    return s;
  };
  const rows: MismatchRow[] = [];
  let firstMismatch: MismatchRow | null = null;
  let totalMismatches = 0;

  const compare = (sample: number, state: NumState, metric: string, idlekit: number | null, runtime: number | null) => {
    const s = summary(metric);
    if (idlekit === null || runtime === null) {
      if (idlekit === null && runtime === null) return;
      s.skipped += 1;
      const row: MismatchRow = { sample, t: state.t, metric, idlekit, runtime, absDiff: null, relDiff: null, vars: { ...(state.vars ?? {}) } };
      s.mismatches += 1;
      totalMismatches += 1;
      firstMismatch ??= row;
      if (rows.length < args.maxRows) rows.push(row);
      return;
    }
    s.compared += 1;
    const diff = withinTolerance(idlekit, runtime, tolerance);
    s.maxAbsDiff = Math.max(s.maxAbsDiff, diff.abs);
    s.maxRelDiff = Math.max(s.maxRelDiff, diff.rel);
    if (diff.ok) return;
    s.mismatches += 1;
    totalMismatches += 1;
    const row: MismatchRow = { sample, t: state.t, metric, idlekit, runtime, absDiff: diff.abs, relDiff: diff.rel, vars: { ...(state.vars ?? {}) } };
    firstMismatch ??= row;
    if (rows.length < args.maxRows) rows.push(row);
  };

  trace.forEach((state, sample) => {
    const probe = probeState(state, sample, seed);
    const expectedIncome = compiled.model.income(ctx, state).amount;
    compare(sample, state, "incomePerSec", Number.isFinite(expectedIncome) ? expectedIncome : null, toRuntimeNumber(adapter.incomePerSec(probe)));
    if (!adapter.actionCosts) return;
    const runtimeCosts = adapter.actionCosts(probe);
    const actions = compiled.model.actions(ctx, state);
    for (const actionId of Object.keys(runtimeCosts).sort()) {
      const action = actions.find((x) => x.id === actionId);
      const cost = action?.cost(ctx, state)?.amount;
      const expected = cost !== undefined && Number.isFinite(cost) ? cost : null;
      compare(sample, state, `cost:${actionId}`, expected, toRuntimeNumber(runtimeCosts[actionId]));
    }
  });

  const metrics: MetricSummary[] = [...summaries.entries()]
    .sort(([a], [b]) => (a === "incomePerSec" ? -1 : b === "incomePerSec" ? 1 : a < b ? -1 : a > b ? 1 : 0))
    .map(([metric, s]) => ({ metric, ...s }));

  return {
    ok: totalMismatches === 0,
    runtime: {
      id: adapter.id,
      ...(adapter.version !== undefined ? { version: adapter.version } : {}),
      ...(adapter.description !== undefined ? { description: adapter.description } : {}),
    },
    scenario: {
      ...(scenario.meta?.id !== undefined ? { id: scenario.meta.id } : {}),
      model: `${scenario.model.id}@${scenario.model.version}`,
    },
    seed,
    tolerance,
    durationSec,
    traceEvery: Math.max(1, args.traceEvery),
    samples: trace.length,
    metrics,
    firstMismatch,
    mismatches: rows,
    truncatedMismatches: totalMismatches - rows.length,
  };
}

function fmt(value: number | null): string {
  if (value === null) return "n/a";
  return String(Number(value.toPrecision(10)));
}

export function renderRuntimeVerifyMarkdown(report: RuntimeVerifyReport): string {
  const lines = [
    `# Runtime verification: ${report.runtime.id}`,
    "",
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Scenario: ${report.scenario.id ?? "(no id)"} (${report.scenario.model})`,
    `- Seed: ${report.seed}`,
    `- Samples: ${report.samples} (every ${report.traceEvery} step(s), ${report.durationSec}s)`,
    `- Tolerance: relative ${report.tolerance.relative}, absolute ${report.tolerance.absolute}`,
    "",
    "| metric | compared | mismatches | skipped | max abs diff | max rel diff |",
    "| --- | --- | --- | --- | --- | --- |",
    ...report.metrics.map((m) => `| ${m.metric} | ${m.compared} | ${m.mismatches} | ${m.skipped} | ${fmt(m.maxAbsDiff)} | ${fmt(m.maxRelDiff)} |`),
  ];
  if (report.mismatches.length > 0) {
    lines.push(
      "",
      "## Mismatches",
      "",
      "| sample | t | metric | idlekit | runtime | abs diff | rel diff | vars |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      ...report.mismatches.map(
        (r) => `| ${r.sample} | ${r.t} | ${r.metric} | ${fmt(r.idlekit)} | ${fmt(r.runtime)} | ${fmt(r.absDiff)} | ${fmt(r.relDiff)} | \`${JSON.stringify(r.vars)}\` |`,
      ),
    );
    if (report.truncatedMismatches > 0) lines.push("", `${report.truncatedMismatches} more mismatch(es) not listed. Raise --max-rows to see them.`);
  }
  return `${lines.join("\n")}\n`;
}
