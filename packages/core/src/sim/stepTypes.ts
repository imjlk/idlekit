import type { StepInput, StepOutput } from "./step";

export type StepOnceFn<N, U extends string, Vars> =
  (input: StepInput<N, U, Vars>) => StepOutput<N, U, Vars>;
