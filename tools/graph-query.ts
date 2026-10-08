import { join, resolve } from "path";
import { installedCompilerBin, ttsxLauncherPath } from "./compiler-bin";

export const root = resolve(import.meta.dir, "..");
export const graphBin = installedCompilerBin(root, "ttsc-graph");

const ACTIONS = ["overview", "tour", "entrypoints", "lookup", "details", "trace"] as const;

export type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  const?: unknown;
  enum?: unknown[];
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
};

export type Span = {
  file: string;
  line?: number;
  name?: string;
  kind?: string;
  signature?: string;
};

type RpcResult = {
  protocolVersion?: string;
  serverInfo?: { name?: string; version?: string };
  tools?: Array<{ name: string; inputSchema?: JsonSchema; input_schema?: JsonSchema }>;
  isError?: boolean;
  structuredContent?: unknown;
  content?: Array<{ type?: string; text?: string }>;
};

function graphEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.TTSC_GRAPH_BINARY;
  delete env.TTSC_GO_BINARY;
  env.TTSC_TTSX_BINARY = ttsxLauncherPath(root);
  return env;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function resolveSchema(schema: JsonSchema, rootSchema: JsonSchema): JsonSchema {
  if (!schema.$ref) return schema;
  const match = /^#\/\$defs\/(.+)$/.exec(schema.$ref);
  const target = match ? rootSchema.$defs?.[match[1]] : undefined;
  if (!target) throw new Error(`live schema $ref ${schema.$ref} did not resolve`);
  return target;
}

function branchesOf(schema: JsonSchema | undefined, rootSchema: JsonSchema): JsonSchema[] {
  if (!schema) return [];
  const resolved = resolveSchema(schema, rootSchema);
  if (resolved.anyOf) return resolved.anyOf.flatMap((entry) => branchesOf(entry, rootSchema));
  if (resolved.oneOf) return resolved.oneOf.flatMap((entry) => branchesOf(entry, rootSchema));
  if (resolved.allOf) {
    const merged: JsonSchema = { properties: {}, required: [] };
    for (const entry of resolved.allOf.flatMap((item) => branchesOf(item, rootSchema))) {
      Object.assign(merged.properties ?? {}, entry.properties);
      merged.required = [...(merged.required ?? []), ...(entry.required ?? [])];
    }
    return [merged];
  }
  return [resolved];
}

function branchName(branch: JsonSchema): string | undefined {
  const typeSchema = branch.properties?.type;
  if (typeof typeSchema?.const === "string") return typeSchema.const;
  if (typeSchema?.enum?.length === 1 && typeof typeSchema.enum[0] === "string") return typeSchema.enum[0];
  return undefined;
}

export function requestBranches(schema: JsonSchema): Map<string, JsonSchema> {
  const found = new Map<string, JsonSchema>();
  for (const branch of branchesOf(schema.properties?.request, schema)) {
    const name = branchName(branch);
    if (name) found.set(name, branch);
  }
  return found;
}

function schemaProperty(schema: JsonSchema, key: string): JsonSchema | undefined {
  const direct = schema.properties?.[key];
  if (!direct) return undefined;
  return resolveSchema(direct, schema);
}

export function assertActions(schema: JsonSchema): string[] {
  const branches = requestBranches(schema);
  const missing = ACTIONS.filter((action) => !branches.has(action));
  if (missing.length > 0) {
    throw new Error(
      `live schema is missing ${missing.join(", ")} (have ${[...branches.keys()].join(", ") || "none"})`,
    );
  }
  const top = schema.properties ?? {};
  for (const key of schema.required ?? []) {
    if (!top[key]) throw new Error(`live schema requires ${key} but published no ${key} property`);
  }
  return [...branches.keys()];
}

export function optionalRequest(
  schema: JsonSchema,
  type: string,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const branch = requestBranches(schema).get(type);
  if (!branch) throw new Error(`live schema has no ${type} request`);
  const props = branch.properties ?? {};
  const request: Record<string, unknown> = { type };
  for (const [key, value] of Object.entries(fields)) {
    if (props[key]) request[key] = value;
  }
  for (const key of branch.required ?? []) {
    if (request[key] === undefined) {
      throw new Error(`live schema requires ${type}.${key}; this call did not have a value from tools/list`);
    }
  }
  return request;
}

export function buildToolArguments(
  schema: JsonSchema,
  question: string,
  request: Record<string, unknown>,
): Record<string, unknown> {
  const type = request.type;
  if (typeof type !== "string") throw new Error("request.type is missing");
  const branch = requestBranches(schema).get(type);
  if (!branch) {
    throw new Error(
      `request.type ${type} is not in the live schema (${[...requestBranches(schema).keys()].join(", ")})`,
    );
  }
  const allowed = new Set(Object.keys(branch.properties ?? {}));
  for (const key of Object.keys(request)) {
    if (!allowed.has(key)) throw new Error(`request.${key} is not a live schema field for ${type}`);
  }
  for (const key of branch.required ?? []) {
    if (request[key] === undefined) throw new Error(`request.${key} is required by the live schema for ${type}`);
  }

  const args: Record<string, unknown> = {};
  if (schemaProperty(schema, "question")) args.question = question;
  const draftSchema = schemaProperty(schema, "draft");
  if (draftSchema) {
    const draftProps = draftSchema.properties ?? {};
    const draft: Record<string, unknown> = {};
    if (draftProps.reason) draft.reason = `The question is answered by one ${type} request.`;
    if (draftProps.type) draft.type = type;
    for (const key of draftSchema.required ?? []) {
      if (draft[key] === undefined) throw new Error(`draft.${key} is required and the live schema gave no value`);
    }
    args.draft = draft;
  }
  if (schemaProperty(schema, "review")) args.review = "The draft matches the live request branch.";
  if (!schemaProperty(schema, "request")) throw new Error("live schema has no request property");
  args.request = request;
  for (const key of schema.required ?? []) {
    if (args[key] === undefined) throw new Error(`missing live required field ${key}`);
  }
  return args;
}

export function unwrapToolResult(result: unknown): unknown {
  const record = asRecord(result);
  if (record.isError === true) {
    const text = Array.isArray(record.content)
      ? record.content.map((entry) => asRecord(entry).text ?? "").join("\n")
      : "";
    throw new Error(text || "inspect_typescript_graph returned an error");
  }
  if (record.structuredContent && typeof record.structuredContent === "object") return record.structuredContent;
  if (Array.isArray(record.content)) {
    const text = record.content.map((entry) => String(asRecord(entry).text ?? "")).join("\n");
    if (text.startsWith("{") || text.startsWith("[")) return JSON.parse(text) as unknown;
  }
  return result;
}

export function collectSpans(value: unknown, spans: Span[] = []): Span[] {
  if (Array.isArray(value)) {
    for (const item of value) collectSpans(item, spans);
    return spans;
  }
  if (!value || typeof value !== "object") return spans;
  const record = asRecord(value);
  if (typeof record.file === "string") {
    const line = typeof record.line === "number"
      ? record.line
      : typeof record.startLine === "number"
        ? record.startLine
        : undefined;
    spans.push({
      file: record.file,
      line,
      name: typeof record.name === "string" ? record.name : undefined,
      kind: typeof record.kind === "string" ? record.kind : undefined,
      signature: typeof record.signature === "string" ? record.signature : undefined,
    });
  }
  for (const child of Object.values(record)) collectSpans(child, spans);
  return spans;
}

export function resultType(payload: unknown): string | undefined {
  const record = asRecord(payload);
  const nested = asRecord(record.result);
  if (typeof nested.type === "string") return nested.type;
  if (typeof record.type === "string") return record.type;
  return undefined;
}

const GENERATION_KEYS = ["snapshot", "snapshotId", "generation", "generationId", "revision"];

export function generationNote(payload: unknown): string {
  const found: string[] = [];
  const walk = (value: unknown, depth: number) => {
    if (depth > 3 || !value || typeof value !== "object" || Array.isArray(value)) return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (GENERATION_KEYS.includes(key) && (typeof child === "string" || typeof child === "number")) {
        found.push(`${key}`);
      } else if (depth < 2) {
        walk(child, depth + 1);
      }
    }
  };
  walk(payload, 0);
  return found.length > 0 ? `generation fields: ${found.join(", ")}` : "no generation identifier";
}

export type TraceHop = {
  from: string;
  to: string;
  fromFile?: string;
  toFile?: string;
};

function endpointLabel(value: unknown): { name?: string; file?: string } {
  if (typeof value === "string") return { name: value };
  if (!value || typeof value !== "object") return {};
  const record = value as { name?: unknown; file?: unknown };
  return {
    name: typeof record.name === "string" ? record.name : undefined,
    file: typeof record.file === "string" ? record.file : undefined,
  };
}

/** Hop edges use symbol names. Opaque node ids are left out. */
export function collectHops(value: unknown, found: TraceHop[] = []): TraceHop[] {
  if (Array.isArray(value)) {
    for (const item of value) collectHops(item, found);
    return found;
  }
  if (!value || typeof value !== "object") return found;
  const record = value as Record<string, unknown>;
  const from = endpointLabel(record.from);
  const to = endpointLabel(record.to);
  if (from.name && to.name) {
    found.push({ from: from.name, to: to.name, fromFile: from.file, toFile: to.file });
  }
  for (const child of Object.values(record)) collectHops(child, found);
  return found;
}

export function summarize(payload: unknown): string {
  const lines = collectSpans(payload)
    .filter((span) => span.name || span.line !== undefined)
    .slice(0, 40)
    .map((span) => {
      const location = `${span.name ?? "(span)"} ${span.file}:${span.line ?? "?"}`;
      return span.signature ? `${location} ${span.signature}` : location;
    });
  const hops = collectHops(payload)
    .slice(0, 40)
    .map((hop) => `${hop.from} -> ${hop.to}`);
  return [`type=${resultType(payload) ?? "unknown"}`, generationNote(payload), ...lines, ...hops].join("\n");
}

function readWithDeadline(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("graph MCP read timed out")), timeoutMs);
  });
  return Promise.race([reader.read(), timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

export class GraphSession {
  readonly cwd: string;
  private proc: ReturnType<typeof Bun.spawn> | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private buffer = "";
  // A chunk can end inside a UTF-8 sequence. The tail carries over to the next read.
  private readonly decoder = new TextDecoder();
  private nextId = 1;
  private stderr = "";

  constructor(
    cwd: string,
    readonly tsconfig: string,
  ) {
    this.cwd = resolve(cwd);
  }

  private stderrTail(): string {
    return this.stderr.slice(-1500);
  }

  private async collectStderr(): Promise<void> {
    const proc = this.proc;
    if (!proc) return;
    const reader = proc.stderr.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        this.stderr += decoder.decode(chunk.value, { stream: true });
        if (this.stderr.length > 8000) this.stderr = this.stderr.slice(-4000);
      }
    } catch {
      // The process closes stderr on shutdown.
    }
  }

  private async send(payload: unknown): Promise<void> {
    const proc = this.proc;
    if (!proc) throw new Error("graph server is not running");
    proc.stdin.write(`${JSON.stringify(payload)}\n`);
    await proc.stdin.flush();
  }

  private async readResponse(id: number, deadline: number): Promise<unknown> {
    while (true) {
      const newline = this.buffer.indexOf("\n");
      if (newline === -1) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          this.proc?.kill();
          throw new Error(`graph MCP timed out waiting for id ${id}\n${this.stderrTail()}`);
        }
        if (!this.reader) throw new Error("graph stdout is closed");
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await readWithDeadline(this.reader, remaining);
        } catch (error) {
          this.proc?.kill();
          throw error;
        }
        if (chunk.done) {
          throw new Error(
            `graph MCP stdout closed waiting for id ${id}\n${this.stderrTail()}\n${this.buffer.slice(0, 400)}`,
          );
        }
        this.buffer += this.decoder.decode(chunk.value, { stream: true });
        continue;
      }
      const line = this.buffer.slice(0, newline).replace(/\r$/, "");
      this.buffer = this.buffer.slice(newline + 1);
      if (line.trim() === "") continue;
      let parsed: { id?: number; error?: { message?: string }; result?: unknown };
      try {
        parsed = JSON.parse(line) as { id?: number; error?: { message?: string }; result?: unknown };
      } catch {
        throw new Error(`graph MCP emitted non-JSON: ${line.slice(0, 200)}`);
      }
      if (parsed.id !== id) continue;
      if (parsed.error) throw new Error(parsed.error.message ?? `graph MCP error id ${id}`);
      return parsed.result;
    }
  }

  private async rpc(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    const id = this.nextId;
    this.nextId += 1;
    await this.send({ jsonrpc: "2.0", id, method, params });
    return this.readResponse(id, Date.now() + timeoutMs);
  }

  async open(): Promise<{ protocolVersion?: string; server?: string }> {
    if (graphBin !== installedCompilerBin(root, "ttsc-graph")) {
      throw new Error(`refusing non-ttsc-graph command: ${graphBin}`);
    }
    this.proc = Bun.spawn([graphBin, "--cwd", this.cwd, "--tsconfig", this.tsconfig], {
      cwd: this.cwd,
      env: graphEnv(),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    this.reader = this.proc.stdout.getReader();
    void this.collectStderr();
    const init = (await this.rpc(
      "initialize",
      {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "idlekit-graph", version: "0.0.0" },
      },
      60_000,
    )) as RpcResult;
    if (init.protocolVersion !== "2025-11-25") {
      this.proc?.kill();
      throw new Error(
        `graph MCP protocol ${init.protocolVersion ?? "missing"} is not 2025-11-25\n${this.stderrTail()}`,
      );
    }
    await this.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    const server = init.serverInfo
      ? `${init.serverInfo.name ?? ""} ${init.serverInfo.version ?? ""}`.trim()
      : undefined;
    return { protocolVersion: init.protocolVersion, server };
  }

  async listTools(): Promise<Array<{ name: string; inputSchema: JsonSchema }>> {
    const result = (await this.rpc("tools/list", {}, 60_000)) as RpcResult;
    return (result.tools ?? []).map((tool) => ({
      name: tool.name,
      inputSchema: tool.inputSchema ?? tool.input_schema ?? {},
    }));
  }

  async call(args: Record<string, unknown>, timeoutMs = 900_000): Promise<unknown> {
    const result = await this.rpc(
      "tools/call",
      { name: "inspect_typescript_graph", arguments: args },
      timeoutMs,
    );
    return unwrapToolResult(result);
  }

  async close(): Promise<number> {
    const proc = this.proc;
    if (!proc) return 0;
    proc.stdin.end();
    const timer = setTimeout(() => proc.kill(), 15_000);
    const exitCode = await proc.exited;
    clearTimeout(timer);
    this.proc = null;
    this.reader = null;
    return exitCode;
  }
}

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cwd = resolve(flag(argv, "--cwd") ?? root);
  const tsconfig = flag(argv, "--tsconfig") ?? "tsconfig.graph.json";
  const question = flag(argv, "--question");
  const requestText = flag(argv, "--request");
  if (!question || !requestText) {
    console.error("usage: bun tools/graph-query.ts --question <text> --request <json> [--cwd dir] [--tsconfig file]");
    process.exit(2);
  }
  const request = JSON.parse(requestText) as Record<string, unknown>;
  const session = new GraphSession(cwd, tsconfig);
  let exitCode = 0;
  try {
    const hello = await session.open();
    const tools = await session.listTools();
    const tool = tools.find((entry) => entry.name === "inspect_typescript_graph");
    if (!tool) throw new Error("tools/list did not advertise inspect_typescript_graph");
    assertActions(tool.inputSchema);
    const payload = await session.call(buildToolArguments(tool.inputSchema, question, request));
    console.log(`server=${hello.server ?? "ttsc-graph"} protocol=${hello.protocolVersion ?? "unreported"}`);
    console.log(`cwd=${cwd} tsconfig=${tsconfig}`);
    console.log(summarize(payload));
  } finally {
    exitCode = await session.close();
    console.log(`shutdown=${exitCode}`);
  }
  if (exitCode !== 0) throw new Error(`graph server shutdown ${exitCode}`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
