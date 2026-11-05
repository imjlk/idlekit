import { mulberry32, type Random } from "../random";

/*
 * Numeric design space shared by global sensitivity and parameter optimization.
 * A point is a unit-cube coordinate per parameter; `mapUnitPoint` turns it into parameter values.
 */

export type DesignParameterV1 = Readonly<{
  /** Stable id. The CLI uses the scenario path, for example `model.params.costGrowth`. */
  id: string;
  min: number;
  max: number;
  /** `log` spaces the range geometrically (min must be > 0). Default `linear`. */
  scale?: "linear" | "log";
  /** Round the mapped value to an integer. */
  integer?: boolean;
}>;

export class DesignSpaceRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DesignSpaceRejected";
  }
}

export const MAX_DESIGN_PARAMETERS = 32;

export function assertDesignParameters(parameters: readonly DesignParameterV1[]): void {
  if (!Array.isArray(parameters) || parameters.length === 0) {
    throw new DesignSpaceRejected("design space needs at least one parameter");
  }
  if (parameters.length > MAX_DESIGN_PARAMETERS) {
    throw new DesignSpaceRejected(`design space allows at most ${MAX_DESIGN_PARAMETERS} parameters`);
  }
  const ids = new Set<string>();
  for (const parameter of parameters) {
    if (typeof parameter.id !== "string" || parameter.id.length === 0) throw new DesignSpaceRejected("parameter id must be a non-empty string");
    if (ids.has(parameter.id)) throw new DesignSpaceRejected(`duplicate parameter id ${parameter.id}`);
    ids.add(parameter.id);
    if (!Number.isFinite(parameter.min) || !Number.isFinite(parameter.max) || !(parameter.max > parameter.min)) {
      throw new DesignSpaceRejected(`parameter ${parameter.id} needs finite min < max`);
    }
    if (parameter.scale === "log" && !(parameter.min > 0)) {
      throw new DesignSpaceRejected(`parameter ${parameter.id} uses a log scale and needs min > 0`);
    }
    if (parameter.integer && Math.floor(parameter.max) - Math.ceil(parameter.min) < 1) {
      throw new DesignSpaceRejected(`integer parameter ${parameter.id} needs at least two integers in range`);
    }
  }
}

/** Value of one parameter at unit coordinate u in [0, 1]. */
export function mapUnit(parameter: DesignParameterV1, u: number): number {
  const x = Math.min(1, Math.max(0, u));
  const raw =
    parameter.scale === "log"
      ? Math.exp(Math.log(parameter.min) + x * (Math.log(parameter.max) - Math.log(parameter.min)))
      : parameter.min + x * (parameter.max - parameter.min);
  if (!parameter.integer) return Math.min(parameter.max, Math.max(parameter.min, raw));
  return Math.min(Math.floor(parameter.max), Math.max(Math.ceil(parameter.min), Math.round(raw)));
}

export function mapUnitPoint(parameters: readonly DesignParameterV1[], unit: readonly number[]): Record<string, number> {
  const out: Record<string, number> = {};
  parameters.forEach((parameter, index) => {
    out[parameter.id] = mapUnit(parameter, unit[index] ?? 0);
  });
  return out;
}

/** Seeded RNG for a design: the seed is truncated to uint32 the way the runner folds a seed. */
export function designRandom(seed: number): Random {
  if (typeof seed !== "number" || !Number.isFinite(seed)) throw new DesignSpaceRejected("design seed must be finite");
  return mulberry32(Math.trunc(seed) >>> 0);
}

/** Fisher-Yates shuffle with a seeded RNG. */
export function shuffled<T>(rng: Random, values: readonly T[]): T[] {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
