/**
 * Evidence host for the conformance harness. Types and runners live in
 * `conformanceRun.ts` so this file's only property is the generator version.
 *
 * @evidence docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness Records generator version 1. Test seeds and game seeds stay on separate streams, and one intentional gap predicate shrinks to its minimal failing integer.
 * @evidenceReview docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness #a195f0e Re-read the section: version 1 is this constant, shrink-gap keeps values outside 1..7, and relation checks refuse off-grid resume, undeclared bulk equality, and debt bans the model does not claim.
 */
export const conformanceGeneratorVersion = 1;
