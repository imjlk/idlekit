/**
 * Runtime verification adapter contract.
 *
 * A game keeps its own income and cost functions (a TS runtime, a server
 * module, or a port of engine code). A plugin wraps them in this shape so
 * `idk verify runtime` can evaluate them on the same states the idlekit
 * simulation visits and report where the two disagree.
 *
 * The adapter only reads plain numbers. It never receives engine values,
 * so it does not depend on the selected money engine.
 */

/** A plain snapshot of one simulated state, handed to the runtime functions. */
export type RuntimeProbeState = Readonly<{
  /** Simulation clock in seconds. */
  t: number;
  /** Zero-based index of the probe in the verification run. */
  sample: number;
  /** Wallet amount as a JavaScript number. */
  wallet: number;
  /** Scenario `vars`, copied. For the built-in `linear` model this is `{ owned }`. */
  vars: Readonly<Record<string, unknown>>;
  prestigeCount: number;
  prestigeMultiplier: number;
  /** The seed of the verification run. Runtime randomness must derive from it. */
  seed: number;
}>;

/** A runtime value: a finite number or a decimal or scientific amount string. `null` means unavailable. */
export type RuntimeAmount = number | string | null;

export type RuntimeInitContext = Readonly<{
  /** Deterministic seed of the idlekit run. Engine-side random generators must be seeded from it. */
  seed: number;
  scenarioId?: string;
  /** `scenario.model.params`, unchanged. */
  modelParams: unknown;
}>;

export type RuntimeEconomyAdapter = Readonly<{
  id: string;
  version?: number;
  description?: string;
  /** Called once before the first probe of each verification run. */
  init?: (ctx: RuntimeInitContext) => void;
  /** Income per second at this state, in the scenario unit, after multipliers. */
  incomePerSec: (state: RuntimeProbeState) => RuntimeAmount;
  /**
   * Price of one application of each action at this state, keyed by idlekit action id
   * (for example `buy.generator`). An action id that is absent is not compared.
   */
  actionCosts?: (state: RuntimeProbeState) => Readonly<Record<string, RuntimeAmount>>;
}>;

/** Identity helper that keeps the adapter literal typed. */
export function defineRuntimeAdapter<const A extends RuntimeEconomyAdapter>(adapter: A): A {
  return adapter;
}
