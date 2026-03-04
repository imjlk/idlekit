import type { StandardIssue, StandardSchema } from "../../../scenario/validate";
import { typiaStandardSchema } from "../../../scenario/validate";
import type { TuneSpecV1 } from "./tuneSpec";

export const TuneSpecV1Schema: StandardSchema<TuneSpecV1> = typiaStandardSchema<TuneSpecV1>();

function hasIssues(result: unknown): result is { issues: StandardIssue[] } {
  return (
    !!result &&
    typeof result === "object" &&
    "issues" in result &&
    Array.isArray((result as Record<string, unknown>).issues)
  );
}

function hasSuccess(result: unknown): result is { success: boolean; value?: TuneSpecV1; issues?: StandardIssue[] } {
  return !!result && typeof result === "object" && "success" in result;
}

function semanticIssues(input: TuneSpecV1): StandardIssue[] {
  const issues: StandardIssue[] = [];

  if (input.schemaVersion !== 1) {
    issues.push({ path: "schemaVersion", message: "schemaVersion must be 1" });
  }

  if (!(input.runner.budget > 0)) {
    issues.push({ path: "runner.budget", message: "runner.budget must be > 0" });
  }

  if (!input.runner.seeds || input.runner.seeds.length === 0) {
    issues.push({ path: "runner.seeds", message: "runner.seeds must not be empty" });
  }

  const set = new Set<string>();
  for (const p of input.strategy.space) {
    if (set.has(p.path)) {
      issues.push({ path: `strategy.space.${p.path}`, message: "duplicate tune param path" });
    }
    set.add(p.path);
  }

  return issues;
}

function fallbackParseTuneSpecV1(input: unknown): TuneSpecV1 | null {
  if (!input || typeof input !== "object") return null;
  const x = input as Record<string, unknown>;

  if (x.schemaVersion !== 1) return null;
  if (!x.strategy || typeof x.strategy !== "object") return null;
  if (!x.objective || typeof x.objective !== "object") return null;
  if (!x.runner || typeof x.runner !== "object") return null;

  const strategy = x.strategy as Record<string, unknown>;
  const objective = x.objective as Record<string, unknown>;
  const runner = x.runner as Record<string, unknown>;

  if (typeof strategy.id !== "string") return null;
  if (!Array.isArray(strategy.space)) return null;
  if (typeof objective.id !== "string") return null;
  if (!Array.isArray(runner.seeds)) return null;
  if (typeof runner.budget !== "number") return null;

  return input as TuneSpecV1;
}

export function validateTuneSpecV1(input: unknown): Readonly<{
  ok: boolean;
  tuneSpec?: TuneSpecV1;
  issues: StandardIssue[];
}> {
  const raw = TuneSpecV1Schema["~standard"].validate(input) as unknown;

  if (hasSuccess(raw)) {
    if (!raw.success) {
      const issues = raw.issues ?? [{ message: "Invalid tune spec" }];
      const fallback = fallbackParseTuneSpecV1(input);
      if (!fallback) return { ok: false, issues };

      const sem = semanticIssues(fallback);
      if (sem.length > 0) return { ok: false, issues: sem };

      return { ok: true, tuneSpec: fallback, issues: [] };
    }
    if (!raw.value) return { ok: false, issues: [{ message: "Tune spec validation returned no value" }] };

    const sem = semanticIssues(raw.value);
    if (sem.length > 0) return { ok: false, issues: sem };

    return { ok: true, tuneSpec: raw.value, issues: [] };
  }

  if (hasIssues(raw)) {
    if (raw.issues.length > 0) return { ok: false, issues: raw.issues };
    const value = input as TuneSpecV1;
    const sem = semanticIssues(value);
    if (sem.length > 0) return { ok: false, issues: sem };
    return { ok: true, tuneSpec: value, issues: [] };
  }

  return { ok: false, issues: [{ message: "Unknown tune spec validation result" }] };
}
