export type MonetizationConfig = Readonly<{
  cohorts: Readonly<{
    baseUsers: number;
  }>;
  retention: Readonly<{
    d1: number;
    d7: number;
    d30: number;
    d90: number;
    longTailDailyDecay: number;
  }>;
  revenue: Readonly<{
    payerConversion: number;
    arppuDaily: number;
    adArpDau: number;
    platformFeeRate: number;
    grossMarginRate: number;
    progressionRevenueLift: number;
    progressionLogSpan: number;
  }>;
  acquisition: Readonly<{
    cpi: number;
  }>;
  uncertainty: Readonly<{
    enabled: boolean;
    draws: number;
    quantiles: number[];
    seed?: number;
    sigma: Readonly<{
      retention: number;
      conversion: number;
      arppu: number;
      ad: number;
    }>;
    correlation: Readonly<{
      retentionConversion: number;
      retentionArppu: number;
      retentionAd: number;
      conversionArppu: number;
      conversionAd: number;
      arppuAd: number;
    }>;
  }>;
}>;

export type LtvPointEstimate = Readonly<{
  cumulativeGrossRevenuePerUser: number;
  cumulativeNetRevenuePerUser: number;
  cumulativeLtvPerUser: number;
}>;

export type TelemetryRow = Readonly<{
  userId: string;
  day: number;
  iapRevenue: number;
  adRevenue: number;
  acquisitionCost?: number;
  active?: boolean;
}>;
