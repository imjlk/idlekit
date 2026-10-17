---
npm/@idlekit/core: patch
npm/@idlekit/cli: patch
---

Reject non-finite plugin money and net worth in comparison and tuning instead of reporting a winner or a successful floor score. Validate ETA measurements and custom objective scores, refuse empty tuning seed lists, and average large finite seed scores without sum overflow. Zero-money tuning diagnostics use the existing -300 scoring floor; unreachable ETA remains a valid outcome. Large finite amounts still work with breakInfinity.
