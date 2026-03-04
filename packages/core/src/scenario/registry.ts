import type { Model } from "../sim/types";
import type { StandardSchema } from "./validate";

export type ModelFactory = Readonly<{
  id: string;
  version: number;

  paramsSchema?: StandardSchema<any>;
  varsSchema?: StandardSchema<any>;

  create: (params: any) => unknown;
}>;

export type ModelRegistry = Readonly<{
  get: (id: string, version: number) => ModelFactory | undefined;
  list: () => ReadonlyArray<Pick<ModelFactory, "id" | "version">>;
}>;

export function createModelRegistry(
  factories: readonly ModelFactory[],
): ModelRegistry {
  const map = new Map<string, ModelFactory>();
  for (const f of factories) {
    map.set(`${f.id}@${f.version}`, f);
  }

  return {
    get(id, version) {
      return map.get(`${id}@${version}`);
    },
    list() {
      return factories.map((f) => ({ id: f.id, version: f.version }));
    },
  };
}

export function defineModelFactory<N, U extends string, Vars>(args: {
  id: string;
  version: number;
  create: (params: any) => Model<N, U, Vars>;
  paramsSchema?: StandardSchema<any>;
  varsSchema?: StandardSchema<any>;
}): ModelFactory {
  return args;
}
