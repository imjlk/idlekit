---
npm/@idlekit/core: patch
---

A censored `timeToMilestone` for `action.<id>.firstApplied` or `progress.first-upgrade` no longer proves an `lte` deadline equal to the horizon violated. These keys are recorded at the start of a tick, so a purchase that becomes affordable exactly at the horizon could still meet that deadline; the constraint is left unproven instead. Model-emitted keys and `prestige.first`, which are recorded at a tick end, keep the strict bound.
