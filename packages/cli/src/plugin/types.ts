import type { AnalyzerDefinition, ModelFactory, ObjectiveFactory, StrategyFactory } from "@idlekit/core";

export type EconPluginModule = Readonly<{
  models?: readonly ModelFactory[];
  strategies?: readonly StrategyFactory[];
  objectives?: readonly ObjectiveFactory[];
  analyzers?: readonly AnalyzerDefinition[];
}>;
