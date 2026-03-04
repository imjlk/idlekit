import type { StandardSchema } from "../../scenario/validate";

export type StrategyFactory = Readonly<{
  id: string;

  paramsSchema?: StandardSchema<any>;

  create: (params: any) => unknown;
}>;

export type StrategyRegistry = Readonly<{
  get: (id: string) => StrategyFactory | undefined;
  list: () => ReadonlyArray<Pick<StrategyFactory, "id">>;
}>;

export function createStrategyRegistry(
  factories: readonly StrategyFactory[],
): StrategyRegistry {
  const map = new Map<string, StrategyFactory>();
  for (const f of factories) map.set(f.id, f);

  return {
    get: (id) => map.get(id),
    list: () => Array.from(map.values()).map((x) => ({ id: x.id })),
  };
}

export function mergeStrategyRegistries(...regs: StrategyRegistry[]): StrategyRegistry {
  const merged = regs.flatMap((r) => r.list().map((x) => r.get(x.id)).filter(Boolean)) as StrategyFactory[];
  return createStrategyRegistry(merged);
}
