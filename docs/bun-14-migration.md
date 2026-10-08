# Migrate to Bun 1.4.2 and the Gunshi CLI

Korean version: [bun-14-migration_ko.md](./bun-14-migration_ko.md)

The next breaking release requires Bun `>=1.4.2` for `@idlekit/money`, `@idlekit/core`, and `@idlekit/cli`. Previous support for Bun 1.3 is removed. Upgrade the runtime before installing the new packages. If an environment cannot upgrade yet, retain its already installed previous package versions and lockfile until migration is possible.

## Upgrade the runtime

Use the upgrade method for your Bun installation: `bun upgrade` for the Bun installer, `brew upgrade bun` for Homebrew, or `scoop update bun` for Scoop. The [official Bun installation guide](https://bun.com/docs/installation#upgrading) also explains how to install a specific version.

Open a new terminal after updating Windows PATH, then run `bun --version` in the same environment that starts the application. It must report 1.4.2 or later. Update version-manager and CI pins too; this repository tests Bun 1.4.2 on Linux and Windows.

For a repository checkout, activate that runtime and run:

```bash
bun install --frozen-lockfile
bun run toolchain:doctor
```

For a consumer application, update its package dependencies and lockfile after upgrading Bun, then run its tests. For a global `idk` installation, update the CLI with the upgraded Bun runtime.

## Update CLI integrations

The `review evaluate`, `review compare`, and `review doctor` commands now emit Markdown reports. Use `--format json` for structured output in automation. OpenTUI dashboards, image previews, and the `--image-mode` / `--image-protocol` flags have been removed; remove those flags from scripts.

Gunshi validates unknown options and offers typo suggestions. Run `idk --help` and command-specific `--help` to check existing scripts, then rerun scenario validation and the relevant reports.

Refresh shell integration with `idk setup completions --shell <shell>`, choosing `bash`, `zsh`, `fish`, or `powershell`. The `idk complete <shell>` command prints the native completion script.

## Release review

The runtime minimum is a breaking compatibility change. Its changeset requests a `major` bump for all three packages under the [release process](./release-process.md). Review the migration guide and generated release plan before approving the release PR.
