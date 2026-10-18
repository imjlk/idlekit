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


/** Inputs of one point estimate. `horizonDays` H covers install days [0, H); day 0 is the install day. */
export type LtvEstimateArgs = Readonly<{
  config: MonetizationConfig;
  horizonDays: number;
  progression: number;
}>;

/** Distribution inputs. Omitted draws, quantiles and seed fall back to `config.uncertainty`. */
export type LtvDistributionArgs = LtvEstimateArgs & Readonly<{
  draws?: number;
  quantiles?: readonly number[];
  seed?: number;
}>;

/** Sample means and LTV order statistics keyed by exact percent (`q50`, `q2.5`). */
export type LtvDistribution = Readonly<{
  mean: LtvPointEstimate;
  quantiles: Record<string, number>;
}>;
