export type { MonetizationConfig, LtvPointEstimate } from "@idlekit/core";

export type TelemetryRow = Readonly<{
  userId: string;
  day: number;
  /** Omitted when the export has no IAP revenue column; omission is not measured zero. */
  iapRevenue?: number;
  adRevenue?: number;
  acquisitionCost?: number;
  active?: boolean;
}>;
