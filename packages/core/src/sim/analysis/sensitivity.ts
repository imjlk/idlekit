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
  const delta = probeY - baselineY;
  return elasticityFromChange({
    baselineP,
    probeP,
    absoluteChange: String(delta),
    direction: delta > 0 ? "higher" : delta < 0 ? "lower" : "flat",
    relativeChange: baselineY > 0 ? delta / baselineY : null,
  });
}

/**
 * Relative elasticity from a change measured in the metric's own arithmetic, such as an engine amount.
 * `relativeChange` is `(probeY - baselineY) / baselineY`, or null when baseline y is not greater than zero.
 * The elasticity is reported only when baseline p is finite and greater than zero and p changes.
 */
export function elasticityFromChange(args: Readonly<{
  baselineP: number;
  probeP: number;
  absoluteChange: string;
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
  const elasticity = relativeChange / ((probeP - baselineP) / baselineP);
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

function dominates(
  left: Readonly<{ values: readonly number[]; senses: readonly ParetoSense[] }>,
  right: Readonly<{ values: readonly number[]; senses: readonly ParetoSense[] }>,
): boolean {
  let better = false;
  for (let index = 0; index < left.values.length; index += 1) {
    const sense = left.senses[index];
    const ahead = sense === "lower" ? left.values[index]! < right.values[index]! : left.values[index]! > right.values[index]!;
    const behind = sense === "lower" ? left.values[index]! > right.values[index]! : left.values[index]! < right.values[index]!;
    if (behind) return false;
    if (ahead) better = true;
  }
  return better;
}

/** Fully observed points only. A null objective cannot dominate and is not dominated into a win. */
export function paretoFront(points: readonly ParetoPoint[]): ParetoFront {
  const comparable: { id: string; values: number[]; senses: ParetoSense[] }[] = [];
  const uncompared: string[] = [];
  for (const point of points) {
    if (point.objectives.length === 0 || point.objectives.some((item) => item.value === null || !Number.isFinite(item.value))) {
      uncompared.push(point.id);
      continue;
    }
    comparable.push({
      id: point.id,
      values: point.objectives.map((item) => item.value as number),
      senses: point.objectives.map((item) => item.sense),
    });
  }
  const nonDominated = comparable
    .filter((candidate) => !comparable.some((other) => other.id !== candidate.id && dominates(other, candidate)))
    .map((candidate) => candidate.id)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  uncompared.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return { sense: "per-metric", nonDominated, uncompared };
}
