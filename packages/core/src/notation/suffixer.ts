export type Suffixer =
  | {
      kind: "alphaInfinite";
      minLen?: number;
    }
  | {
      kind: "table";
      table: string[];
    };
