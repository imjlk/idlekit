import { evidence, type ITtscEvidenceGraphConfig } from "@ttsc/evidence";
import type { ITtscLintConfig } from "@ttsc/lint";

/**
 * Project helper for the evidence graph. `@ttsc/lint` does not load this file
 * on its own. `lint.config.ts` imports it.
 *
 * Production and test claims are separate so a test citation cannot satisfy
 * the implementation obligation. The third claim makes executed tests cite
 * the implementation symbols they run, which is what expires review when
 * that implementation changes. `requireReview` watches the cited target,
 * not every edit in the repository.
 */
export const productionFiles = [
  "packages/core/src/scenario/concreteValidator.ts",
  "packages/core/src/scenario/validate.ts",
];

export const testFiles = ["packages/core/src/scenario/concreteValidator.test.ts"];

const activeMarkdown = {
  type: "markdown" as const,
  files: ["docs/requirements/active/**/*.md"],
  symbol: "h2" as const,
  noEvidenceExclude: true,
  requireReview: true,
};

export const disabledClaimLedger = [
  {
    name: "planned requirements stay disabled until their feature PR",
    owner: "idlekit maintainers",
    scope: "docs/requirements/planned/**/*.md",
    activatesIn: "PR-01",
    reason:
      "Feature requirements become active only when that PR adds a production host and an executed test. Do not enable this claim to fail the whole roadmap, and do not exclude those headings to turn it green.",
  },
] as const;

export const evidenceGraph: ITtscEvidenceGraphConfig = {
  claims: [
    {
      name: "active requirements have production implementations",
      type: "typescript",
      files: productionFiles,
      symbol: ["function", "property"],
      reference: activeMarkdown,
    },
    {
      name: "active requirements have executed test hosts",
      type: "typescript",
      files: testFiles,
      symbol: "function",
      reference: activeMarkdown,
    },
    {
      name: "executed tests cite the implementation they run",
      type: "typescript",
      files: testFiles,
      symbol: "function",
      reference: {
        type: "typescript",
        files: productionFiles,
        symbol: ["property", "function"],
        noEvidenceExclude: true,
        requireReview: true,
      },
    },
    {
      name: disabledClaimLedger[0].name,
      type: "typescript",
      files: productionFiles,
      symbol: "function",
      disabled: true,
      reference: {
        type: "markdown",
        files: ["docs/requirements/planned/**/*.md"],
        symbol: "h2",
        noEvidenceExclude: true,
      },
    },
  ],
};

/**
 * One object: this lint loader rejects an array config.
 * `files` is omitted because `evidence/graph` options have to sit on an
 * unscoped entry, and a `files` filter would also hide hosts the Program
 * reaches through imports. `documented` and `todo` are enabled on
 * `fixtures/evidence/base`, whose Program is only those sources.
 * `singular` stays off. These product files export more than one value.
 */
export const graphLintConfig = {
  plugins: { evidence },
  rules: {
    "evidence/graph": ["error", evidenceGraph],
    "evidence/review": "error",
  },
} satisfies ITtscLintConfig;
