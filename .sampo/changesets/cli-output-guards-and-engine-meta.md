---
npm/@idlekit/cli: patch
---

`--out`, `--artifact-out`, `--state-out`, `evaluate --out-dir` and list output now refuse a path that names one of the command's input files, including a file reached through another input such as an experiment spec's scenario or a plugin's local import, and including through a symlink or hard link, on every command; `judge` checks before a Jev request and its Markdown output follows the same rule. `simulate --resume state.json --state-out state.json` still saves in place. `compare` and `tune` record `_meta.effectiveEngine`, and `tune --baseline-artifact` refuses a baseline produced with another engine. The linear overflow hint names every Number-only command, and `balance --format md` reports breach gaps without binary rounding noise.
