import type {
  AnalyzerDefinition,
  ModelFactory,
  ObjectiveFactory,
  RuntimeEconomyAdapter,
  StrategyFactory,
} from "@idlekit/core";

export type EconPluginModule = Readonly<{
  models?: readonly ModelFactory[];
  strategies?: readonly StrategyFactory[];
  objectives?: readonly ObjectiveFactory[];
  analyzers?: readonly AnalyzerDefinition[];
  /** Runtime verification adapters for `idk verify runtime`. */
  runtimes?: readonly RuntimeEconomyAdapter[];
}>;
