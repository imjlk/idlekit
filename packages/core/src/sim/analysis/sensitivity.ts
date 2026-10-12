import type { ParamSpace } from "../strategy/opt/tuneSpec";

/**
 * Local one-at-a-time sensitivity.
 * This is not a global sensitivity index and not a Sobol index.
 */

export type ElasticityDirection = "higher" | "lower" | "flat" | "unavailable";

export type LocalElasticity = Readonly<{
  status: "observed" | "unavailable";
  elasticity: string | null;
  absoluteChange: string | null;
  direction: ElasticityDirection;
  globalSensitivity: false;
  sobol: false;
}>;

export type ParetoSense = "lower" | "higher";

export type ParetoObjective = Readonly<{
  id: string;
  sense: ParetoSense;
  value: number | null;
}>;

export type ParetoPoint = Readonly<{
  id: string;
  objectives: readonly ParetoObjective[];
}>;

export type ParetoFront = Readonly<{
  sense: "per-metric";
  nonDominated: readonly string[];
  uncompared: readonly string[];
}>;

const UNAVAILABLE: LocalElasticity = {
  status: "unavailable",
  elasticity: null,
  absoluteChange: null,
  direction: "unavailable",
  globalSensitivity: false,
  sobol: false,
};

export function assignmentFitsParamSpace(space: ParamSpace, value: string | number | boolean | null): boolean {
  // Canonical JSON, task text, and probe ids write -0 as 0, so -0 would share every descriptor with 0.
  if (Object.is(value, -0)) return false;
  if (space.kind === "bool") return typeof value === "boolean";
  if (space.kind === "int") {
    return typeof value === "number" && Number.isInteger(value) && value >= space.min && value <= space.max;
  }
  if (space.kind === "number") {
    return typeof value === "number" && Number.isFinite(value) && value >= space.min && value <= space.max;
  }
  // A JSON literal such as 1e400 parses to Infinity, and canonical JSON would write it as null.
  if (typeof value === "number" && !Number.isFinite(value)) return false;
  return space.values.some((entry) => entry === value);
}

/**
 * Relative elasticity only when baseline p and y are finite and greater than zero and p changes.
 * A missing y is not replaced with the horizon.
 */
export function localElasticity(args: Readonly<{
  baselineP: number;
  probeP: number;
  baselineY: number | null;
  probeY: number | null;
}>): LocalElasticity {
  const { baselineP, probeP, baselineY, probeY } = args;
  if (baselineY === null || probeY === null || !Number.isFinite(baselineY) || !Number.isFinite(probeY)) {
    return UNAVAILABLE;
  }
  // Two finite values of opposite sign near the double limit have a difference outside it. The ratio stays finite.
  const delta = probeY - baselineY;
  const finiteDelta = Number.isFinite(delta);
  return elasticityFromChange({
    baselineP,
    probeP,
    absoluteChange: finiteDelta ? String(delta) : null,
    direction: probeY > baselineY ? "higher" : probeY < baselineY ? "lower" : "flat",
    relativeChange: baselineY > 0 ? (finiteDelta ? delta / baselineY : probeY / baselineY - 1) : null,
  });
}

/**
 * `(probeP - baselineP) / baselineP`. When the difference of two finite parameters overflows, the ratio
 * `probeP / baselineP - 1` gives the same relative change without leaving the double range.
 */
export function relativeParameterChange(baselineP: number, probeP: number): number {
  const delta = probeP - baselineP;
  return Number.isFinite(delta) ? delta / baselineP : probeP / baselineP - 1;
}

/**
 * Relative elasticity from a change measured in the metric's own arithmetic, such as an engine amount.
 * `relativeChange` is `(probeY - baselineY) / baselineY`, or null when baseline y is not greater than zero.
 * The elasticity is reported only when baseline p is finite and greater than zero and p changes.
 */
export function elasticityFromChange(args: Readonly<{
  baselineP: number;
  probeP: number;
  absoluteChange: string | null;
  direction: Exclude<ElasticityDirection, "unavailable">;
  relativeChange: number | null;
}>): LocalElasticity {
  const { baselineP, probeP, absoluteChange, direction, relativeChange } = args;
  const unavailable: LocalElasticity = {
    status: "unavailable",
    elasticity: null,
    absoluteChange,
    direction,
    globalSensitivity: false,
    sobol: false,
  };
  const pChanged = Number.isFinite(baselineP) && Number.isFinite(probeP) && probeP !== baselineP;
  if (relativeChange === null || !Number.isFinite(relativeChange) || !(baselineP > 0) || !pChanged) return unavailable;
  // A tiny positive baseline can make the parameter change overflow. Dividing by it would report a false 0.
  const parameterChange = relativeParameterChange(baselineP, probeP);
  if (!Number.isFinite(parameterChange) || parameterChange === 0) return unavailable;
  const elasticity = relativeChange / parameterChange;
  if (!Number.isFinite(elasticity)) return unavailable;
  return {
    status: "observed",
    elasticity: String(elasticity),
    absoluteChange,
    direction,
    globalSensitivity: false,
    sobol: false,
  };
}

type ComparablePoint<T> = { id: string; values: T[]; senses: ParetoSense[] };

function dominates<T>(left: ComparablePoint<T>, right: ComparablePoint<T>, compare: (a: T, b: T) => number): boolean {
  let better = false;
  for (let index = 0; index < left.values.length; index += 1) {
    const order = compare(left.values[index]!, right.values[index]!);
    const ahead = left.senses[index] === "lower" ? order < 0 : order > 0;
    const behind = left.senses[index] === "lower" ? order > 0 : order < 0;
    if (behind) return false;
    if (ahead) better = true;
  }
  return better;
}

/**
 * Pareto front under a caller order, such as an engine comparison. Every pair is compared directly,
 * so an order with a tolerance is not chained through a third point. A null objective is uncompared.
 */
export function paretoFrontBy<T>(
  points: readonly Readonly<{ id: string; objectives: readonly Readonly<{ sense: ParetoSense; value: T | null }>[] }>[],
  compare: (left: T, right: T) => number,
): ParetoFront {
  // The front lists ids, so two points with one id would be ambiguous and would never compare against each other.
  if (new Set(points.map((point) => point.id)).size !== points.length) throw new Error("Pareto point ids must be unique");
  const comparable: ComparablePoint<T>[] = [];
  const uncompared: string[] = [];
  for (const point of points) {
    if (point.objectives.length === 0 || point.objectives.some((item) => item.value === null)) {
      uncompared.push(point.id);
      continue;
    }
    comparable.push({
      id: point.id,
      values: point.objectives.map((item) => item.value as T),
      senses: point.objectives.map((item) => item.sense),
    });
  }
  const nonDominated = comparable
    .filter((candidate) => !comparable.some((other) => other.id !== candidate.id && dominates(other, candidate, compare)))
    .map((candidate) => candidate.id)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  uncompared.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return { sense: "per-metric", nonDominated, uncompared };
}

/**
 * Fully observed points only. A null objective cannot dominate and is not dominated into a win.
 * Objectives are matched by id, so two points may list them in different orders. Points must share one id set.
 */
export function paretoFront(points: readonly ParetoPoint[]): ParetoFront {
  const first = points[0]?.objectives ?? [];
  const ids = first.map((item) => item.id).sort();
  const senses = new Map(first.map((item) => [item.id, item.sense]));
  return paretoFrontBy(
    points.map((point) => {
      const byId = new Map(point.objectives.map((item) => [item.id, item]));
      if (byId.size !== point.objectives.length || byId.size !== ids.length || ids.some((id) => !byId.has(id))) {
        throw new Error(`Pareto point ${point.id} does not list the same objective ids as the other points`);
      }
      return {
        id: point.id,
        objectives: ids.map((id) => {
          const item = byId.get(id)!;
          if (item.sense !== senses.get(id)) throw new Error(`Pareto point ${point.id} gives objective ${id} another sense`);
          return { sense: item.sense, value: item.value === null || !Number.isFinite(item.value) ? null : item.value };
        }),
      };
    }),
    (left: number, right: number) => (left < right ? -1 : left > right ? 1 : 0),
  );
}
