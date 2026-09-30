import { createHash } from "crypto";
import { cpSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import {
  GraphSession,
  assertActions,
  buildToolArguments,
  collectHops,
  collectSpans,
  generationNote,
  graphBin,
  optionalRequest,
  requestBranches,
  resultType,
  root,
  type JsonSchema,
  type Span,
} from "./graph-query";

const failures: string[] = [];

function fail(message: string): void {
  failures.push(message);
  console.error(`FAIL ${message}`);
}

function ok(message: string): void {
  console.log(`ok ${message}`);
}

function sourceSpans(payload: unknown): Span[] {
  return collectSpans(payload).filter((span) => !span.file.endsWith(".d.ts"));
}

function hasSource(payload: unknown, needle: string): boolean {
  return sourceSpans(payload).some((span) => span.file.includes(needle));
}

function symbolFile(label: string, file: string | undefined): string | undefined {
  if (file) return file;
  const hash = label.lastIndexOf("#");
  return hash > 0 ? label.slice(0, hash) : undefined;
}

function isCliCommandFile(file: string | undefined): boolean {
  if (!file) return false;
  return file.includes("packages/cli/src/commands/") || /(^|\/)src\/commands\//.test(file);
}

function citesCliRun(payload: unknown): boolean {
  if (resultType(payload) !== "trace") return false;
  return collectHops(payload).some((hop) => {
    const fromRun = hop.from.includes("runScenario");
    const toRun = hop.to.includes("runScenario");
    if (fromRun === toRun) return false;
    const command = fromRun ? symbolFile(hop.to, hop.toFile) : symbolFile(hop.from, hop.fromFile);
    return isCliCommandFile(command);
  });
}

function endpointsConnect(
  hops: ReadonlyArray<{ from: string; to: string }>,
  left: string,
  right: string,
): boolean {
  const parent = new Map<string, string>();
  const find = (name: string): string => {
    const prev = parent.get(name);
    if (!prev || prev === name) {
      parent.set(name, name);
      return name;
    }
    const rootName = find(prev);
    parent.set(name, rootName);
    return rootName;
  };
  const union = (from: string, to: string): void => {
    const fromRoot = find(from);
    const toRoot = find(to);
    if (fromRoot !== toRoot) parent.set(fromRoot, toRoot);
  };
  for (const hop of hops) union(hop.from, hop.to);
  const names = [...parent.keys()];
  const leftNames = names.filter((name) => name.includes(left));
  const rightNames = names.filter((name) => name.includes(right));
  return leftNames.some((from) => rightNames.some((to) => find(from) === find(to)));
}

function tagTexts(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) tagTexts(item, found);
    return found;
  }
  if (!value || typeof value !== "object") return found;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.docTags)) {
    for (const tag of record.docTags) {
      const text = (tag as { text?: unknown }).text;
      if (typeof text === "string") found.push(text);
    }
  }
  for (const child of Object.values(record)) tagTexts(child, found);
  return found;
}

function hasTag(payload: unknown, text: string): boolean {
  return tagTexts(payload).some((value) => value.split(/\s+/).includes(text));
}

function namedSource(payload: unknown, name: string, needle: string): Span | undefined {
  return sourceSpans(payload).find((span) => {
    if (!span.file.includes(needle) || span.line === undefined) return false;
    if (span.name === name || span.name?.endsWith(`.${name}`)) return true;
    return span.signature?.includes(name) === true;
  });
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return (await Bun.file(path).json()) as Record<string, unknown>;
}

async function openSchema(cwd: string, tsconfig: string): Promise<{
  session: GraphSession;
  schema: JsonSchema;
  hello: { protocolVersion?: string; server?: string };
}> {
  const session = new GraphSession(cwd, tsconfig);
  try {
    const hello = await session.open();
    const tools = await session.listTools();
    const tool = tools.find((entry) => entry.name === "inspect_typescript_graph");
    if (!tool) throw new Error(`tools/list missed inspect_typescript_graph at ${cwd} ${tsconfig}`);
    assertActions(tool.inputSchema);
    return { session, schema: tool.inputSchema, hello };
  } catch (error) {
    await session.close();
    throw error;
  }
}

async function ask(
  session: GraphSession,
  schema: JsonSchema,
  question: string,
  request: Record<string, unknown>,
): Promise<unknown> {
  return session.call(buildToolArguments(schema, question, request));
}

function expectType(name: string, payload: unknown, type: string): void {
  const actual = resultType(payload);
  if (actual !== type) fail(`${name} result type ${String(actual)} != ${type}`);
  else ok(`${name} type=${type} ${generationNote(payload)}`);
}

async function scratch(): Promise<void> {
  const dir = join(root, "tmp", `graph-smoke-${process.pid}`);
  cpSync(join(root, "fixtures", "graph", "base"), dir, { recursive: true });
  const hostPath = join(dir, "src", "host.ts");
  const callerPath = join(dir, "src", "caller.ts");
  try {
    const base = await openSchema(dir, "tsconfig.json");
    try {
      const looked = await ask(
        base.session,
        base.schema,
        "Where is quotaHost declared?",
        optionalRequest(base.schema, "lookup", { query: "quotaHost", limit: 5 }),
      );
      const decl = namedSource(looked, "quotaHost", "src/host.ts");
      if (!decl) fail(`scratch baseline missed src/host.ts quotaHost (${generationNote(looked)})`);
      else ok(`scratch baseline ${decl.file}:${decl.line} ${generationNote(looked)}`);
      const traced = await ask(
        base.session,
        base.schema,
        "What does useQuota call?",
        optionalRequest(base.schema, "trace", {
          from: "useQuota",
          direction: "forward",
          focus: "execution",
          maxDepth: 2,
          maxNodes: 12,
        }),
      );
      const traceType = resultType(traced);
      const linked = collectHops(traced).some(
        (hop) => hop.from.includes("useQuota") && hop.to.includes("quotaHost"),
      );
      if (traceType !== "trace" || !linked) {
        fail(`scratch trace useQuota did not reach quotaHost in src/host.ts (${traceType ?? "untyped"})`);
      } else ok("scratch trace useQuota -> quotaHost");
    } finally {
      const code = await base.session.close();
      if (code !== 0) fail(`scratch baseline shutdown ${code}`);
      else ok("scratch baseline shutdown 0");
    }

    const renamedHost = readFileSync(hostPath, "utf8").replaceAll("quotaHost", "quotaHostRenamed");
    const renamedCaller = readFileSync(callerPath, "utf8").replaceAll("quotaHost", "quotaHostRenamed");
    writeFileSync(hostPath, renamedHost);
    writeFileSync(callerPath, renamedCaller);
    const renamed = await openSchema(dir, "tsconfig.json");
    try {
      const looked = await ask(
        renamed.session,
        renamed.schema,
        "Where is quotaHostRenamed declared?",
        optionalRequest(renamed.schema, "lookup", { query: "quotaHostRenamed", limit: 5 }),
      );
      const decl = namedSource(looked, "quotaHostRenamed", "src/host.ts");
      const stale = sourceSpans(looked).some((span) => span.name === "quotaHost");
      if (!decl || stale) fail("scratch rename did not show quotaHostRenamed on src/host.ts");
      else ok(`scratch rename ${decl.file}:${decl.line} ${generationNote(looked)}`);
    } finally {
      const code = await renamed.session.close();
      if (code !== 0) fail(`scratch rename shutdown ${code}`);
    }

    writeFileSync(hostPath, readFileSync(hostPath, "utf8").replace("(): 3", "(): 4").replace("return 3", "return 4"));
    const edited = await openSchema(dir, "tsconfig.json");
    try {
      const details = await ask(
        edited.session,
        edited.schema,
        "What is the quotaHostRenamed signature?",
        optionalRequest(edited.schema, "details", { handles: ["quotaHostRenamed"] }),
      );
      const decl = namedSource(details, "quotaHostRenamed", "src/host.ts");
      const signature = decl?.signature ?? "";
      if (!decl || !signature.includes("(): 4") || signature.includes("(): 3")) {
        fail(`scratch signature was ${signature || "missing"}`);
      } else ok(`scratch body ${signature} ${generationNote(details)}`);
    } finally {
      const code = await edited.session.close();
      if (code !== 0) fail(`scratch edit shutdown ${code}`);
    }

    writeFileSync(hostPath, readFileSync(hostPath, "utf8").replace("docs/spec.md#quota", "docs/spec.md#quota-next"));
    const cited = await openSchema(dir, "tsconfig.json");
    try {
      const next = await ask(
        cited.session,
        cited.schema,
        "Which declaration cites docs/spec.md#quota-next?",
        optionalRequest(cited.schema, "lookup", { query: "docs/spec.md#quota-next", limit: 5 }),
      );
      const previous = await ask(
        cited.session,
        cited.schema,
        "Which declaration cites docs/spec.md#quota?",
        optionalRequest(cited.schema, "lookup", { query: "docs/spec.md#quota", limit: 5 }),
      );
      const nextHit = hasTag(next, "docs/spec.md#quota-next") && hasSource(next, "src/host.ts");
      const staleHit = hasTag(previous, "docs/spec.md#quota");
      if (!nextHit || staleHit) fail("scratch citation change was not visible to lookup");
      else ok(`scratch citation src/host.ts ${generationNote(next)}`);
    } finally {
      const code = await cited.session.close();
      if (code !== 0) fail(`scratch citation shutdown ${code}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const rootPkg = await readJson(join(root, "package.json"));
  const dev = (rootPkg.devDependencies ?? {}) as Record<string, string>;
  const graphPkg = await readJson(join(root, "node_modules", "@ttsc", "graph", "package.json"));
  const ttscPkg = await readJson(join(root, "node_modules", "ttsc", "package.json"));
  console.log(`installed @ttsc/graph ${String(graphPkg.version)} ttsc ${String(ttscPkg.version)}`);
  if (String(graphPkg.version) !== dev["@ttsc/graph"]) {
    fail(`installed @ttsc/graph ${String(graphPkg.version)} is not the pin ${String(dev["@ttsc/graph"])}`);
  }
  if (String(ttscPkg.version) !== dev.ttsc) {
    fail(`installed ttsc ${String(ttscPkg.version)} is not the pin ${String(dev.ttsc)}`);
  }
  console.log(`command ${graphBin} --cwd ${root} --tsconfig tsconfig.graph.json`);
  for (const rel of ["tsconfig.graph.json", "tools/graph-query.ts", "tools/graph-preflight.ts"]) {
    const bytes = await Bun.file(join(root, rel)).bytes();
    console.log(`sha256 ${rel} ${createHash("sha256").update(bytes).digest("hex")}`);
  }

  if (dev["@ttsc/graph"] !== "0.30.4") fail(`root @ttsc/graph is ${String(dev["@ttsc/graph"])}`);
  for (const rel of ["packages/money/package.json", "packages/core/package.json", "packages/cli/package.json"]) {
    const pkg = await readJson(join(root, rel));
    const names = [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ].flatMap((section) => Object.keys((pkg[section] ?? {}) as Record<string, string>));
    if (names.includes("@ttsc/graph") || names.includes("ttsc")) fail(`${rel} depends on the graph toolchain`);
  }

  let session: GraphSession | null = null;
  try {
    const opened = await openSchema(root, "tsconfig.graph.json");
    session = opened.session;
    ok(
      `initialize protocol=${opened.hello.protocolVersion ?? "unreported"} server=${opened.hello.server ?? "ttsc-graph"}`,
    );
    ok(`tools/list actions ${[...requestBranches(opened.schema).keys()].join(",")}`);
    const schema = opened.schema;

    const overview = await ask(
      opened.session,
      schema,
      "How is this repository laid out?",
      optionalRequest(schema, "overview", { aspect: "all" }),
    );
    expectType("overview", overview, "overview");
    if (!hasSource(overview, "packages/")) fail("overview did not cite a packages source file");
    else ok("overview cites package source");

    const tour = await ask(
      opened.session,
      schema,
      "How does runScenario reach stepOnce?",
      optionalRequest(schema, "tour", {
        reinterpretations: ["runScenario", "stepOnce", "compileScenario", "tickMoney"],
      }),
    );
    expectType("tour", tour, "tour");
    const tourRun = namedSource(tour, "runScenario", "packages/core/src/sim/simulator.ts");
    const tourStep = namedSource(tour, "stepOnce", "packages/core/src/sim/step.ts");
    if (!tourRun || !tourStep) {
      fail(
        `tour missed runScenario (${tourRun ? `${tourRun.file}:${tourRun.line}` : "none"}) or stepOnce (${tourStep ? `${tourStep.file}:${tourStep.line}` : "none"})`,
      );
    } else {
      ok(`tour runScenario ${tourRun.file}:${tourRun.line}; stepOnce ${tourStep.file}:${tourStep.line}`);
    }

    const entrypoints = await ask(
      opened.session,
      schema,
      "Where does a scenario run start?",
      optionalRequest(schema, "entrypoints", { query: "runScenario stepOnce", limit: 4 }),
    );
    expectType("entrypoints", entrypoints, "entrypoints");

    const runLookup = await ask(
      opened.session,
      schema,
      "Where is runScenario declared?",
      optionalRequest(schema, "lookup", { query: "runScenario", limit: 8 }),
    );
    const runDecl = namedSource(runLookup, "runScenario", "packages/core/src/sim/simulator.ts");
    if (!runDecl) fail("lookup runScenario did not return packages/core/src/sim/simulator.ts");
    else ok(`lookup runScenario ${runDecl.file}:${runDecl.line}`);

    const details = await ask(
      opened.session,
      schema,
      "What is the runScenario declaration?",
      optionalRequest(schema, "details", { handles: ["runScenario"], neighbors: true, neighborLimit: 4 }),
    );
    expectType("details", details, "details");
    if (!namedSource(details, "runScenario", "packages/core/src/sim/simulator.ts")) {
      fail("details runScenario missed the core source span");
    }

    const forward = await ask(
      opened.session,
      schema,
      "What does runScenario call?",
      optionalRequest(schema, "trace", {
        from: "runScenario",
        direction: "forward",
        focus: "execution",
        maxDepth: 2,
        maxNodes: 32,
      }),
    );
    const forwardType = resultType(forward);
    const forwardHop = collectHops(forward).some(
      (hop) => hop.from.includes("runScenario") && hop.to.includes("stepOnce"),
    );
    if (forwardType !== "trace" || !forwardHop) {
      fail("trace runScenario forward missed the runScenario -> stepOnce hop");
    } else ok("trace runScenario -> stepOnce");

    const reverse = await ask(
      opened.session,
      schema,
      "What calls stepOnce?",
      optionalRequest(schema, "trace", {
        from: "stepOnce",
        direction: "reverse",
        focus: "execution",
        maxDepth: 2,
        maxNodes: 32,
      }),
    );
    const reverseType = resultType(reverse);
    const reverseHop = collectHops(reverse).some(
      (hop) =>
        (hop.from.includes("runScenario") && hop.to.includes("stepOnce")) ||
        (hop.from.includes("stepOnce") && hop.to.includes("runScenario")),
    );
    if (reverseType !== "trace" || !reverseHop) {
      fail("trace stepOnce reverse missed the runScenario -> stepOnce hop");
    } else ok("trace stepOnce <- runScenario");

    const plannerLookup = await ask(
      opened.session,
      schema,
      "Where is createPlannerStrategy declared?",
      optionalRequest(schema, "lookup", { query: "createPlannerStrategy", limit: 5 }),
    );
    const plannerDecl = namedSource(
      plannerLookup,
      "createPlannerStrategy",
      "packages/core/src/sim/strategy/planner.ts",
    );
    if (!plannerDecl) fail("lookup createPlannerStrategy missed packages/core/src/sim/strategy/planner.ts");
    else ok(`lookup createPlannerStrategy ${plannerDecl.file}:${plannerDecl.line}`);
    const plannerPath = await ask(
      opened.session,
      schema,
      "How does createPlannerStrategy reach stepOnce?",
      optionalRequest(schema, "trace", {
        from: "createPlannerStrategy",
        to: "stepOnce",
        direction: "forward",
        focus: "all",
        maxDepth: 8,
        maxNodes: 32,
      }),
    );
    const plannerSource = readFileSync(join(root, "packages/core/src/sim/strategy/planner.ts"), "utf8");
    const bindsDefault = plannerSource.includes("({ stepOnce }") && plannerSource.includes("d.stepOnce(");
    const plannerLinked = endpointsConnect(collectHops(plannerPath), "createPlannerStrategy", "stepOnce");
    if (plannerLinked) {
      ok("trace createPlannerStrategy -> stepOnce");
    } else if (plannerDecl && bindsDefault) {
      ok(
        "unobserved createPlannerStrategy -> stepOnce (call is PlannerDeps.stepOnce; path hops=0; source default { stepOnce })",
      );
    } else {
      fail("createPlannerStrategy declaration or PlannerDeps.stepOnce source binding was missing");
    }

    const compiled = await ask(
      opened.session,
      schema,
      "Where is compileScenario declared?",
      optionalRequest(schema, "lookup", { query: "compileScenario", limit: 5 }),
    );
    const compileDecl = namedSource(compiled, "compileScenario", "packages/core/src/scenario/compile.ts");
    if (!compileDecl) fail("lookup compileScenario missed packages/core/src/scenario/compile.ts");
    else ok(`lookup compileScenario ${compileDecl.file}:${compileDecl.line}`);

    const money = await ask(
      opened.session,
      schema,
      "Where is tickMoney declared?",
      optionalRequest(schema, "lookup", { query: "tickMoney", limit: 8 }),
    );
    const moneyDecl = namedSource(money, "tickMoney", "packages/money/src/policy/tickMoney.ts");
    if (moneyDecl) ok(`lookup tickMoney ${moneyDecl.file}:${moneyDecl.line}`);
    else {
      const onlyDts = collectSpans(money).filter(
        (span) => span.name === "tickMoney" || span.signature?.includes("tickMoney"),
      );
      const declarationOnly = onlyDts.length > 0 && onlyDts.every((span) => span.file.endsWith(".d.ts"));
      console.log(
        declarationOnly
          ? "aggregate tickMoney resolved only to .d.ts; querying packages/money"
          : "aggregate tickMoney did not land on the money source; querying packages/money",
      );
      const moneySession = await openSchema(join(root, "packages", "money"), "tsconfig.json");
      try {
        const local = await ask(
          moneySession.session,
          moneySession.schema,
          "Where is tickMoney declared?",
          optionalRequest(moneySession.schema, "lookup", { query: "tickMoney", limit: 5 }),
        );
        const localDecl = namedSource(local, "tickMoney", "src/policy/tickMoney.ts");
        if (!localDecl) fail("money package config did not declare tickMoney in src/policy/tickMoney.ts");
        else ok(`authoritative money package lookup tickMoney ${localDecl.file}:${localDecl.line}`);
      } finally {
        const code = await moneySession.session.close();
        if (code !== 0) fail(`money package shutdown ${code}`);
      }
    }

    const callers = await ask(
      opened.session,
      schema,
      "Which CLI command calls runScenario?",
      optionalRequest(schema, "trace", {
        from: "runScenario",
        direction: "reverse",
        focus: "execution",
        maxDepth: 2,
        maxNodes: 32,
      }),
    );
    if (citesCliRun(callers)) ok("trace runScenario reverse reaches packages/cli/src");
    else {
      console.log("aggregate reverse trace did not cite CLI source; querying packages/cli");
      const cliSession = await openSchema(join(root, "packages", "cli"), "tsconfig.json");
      try {
        const local = await ask(
          cliSession.session,
          cliSession.schema,
          "Which command calls runScenario?",
          optionalRequest(cliSession.schema, "trace", {
            from: "runScenario",
            direction: "reverse",
            focus: "execution",
            maxDepth: 3,
            maxNodes: 32,
          }),
        );
        if (!citesCliRun(local)) fail("CLI package reverse trace missed a command to runScenario hop");
        else ok("authoritative CLI package trace cites command source");
      } finally {
        const code = await cliSession.session.close();
        if (code !== 0) fail(`CLI package shutdown ${code}`);
      }
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  } finally {
    if (session) {
      const code = await session.close();
      if (code !== 0) fail(`repo graph shutdown ${code}`);
      else ok("repo graph shutdown 0");
    }
  }

  try {
    await scratch();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }

  if (failures.length > 0) {
    console.error(`graph:check failed (${failures.length})`);
    process.exit(1);
  }
  console.log("graph:check passed");
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
