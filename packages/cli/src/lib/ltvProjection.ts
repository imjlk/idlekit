import type { ScenarioV1 } from "@idlekit/core";
import type { LtvPointEstimate, MonetizationConfig } from "./ltvTypes";

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

export function deriveMonetizationConfig(scenario: ScenarioV1): MonetizationConfig {
  const m = scenario.monetization;
  const q = (m?.uncertainty?.quantiles ?? [0.5, 0.9]).filter((x): x is number => typeof x === "number");
  const quantiles = q.length > 0 ? [...new Set(q)].sort((a, b) => a - b) : [0.5, 0.9];
  return {
    cohorts: {
      baseUsers: m?.cohorts?.baseUsers ?? 1,
    },
    retention: {
      d1: m?.retention?.d1 ?? 0.42,
      d7: m?.retention?.d7 ?? 0.2,
      d30: m?.retention?.d30 ?? 0.09,
      d90: m?.retention?.d90 ?? 0.04,
      longTailDailyDecay: m?.retention?.longTailDailyDecay ?? 0.02,
    },
    revenue: {
      payerConversion: m?.revenue?.payerConversion ?? 0.03,
      arppuDaily: m?.revenue?.arppuDaily ?? 0.7,
      adArpDau: m?.revenue?.adArpDau ?? 0.02,
      platformFeeRate: m?.revenue?.platformFeeRate ?? 0.3,
      grossMarginRate: m?.revenue?.grossMarginRate ?? 0.92,
      progressionRevenueLift: m?.revenue?.progressionRevenueLift ?? 0.4,
      progressionLogSpan: m?.revenue?.progressionLogSpan ?? 6,
    },
    acquisition: {
      cpi: m?.acquisition?.cpi ?? 0,
    },
    uncertainty: {
      enabled: m?.uncertainty?.enabled ?? false,
      draws: m?.uncertainty?.draws ?? 300,
      quantiles,
      seed: m?.uncertainty?.seed,
      sigma: {
        retention: m?.uncertainty?.sigma?.retention ?? 0.08,
        conversion: m?.uncertainty?.sigma?.conversion ?? 0.12,
        arppu: m?.uncertainty?.sigma?.arppu ?? 0.2,
        ad: m?.uncertainty?.sigma?.ad ?? 0.15,
      },
      correlation: {
        retentionConversion: m?.uncertainty?.correlation?.retentionConversion ?? 0,
        retentionArppu: m?.uncertainty?.correlation?.retentionArppu ?? 0,
        retentionAd: m?.uncertainty?.correlation?.retentionAd ?? 0,
        conversionArppu: m?.uncertainty?.correlation?.conversionArppu ?? 0,
        conversionAd: m?.uncertainty?.correlation?.conversionAd ?? 0,
        arppuAd: m?.uncertainty?.correlation?.arppuAd ?? 0,
      },
    },
  };
}

export function retentionAtDay(ret: MonetizationConfig["retention"], day: number): number {
  if (day <= 0) return 1;
  if (day <= 1) return ret.d1;
  if (day <= 7) return ret.d1 + ((ret.d7 - ret.d1) * (day - 1)) / 6;
  if (day <= 30) return ret.d7 + ((ret.d30 - ret.d7) * (day - 7)) / 23;
  if (day <= 90) return ret.d30 + ((ret.d90 - ret.d30) * (day - 30)) / 60;
  const extra = day - 90;
  return clamp01(ret.d90 * Math.exp(-ret.longTailDailyDecay * extra));
}

export function progressionFactor(startWorthLog10: number, endWorthLog10: number, span: number): number {
  if (!Number.isFinite(startWorthLog10) || !Number.isFinite(endWorthLog10) || !Number.isFinite(span) || span <= 0) {
    return 0;
  }
  return clamp01((endWorthLog10 - startWorthLog10) / span);
}

export function estimateLtvPerUser(args: {
  config: MonetizationConfig;
  horizonDays: number;
  progression: number;
}): LtvPointEstimate {
  const { config, horizonDays } = args;
  const progression = clamp01(args.progression);

  const arppuDaily = config.revenue.arppuDaily * (1 + progression * config.revenue.progressionRevenueLift);
  const adArpDau = config.revenue.adArpDau * (1 + progression * config.revenue.progressionRevenueLift * 0.5);
  const payerConversion = config.revenue.payerConversion;

  const fullDays = Math.floor(Math.max(0, horizonDays));
  const remainder = Math.max(0, horizonDays - fullDays);

  let gross = 0;
  for (let day = 1; day <= fullDays; day++) {
    const active = retentionAtDay(config.retention, day);
    gross += active * (payerConversion * arppuDaily + adArpDau);
  }
  if (remainder > 0) {
    const active = retentionAtDay(config.retention, fullDays + 1);
    gross += remainder * active * (payerConversion * arppuDaily + adArpDau);
  }

  const net = gross * (1 - config.revenue.platformFeeRate) * config.revenue.grossMarginRate;
  const ltv = net - config.acquisition.cpi;

  return {
    cumulativeGrossRevenuePerUser: gross,
    cumulativeNetRevenuePerUser: net,
    cumulativeLtvPerUser: ltv,
  };
}
