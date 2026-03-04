export type ListFormat = "json" | "md" | "csv";

export type ModelsListRow = Readonly<{
  id: string;
  version: number;
}>;

export type StrategiesListRow = Readonly<{
  id: string;
  hasParamsSchema: boolean;
  hasDefaultParams: boolean;
}>;

export type ObjectivesListRow = Readonly<{
  id: string;
  hasParamsSchema: boolean;
  hasDefaultParams: boolean;
}>;

export type ModelsListOutput = Readonly<{ ok: true; models: readonly ModelsListRow[] }>;
export type StrategiesListOutput = Readonly<{ ok: true; strategies: readonly StrategiesListRow[] }>;
export type ObjectivesListOutput = Readonly<{ ok: true; objectives: readonly ObjectivesListRow[] }>;
