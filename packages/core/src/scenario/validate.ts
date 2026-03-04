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

    if ("issues" in r && r.issues == null) {
      return [];
    }

    return [];
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
