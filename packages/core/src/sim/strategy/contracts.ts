/**
 * Determinism Contract (v0.1)
 *
 * The whole simulator stack should be deterministic given:
 * - compiled scenario (ctx + model + initial + constraints + run options)
 * - strategy params (and optional tuneSpec seed list)
 *
 * Rules:
 * 1) Model/Action/Strategy MUST NOT use:
 *    - Math.random(), Date.now(), performance.now()
 *    - global mutable singletons
 *    - iteration order of JS objects/maps unless stabilized
 *
 * 2) Model.actions() MUST return a stable set for identical state inputs.
 *    If order isn't guaranteed, consumers (greedy/planner) MUST stabilize by sorting.
 *
 * 3) Action.bulk() MUST return deterministic quotes for identical inputs.
 *    If order isn't guaranteed, consumers MUST stabilize by sorting by size ascending.
 *
 * 4) Strategy.decide() MUST be deterministic and MUST NOT mutate:
 *    - ctx, model, state (treat as immutable)
 *    - internal hidden state should be avoided; if needed, must be reset/recreated per run.
 *
 * 5) Tie-break MUST be stable:
 *    When two candidates have identical score, choose by:
 *    (a) lower equivalentCost (if available)
 *    (b) lower cost
 *    (c) actionId lexicographic
 *    (d) bulkSize ascending
 *
 * Notes:
 * - We intentionally keep RNG out of core v0.1.
 *   If stochastic models are needed later, randomness should be carried explicitly in Vars/SimState,
 *   so that rollouts (planner) can clone it safely.
 */

export const DeterminismContract = {
  version: 1,
} as const;
