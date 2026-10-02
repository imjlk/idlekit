import { chmodSync, existsSync, readFileSync, realpathSync, statSync, writeFileSync } from "fs";
import { join } from "path";

const GUARD = [
  'import fs from "fs";',
  "const locked = new Set();",
  'for (const line of (process.env.IDLEKIT_EVIDENCE_LOCK ?? "").split("\\n")) {',
  "  if (line.length === 0) continue;",
  "  try {",
  "    locked.add(fs.realpathSync(line));",
  "  } catch {",
  "    locked.add(line);",
  "  }",
  "}",
  "function pathOf(value) {",
  '  if (typeof value === "string" || value instanceof URL) return value;',
  '  if (value && typeof value === "object" && typeof value.name === "string") return value.name;',
  "  return undefined;",
  "}",
  "function lockedTarget(value) {",
  "  const target = pathOf(value);",
  "  if (target === undefined) return false;",
  "  try {",
  "    return locked.has(fs.realpathSync(target));",
  "  } catch {",
  "    return false;",
  "  }",
  "}",
  "function reject(value) {",
  '  if (lockedTarget(value)) throw new Error("evidence source is read-only");',
  "}",
  "const write = Bun.write.bind(Bun);",
  "Bun.write = (dest, input) => {",
  "  reject(dest);",
  "  return write(dest, input);",
  "};",
  "const names = [",
  '  "writeFileSync",',
  '  "writeFile",',
  '  "appendFileSync",',
  '  "appendFile",',
  '  "rmSync",',
  '  "unlinkSync",',
  '  "renameSync",',
  '  "copyFileSync",',
  "];",
  "for (const name of names) {",
  "  const original = fs[name];",
  '  if (typeof original !== "function") continue;',
  "  fs[name] = (...args) => {",
  "    reject(args[0]);",
  "    reject(args[1]);",
  "    return original.apply(fs, args);",
  "  };",
  "}",
  "",
].join("\n");

/** `--preload` sits with the test options, before a `--` pattern separator. */
export function preloadTestArgs(args: readonly string[], preload: string): string[] {
  const testAt = args.indexOf("test");
  const flag = ["--preload", preload];
  if (testAt < 0) return [...flag, ...args];
  return [...args.slice(0, testAt + 1), ...flag, ...args.slice(testAt + 1)];
}

export function installSourceLock(
  directory: string,
  files: readonly string[],
): { preload: string; env: string } {
  const preload = join(directory, "source-lock.mjs");
  writeFileSync(preload, GUARD);
  return { preload, env: files.join("\n") };
}

export function sourceDigests(files: readonly string[]): Map<string, string> {
  const digests = new Map<string, string>();
  for (const file of files) digests.set(file, Bun.hash(readFileSync(file)).toString());
  return digests;
}

export function changedSources(digests: ReadonlyMap<string, string>): string[] {
  const changed: string[] = [];
  for (const [file, digest] of digests) {
    let next = "";
    try {
      next = Bun.hash(readFileSync(file)).toString();
    } catch {
      next = "";
    }
    if (next !== digest) changed.push(file);
  }
  return changed;
}

/** Clear write bits so a test cannot replace a file the scanner already read. */
export function sealSources(files: readonly string[]): Map<string, number> {
  const modes = new Map<string, number>();
  try {
    for (const file of files) {
      const mode = statSync(file).mode;
      modes.set(file, mode);
      chmodSync(file, mode & ~0o222);
    }
  } catch (error) {
    unsealSources(modes);
    throw error;
  }
  return modes;
}

export function unsealSources(modes: ReadonlyMap<string, number>): void {
  for (const [file, mode] of modes) {
    try {
      chmodSync(file, mode);
    } catch {
      continue;
    }
  }
}

const LINUX_SEAL = [
  "#!/bin/bash",
  "set -euo pipefail",
  "seal() {",
  "  while IFS= read -r file; do",
  '    [ -n "$file" ] || continue',
  '    target=$(readlink -f -- "$file")',
  '    mount --bind -- "$target" "$target"',
  '    mount -o remount,bind,ro -- "$target"',
  '  done <<< "${IDLEKIT_EVIDENCE_LOCK:-}"',
  "}",
  'if [ "${IDLEKIT_EVIDENCE_SEALED:-}" = "1" ]; then',
  "  seal",
  "  unset IDLEKIT_EVIDENCE_SEALED",
  '  if [ "$(id -u)" = "0" ] && [ -n "${SUDO_UID:-}" ]; then',
  '    exec setpriv --reuid="$SUDO_UID" --regid="$SUDO_GID" --init-groups -- "$@"',
  "  fi",
  '  exec "$@"',
  "fi",
  "if unshare --user --map-root-user --mount --propagation private \\",
  "  /bin/bash -c 'mount --bind /etc/hosts /etc/hosts' >/dev/null 2>&1; then",
  "  export IDLEKIT_EVIDENCE_SEALED=1",
  "  exec unshare --user --map-root-user --mount --propagation private \\",
  '    /bin/bash "$0" "$@"',
  "fi",
  "if sudo -n -E true >/dev/null 2>&1; then",
  "  export IDLEKIT_EVIDENCE_SEALED=1",
  "  exec sudo -n -E unshare --mount --propagation private \\",
  '    /bin/bash "$0" "$@"',
  "fi",
  'echo "evidence source lock could not sandbox the test" >&2',
  "exit 1",
  "",
].join("\n");

function sandboxQuoted(path: string): string {
  const escaped = path.split("\\").join("\\\\").split('"').join('\\"');
  return `"${escaped}"`;
}

function sealedPaths(files: readonly string[]): string[] {
  const paths = new Set<string>();
  for (const file of files) {
    paths.add(file);
    try {
      paths.add(realpathSync(file));
    } catch {
      continue;
    }
  }
  return [...paths];
}

function darwinProfile(files: readonly string[]): string {
  const lines = ["(version 1)", "(allow default)", "(deny file-write*"];
  for (const file of sealedPaths(files)) lines.push(`  (literal ${sandboxQuoted(file)})`);
  lines.push(")", "");
  return lines.join("\n");
}

function sandboxArgv(
  platform: string,
  directory: string,
  command: readonly string[],
  files: readonly string[],
): string[] | undefined {
  if (platform === "darwin") {
    if (!existsSync("/usr/bin/sandbox-exec")) return undefined;
    const profile = join(directory, "source-lock.sb");
    writeFileSync(profile, darwinProfile(files));
    return ["/usr/bin/sandbox-exec", "-f", profile, ...command];
  }
  if (platform === "linux") {
    const script = join(directory, "source-lock-mount.sh");
    writeFileSync(script, LINUX_SEAL);
    return ["/bin/bash", script, ...command];
  }
  return undefined;
}

/**
 * Darwin uses `sandbox-exec`. Linux uses a mount namespace.
 * Other platforms have no sandbox: the result is `undefined`, not an unsealed command.
 * An empty file list is the command unchanged on every platform.
 */
export function sourceLockCommand(
  platform: string,
  directory: string,
  command: readonly string[],
  files: readonly string[],
): string[] | undefined {
  if (files.length === 0) return [...command];
  if (platform !== "darwin" && platform !== "linux") return undefined;
  const wrapped = sandboxArgv(platform, directory, command, files);
  if (!wrapped) throw new Error("evidence source lock could not sandbox the test");
  return wrapped;
}

/** Run the test where it cannot chmod, replace, or unlink the scanned files. */
export function sealedCommand(
  directory: string,
  command: readonly string[],
  files: readonly string[],
): string[] {
  const wrapped = sourceLockCommand(process.platform, directory, command, files);
  if (!wrapped) throw new Error("evidence source lock could not sandbox the test");
  return wrapped;
}
