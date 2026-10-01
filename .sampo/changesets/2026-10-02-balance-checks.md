---
npm/@idlekit/core: minor
npm/@idlekit/cli: minor
---

Judge scenario metrics with a balance check file.

- `idk evaluate --checks` compares a registered metric, operator, threshold, and unit
- a missing or unknown metric does not pass as zero, and a mismatch is not rewritten into the baseline
- `idk kpi regress` keeps its flags and maps the same rows through that check
