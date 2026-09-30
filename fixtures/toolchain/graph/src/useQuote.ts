import { quoteBudget } from "./quoteBudget";

export function useQuote(count: number): number {
  return quoteBudget(count);
}
