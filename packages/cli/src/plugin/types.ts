import type { ModelFactory } from "@idlekit/core";
import type { ObjectiveFactory } from "@idlekit/core";
import type { StrategyFactory } from "@idlekit/core";

export type EconPluginModule = Readonly<{
  models?: readonly ModelFactory[];
  strategies?: readonly StrategyFactory[];
  objectives?: readonly ObjectiveFactory[];
}>;
