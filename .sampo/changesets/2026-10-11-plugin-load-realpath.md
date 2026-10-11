---
npm/@idlekit/cli: patch
---

Load a plugin reached through a symlinked directory even when its file was created after a sibling plugin in that directory was loaded in the same process.

- import each plugin by its realpath; Bun already names the module by it, and `pluginDigest` stays keyed by the resolved path that was passed
