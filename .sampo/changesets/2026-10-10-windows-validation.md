---
npm/@idlekit/cli: patch
---

Validate the complete CLI test suite and release/toolchain TypeScript on Windows CI. Path assertions now accept Windows absolute paths, directory alias security checks use junctions on Windows, and file symlink tests run when permissions allow them. The large-clock session regression isolates its active ticks so it finishes within the default test timeout; failed Evidence inventory runs now include their test output.
