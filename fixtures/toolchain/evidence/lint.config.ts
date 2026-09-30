import { evidence, type ITtscEvidenceGraphConfig } from "@ttsc/evidence";
import type { ITtscLintConfig } from "@ttsc/lint";

const graph: ITtscEvidenceGraphConfig = {
  claims: [
    {
      name: "quota fixture cites its spec",
      type: "typescript",
      files: ["src/**/*.ts"],
      symbol: "function",
      reference: {
        type: "markdown",
        files: ["docs/quota.md"],
        symbol: "h2",
        noEvidenceExclude: true,
      },
    },
  ],
};

export default {
  plugins: { evidence },
  rules: {
    "evidence/graph": ["error", graph],
  },
} satisfies ITtscLintConfig;
