---
npm/@idlekit/cli: patch
---

Preserve existing dependency resolutions when preparing package releases. CI and `release:version` now refresh only workspace version metadata, reject other lockfile changes, and verify a frozen install. Dependency upgrades remain separate reviewed changes.
