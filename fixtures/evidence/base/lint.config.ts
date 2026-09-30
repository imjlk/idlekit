import { evidence, type ITtscEvidenceGraphConfig } from "@ttsc/evidence";
import type { ITtscLintConfig } from "@ttsc/lint";

const graph: ITtscEvidenceGraphConfig = {
  claims: [
    {
      name: "production cites the spec",
      type: "typescript",
      files: ["src/host.ts"],
      symbol: ["function", "property"],
      reference: {
        type: "markdown",
        files: ["docs/spec.md"],
        symbol: "h2",
        noEvidenceExclude: true,
        requireReview: true,
      },
    },
    {
      name: "tests cite the spec",
      type: "typescript",
      files: ["src/host.test.ts"],
      symbol: "function",
      reference: {
        type: "markdown",
        files: ["docs/spec.md"],
        symbol: "h2",
        noEvidenceExclude: true,
        requireReview: true,
      },
    },
    {
      name: "tests cite the implementation",
      type: "typescript",
      files: ["src/host.test.ts"],
      symbol: "function",
      reference: {
        type: "typescript",
        files: ["src/host.ts"],
        symbol: ["function", "property"],
        noEvidenceExclude: true,
        requireReview: true,
      },
    },
  ],
};

const graphConfig = {
  plugins: { evidence },
  rules: {
    "evidence/graph": ["error", graph],
    "evidence/review": "error",
    "evidence/documented": "error",
    "evidence/todo": "error",
  },
} satisfies ITtscLintConfig;

export default graphConfig;
