import type { ScenarioV1 } from "../scenario/types";
import {
  RETENTION_DAYS, applyRetentionPatch, compareRetention, observeCohort, planRetentionPatch,
  type CohortActivityRow, type CohortObservation, type RetentionAssumptions, type RetentionComparison,
  type RetentionKey, type RetentionPatchPlan,
} from "./cohort";

/**
 * Telemetry feedback loop: a standardized batch of complete install cohorts,
 * multi-cohort comparison, drift checks, experiment planning and a patch plan
 * that keeps the scenario diff explicit. Everything runs on local values.
 */

export const COHORT_BATCH_SCHEMA_VERSION = 1 as const;

/** One complete install cohort in a batch. Rows follow the `observeCohort` export contract. */
export type CohortBatchEntry = Readonly<{
  id: string;
  /** Optional experiment group or scenario variant label. */
  variant?: string;
  /** Optional ISO calendar date (YYYY-MM-DD) shared by every install in the cohort. */
  installDate?: string;
  observedThroughDay: number;
  rows: readonly CohortActivityRow[];
}>;

export type CohortBatch = Readonly<{
  schemaVersion: typeof COHORT_BATCH_SCHEMA_VERSION;
  cohorts: readonly CohortBatchEntry[];
}>;

export type ObservedCohort = Readonly<{
  id: string;
  variant: string | null;
  installDate: string | null;
  rows: number;
  observation: CohortObservation;
}>;

export type CohortBatchIssue = Readonly<{ path: string; message: string }>;

export type CohortBatchValidation =
  | Readonly<{ ok: true; issues: readonly []; cohorts: readonly ObservedCohort[] }>
  | Readonly<{ ok: false; issues: readonly CohortBatchIssue[] }>;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ROW_KEYS = new Set(["userId", "day", "active", "iapRevenue", "adRevenue", "acquisitionCost"]);
const ENTRY_KEYS = new Set(["id", "variant", "installDate", "observedThroughDay", "rows"]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Validate a standardized cohort batch and observe every cohort. All issues are
 * collected with a JSON path, so a batch export can be fixed in one pass.
 * Revenue fields must be present on every row of a cohort or on none of them.
 */
export function validateCohortBatch(input: unknown): CohortBatchValidation {
  const issues: CohortBatchIssue[] = [];
  if (!record(input)) return { ok: false, issues: [{ path: "$", message: "Cohort batch must be an object" }] };
  if (input.schemaVersion !== COHORT_BATCH_SCHEMA_VERSION) issues.push({ path: "$.schemaVersion", message: `schemaVersion must be ${COHORT_BATCH_SCHEMA_VERSION}` });
  for (const key of Object.keys(input)) if (key !== "schemaVersion" && key !== "cohorts") issues.push({ path: `$.${key}`, message: "Unknown cohort batch field" });
  if (!Array.isArray(input.cohorts) || input.cohorts.length === 0) {
    issues.push({ path: "$.cohorts", message: "cohorts must be a non-empty array" });
    return { ok: false, issues };
  }
  const ids = new Set<string>();
  const cohorts: ObservedCohort[] = [];
  for (const [index, value] of input.cohorts.entries()) {
    const path = `$.cohorts[${index}]`;
    if (!record(value)) { issues.push({ path, message: "Cohort must be an object" }); continue; }
    const before = issues.length;
    for (const key of Object.keys(value)) if (!ENTRY_KEYS.has(key)) issues.push({ path: `${path}.${key}`, message: "Unknown cohort field" });
    if (typeof value.id !== "string" || !ID_PATTERN.test(value.id)) issues.push({ path: `${path}.id`, message: "id must match [A-Za-z0-9][A-Za-z0-9._:-]{0,127}" });
    else if (ids.has(value.id)) issues.push({ path: `${path}.id`, message: `Duplicate cohort id ${value.id}` });
    else ids.add(value.id);
    if (value.variant !== undefined && (typeof value.variant !== "string" || !ID_PATTERN.test(value.variant))) issues.push({ path: `${path}.variant`, message: "variant must match [A-Za-z0-9][A-Za-z0-9._:-]{0,127}" });
    if (value.installDate !== undefined && (typeof value.installDate !== "string" || !validDate(value.installDate))) issues.push({ path: `${path}.installDate`, message: "installDate must be a valid YYYY-MM-DD date" });
    if (typeof value.observedThroughDay !== "number" || !Number.isSafeInteger(value.observedThroughDay) || value.observedThroughDay < 0) issues.push({ path: `${path}.observedThroughDay`, message: "observedThroughDay must be a nonnegative safe integer" });
    if (!Array.isArray(value.rows) || value.rows.length === 0) { issues.push({ path: `${path}.rows`, message: "rows must be a non-empty array" }); continue; }
    const presence = new Map<string, number>();
    for (const [rowIndex, row] of value.rows.entries()) {
      if (!record(row)) { issues.push({ path: `${path}.rows[${rowIndex}]`, message: "Row must be an object" }); continue; }
      for (const key of Object.keys(row)) {
        if (!ROW_KEYS.has(key)) issues.push({ path: `${path}.rows[${rowIndex}].${key}`, message: "Unknown row field" });
        else presence.set(key, (presence.get(key) ?? 0) + 1);
      }
      if (typeof row.userId !== "string" || !row.userId.trim()) issues.push({ path: `${path}.rows[${rowIndex}].userId`, message: "userId must be a non-empty string" });
      if (typeof row.day !== "number") issues.push({ path: `${path}.rows[${rowIndex}].day`, message: "day must be a number" });
      if (row.active !== undefined && typeof row.active !== "boolean") issues.push({ path: `${path}.rows[${rowIndex}].active`, message: "active must be boolean" });
      for (const key of ["iapRevenue", "adRevenue", "acquisitionCost"] as const) {
        if (row[key] !== undefined && typeof row[key] !== "number") issues.push({ path: `${path}.rows[${rowIndex}].${key}`, message: `${key} must be a number` });
      }
    }
    for (const key of ["iapRevenue", "adRevenue"] as const) {
      const count = presence.get(key) ?? 0;
      if (count !== 0 && count !== value.rows.length) issues.push({ path: `${path}.rows`, message: `${key} must be on every row of the cohort or none; an omitted value is unmeasured, not zero` });
    }
    if (issues.length !== before) continue;
    try {
      const observation = observeCohort(value.rows as CohortActivityRow[], value.observedThroughDay as number);
      cohorts.push({
        id: value.id as string,
        variant: (value.variant as string | undefined) ?? null,
        installDate: (value.installDate as string | undefined) ?? null,
        rows: value.rows.length,
        observation,
      });
    } catch (error) {
      issues.push({ path, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return issues.length ? { ok: false, issues } : { ok: true, issues: [], cohorts };
}

/** Observe every cohort in a batch, or throw one RangeError listing each issue path. */
export function observeCohortBatch(input: unknown): readonly ObservedCohort[] {
  const result = validateCohortBatch(input);
  if (!result.ok) throw new RangeError(`Invalid cohort batch: ${result.issues.map(issue => `${issue.path}: ${issue.message}`).join("; ")}`);
  return result.cohorts;
}

// --- statistics helpers -------------------------------------------------------

/** Complementary error function (Numerical Recipes erfcc, fractional error < 1.2e-7). */
function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}

/** Standard normal CDF. */
export function standardNormalCdf(x: number): number {
  return 0.5 * erfc(-x / Math.SQRT2);
}

/** Standard normal quantile (Acklam's rational approximation, relative error < 1.2e-9). */
export function standardNormalQuantile(p: number): number {
  if (!(p > 0 && p < 1)) throw new RangeError("Normal quantile probability must be in (0, 1)");
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > 1 - low) return -standardNormalQuantile(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

export type SignificanceHint = Readonly<{
  test: "two-proportion-z";
  alpha: number;
  z: number | null;
  pValue: number | null;
  /**
   * `insufficient-sample` when an expected success or failure count is below 5.
   * A hint describes this pair only: repeated looks or many pairs inflate false positives.
   */
  verdict: "significant" | "not-significant" | "insufficient-sample";
}>;

function assertAlpha(alpha: number): void {
  if (!(Number.isFinite(alpha) && alpha > 0 && alpha < 1)) throw new RangeError("alpha must be in (0, 1)");
}

/** Pooled two-proportion z-test hint for retained/installed counts. */
export function twoProportionSignificance(
  a: Readonly<{ users: number; activeUsers: number }>,
  b: Readonly<{ users: number; activeUsers: number }>,
  alpha = 0.05,
): SignificanceHint {
  assertAlpha(alpha);
  for (const group of [a, b]) {
    if (!Number.isSafeInteger(group.users) || group.users < 1 || !Number.isSafeInteger(group.activeUsers) || group.activeUsers < 0 || group.activeUsers > group.users) {
      throw new RangeError("Significance counts must be integers with 0 <= activeUsers <= users and users >= 1");
    }
  }
  const pooled = (a.activeUsers + b.activeUsers) / (a.users + b.users);
  const expected = [a.users * pooled, a.users * (1 - pooled), b.users * pooled, b.users * (1 - pooled)];
  if (expected.some(count => count < 5)) return { test: "two-proportion-z", alpha, z: null, pValue: null, verdict: "insufficient-sample" };
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / a.users + 1 / b.users));
  const z = (b.activeUsers / b.users - a.activeUsers / a.users) / se;
  const pValue = Math.min(1, 2 * (1 - standardNormalCdf(Math.abs(z))));
  return { test: "two-proportion-z", alpha, z, pValue, verdict: pValue < alpha ? "significant" : "not-significant" };
}

// --- multi-cohort comparison --------------------------------------------------

export type CohortComparisonCell = Readonly<{
  cohortId: string;
  variant: string | null;
  status: "observed" | "not-observed";
  users: number;
  activeUsers: number | null;
  rate: number | null;
  interval95: Readonly<{ min: number; max: number }> | null;
  differenceFromBaselinePercentagePoints: number | null;
  differenceFromAssumptionPercentagePoints: number | null;
  significance: SignificanceHint | null;
}>;

export type CohortComparisonDay = Readonly<{
  day: number;
  assumption: number | null;
  observedCohorts: number;
  /** Max minus min observed rate across cohorts, in percentage points; null below two observed cohorts. */
  spreadPercentagePoints: number | null;
  cohorts: readonly CohortComparisonCell[];
}>;

export type MultiCohortComparison = Readonly<{
  baseline: string;
  alpha: number;
  /** Number of non-baseline cohorts compared per day; consider alpha / comparisons for a family-wise bound. */
  comparisons: number;
  days: readonly CohortComparisonDay[];
  notes: readonly string[];
}>;

/**
 * Compare exact-day retention across cohorts. The baseline cohort (first by default)
 * anchors the difference and the significance hint of every other cohort.
 */
export function compareCohorts(
  cohorts: readonly ObservedCohort[],
  options: Readonly<{ baseline?: string; assumptions?: RetentionAssumptions; alpha?: number }> = {},
): MultiCohortComparison {
  if (cohorts.length === 0) throw new RangeError("Cohort comparison requires at least one cohort");
  const alpha = options.alpha ?? 0.05;
  assertAlpha(alpha);
  const baseline = options.baseline === undefined ? cohorts[0]! : cohorts.find(cohort => cohort.id === options.baseline);
  if (!baseline) throw new RangeError(`Baseline cohort ${options.baseline} is not in the batch`);
  const assumptionRows = cohorts.map(cohort => compareRetention(cohort.observation, options.assumptions ?? {}));
  const days = RETENTION_DAYS.map((day, dayIndex) => {
    const base = baseline.observation.retention[dayIndex]!;
    const cells = cohorts.map((cohort, cohortIndex): CohortComparisonCell => {
      const point = cohort.observation.retention[dayIndex]!;
      const assumption: RetentionComparison = assumptionRows[cohortIndex]![dayIndex]!;
      const comparable = cohort !== baseline && point.activeUsers !== null && base.activeUsers !== null;
      return {
        cohortId: cohort.id,
        variant: cohort.variant,
        status: point.status,
        users: point.users,
        activeUsers: point.activeUsers,
        rate: point.rate,
        interval95: point.interval95,
        differenceFromBaselinePercentagePoints: comparable ? (point.rate! - base.rate!) * 100 : null,
        differenceFromAssumptionPercentagePoints: assumption.differencePercentagePoints,
        significance: comparable ? twoProportionSignificance({ users: base.users, activeUsers: base.activeUsers! }, { users: point.users, activeUsers: point.activeUsers! }, alpha) : null,
      };
    });
    const rates = cells.flatMap(cell => cell.rate === null ? [] : [cell.rate]);
    return {
      day,
      assumption: options.assumptions?.[`d${day}` as RetentionKey] ?? null,
      observedCohorts: rates.length,
      spreadPercentagePoints: rates.length >= 2 ? (Math.max(...rates) - Math.min(...rates)) * 100 : null,
      cohorts: cells,
    };
  });
  const notes = [
    "Significance is a pooled two-proportion z-test hint per day and pair; it is not a pre-registered experiment analysis.",
    "Cohorts with different install dates, release builds or acquisition sources differ for reasons other than the scenario.",
  ];
  if (cohorts.length > 2) notes.push(`With ${cohorts.length - 1} comparisons per day, a family-wise 5% bound needs alpha / ${cohorts.length - 1} per comparison.`);
  return { baseline: baseline.id, alpha, comparisons: cohorts.length - 1, days, notes };
}

// --- drift detection ----------------------------------------------------------

export type RetentionDriftFinding = Readonly<{
  day: number;
  assumption: number;
  observed: number;
  differencePercentagePoints: number;
  interval95: Readonly<{ min: number; max: number }>;
  /** The assumption lies outside the cohort's Wilson 95% interval. */
  assumptionOutsideInterval: boolean;
  drift: boolean;
}>;

export type RetentionDriftReport = Readonly<{
  status: "drift" | "within-threshold" | "no-comparable-days";
  thresholdPercentagePoints: number;
  requireIntervalExclusion: boolean;
  findings: readonly RetentionDriftFinding[];
}>;

/**
 * Compare observed anchors with explicit assumptions. A day drifts when the absolute
 * difference reaches the threshold and, by default, the assumption also lies outside
 * the Wilson 95% interval (so a small cohort's noise alone does not alert).
 */
export function detectRetentionDrift(
  observation: CohortObservation,
  assumptions: RetentionAssumptions,
  options: Readonly<{ thresholdPercentagePoints?: number; requireIntervalExclusion?: boolean }> = {},
): RetentionDriftReport {
  const thresholdPercentagePoints = options.thresholdPercentagePoints ?? 5;
  if (!(Number.isFinite(thresholdPercentagePoints) && thresholdPercentagePoints >= 0 && thresholdPercentagePoints <= 100)) {
    throw new RangeError("Drift threshold must be finite and in 0..100 percentage points");
  }
  const requireIntervalExclusion = options.requireIntervalExclusion ?? true;
  const comparison = compareRetention(observation, assumptions);
  const findings: RetentionDriftFinding[] = [];
  for (const [index, row] of comparison.entries()) {
    if (row.status !== "compared") continue;
    const interval = observation.retention[index]!.interval95!;
    const outside = row.assumption! < interval.min || row.assumption! > interval.max;
    const difference = row.differencePercentagePoints!;
    findings.push({
      day: row.day, assumption: row.assumption!, observed: row.observed!, differencePercentagePoints: difference,
      interval95: interval, assumptionOutsideInterval: outside,
      drift: Math.abs(difference) + 1e-9 >= thresholdPercentagePoints && (!requireIntervalExclusion || outside),
    });
  }
  const status = findings.length === 0 ? "no-comparable-days" : findings.some(finding => finding.drift) ? "drift" : "within-threshold";
  return { status, thresholdPercentagePoints, requireIntervalExclusion, findings };
}

// --- experiment design --------------------------------------------------------

export type ExperimentGroupInput = Readonly<{ id: string; scenario?: string; retention?: number }>;

export type RetentionExperimentPlan = Readonly<{
  retentionDay: number;
  baselineRate: number;
  minimumDetectableEffectPercentagePoints: number;
  targetRate: number;
  alpha: number;
  /** alpha divided by the number of comparisons against the control group. */
  adjustedAlpha: number;
  power: number;
  usersPerGroup: number;
  totalUsers: number;
  groups: readonly Readonly<{ id: string; scenario: string | null; role: "control" | "treatment"; assumedRetention: number | null; requiredUsers: number }>[];
  observationWindow: Readonly<{
    observedThroughDay: number;
    enrollmentDays: number | null;
    /** Enrollment plus the retention day plus one export day, when daily installs are known. */
    earliestReadoutDay: number | null;
  }>;
  recommendations: readonly string[];
}>;

/**
 * Size a retention experiment for a two-sided pooled two-proportion test with equal
 * allocation. Each treatment group is compared with the first (control) group, with
 * a Bonferroni-adjusted alpha. The plan does not replace an experiment platform.
 */
export function planRetentionExperiment(args: Readonly<{
  groups: readonly ExperimentGroupInput[];
  retentionDay: number;
  baselineRate?: number;
  minimumDetectableEffectPercentagePoints?: number;
  alpha?: number;
  power?: number;
  dailyInstalls?: number;
}>): RetentionExperimentPlan {
  if (!(RETENTION_DAYS as readonly number[]).includes(args.retentionDay)) throw new RangeError(`retentionDay must be one of ${RETENTION_DAYS.join(", ")}`);
  if (args.groups.length < 2) throw new RangeError("An experiment requires a control group and at least one treatment group");
  const ids = new Set<string>();
  for (const group of args.groups) {
    if (!ID_PATTERN.test(group.id) || ids.has(group.id)) throw new RangeError(`Experiment group ids must be unique and match ${ID_PATTERN.source}`);
    ids.add(group.id);
    if (group.retention !== undefined && !(Number.isFinite(group.retention) && group.retention >= 0 && group.retention <= 1)) throw new RangeError(`Group ${group.id} retention must be in 0..1`);
  }
  const alpha = args.alpha ?? 0.05;
  const power = args.power ?? 0.8;
  assertAlpha(alpha);
  if (!(Number.isFinite(power) && power > 0 && power < 1)) throw new RangeError("power must be in (0, 1)");
  const control = args.groups[0]!;
  const baselineRate = args.baselineRate ?? control.retention;
  if (baselineRate === undefined || !(baselineRate > 0 && baselineRate < 1)) throw new RangeError("baselineRate must be in (0, 1); pass it or give the control group a retention assumption");
  let mde = args.minimumDetectableEffectPercentagePoints;
  if (mde === undefined) {
    const effects = args.groups.slice(1).flatMap(group => group.retention === undefined ? [] : [Math.abs(group.retention - baselineRate) * 100]).filter(effect => effect > 0);
    if (effects.length === 0) throw new RangeError("minimumDetectableEffectPercentagePoints is required when the variants assume the same retention");
    mde = Math.min(...effects);
  }
  if (!(Number.isFinite(mde) && mde > 0 && mde < 100)) throw new RangeError("minimumDetectableEffectPercentagePoints must be in (0, 100)");
  const delta = mde / 100;
  // A directionless MDE must cover both feasible alternatives: variance, and thus
  // required sample size, is not symmetric around a baseline other than 0.5.
  const mdeTargets = [baselineRate - delta, baselineRate + delta].filter(rate => rate >= 0 && rate <= 1);
  const targets = args.minimumDetectableEffectPercentagePoints !== undefined
    ? mdeTargets
    : args.groups.slice(1).flatMap(group => group.retention === undefined || group.retention === baselineRate ? mdeTargets : [group.retention]);
  if (targets.length === 0) throw new RangeError("The minimum detectable effect moves the target rate outside [0, 1]");
  const comparisons = args.groups.length - 1;
  const adjustedAlpha = alpha / comparisons;
  const zAlpha = standardNormalQuantile(1 - adjustedAlpha / 2);
  const zBeta = standardNormalQuantile(power);
  const requiredUsers = (target: number): number => {
    const effect = target - baselineRate;
    const mean = (baselineRate + target) / 2;
    const numerator = zAlpha * Math.sqrt(2 * mean * (1 - mean)) + zBeta * Math.sqrt(baselineRate * (1 - baselineRate) + target * (1 - target));
    return Math.ceil((numerator * numerator) / (effect * effect));
  };
  // Keep equal allocation and report the alternative that determines its budget.
  let targetRate = targets[0]!;
  let usersPerGroup = requiredUsers(targetRate);
  for (const target of targets.slice(1)) {
    const users = requiredUsers(target);
    if (users > usersPerGroup) { targetRate = target; usersPerGroup = users; }
  }
  const totalUsers = usersPerGroup * args.groups.length;
  let enrollmentDays: number | null = null;
  if (args.dailyInstalls !== undefined) {
    if (!(Number.isFinite(args.dailyInstalls) && args.dailyInstalls > 0)) throw new RangeError("dailyInstalls must be positive");
    enrollmentDays = Math.max(7, Math.ceil(totalUsers / args.dailyInstalls));
  }
  const recommendations = [
    `Enroll at least ${usersPerGroup} new installs per group and read D${args.retentionDay} only after every enrolled install is fully observed through day ${args.retentionDay}.`,
    args.minimumDetectableEffectPercentagePoints === undefined
      ? "Sample size covers each signed assumed treatment effect; targetRate is the alternative requiring the largest equal-allocation budget."
      : "The explicit MDE is directionless; sample size covers both feasible directions and targetRate is the more conservative alternative.",
    "Assign groups at install time with a stable hash of a local pseudonymous ID; never reassign a player between groups.",
    "Enroll for whole weeks (at least 7 days) so weekday and weekend installs appear in every group.",
    "Fix the readout day and metric before launch. Repeatedly peeking and stopping on a significant hint inflates false positives.",
    "Export each group as its own complete cohort (or one cohort per group and install date) in the cohort batch format, then run idk telemetry compare with the control as baseline.",
  ];
  if (comparisons > 1) recommendations.push(`The plan uses alpha ${adjustedAlpha} per comparison (Bonferroni for ${comparisons} treatments).`);
  if (enrollmentDays === null) recommendations.push("Pass dailyInstalls to estimate the enrollment period and the earliest readout day.");
  return {
    retentionDay: args.retentionDay,
    baselineRate,
    minimumDetectableEffectPercentagePoints: mde,
    targetRate,
    alpha,
    adjustedAlpha,
    power,
    usersPerGroup,
    totalUsers,
    groups: args.groups.map((group, index) => ({
      id: group.id, scenario: group.scenario ?? null, role: index === 0 ? "control" : "treatment",
      assumedRetention: group.retention ?? null, requiredUsers: usersPerGroup,
    })),
    observationWindow: {
      observedThroughDay: args.retentionDay,
      enrollmentDays,
      earliestReadoutDay: enrollmentDays === null ? null : enrollmentDays + args.retentionDay + 1,
    },
    recommendations,
  };
}

/** FNV-1a 32-bit hash; deterministic and dependency-free. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Deterministic, uniform group assignment for a local pseudonymous user ID. */
export function assignExperimentGroup(userId: string, experimentId: string, groupIds: readonly string[]): string {
  if (typeof userId !== "string" || !userId) throw new RangeError("userId must be a non-empty string");
  if (groupIds.length === 0) throw new RangeError("At least one group is required");
  return groupIds[fnv1a(`${experimentId}\u0000${userId}`) % groupIds.length]!;
}

// --- patch workflow -----------------------------------------------------------

export type RetentionChange = Readonly<{ key: RetentionKey; before: number | null; after: number | null }>;

export type RetentionUpdatePlan = Readonly<{
  plan: RetentionPatchPlan;
  /** Validated patched copy of the scenario; absent unless the plan is ready. */
  scenario?: ScenarioV1;
  changes: readonly RetentionChange[];
}>;

/**
 * Plan, apply and validate a retention patch in one step. The input scenario is
 * never modified. Non-ready plans return no scenario and keep their warnings.
 */
export function planScenarioRetentionUpdate(scenario: ScenarioV1, observation: CohortObservation): RetentionUpdatePlan {
  const plan = planRetentionPatch(observation, scenario.monetization?.retention);
  if (plan.status !== "ready") return { plan, changes: [] };
  const patched = applyRetentionPatch({ scenario, observation });
  const changes = RETENTION_DAYS.map((day): RetentionChange => {
    const key = `d${day}` as RetentionKey;
    return { key, before: scenario.monetization?.retention?.[key] ?? null, after: patched.monetization?.retention?.[key] ?? null };
  }).filter(change => change.before !== change.after);
  return { plan, scenario: patched, changes };
}
