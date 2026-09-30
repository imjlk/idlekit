import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "fs";
import { join, relative } from "path";
import { createTempDir, sha256Hex, writeText } from "./_bun";
import {
  assertTtscArgv,
  fixtureEnv,
  graphBin,
  inspectToolchain,
  root,
  runCommand,
  ttscBin,
  type CommandResult,
} from "./toolchain-host";

type Step = {
  name: string;
  expected: "zero" | "nonzero";
  command: string;
  exitCode: number;
  ok: boolean;
  detail?: string;
};

const steps: Step[] = [];

function textOf(result: CommandResult): string {
  return `${result.stdout}\n${result.stderr}`;
}

function record(name: string, expected: "zero" | "nonzero", result: CommandResult, ok: boolean, detail?: string): void {
  steps.push({ name, expected, command: result.command, exitCode: result.exitCode, ok, detail });
  const mark = ok ? "ok" : "FAIL";
  console.error(`${mark} ${name} exit=${result.exitCode}`);
  if (!ok) {
    console.error(detail ?? textOf(result).slice(0, 2000));
  }
}

function expectZero(name: string, result: CommandResult, extra?: (text: string) => string | undefined): void {
  const problem = result.exitCode !== 0
    ? `expected exit 0\n${textOf(result).slice(0, 1500)}`
    : extra?.(textOf(result));
  record(name, "zero", result, problem === undefined, problem);
}

function expectNonZero(name: string, result: CommandResult, marker: string): void {
  const body = textOf(result);
  const ok = result.exitCode !== 0 && body.includes(marker);
  const detail = ok
    ? undefined
    : `expected nonzero and ${marker}, got exit ${result.exitCode}`;
  record(name, "nonzero", result, ok, detail ?? body.slice(0, 500));
}

function ttsc(args: string[], cwd: string, cacheDir?: string): CommandResult {
  const full = [ttscBin, ...args];
  assertTtscArgv(full);
  return runCommand(full, { cwd, env: fixtureEnv(cacheDir) });
}

function hashTree(dir: string): string {
  const files: string[] = [];
  const walk = (current: string) => {
    for (const name of readdirSync(current)) {
      const path = join(current, name);
      const stat = statSync(path);
      if (stat.isDirectory()) walk(path);
      else files.push(path);
    }
  };
  walk(dir);
  files.sort();
  return sha256Hex(files.map((path) => `${relative(dir, path)}\n${readFileSync(path)}`).join("\n"));
}

async function mcp(
  cwd: string,
  messages: Array<{ id?: number; method: string; params?: unknown }>,
): Promise<{ responses: unknown[]; stderr: string }> {
  const proc = Bun.spawn([graphBin, "--cwd", cwd, "--tsconfig", "tsconfig.json"], {
    cwd,
    env: fixtureEnv(),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const responses: unknown[] = [];
  const wanted = new Set(messages.flatMap((message) => (message.id === undefined ? [] : [message.id])));

  const readMatching = async (deadline: number) => {
    while (responses.length < wanted.size) {
      const newline = buffer.indexOf("\n");
      if (newline === -1) {
        if (Date.now() > deadline) {
          throw new Error(`graph MCP timed out after ${responses.length}/${wanted.size} responses\n${buffer.slice(0, 500)}`);
        }
        const chunk = await reader.read();
        if (chunk.done) throw new Error(`graph MCP stdout closed\n${buffer}`);
        buffer += decoder.decode(chunk.value);
        continue;
      }
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      if (line.trim() === "") continue;
      const parsed = JSON.parse(line) as { id?: number };
      if (parsed.id !== undefined && wanted.has(parsed.id)) responses.push(parsed);
    }
  };

  try {
    for (const message of messages) {
      const payload = message.id === undefined
        ? { jsonrpc: "2.0", method: message.method, params: message.params }
        : { jsonrpc: "2.0", id: message.id, method: message.method, params: message.params };
      proc.stdin.write(`${JSON.stringify(payload)}\n`);
    }
    await readMatching(Date.now() + 600_000);
  } finally {
    proc.kill();
    await proc.exited;
  }
  return { responses, stderr: await new Response(proc.stderr).text() };
}

function graphArgs(question: string, request: Record<string, unknown>) {
  return {
    question,
    draft: { reason: "The fixture names the symbol under test.", type: request.type },
    review: "The installed tool schema requires one request.",
    request,
  };
}

async function main(): Promise<void> {
  const doctor = inspectToolchain();
  console.log(JSON.stringify({ doctor }, null, 2));
  if (!doctor.ok) {
    console.error(doctor.failures.join("\n"));
    process.exit(1);
  }

  const cacheDir = await createTempDir("ttsc-cache");
  const cold = ttsc(
    ["prepare", "-p", join(root, "fixtures/toolchain/typia/tsconfig.json"), "--cwd", join(root, "fixtures/toolchain/typia"), "--cache-dir", cacheDir],
    join(root, "fixtures/toolchain/typia"),
    cacheDir,
  );
  const coldText = textOf(cold);
  expectZero("prepare-cold", cold, (text) =>
    text.includes("building source plugin") ? undefined : "cold prepare did not build a source plugin",
  );
  const warm = ttsc(
    ["prepare", "-p", join(root, "fixtures/toolchain/typia/tsconfig.json"), "--cwd", join(root, "fixtures/toolchain/typia"), "--cache-dir", cacheDir],
    join(root, "fixtures/toolchain/typia"),
    cacheDir,
  );
  expectZero("prepare-warm", warm, (text) =>
    text.includes("building source plugin") ? "warm prepare rebuilt a source plugin" : undefined,
  );
  const paths = ttsc(["cache", "paths", "--json", "--cwd", join(root, "fixtures/toolchain/typia"), "--cache-dir", cacheDir], cacheDir, cacheDir);
  expectZero("cache-paths", paths, (text) => {
    if (!text.includes(cacheDir)) return "cache paths did not name the requested cache dir";
    return undefined;
  });

  const compilerDir = join(root, "fixtures/toolchain/compiler");
  expectZero(
    "compiler-ok",
    ttsc(["--noEmit", "-p", join(compilerDir, "tsconfig.json"), "--cwd", compilerDir, "--cache-dir", cacheDir], compilerDir, cacheDir),
  );
  expectNonZero(
    "compiler-bad",
    ttsc(["--noEmit", "-p", join(compilerDir, "tsconfig.bad.json"), "--cwd", compilerDir, "--cache-dir", cacheDir], compilerDir, cacheDir),
    "error",
  );

  const typiaDir = join(root, "fixtures/toolchain/typia");
  const typiaOut = await createTempDir("typia-out");
  expectZero(
    "typia-check",
    ttsc(["--noEmit", "-p", join(typiaDir, "tsconfig.json"), "--cwd", typiaDir, "--cache-dir", cacheDir], typiaDir, cacheDir),
  );
  expectZero(
    "typia-emit",
    ttsc(["--emit", "-p", join(typiaDir, "tsconfig.json"), "--cwd", typiaDir, "--outDir", typiaOut, "--cache-dir", cacheDir], typiaDir, cacheDir),
  );
  const typiaJs = join(typiaOut, "run.js");
  const typiaRun = runCommand([process.execPath, typiaJs], { cwd: typiaDir, env: fixtureEnv(cacheDir) });
  expectZero("typia-run", typiaRun, (text) => (text.includes("typia-ok") ? undefined : "transformed validator did not accept and reject"));
  const typiaRaw = runCommand([process.execPath, join(typiaDir, "src/run.ts")], {
    cwd: join(root, "fixtures/toolchain/bun-nopreload"),
    env: fixtureEnv(cacheDir),
  });
  expectNonZero("typia-no-transform", typiaRaw, "transform");

  const evidenceDir = join(root, "fixtures/toolchain/evidence");
  expectZero(
    "evidence-check",
    ttsc(["--noEmit", "-p", join(evidenceDir, "tsconfig.json"), "--cwd", evidenceDir, "--cache-dir", cacheDir], evidenceDir, cacheDir),
  );
  const evidenceTest = runCommand([process.execPath, "test", join(evidenceDir, "src/quotaHost.test.ts")], {
    cwd: evidenceDir,
    env: fixtureEnv(cacheDir),
  });
  expectZero("evidence-test", evidenceTest);
  const brokenEvidence = await createTempDir("evidence-broken");
  cpSync(evidenceDir, brokenEvidence, { recursive: true });
  for (const file of [join(brokenEvidence, "src/quotaHost.ts"), join(brokenEvidence, "src/quotaHost.test.ts")]) {
    await writeText(file, readFileSync(file, "utf8").replaceAll(/@evidence\s+/g, ""));
  }
  expectNonZero(
    "evidence-missing",
    ttsc(["--noEmit", "-p", join(brokenEvidence, "tsconfig.json"), "--cwd", brokenEvidence, "--cache-dir", cacheDir], brokenEvidence, cacheDir),
    "[evidence/graph]",
  );

  const graphDir = join(root, "fixtures/toolchain/graph");
  const graphEmpty = join(root, "fixtures/toolchain/graph-empty");
  let graphOk = false;
  let graphDetail = "";
  try {
    const positive = await mcp(graphDir, [
      {
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "idlekit-toolchain-smoke", version: "0.0.0" },
        },
      },
      { method: "notifications/initialized" },
      { id: 2, method: "tools/list" },
      {
        id: 3,
        method: "tools/call",
        params: {
          name: "inspect_typescript_graph",
          arguments: graphArgs("Where is quoteBudget declared?", { type: "lookup", query: "quoteBudget" }),
        },
      },
      {
        id: 4,
        method: "tools/call",
        params: {
          name: "inspect_typescript_graph",
          arguments: graphArgs("What calls quoteBudget?", {
            type: "trace",
            from: "quoteBudget",
            direction: "reverse",
            focus: "execution",
          }),
        },
      },
    ]);
    const body = JSON.stringify(positive.responses);
    const listed = body.includes("inspect_typescript_graph");
    const found = body.includes("quoteBudget") && body.includes("useQuote");
    graphOk = listed && found && !body.includes('"error"');
    graphDetail = graphOk ? "" : body.slice(0, 2000);
  } catch (error) {
    graphDetail = error instanceof Error ? error.message : String(error);
  }
  steps.push({
    name: "graph-mcp",
    expected: "zero",
    command: `${graphBin} --cwd ${graphDir} --tsconfig tsconfig.json`,
    exitCode: graphOk ? 0 : 1,
    ok: graphOk,
    detail: graphDetail,
  });
  console.error(`${graphOk ? "ok" : "FAIL"} graph-mcp`);

  let mismatchOk = false;
  let mismatchDetail = "";
  try {
    const mismatch = await mcp(graphDir, [
      {
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "1999-01-01",
          capabilities: {},
          clientInfo: { name: "idlekit-toolchain-smoke", version: "0.0.0" },
        },
      },
    ]);
    const body = JSON.stringify(mismatch.responses);
    const acceptedBadVersion = body.includes("1999-01-01");
    const graphPayload = body.includes("quoteBudget") || body.includes("useQuote");
    mismatchOk = !acceptedBadVersion && !graphPayload;
    mismatchDetail = mismatchOk
      ? "server negotiated its own protocol and returned no graph payload"
      : body.slice(0, 1000);
  } catch (error) {
    mismatchOk = true;
    mismatchDetail = error instanceof Error ? error.message : String(error);
  }
  steps.push({
    name: "graph-protocol-mismatch",
    expected: "nonzero",
    command: `${graphBin} initialize protocolVersion=1999-01-01`,
    exitCode: mismatchOk ? 1 : 0,
    ok: mismatchOk,
    detail: mismatchDetail,
  });
  console.error(`${mismatchOk ? "ok" : "FAIL"} graph-protocol-mismatch`);

  let emptyOk = false;
  let emptyDetail = "";
  try {
    const empty = await mcp(graphEmpty, [
      {
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "idlekit-toolchain-smoke", version: "0.0.0" },
        },
      },
      { method: "notifications/initialized" },
      {
        id: 2,
        method: "tools/call",
        params: {
          name: "inspect_typescript_graph",
          arguments: graphArgs("Where is quoteBudget declared?", { type: "lookup", query: "quoteBudget" }),
        },
      },
    ]);
    const body = JSON.stringify(empty.responses);
    emptyOk = !body.includes("quoteBudget") || body.includes('"hits":[]') || body.includes("error");
    emptyDetail = emptyOk ? "" : body.slice(0, 1000);
  } catch (error) {
    emptyOk = true;
    emptyDetail = error instanceof Error ? error.message : String(error);
  }
  steps.push({
    name: "graph-empty",
    expected: "nonzero",
    command: `${graphBin} --cwd ${graphEmpty} --tsconfig tsconfig.json`,
    exitCode: emptyOk ? 1 : 0,
    ok: emptyOk,
    detail: emptyDetail,
  });
  console.error(`${emptyOk ? "ok" : "FAIL"} graph-empty`);

  const preloadEnv = fixtureEnv(cacheDir);
  // Bun 1.3.10 has no node:module.registerHooks. A non-.js launcher makes
  // @ttsc/lint spawn ttsx under Node instead of process.execPath.
  preloadEnv.TTSC_TTSX_BINARY = join(root, "tools/ttsx-under-node");
  const preload = runCommand([process.execPath, join(root, "fixtures/toolchain/bun-preload/src/entry.ts")], {
    cwd: join(root, "fixtures/toolchain/bun-preload"),
    env: preloadEnv,
  });
  expectZero("bun-preload", preload, (text) => (text.includes("preload-ok") ? undefined : "preload run did not validate"));
  const nopreload = runCommand([process.execPath, join(root, "fixtures/toolchain/bun-nopreload/src/entry.ts")], {
    cwd: join(root, "fixtures/toolchain/bun-nopreload"),
    env: fixtureEnv(cacheDir),
  });
  expectNonZero("bun-nopreload", nopreload, "transform");

  const emitDir = join(root, "fixtures/toolchain/emit");
  const emitOut = await createTempDir("emit-out");
  expectZero(
    "emit-build",
    ttsc(["--emit", "-p", join(emitDir, "tsconfig.json"), "--cwd", emitDir, "--outDir", emitOut, "--cache-dir", cacheDir], emitDir, cacheDir),
  );
  let emitted = "";
  try {
    emitted = readFileSync(join(emitOut, "main.js"), "utf8");
  } catch (error) {
    emitted = error instanceof Error ? error.message : String(error);
  }
  const emitLeak = /typia\.createValidate|@ttsc\//.test(emitted);
  const emitRun = runCommand([process.execPath, join(emitOut, "main.js")], { cwd: emitOut, env: fixtureEnv(cacheDir) });
  const emitOk = !emitLeak && emitRun.exitCode === 0 && emitRun.stdout.includes("emit-ok");
  steps.push({
    name: "emit-plain-bun",
    expected: "zero",
    command: `${process.execPath} ${join(emitOut, "main.js")}`,
    exitCode: emitOk ? 0 : emitRun.exitCode,
    ok: emitOk,
    detail: emitOk ? undefined : `leak=${emitLeak}\n${textOf(emitRun).slice(0, 1000)}`,
  });
  console.error(`${emitOk ? "ok" : "FAIL"} emit-plain-bun`);

  const tsxDir = join(root, "fixtures/toolchain/tsx");
  const tsxOut = await createTempDir("tsx-out");
  const tsxBuild = ttsc(
    ["--emit", "-p", join(tsxDir, "tsconfig.json"), "--cwd", tsxDir, "--outDir", tsxOut, "--cache-dir", cacheDir],
    tsxDir,
    cacheDir,
  );
  let tsxJs = "";
  if (tsxBuild.exitCode === 0) {
    try {
      tsxJs = readFileSync(join(tsxOut, "card.js"), "utf8");
    } catch (error) {
      tsxJs = error instanceof Error ? error.message : String(error);
    }
  }
  const importsOpentui = tsxJs.includes("@opentui/react");
  const importsReactRuntime = /from\s+["']react\/jsx-(?:dev-)?runtime["']/.test(tsxJs);
  const tsxOk = tsxBuild.exitCode === 0 && importsOpentui && !importsReactRuntime;
  steps.push({
    name: "tsx-opentui",
    expected: "zero",
    command: tsxBuild.command,
    exitCode: tsxOk ? 0 : tsxBuild.exitCode || 1,
    ok: tsxOk,
    detail: tsxOk ? undefined : `${textOf(tsxBuild).slice(0, 1500)}\n${tsxJs.slice(0, 500)}`,
  });
  console.error(`${tsxOk ? "ok" : "FAIL"} tsx-opentui`);

  const inputHash = hashTree(join(root, "fixtures/toolchain"));
  const failed = steps.filter((step) => !step.ok);
  const summary = {
    os: doctor.os,
    arch: doctor.arch,
    bun: doctor.bun,
    node: doctor.node,
    ttsc: doctor.ttscVersion,
    go: doctor.go,
    nativeSha256: doctor.nativeSha256,
    lockfileSha256: doctor.lockfileSha256,
    fixtureHash: inputHash,
    steps,
    failed: failed.map((step) => step.name),
  };
  const reportPath = join(root, "tmp/toolchain-smoke.json");
  mkdirSync(join(root, "tmp"), { recursive: true });
  await writeText(reportPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify({ report: reportPath, failed: summary.failed, fixtureHash: inputHash }, null, 2));
  rmSync(cacheDir, { recursive: true, force: true });
  if (failed.length > 0) process.exit(1);
}

await main();
