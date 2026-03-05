export type ScenarioMigrationNotice = Readonly<{
  level: "info" | "warn";
  message: string;
  path?: string;
}>;

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null;
}

function isLikelyScenarioObject(input: Record<string, unknown>): boolean {
  return (
    isRecord(input.unit) &&
    isRecord(input.policy) &&
    isRecord(input.model) &&
    isRecord(input.initial) &&
    isRecord(input.clock)
  );
}

function mapLegacyLtvToMonetization(input: Record<string, unknown>): Record<string, unknown> {
  if (isRecord(input.monetization)) return input;
  if (!isRecord(input.ltv)) return input;
  const ltv = input.ltv;

  const retention = isRecord(ltv.retention) ? ltv.retention : {};
  const revenue = isRecord(ltv.revenue) ? ltv.revenue : {};
  const acquisition = isRecord(ltv.acquisition) ? ltv.acquisition : {};
  const uncertainty = isRecord(ltv.uncertainty) ? ltv.uncertainty : {};

  return {
    ...input,
    monetization: {
      retention: {
        d1: retention.d1,
        d7: retention.d7,
        d30: retention.d30,
        d90: retention.d90,
        longTailDailyDecay: retention.longTailDailyDecay,
      },
      revenue: {
        payerConversion: revenue.payerConversion,
        arppuDaily: revenue.arppuDaily,
        adArpDau: revenue.adArpDau,
        platformFeeRate: revenue.platformFeeRate,
        grossMarginRate: revenue.grossMarginRate,
      },
      acquisition: {
        cpi: acquisition.cpi,
      },
      uncertainty: uncertainty,
    },
  };
}

export function migrateScenarioDocument(input: unknown): Readonly<{
  document: unknown;
  notices: ScenarioMigrationNotice[];
}> {
  if (!isRecord(input)) {
    return { document: input, notices: [] };
  }

  const notices: ScenarioMigrationNotice[] = [];
  let doc: Record<string, unknown> = input;

  if (!isRecord(doc.monetization) && isRecord(doc.ltv)) {
    doc = mapLegacyLtvToMonetization(doc);
    notices.push({
      level: "warn",
      path: "ltv",
      message: "legacy 'ltv' block was mapped to 'monetization'; migrate scenario file to v1 canonical fields",
    });
  }

  const schemaVersion = doc.schemaVersion;
  if (schemaVersion === 1) {
    return { document: doc, notices };
  }

  if (schemaVersion === 0 && isLikelyScenarioObject(doc)) {
    notices.push({
      level: "warn",
      path: "schemaVersion",
      message: "schemaVersion 0 is deprecated and was migrated to 1",
    });
    return {
      document: {
        ...doc,
        schemaVersion: 1,
      },
      notices,
    };
  }

  if (schemaVersion === undefined && isLikelyScenarioObject(doc)) {
    notices.push({
      level: "info",
      path: "schemaVersion",
      message: "schemaVersion was missing and defaulted to 1",
    });
    return {
      document: {
        ...doc,
        schemaVersion: 1,
      },
      notices,
    };
  }

  return { document: doc, notices };
}
