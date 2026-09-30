import type { ITtscLintConfig } from "@ttsc/lint";

/**
 * Format gate for the new evidence tools only. `severity: "error"` is what
 * makes `ttsc check` fail. An empty `format` block would not.
 * This file is not the evidence graph. `tsconfig.format.json` points at it.
 */
const config = {
  format: {
    severity: "error",
    semi: true,
    singleQuote: false,
    trailingComma: "all",
    printWidth: 100,
  },
} satisfies ITtscLintConfig;

export default config;
