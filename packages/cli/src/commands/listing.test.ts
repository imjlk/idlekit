import { describe, expect, it } from "bun:test";
import { buildModelsList } from "./modelsList";
import { cmdStrategiesList } from "./strategies";
import { cmdObjectivesList } from "./objectives";
import { renderModelsList, renderObjectivesList, renderStrategiesList } from "../io/renderList";

describe("CLI list builders", () => {
  it("sorts models by id then version", () => {
    const reg = {
      list: () => [
        { id: "z", version: 1 },
        { id: "a", version: 2 },
        { id: "a", version: 1 },
      ],
    } as const;

    const out = buildModelsList(reg as any);
    expect(out.models).toEqual([
      { id: "a", version: 1 },
      { id: "a", version: 2 },
      { id: "z", version: 1 },
    ]);
  });

  it("sorts strategies/objectives and exposes schema/default flags", () => {
    const strategyMap = new Map<string, any>([
      ["greedy", { id: "greedy", paramsSchema: { "~standard": { validate: () => ({ success: true, value: {} }) } } }],
      ["scripted", { id: "scripted", defaultParams: {} }],
    ]);

    const strategyReg = {
      list: () => [{ id: "scripted" }, { id: "greedy" }],
      get: (id: string) => strategyMap.get(id),
    } as const;

    const objectiveMap = new Map<string, any>([
      ["endNetWorthLog10", { id: "endNetWorthLog10", defaultParams: {}, paramsSchema: { "~standard": { validate: () => ({ success: true, value: {} }) } } }],
      ["endMoneyLog10", { id: "endMoneyLog10" }],
    ]);

    const objectiveReg = {
      list: () => [{ id: "endNetWorthLog10" }, { id: "endMoneyLog10" }],
      get: (id: string) => objectiveMap.get(id),
    } as const;

    const strategies = cmdStrategiesList({ strategyRegistry: strategyReg as any });
    expect(strategies.strategies).toEqual([
      { id: "greedy", hasParamsSchema: true, hasDefaultParams: false },
      { id: "scripted", hasParamsSchema: false, hasDefaultParams: true },
    ]);

    const objectives = cmdObjectivesList({ objectiveRegistry: objectiveReg as any });
    expect(objectives.objectives).toEqual([
      { id: "endMoneyLog10", hasParamsSchema: false, hasDefaultParams: false },
      { id: "endNetWorthLog10", hasParamsSchema: true, hasDefaultParams: true },
    ]);
  });
});

describe("CLI list rendering", () => {
  it("renders markdown/json/csv formats", () => {
    const models = { ok: true as const, models: [{ id: "linear", version: 1 }] };
    const strategies = {
      ok: true as const,
      strategies: [{ id: "greedy", hasParamsSchema: true, hasDefaultParams: true }],
    };
    const objectives = {
      ok: true as const,
      objectives: [{ id: "endNetWorthLog10", hasParamsSchema: true, hasDefaultParams: true }],
    };

    expect(renderModelsList(models, "md")).toContain("| id | version |");
    expect(renderStrategiesList(strategies, "json")).toContain('"id": "greedy"');
    expect(renderObjectivesList(objectives, "csv")).toContain("id,hasParamsSchema,hasDefaultParams");
  });
});
