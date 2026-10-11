---
npm/@idlekit/core: patch
npm/@idlekit/cli: patch
---

Publish registry metadata with concrete internal dependency versions.

- `@idlekit/core@0.2.0` and `@idlekit/cli@0.2.0` were published with `workspace:*` in their registry dependencies, so npm and Bun could not install them; their tarballs already named `0.2.0`
- the release rewrites every package manifest before Sampo's dry run and real publish, and restores it afterwards, because npm sends the manifest it read before `prepack`
- package contents, exports, and CLI behavior are unchanged
