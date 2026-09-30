import type { ITtscLintConfig } from "@ttsc/lint";

const config = {
  format: {
    severity: "error",
    semi: true,
    singleQuote: false,
  },
} satisfies ITtscLintConfig;

export default config;
