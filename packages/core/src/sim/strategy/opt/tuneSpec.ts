export type TuneSpecV1 = Readonly<{
  schemaVersion: 1;

  meta?: Readonly<{
    id?: string;
    title?: string;
    description?: string;
    tags?: string[];
  }>;

  strategy: Readonly<{
    id: string;
    baseParams?: unknown;
    space: readonly TuneParam[];
  }>;

  objective: Readonly<{
    id: string;
    params?: unknown;
  }>;

  runner: Readonly<{
    seeds: readonly number[];
    budget: number;

    overrideDurationSec?: number;
    overrideStepSec?: number;

    stages?: readonly Readonly<{
      budget: number;
      durationSec?: number;
      keepTopK?: number;
      fast?: boolean;
    }>[];

    topK?: number;
  }>;
}>;

export type TuneParam = Readonly<{
  path: string;
  space: ParamSpace;
}>;

export type ParamSpace =
  | Readonly<{ kind: "bool" }>
  | Readonly<{ kind: "int"; min: number; max: number }>
  | Readonly<{ kind: "number"; min: number; max: number; scale?: "linear" | "log" }>
  | Readonly<{ kind: "choice"; values: readonly unknown[] }>;
