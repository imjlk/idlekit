import type { Strategy } from "./types";

export type ScriptedStep = Readonly<{
  actionId: string;
  bulkSize?: number;
}>;

export function createScriptedStrategy<N, U extends string, Vars>(
  plan: readonly ScriptedStep[],
): Strategy<N, U, Vars> {
  let cursor = 0;

  return {
    id: "scripted",
    decide(ctx, model, state) {
      if (cursor >= plan.length) return [];
      const target = plan[cursor];
      if (!target) return [];
      const action = model.actions(ctx, state).find((a) => a.id === target.actionId);
      if (!action) {
        cursor += 1;
        return [];
      }
      cursor += 1;
      return [{ action, bulkSize: target.bulkSize }];
    },
  };
}
