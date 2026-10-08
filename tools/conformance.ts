import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { demonstrateShrinkGap, replayShrinkReport } from "../packages/core/src/testkit/conformance";
import { commandText, root, runTtsc } from "./evidence-host";
import { ttsxLauncherPath } from "./compiler-bin";
import { fixtureEnv } from "./toolchain-host";

type Step = {
  name: string;
  ok: boolean;
  detail?: string;
};

const steps: Step[] = [];

function record(name: string, ok: boolean, detail?: string): void {
  steps.push({ name, ok, detail });
  console.error(`${ok ? "ok" : "FAIL"} ${name}`);
  if (!ok && detail) console.error(detail.slice(0, 2000));
}

/**
 * Throws instead of exiting. `runNegativeConformanceChecks` runs inside `bun test`,
 * where `process.exit` would end the whole run before the reporter writes a row.
 */
function finish(): void {
  const failed = steps.filter((step) => !step.ok).map((step) => step.name);
  steps.length = 0;
  if (failed.length > 0) throw new Error(`conformance steps failed: ${failed.join(", ")}`);
}

function readReport(path: string): ReturnType<typeof demonstrateShrinkGap> {
  return JSON.parse(readFileSync(path, "utf8")) as ReturnType<typeof demonstrateShrinkGap>;
}

function replay(path: string): void {
  const absolute = resolve(root, path);
  const saved = readReport(absolute);
  const fresh = demonstrateShrinkGap();
  const same = JSON.stringify(saved) === JSON.stringify(fresh);
  record("shrink-fixture-matches", same, same ? undefined : "fixture drifted from demonstrateShrinkGap()");
  const replayed = replayShrinkReport(saved);
  const failedAgain = replayed.failed && replayed.pathOk && replayed.shrunk === saved.value && saved.value === 1;
  record(
    "shrink-replay-fails",
    failedAgain,
    failedAgain ? undefined : JSON.stringify({ saved: saved.value, replayed }),
  );
  finish();
}

function printShrink(): void {
  process.stdout.write(`${JSON.stringify(demonstrateShrinkGap(), null, 2)}\n`);
}

function copyFixture(rel: string, dest: string): void {
  cpSync(join(root, rel), dest, { recursive: true });
}

function spawn(
  args: string[],
  cwd: string,
  env: Record<string, string | undefined> = process.env,
): { exitCode: number; text: string } {
  const proc = Bun.spawnSync(args, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  return {
    exitCode: proc.exitCode ?? 1,
    text: `${proc.stdout.toString()}\n${proc.stderr.toString()}`,
  };
}

function graphLookup(dir: string, query: string): { exitCode: number; text: string } {
  const project = realpathSync(dir);
  return spawn(
    [
      process.execPath,
      realpathSync(join(root, "tools/graph-query.ts")),
      "--cwd",
      project,
      "--tsconfig",
      "tsconfig.json",
      "--question",
      `Where is ${query} declared?`,
      "--request",
      JSON.stringify({ type: "lookup", query, limit: 5 }),
    ],
    project,
  );
}

/**
 * @evidence docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness The negative runner checks a missing transform, a deleted citation, and an empty graph.
 * @evidenceReview docs/requirements/active/simulation-conformance.md#req-dx01-conformance-harness #f518b31 Re-read the section: those three checks belong to the harness.
 */
export function runNegativeConformanceChecks(): void {
  negative();
}

export function createNegativeWorkspace(base: string): string {
  mkdirSync(join(base, "tmp"), { recursive: true });
  // A previous interrupted process (or a different PID namespace) can reuse a
  // PID. Never remove another invocation's project while its compiler reads it.
  return mkdtempSync(join(base, "tmp", "conformance-negative-"));
}

function negative(): void {
  // macOS /tmp is a symlink of /private/tmp. ttsc rejects a project seen through both.
  const base = realpathSync(root);
  const work = createNegativeWorkspace(base);
  try {
    const preload = join(work, "bun-preload");
    // Copy the package boundary too: this probe needs typia, not the parent
    // repository's lint/evidence plugins and their unrelated host-input proofs.
    copyFixture("fixtures/toolchain/bun-preload", preload);
    const preloadEnv = fixtureEnv();
    // Keep the standalone runtime probe independent of bun test's NODE_ENV.
    delete preloadEnv.NODE_ENV;
    preloadEnv.TTSC_TTSX_BINARY = ttsxLauncherPath(base);
    // Preserve the bounded retry for an unstable upstream host generation.
    // A missing transform fails with a different error and is never retried.
    // Bun's directory-mismatch warning alone is not a failed transform verdict.
    let preloaded = spawn([process.execPath, "src/entry.ts"], preload, preloadEnv);
    let attempts = 1;
    while (
      attempts < 3 &&
      preloaded.exitCode !== 0 &&
      preloaded.text.includes("TtscUnstableGenerationError")
    ) {
      attempts += 1;
      preloaded = spawn([process.execPath, "src/entry.ts"], preload, preloadEnv);
    }
    record(
      "transform-present",
      preloaded.exitCode === 0 && preloaded.text.includes("preload-ok"),
      `attempts=${attempts}\n${preloaded.text.slice(0, 1500)}`,
    );

    const nopreload = join(work, "bun-nopreload");
    copyFixture("fixtures/toolchain/bun-nopreload", nopreload);
    const missingTransform = spawn(
      [process.execPath, join(nopreload, "src/entry.ts")],
      nopreload,
      fixtureEnv(),
    );
    record(
      "transform-missing",
      missingTransform.exitCode !== 0 && /transform|typia/i.test(missingTransform.text),
      missingTransform.text.slice(0, 1500),
    );

    const evidence = join(work, "evidence");
    copyFixture("fixtures/evidence/base", evidence);
    const evidenceOk = runTtsc(["-p", "tsconfig.json", "--noEmit", "--cwd", evidence], evidence);
    record("evidence-present", evidenceOk.exitCode === 0, commandText(evidenceOk).slice(0, 1500));

    const hostPath = join(evidence, "src/host.ts");
    const host = readFileSync(hostPath, "utf8");
    const citation = " * @evidence docs/spec.md#quota Returns the quota this section states, which is 3.\n";
    if (!host.includes(citation)) {
      record("evidence-missing", false, "citation text was not in the copied host");
    } else {
      writeFileSync(hostPath, host.replace(citation, ""));
      const evidenceBad = runTtsc(["-p", "tsconfig.json", "--noEmit", "--cwd", evidence], evidence);
      const body = commandText(evidenceBad);
      record(
        "evidence-missing",
        evidenceBad.exitCode !== 0 && /Missing acknowledgement/.test(body),
        body.slice(0, 1500),
      );
    }

    const graphBase = join(work, "graph-base");
    copyFixture("fixtures/graph/base", graphBase);
    const found = graphLookup(graphBase, "quotaHost");
    record(
      "graph-present",
      found.exitCode === 0 && found.text.includes("quotaHost") && found.text.includes("src/host.ts"),
      found.text.slice(0, 1500),
    );

    const graphEmpty = join(work, "graph-empty");
    copyFixture("fixtures/toolchain/graph-empty", graphEmpty);
    // The shared fixture matches no TypeScript inputs, so ttscgraph exits before lookup.
    // An unrelated source lets this query finish without declaring quoteBudget.
    mkdirSync(join(graphEmpty, "src"), { recursive: true });
    writeFileSync(
      join(graphEmpty, "src", "unrelated.ts"),
      "export function unrelatedHost(): 1 {\n  return 1;\n}\n",
    );
    const missed = graphLookup(graphEmpty, "quoteBudget");
    const declared = /quoteBudget\s+\S+:\d+/.test(missed.text);
    record(
      "graph-missing",
      missed.exitCode === 0 && !declared,
      missed.exitCode === 0 && !declared ? `exit=${missed.exitCode}` : missed.text.slice(0, 1500),
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  finish();
}

function runCli(run: () => void): void {
  try {
    run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (import.meta.main) {
  const command = process.argv[2];
  if (command === "replay") {
    const target = process.argv[3];
    if (!target) {
      console.error("usage: bun tools/conformance.ts replay <fixture>");
      process.exit(2);
    }
    runCli(() => replay(target));
  } else if (command === "print-shrink") {
    printShrink();
  } else if (command === "negative") {
    runCli(runNegativeConformanceChecks);
  } else {
    console.error("usage: bun tools/conformance.ts replay <fixture> | negative | print-shrink");
    process.exit(2);
  }
}
