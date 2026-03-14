import typia from "typia";
import type { ZodType } from "zod";
import type { ScenarioV1 } from "./types";

export type StandardIssue = Readonly<{
  path?: string;
  message: string;
  expected?: string;
  value?: unknown;
}>;

export type StandardResult<T> =
  | Readonly<{ success: true; value: T }>
  | Readonly<{ success: false; issues: StandardIssue[] }>;

export type StandardSchema<T> = Readonly<{
  "~standard": Readonly<{
    validate: (input: unknown) => StandardResult<T>;
  }>;
}>;

export function typiaStandardSchema<T>(): StandardSchema<T> {
  return {
    "~standard": {
      validate(input) {
        try {
          const validated = typia.validate<T>(input);
          if (validated.success) {
            return { success: true, value: validated.data };
          }

          const issues: StandardIssue[] = validated.errors.map((err: any) => ({
            path: err.path,
            message: err.message ?? `Expected ${err.expected}`,
            expected: err.expected,
            value: err.value,
          }));

          return { success: false, issues };
        } catch (error) {
          const issues: StandardIssue[] = [
            {
              message:
                error instanceof Error
                  ? error.message
                  : "typia validation failed (transformer may be missing)",
            },
          ];
          return { success: false, issues };
        }
      },
    },
  };
}

export function zodStandardSchema<T>(schema: ZodType<T>): StandardSchema<T> {
  return {
    "~standard": {
      validate(input) {
        const parsed = schema.safeParse(input);
        if (parsed.success) {
          return { success: true, value: parsed.data };
        }

        const issues: StandardIssue[] = parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
          expected: issue.code,
          value: input,
        }));

        return { success: false, issues };
      },
    },
  };
}

function pushIssue(issues: StandardIssue[], message: string, path?: string, value?: unknown): void {
  issues.push({ message, path, value });
}

function isFiniteNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function validateRate01(
  issues: StandardIssue[],
  value: unknown,
  path: string,
  fieldLabel: string,
): void {
  if (!isFiniteNumber(value) || value < 0 || value > 1) {
    pushIssue(issues, `${fieldLabel} must be a finite number in [0, 1]`, path, value);
  }
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null;
}

function validateBaseScenario(input: unknown): StandardResult<ScenarioV1> {
  const issues: StandardIssue[] = [];
  if (!isRecord(input)) {
    return {
      success: false,
      issues: [{ path: "$", message: "Scenario must be an object", value: input }],
    };
  }

  if (input.schemaVersion !== 1) {
    pushIssue(issues, "schemaVersion must be 1", "schemaVersion", input.schemaVersion);
  }

  const unit = input.unit;
  if (!isRecord(unit) || typeof unit.code !== "string" || unit.code.length === 0) {
    pushIssue(issues, "unit.code is required", "unit.code", unit);
  }

  const policy = input.policy;
  if (!isRecord(policy) || (policy.mode !== "drop" && policy.mode !== "accumulate")) {
    pushIssue(issues, "policy.mode must be 'drop' or 'accumulate'", "policy.mode", policy);
  }

  const model = input.model;
  if (!isRecord(model) || typeof model.id !== "string" || typeof model.version !== "number") {
    pushIssue(issues, "model.id(string) and model.version(number) are required", "model", model);
  }

  const initial = input.initial;
  if (!isRecord(initial)) {
    pushIssue(issues, "initial is required", "initial", initial);
  } else {
    const wallet = initial.wallet;
    if (
      !isRecord(wallet) ||
      typeof wallet.unit !== "string" ||
      typeof wallet.amount !== "string" ||
      wallet.amount.length === 0
    ) {
      pushIssue(
        issues,
        "initial.wallet requires unit(string), amount(string)",
        "initial.wallet",
        wallet,
      );
    }
  }

  const clock = input.clock;
  if (!isRecord(clock) || typeof clock.stepSec !== "number" || !(clock.stepSec > 0)) {
    pushIssue(issues, "clock.stepSec(number > 0) is required", "clock.stepSec", clock);
  } else {
    const durationSec = clock.durationSec;
    const untilExpr = clock.untilExpr;
    const hasDuration = typeof durationSec === "number";
    const hasUntilExpr = typeof untilExpr === "string" && untilExpr.trim().length > 0;

    if (hasDuration && !(durationSec > 0)) {
      pushIssue(issues, "clock.durationSec must be > 0 when provided", "clock.durationSec", durationSec);
    }
    if (!hasDuration && !hasUntilExpr) {
      pushIssue(
        issues,
        "clock requires at least one stop condition: durationSec or untilExpr",
        "clock",
        clock,
      );
    }
  }

  const sim = input.sim;
  if (sim !== undefined) {
    if (!isRecord(sim)) {
      pushIssue(issues, "sim must be an object when provided", "sim", sim);
    } else {
      if (sim.eventLog !== undefined) {
        const eventLog = sim.eventLog;
        if (!isRecord(eventLog)) {
          pushIssue(issues, "sim.eventLog must be an object when provided", "sim.eventLog", eventLog);
        } else {
          if (eventLog.enabled !== undefined && typeof eventLog.enabled !== "boolean") {
            pushIssue(
              issues,
              "sim.eventLog.enabled must be boolean when provided",
              "sim.eventLog.enabled",
              eventLog.enabled,
            );
          }
          if (eventLog.maxEvents !== undefined) {
            if (
              typeof eventLog.maxEvents !== "number" ||
              !Number.isInteger(eventLog.maxEvents) ||
              eventLog.maxEvents < 0
            ) {
              pushIssue(
                issues,
                "sim.eventLog.maxEvents must be an integer >= 0 when provided",
                "sim.eventLog.maxEvents",
                eventLog.maxEvents,
              );
            }
          }
        }
      }

      if (sim.offline !== undefined) {
        const offline = sim.offline;
        if (!isRecord(offline)) {
          pushIssue(issues, "sim.offline must be an object when provided", "sim.offline", offline);
        } else {
          if (offline.maxSec !== undefined) {
            if (typeof offline.maxSec !== "number" || !Number.isFinite(offline.maxSec) || offline.maxSec < 0) {
              pushIssue(
                issues,
                "sim.offline.maxSec must be a finite number >= 0 when provided",
                "sim.offline.maxSec",
                offline.maxSec,
              );
            }
          }

          if (offline.overflowPolicy !== undefined) {
            if (offline.overflowPolicy !== "clamp" && offline.overflowPolicy !== "reject") {
              pushIssue(
                issues,
                "sim.offline.overflowPolicy must be 'clamp' or 'reject' when provided",
                "sim.offline.overflowPolicy",
                offline.overflowPolicy,
              );
            }
          }

          if (offline.decay !== undefined) {
            const decay = offline.decay;
            if (!isRecord(decay)) {
              pushIssue(issues, "sim.offline.decay must be an object when provided", "sim.offline.decay", decay);
            } else {
              if (decay.kind !== "none" && decay.kind !== "linear") {
                pushIssue(
                  issues,
                  "sim.offline.decay.kind must be 'none' or 'linear'",
                  "sim.offline.decay.kind",
                  decay.kind,
                );
              }

              if (decay.floorRatio !== undefined) {
                if (
                  typeof decay.floorRatio !== "number" ||
                  !Number.isFinite(decay.floorRatio) ||
                  decay.floorRatio < 0 ||
                  decay.floorRatio > 1
                ) {
                  pushIssue(
                    issues,
                    "sim.offline.decay.floorRatio must be a number in [0, 1] when provided",
                    "sim.offline.decay.floorRatio",
                    decay.floorRatio,
                  );
                }
              }
            }
          }
        }
      }
    }
  }

  const design = input.design;
  if (design !== undefined) {
    if (!isRecord(design)) {
      pushIssue(issues, "design must be an object when provided", "design", design);
    } else {
      if (
        design.intent !== undefined &&
        design.intent !== "frequent-progression" &&
        design.intent !== "scale-fantasy" &&
        design.intent !== "strategic-optimization"
      ) {
        pushIssue(
          issues,
          "design.intent must be 'frequent-progression', 'scale-fantasy', or 'strategic-optimization'",
          "design.intent",
          design.intent,
        );
      }

      if (design.sessionPattern !== undefined) {
        const sessionPattern = design.sessionPattern;
        if (!isRecord(sessionPattern)) {
          pushIssue(
            issues,
            "design.sessionPattern must be an object when provided",
            "design.sessionPattern",
            sessionPattern,
          );
        } else {
          if (
            sessionPattern.id !== "always-on" &&
            sessionPattern.id !== "short-bursts" &&
            sessionPattern.id !== "twice-daily" &&
            sessionPattern.id !== "offline-heavy" &&
            sessionPattern.id !== "weekend-marathon"
          ) {
            pushIssue(
              issues,
              "design.sessionPattern.id must be one of always-on, short-bursts, twice-daily, offline-heavy, weekend-marathon",
              "design.sessionPattern.id",
              sessionPattern.id,
            );
          }
          if (
            sessionPattern.days !== undefined &&
            (typeof sessionPattern.days !== "number" ||
              !Number.isInteger(sessionPattern.days) ||
              sessionPattern.days <= 0)
          ) {
            pushIssue(
              issues,
              "design.sessionPattern.days must be a positive integer when provided",
              "design.sessionPattern.days",
              sessionPattern.days,
            );
          }
        }
      }
    }
  }

  const monetization = input.monetization;
  if (monetization !== undefined) {
    if (!isRecord(monetization)) {
      pushIssue(issues, "monetization must be an object when provided", "monetization", monetization);
    } else {
      if (monetization.cohorts !== undefined) {
        const cohorts = monetization.cohorts;
        if (!isRecord(cohorts)) {
          pushIssue(issues, "monetization.cohorts must be an object when provided", "monetization.cohorts", cohorts);
        } else if (cohorts.baseUsers !== undefined) {
          if (
            typeof cohorts.baseUsers !== "number" ||
            !Number.isInteger(cohorts.baseUsers) ||
            cohorts.baseUsers <= 0
          ) {
            pushIssue(
              issues,
              "monetization.cohorts.baseUsers must be a positive integer when provided",
              "monetization.cohorts.baseUsers",
              cohorts.baseUsers,
            );
          }
        }
      }

      if (monetization.retention !== undefined) {
        const retention = monetization.retention;
        if (!isRecord(retention)) {
          pushIssue(
            issues,
            "monetization.retention must be an object when provided",
            "monetization.retention",
            retention,
          );
        } else {
          const d1 = retention.d1;
          const d7 = retention.d7;
          const d30 = retention.d30;
          const d90 = retention.d90;
          if (d1 !== undefined) validateRate01(issues, d1, "monetization.retention.d1", "monetization.retention.d1");
          if (d7 !== undefined) validateRate01(issues, d7, "monetization.retention.d7", "monetization.retention.d7");
          if (d30 !== undefined)
            validateRate01(issues, d30, "monetization.retention.d30", "monetization.retention.d30");
          if (d90 !== undefined)
            validateRate01(issues, d90, "monetization.retention.d90", "monetization.retention.d90");
          if (
            isFiniteNumber(d1) &&
            isFiniteNumber(d7) &&
            isFiniteNumber(d30) &&
            isFiniteNumber(d90) &&
            !(d1 >= d7 && d7 >= d30 && d30 >= d90)
          ) {
            pushIssue(
              issues,
              "monetization.retention must satisfy d1 >= d7 >= d30 >= d90",
              "monetization.retention",
              retention,
            );
          }
          if (retention.longTailDailyDecay !== undefined) {
            if (!isFiniteNumber(retention.longTailDailyDecay) || retention.longTailDailyDecay < 0) {
              pushIssue(
                issues,
                "monetization.retention.longTailDailyDecay must be a finite number >= 0",
                "monetization.retention.longTailDailyDecay",
                retention.longTailDailyDecay,
              );
            }
          }
        }
      }

      if (monetization.revenue !== undefined) {
        const revenue = monetization.revenue;
        if (!isRecord(revenue)) {
          pushIssue(issues, "monetization.revenue must be an object when provided", "monetization.revenue", revenue);
        } else {
          if (revenue.payerConversion !== undefined) {
            validateRate01(
              issues,
              revenue.payerConversion,
              "monetization.revenue.payerConversion",
              "monetization.revenue.payerConversion",
            );
          }
          if (revenue.platformFeeRate !== undefined) {
            validateRate01(
              issues,
              revenue.platformFeeRate,
              "monetization.revenue.platformFeeRate",
              "monetization.revenue.platformFeeRate",
            );
          }
          if (revenue.grossMarginRate !== undefined) {
            validateRate01(
              issues,
              revenue.grossMarginRate,
              "monetization.revenue.grossMarginRate",
              "monetization.revenue.grossMarginRate",
            );
          }
          if (revenue.arppuDaily !== undefined) {
            if (!isFiniteNumber(revenue.arppuDaily) || revenue.arppuDaily < 0) {
              pushIssue(
                issues,
                "monetization.revenue.arppuDaily must be a finite number >= 0",
                "monetization.revenue.arppuDaily",
                revenue.arppuDaily,
              );
            }
          }
          if (revenue.adArpDau !== undefined) {
            if (!isFiniteNumber(revenue.adArpDau) || revenue.adArpDau < 0) {
              pushIssue(
                issues,
                "monetization.revenue.adArpDau must be a finite number >= 0",
                "monetization.revenue.adArpDau",
                revenue.adArpDau,
              );
            }
          }
          if (revenue.progressionRevenueLift !== undefined) {
            if (!isFiniteNumber(revenue.progressionRevenueLift) || revenue.progressionRevenueLift < 0) {
              pushIssue(
                issues,
                "monetization.revenue.progressionRevenueLift must be a finite number >= 0",
                "monetization.revenue.progressionRevenueLift",
                revenue.progressionRevenueLift,
              );
            }
          }
          if (revenue.progressionLogSpan !== undefined) {
            if (!isFiniteNumber(revenue.progressionLogSpan) || revenue.progressionLogSpan <= 0) {
              pushIssue(
                issues,
                "monetization.revenue.progressionLogSpan must be a finite number > 0",
                "monetization.revenue.progressionLogSpan",
                revenue.progressionLogSpan,
              );
            }
          }
        }
      }

      if (monetization.acquisition !== undefined) {
        const acquisition = monetization.acquisition;
        if (!isRecord(acquisition)) {
          pushIssue(
            issues,
            "monetization.acquisition must be an object when provided",
            "monetization.acquisition",
            acquisition,
          );
        } else if (acquisition.cpi !== undefined) {
          if (!isFiniteNumber(acquisition.cpi) || acquisition.cpi < 0) {
            pushIssue(
              issues,
              "monetization.acquisition.cpi must be a finite number >= 0",
              "monetization.acquisition.cpi",
              acquisition.cpi,
            );
          }
        }
      }

      if (monetization.uncertainty !== undefined) {
        const uncertainty = monetization.uncertainty;
        if (!isRecord(uncertainty)) {
          pushIssue(
            issues,
            "monetization.uncertainty must be an object when provided",
            "monetization.uncertainty",
            uncertainty,
          );
        } else {
          if (uncertainty.enabled !== undefined && typeof uncertainty.enabled !== "boolean") {
            pushIssue(
              issues,
              "monetization.uncertainty.enabled must be boolean when provided",
              "monetization.uncertainty.enabled",
              uncertainty.enabled,
            );
          }
          if (uncertainty.draws !== undefined) {
            if (
              typeof uncertainty.draws !== "number" ||
              !Number.isInteger(uncertainty.draws) ||
              uncertainty.draws <= 0
            ) {
              pushIssue(
                issues,
                "monetization.uncertainty.draws must be a positive integer when provided",
                "monetization.uncertainty.draws",
                uncertainty.draws,
              );
            }
          }
          if (uncertainty.seed !== undefined && !isFiniteNumber(uncertainty.seed)) {
            pushIssue(
              issues,
              "monetization.uncertainty.seed must be a finite number when provided",
              "monetization.uncertainty.seed",
              uncertainty.seed,
            );
          }
          if (uncertainty.quantiles !== undefined) {
            if (!Array.isArray(uncertainty.quantiles) || uncertainty.quantiles.length === 0) {
              pushIssue(
                issues,
                "monetization.uncertainty.quantiles must be a non-empty number array when provided",
                "monetization.uncertainty.quantiles",
                uncertainty.quantiles,
              );
            } else {
              for (const [idx, q] of uncertainty.quantiles.entries()) {
                if (!isFiniteNumber(q) || q <= 0 || q >= 1) {
                  pushIssue(
                    issues,
                    "quantile must be in (0, 1)",
                    `monetization.uncertainty.quantiles.${idx}`,
                    q,
                  );
                }
              }
            }
          }
          if (uncertainty.sigma !== undefined) {
            const sigma = uncertainty.sigma;
            if (!isRecord(sigma)) {
              pushIssue(
                issues,
                "monetization.uncertainty.sigma must be an object when provided",
                "monetization.uncertainty.sigma",
                sigma,
              );
            } else {
              const sigmaFields: Array<keyof typeof sigma> = ["retention", "conversion", "arppu", "ad"];
              for (const field of sigmaFields) {
                const v = sigma[field];
                if (v === undefined) continue;
                if (!isFiniteNumber(v) || v < 0) {
                  pushIssue(
                    issues,
                    `${String(field)} sigma must be a finite number >= 0`,
                    `monetization.uncertainty.sigma.${String(field)}`,
                    v,
                  );
                }
              }
            }
          }

          if (uncertainty.correlation !== undefined) {
            const corr = uncertainty.correlation;
            if (!isRecord(corr)) {
              pushIssue(
                issues,
                "monetization.uncertainty.correlation must be an object when provided",
                "monetization.uncertainty.correlation",
                corr,
              );
            } else {
              const corrFields: Array<keyof typeof corr> = [
                "retentionConversion",
                "retentionArppu",
                "retentionAd",
                "conversionArppu",
                "conversionAd",
                "arppuAd",
              ];
              for (const field of corrFields) {
                const v = corr[field];
                if (v === undefined) continue;
                if (!isFiniteNumber(v) || v < -1 || v > 1) {
                  pushIssue(
                    issues,
                    `${String(field)} correlation must be a finite number in [-1, 1]`,
                    `monetization.uncertainty.correlation.${String(field)}`,
                    v,
                  );
                }
              }
            }
          }
        }
      }
    }
  }

  const analysis = input.analysis;
  if (analysis !== undefined) {
    if (!isRecord(analysis)) {
      pushIssue(issues, "analysis must be an object when provided", "analysis", analysis);
    } else if (analysis.experience !== undefined) {
      const experience = analysis.experience;
      if (!isRecord(experience)) {
        pushIssue(
          issues,
          "analysis.experience must be an object when provided",
          "analysis.experience",
          experience,
        );
      } else {
        if (
          experience.series !== undefined &&
          experience.series !== "money" &&
          experience.series !== "netWorth"
        ) {
          pushIssue(
            issues,
            "analysis.experience.series must be 'money' or 'netWorth'",
            "analysis.experience.series",
            experience.series,
          );
        }
        if (
          experience.draws !== undefined &&
          (typeof experience.draws !== "number" ||
            !Number.isInteger(experience.draws) ||
            experience.draws <= 0)
        ) {
          pushIssue(
            issues,
            "analysis.experience.draws must be a positive integer when provided",
            "analysis.experience.draws",
            experience.draws,
          );
        }
        if (experience.quantiles !== undefined) {
          if (!Array.isArray(experience.quantiles) || experience.quantiles.length === 0) {
            pushIssue(
              issues,
              "analysis.experience.quantiles must be a non-empty array when provided",
              "analysis.experience.quantiles",
              experience.quantiles,
            );
          } else {
            for (let i = 0; i < experience.quantiles.length; i += 1) {
              validateRate01(
                issues,
                experience.quantiles[i],
                `analysis.experience.quantiles.${i}`,
                "analysis.experience quantile",
              );
            }
          }
        }
      }
    }
  }

  if (issues.length > 0) return { success: false, issues };
  return { success: true, value: input as ScenarioV1 };
}

export function validateScenarioV1(
  input: unknown,
  registry?: import("./registry").ModelRegistry,
): Readonly<{ ok: boolean; scenario?: ScenarioV1; issues: StandardIssue[] }> {
  const stage1 = validateBaseScenario(input);
  if (!stage1.success) {
    return { ok: false, issues: stage1.issues };
  }

  const scenario = stage1.value;
  const issues: StandardIssue[] = [];
  const normalizeIssues = (result: unknown): StandardIssue[] => {
    if (!result || typeof result !== "object") return [{ message: "Schema returned invalid result" }];

    const r = result as any;
    if (typeof r.success === "boolean") {
      return r.success ? [] : (Array.isArray(r.issues) ? r.issues : [{ message: "Schema validation failed" }]);
    }

    if (Array.isArray(r.issues)) {
      return r.issues;
    }

    return [{ message: "Schema returned invalid result shape" }];
  };

  if (registry) {
    const mf = registry.get(scenario.model.id, scenario.model.version);
    if (!mf) {
      issues.push({
        path: "model",
        message: `Model not found in registry: ${scenario.model.id}@${scenario.model.version}`,
      });
    } else {
      if (mf.paramsSchema) {
        const result = mf.paramsSchema["~standard"].validate(scenario.model.params);
        for (const issue of normalizeIssues(result)) {
          issues.push({ ...issue, path: issue.path ? `model.params.${issue.path}` : "model.params" });
        }
      }

      if (mf.varsSchema) {
        const result = mf.varsSchema["~standard"].validate(scenario.initial.vars);
        for (const issue of normalizeIssues(result)) {
          issues.push({ ...issue, path: issue.path ? `initial.vars.${issue.path}` : "initial.vars" });
        }
      }
    }
  }

  return {
    ok: issues.length === 0,
    scenario: issues.length === 0 ? scenario : undefined,
    issues,
  };
}
