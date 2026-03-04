import type { ScriptedStrategyParamsV1 } from "./params";
import type { Strategy } from "./types";

export type ScriptedStep = Readonly<{
  actionId: string;
  bulkSize?: number;
}>;

export function createScriptedStrategy<N, U extends string, Vars>(
  params: ScriptedStrategyParamsV1,
): Strategy<N, U, Vars> {
  const plan = params.program;
  const onCannotApply = params.onCannotApply ?? "skip";
  const loop = params.loop ?? true;
  let cursor = 0;

  return {
    id: "scripted",
    decide(ctx, model, state) {
      if (plan.length === 0) return [];
      if (cursor >= plan.length) {
        if (!loop) return [];
        cursor = 0;
      }
      const target = plan[cursor];
      if (!target) return [];
      const action = model.actions(ctx, state).find((a) => a.id === target.actionId);
      if (!action) {
        if (onCannotApply === "stop") return [];
        cursor += 1;
        return [];
      }
      cursor += 1;
      return [{ action, bulkSize: target.bulkSize }];
    },
  };
}
