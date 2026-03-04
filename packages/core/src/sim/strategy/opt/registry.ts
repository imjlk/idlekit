import type { StandardSchema } from "../../../scenario/validate";
import type { OptimizationObjective } from "./objective";

export type ObjectiveFactory = Readonly<{
  id: string;
  defaultParams?: unknown;
  paramsSchema?: StandardSchema<any>;
  create: (params: any) => OptimizationObjective<any, any, any>;
}>;

export type ObjectiveRegistry = Readonly<{
  get: (id: string) => ObjectiveFactory | undefined;
  list: () => ReadonlyArray<Pick<ObjectiveFactory, "id">>;
}>;

export function createObjectiveRegistry(factories: readonly ObjectiveFactory[]): ObjectiveRegistry {
  const map = new Map<string, ObjectiveFactory>();
  for (const f of factories) map.set(f.id, f);

  return {
    get: (id) => map.get(id),
    list: () => Array.from(map.values()).map((x) => ({ id: x.id })),
  };
}
