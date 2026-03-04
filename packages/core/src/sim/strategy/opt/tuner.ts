import type { CompiledScenario } from "../../types";
import type { StrategyRegistry } from "../registry";
import type { ObjectiveRegistry } from "./registry";
import type { TuneSpecV1 } from "./tuneSpec";

export type TuneSeedResult = Readonly<{
  seed: number;
  score: number;
  durationSec: number;
  endMoneyLog10: number;
  endNetWorthLog10: number;
  droppedRate: number;
  actionsApplied: number;
}>;

export type TuneCandidate = Readonly<{
  params: unknown;
  score: number;
  seedScores: readonly number[];
  seedResults?: readonly TuneSeedResult[];
}>;

export type TuneReport = Readonly<{
  objectiveId: string;
  strategyId: string;

  best: TuneCandidate;
  top: readonly TuneCandidate[];

  tried: number;
  notes?: string[];

  stages?: readonly Readonly<{
    stageIndex: number;
    tried: number;
    kept: number;
    bestScore: number;
  }>[];
}>;

export interface StrategyTuner {
  id: string;

  tune: (args: {
    baseScenario: CompiledScenario<any, any, any>;
    tuneSpec: TuneSpecV1;

    strategyRegistry: StrategyRegistry;
    objectiveRegistry: ObjectiveRegistry;

    runCandidate: (args: {
      scenario: CompiledScenario<any, any, any>;
      params: unknown;
      seeds: readonly number[];
      overrides?: Readonly<{ stepSec?: number; durationSec?: number; fast?: boolean }>;
    }) => Readonly<{
      score: number;
      seedScores: readonly number[];
      seedResults?: readonly TuneSeedResult[];
    }>;
  }) => TuneReport;
}
