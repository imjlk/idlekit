export type { MonetizationConfig, LtvPointEstimate } from "@idlekit/core";

export type TelemetryRow = Readonly<{
  userId: string;
  day: number;
  iapRevenue: number;
  adRevenue: number;
  acquisitionCost?: number;
  active?: boolean;
}>;
