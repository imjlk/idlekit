import { z } from "zod";
import type { StandardIssue, StandardSchema } from "../../../scenario/validate";
import { zodStandardSchema } from "../../../scenario/validate";
import type { TuneSpecV1 } from "./tuneSpec";

const paramSpaceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("bool") }),
  z.object({
    kind: z.literal("int"),
    min: z.number(),
    max: z.number(),
  }),
  z.object({
    kind: z.literal("number"),
    min: z.number(),
    max: z.number(),
    scale: z.enum(["linear", "log"]).optional(),
  }),
  z.object({
    kind: z.literal("choice"),
    values: z.array(z.unknown()),
  }),
]);

const tuneParamSchema = z.object({
  path: z.string().min(1),
  space: paramSpaceSchema,
});

const tuneSpecV1ZodSchema = z.object({
  schemaVersion: z.literal(1),
  meta: z
    .object({
      id: z.string().optional(),
      title: z.string().optional(),
      description: z.string().optional(),
      tags: z.array(z.string()).optional(),
    })
    .optional(),
  strategy: z.object({
    id: z.string().min(1),
    baseParams: z.unknown().optional(),
    space: z.array(tuneParamSchema),
  }),
  objective: z.object({
    id: z.string().min(1),
    params: z.unknown().optional(),
  }),
  runner: z.object({
    seeds: z.array(z.number()).nonempty(),
    budget: z.number(),
    overrideDurationSec: z.number().optional(),
    overrideStepSec: z.number().optional(),
    stages: z
      .array(
        z.object({
          budget: z.number(),
          durationSec: z.number().optional(),
          keepTopK: z.number().optional(),
          fast: z.boolean().optional(),
        }),
      )
      .optional(),
    topK: z.number().optional(),
  }),
});

export const TuneSpecV1Schema: StandardSchema<TuneSpecV1> = zodStandardSchema(tuneSpecV1ZodSchema);

function semanticIssues(input: TuneSpecV1): StandardIssue[] {
  const issues: StandardIssue[] = [];

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

export function validateTuneSpecV1(input: unknown): Readonly<{
  ok: boolean;
  tuneSpec?: TuneSpecV1;
  issues: StandardIssue[];
}> {
  const raw = TuneSpecV1Schema["~standard"].validate(input);
  if (!raw.success) {
    return { ok: false, issues: raw.issues };
  }

  const sem = semanticIssues(raw.value);
  if (sem.length > 0) return { ok: false, issues: sem };
  return { ok: true, tuneSpec: raw.value, issues: [] };
}
