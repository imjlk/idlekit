import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export interface FieldSchema {
  id: string;
  path: string;
  unit: string;
  type: "number" | "integer";
  min?: number;
  max?: number;
  /** Optional identity guard for a field reached through an array index. */
  parentId?: string;
}

export interface SheetSchema {
  version: 1;
  fields: FieldSchema[];
}

export interface SheetLimits {
  maxCsvBytes: number;
  maxRows: number;
  maxColumns: number;
  maxCellBytes: number;
  maxFields: number;
  maxInputFiles: number;
  maxInputBytes: number;
  maxTotalInputBytes: number;
  maxOutputFiles: number;
  maxOutputBytes: number;
  maxTotalOutputBytes: number;
}

export const SHEET_LIMITS: Readonly<SheetLimits> = Object.freeze({
  maxCsvBytes: 2 * 1024 * 1024,
  maxRows: 10001,
  maxColumns: 128,
  maxCellBytes: 64 * 1024,
  maxFields: 10000,
  maxInputFiles: 128,
  maxInputBytes: 8 * 1024 * 1024,
  maxTotalInputBytes: 32 * 1024 * 1024,
  maxOutputFiles: 64,
  maxOutputBytes: 16 * 1024 * 1024,
  maxTotalOutputBytes: 64 * 1024 * 1024,
});

function limitsFor(overrides: Partial<SheetLimits> = {}): SheetLimits {
  const limits = { ...SHEET_LIMITS, ...overrides };
  for (const key of Object.keys(limits) as (keyof SheetLimits)[]) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > SHEET_LIMITS[key]) {
      throw new Error(`Invalid ${key}: limits must be positive integers no greater than ${SHEET_LIMITS[key]}`);
    }
  }
  return limits;
}

const numberText = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const sha256Text = /^[a-f0-9]{64}$/;
const generationText = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const forbiddenKeys = new Set(["__proto__", "prototype", "constructor"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formulaLike(value: string): boolean {
  if (numberText.test(value) && Number.isFinite(Number(value))) return false;
  return /^[\s\u0000-\u001f\u007f-\u009f]*[=+@-]/u.test(value) || /^[\t\r\n]/u.test(value);
}

/** Strict RFC-4180-style parsing; accepts LF or CRLF and a leading UTF-8 BOM. */
export function parseCsv(text: string, overrides?: Partial<SheetLimits>): string[][] {
  const limits = limitsFor(overrides);
  if (Buffer.byteLength(text) > limits.maxCsvBytes) throw new Error("CSV exceeds byte limit");
  if (text.includes("\0")) throw new Error("CSV contains a NUL character");
  if (text.startsWith("\ufeff")) text = text.slice(1);
  if (text === "") return [];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let closedQuote = false;
  let started = false;
  const endCell = () => {
    if (Buffer.byteLength(cell) > limits.maxCellBytes) throw new Error("CSV cell exceeds byte limit");
    row.push(cell);
    if (row.length > limits.maxColumns) throw new Error("CSV exceeds column limit");
    cell = "";
    closedQuote = false;
    started = false;
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    if (rows.length > limits.maxRows) throw new Error("CSV exceeds row limit");
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else { quoted = false; closedQuote = true; }
      } else cell += char;
    } else if (char === ",") endCell();
    else if (char === "\r" || char === "\n") {
      endRow();
      if (char === "\r" && text[i + 1] === "\n") i++;
    } else if (closedQuote) throw new Error("Unexpected text after closing CSV quote");
    else if (char === '"') {
      if (started) throw new Error("Quote in an unquoted CSV cell");
      quoted = true;
      started = true;
    } else { cell += char; started = true; }
    if (cell.length > limits.maxCellBytes) throw new Error("CSV cell exceeds byte limit");
  }
  if (quoted) throw new Error("Unterminated quoted CSV cell");
  if (row.length > 0 || started || closedQuote || cell !== "") endRow();
  return rows;
}

/** Formula-like text is deliberately apostrophe-prefixed before spreadsheet export. */
export function stringifyCsv(rows: readonly (readonly string[])[], overrides?: Partial<SheetLimits>): string {
  const limits = limitsFor(overrides);
  if (rows.length > limits.maxRows) throw new Error("CSV exceeds row limit");
  let bytes = 0;
  return rows.map((row) => {
    if (row.length > limits.maxColumns) throw new Error("CSV exceeds column limit");
    const line = row.map((raw) => {
      if (typeof raw !== "string" || raw.includes("\0")) throw new Error("Invalid CSV cell");
      const cell = formulaLike(raw) ? `'${raw}` : raw;
      if (Buffer.byteLength(cell) > limits.maxCellBytes) throw new Error("CSV cell exceeds byte limit");
      return /[",\r\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
    }).join(",") + "\r\n";
    bytes += Buffer.byteLength(line);
    if (bytes > limits.maxCsvBytes) throw new Error("CSV exceeds byte limit");
    return line;
  }).join("");
}

function pointerSegments(pointer: string): string[] {
  if (!pointer.startsWith("/") || pointer.length > 4096) throw new Error(`Invalid JSON pointer: ${pointer}`);
  const segments = pointer.slice(1).split("/").map((part) => {
    if (/~(?:[^01]|$)/.test(part)) throw new Error(`Invalid JSON pointer escape: ${pointer}`);
    const key = part.replaceAll("~1", "/").replaceAll("~0", "~");
    if (forbiddenKeys.has(key)) throw new Error(`Unsafe JSON pointer: ${pointer}`);
    return key;
  });
  if (segments.length > 64) throw new Error("JSON pointer exceeds depth limit");
  return segments;
}

function locate(source: unknown, pointer: string): { parent: Record<string, unknown>; key: string; value: unknown } {
  const segments = pointerSegments(pointer);
  let value = source;
  let parent: Record<string, unknown> | undefined;
  let key = "";
  for (key of segments) {
    if (value === null || typeof value !== "object" || !Object.hasOwn(value, key)) {
      throw new Error(`JSON pointer does not exist: ${pointer}`);
    }
    if (Array.isArray(value) && (!/^(0|[1-9]\d*)$/.test(key) || !Number.isSafeInteger(Number(key)))) {
      throw new Error(`Invalid array index in JSON pointer: ${pointer}`);
    }
    parent = value as Record<string, unknown>;
    value = parent[key];
  }
  return { parent: parent!, key, value };
}

function checkNumber(value: unknown, field: FieldSchema): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Field ${field.id} requires a finite number`);
  if (Number.isInteger(value) && !Number.isSafeInteger(value)) throw new Error(`Field ${field.id} has an unsafe integer`);
  if (field.type === "integer" && !Number.isSafeInteger(value)) throw new Error(`Field ${field.id} requires a safe integer`);
  if (field.min !== undefined && value < field.min) throw new Error(`Field ${field.id} is below min ${field.min}`);
  if (field.max !== undefined && value > field.max) throw new Error(`Field ${field.id} is above max ${field.max}`);
  return value;
}

function parseNumber(raw: string, field: FieldSchema): number {
  if (raw.trim() === "" || !numberText.test(raw)) throw new Error(`Field ${field.id} requires a numeric literal, not blank text or a formula`);
  const value = checkNumber(Number(raw), field);
  const [mantissa = "", exponent = "0"] = raw.replace(/^[+-]/, "").toLowerCase().split("e");
  let digits = mantissa.replace(".", "").replace(/^0+/, "");
  if (value === 0 && digits !== "") throw new Error(`Field ${field.id} underflows to zero`);
  if (field.type === "integer" && digits !== "") {
    let scale = Number(exponent) - (mantissa.includes(".") ? mantissa.length - mantissa.indexOf(".") - 1 : 0);
    while (scale < 0 && digits.endsWith("0")) { digits = digits.slice(0, -1); scale++; }
    // Check the literal's exact decimal value, before binary rounding can hide a fraction.
    if (!Number.isSafeInteger(scale) || scale < 0 || digits.length + scale > 16 || BigInt(digits + "0".repeat(scale)) > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(`Field ${field.id} requires an exact safe integer literal`);
    }
  }
  return value;
}

export function validateSheetSchema(value: unknown, template?: unknown, overrides?: Partial<SheetLimits>): SheetSchema {
  const limits = limitsFor(overrides);
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.fields) || value.fields.length === 0 || value.fields.length > limits.maxFields) {
    throw new Error("Sheet schema requires version 1 and a bounded nonempty fields array");
  }
  const fields: FieldSchema[] = [];
  const ids = new Set<string>();
  type PathNode = { terminal: boolean; children: Map<string, PathNode> };
  const paths: PathNode = { terminal: false, children: new Map() };
  for (const candidate of value.fields) {
    if (!isRecord(candidate) || typeof candidate.id !== "string" || typeof candidate.unit !== "string" || typeof candidate.path !== "string" || (candidate.type !== "number" && candidate.type !== "integer")) {
      throw new Error("Invalid sheet field schema");
    }
    for (const label of [candidate.id, candidate.unit]) {
      if (label.trim() !== label || label === "" || label.length > 1024 || /[\u0000-\u001f\u007f]/.test(label) || formulaLike(label)) {
        throw new Error("Field IDs and units must be nonempty, safe spreadsheet text");
      }
    }
    if (ids.has(candidate.id)) throw new Error(`Duplicate field ID: ${candidate.id}`);
    ids.add(candidate.id);
    for (const bound of [candidate.min, candidate.max]) {
      if (bound !== undefined && (typeof bound !== "number" || !Number.isFinite(bound))) throw new Error(`Invalid bounds for ${candidate.id}`);
    }
    if (typeof candidate.min === "number" && typeof candidate.max === "number" && candidate.min > candidate.max) throw new Error(`Reversed bounds for ${candidate.id}`);
    if (candidate.parentId !== undefined && (typeof candidate.parentId !== "string" || candidate.parentId.length === 0 || candidate.parentId.length > 1024)) throw new Error(`Invalid parentId for ${candidate.id}`);
    const parts = pointerSegments(candidate.path);
    let node = paths;
    for (const part of parts) {
      if (node.terminal) throw new Error(`Duplicate or overlapping field path: ${candidate.path}`);
      let child = node.children.get(part);
      if (!child) { child = { terminal: false, children: new Map() }; node.children.set(part, child); }
      node = child;
    }
    if (node.terminal || node.children.size > 0) throw new Error(`Duplicate or overlapping field path: ${candidate.path}`);
    node.terminal = true;
    const field: FieldSchema = { id: candidate.id, path: candidate.path, unit: candidate.unit, type: candidate.type };
    if (candidate.min !== undefined) field.min = candidate.min as number;
    if (candidate.max !== undefined) field.max = candidate.max as number;
    if (candidate.parentId !== undefined) field.parentId = candidate.parentId as string;
    if (template !== undefined) {
      const location = locate(template, field.path);
      if (field.parentId !== undefined && (!Object.hasOwn(location.parent, "id") || location.parent.id !== field.parentId)) throw new Error(`Parent ID mismatch for ${field.id}: expected ${field.parentId}`);
      checkNumber(location.value, { ...field, min: undefined, max: undefined });
    }
    fields.push(field);
  }
  return { version: 1, fields };
}

function sheetRows(text: string, schema: SheetSchema, overrides?: Partial<SheetLimits>) {
  const table = parseCsv(text, overrides);
  const headers = table.shift();
  if (!headers || new Set(headers).size !== headers.length || headers.some((header) => header === "")) throw new Error("CSV requires unique nonempty headers");
  const idColumn = headers.indexOf("id");
  const valueColumn = headers.indexOf("value");
  const unitColumn = headers.indexOf("unit");
  if (idColumn < 0 || valueColumn < 0 || unitColumn < 0) throw new Error("CSV requires id,value,unit columns");
  const fields = new Map(schema.fields.map((field) => [field.id, field]));
  const rows = new Map<string, string[]>();
  const values = new Map<string, number>();
  for (const row of table) {
    if (row.length !== headers.length) throw new Error("CSV row width does not match headers");
    const id = row[idColumn]!;
    const field = fields.get(id);
    if (!field) throw new Error(`Unknown sheet row ID: ${id}`);
    if (rows.has(id)) throw new Error(`Duplicate sheet row ID: ${id}`);
    if (row[unitColumn] !== field.unit) throw new Error(`Unit mismatch for ${id}: expected ${field.unit}`);
    const raw = row[valueColumn]!;
    values.set(id, parseNumber(raw, field));
    rows.set(id, row);
  }
  for (const field of schema.fields) if (!rows.has(field.id)) throw new Error(`Missing sheet row ID: ${field.id}`);
  return { headers, rows, values };
}

export function applySheetCsv<T>(template: T, schemaValue: SheetSchema, csv: string, overrides?: Partial<SheetLimits>): T {
  const schema = validateSheetSchema(schemaValue, template, overrides);
  const { values } = sheetRows(csv, schema, overrides);
  const output = structuredClone(template);
  for (const field of schema.fields) {
    const { parent, key } = locate(output, field.path);
    parent[key] = values.get(field.id)!;
  }
  return output;
}

export function exportSheetCsv(template: unknown, schemaValue: SheetSchema, previousCsv?: string, overrides?: Partial<SheetLimits>): string {
  const schema = validateSheetSchema(schemaValue, template, overrides);
  const previous = previousCsv === undefined ? undefined : sheetRows(previousCsv, schema, overrides);
  const extra = previous?.headers.filter((header) => !["id", "value", "unit"].includes(header)) ?? [];
  const rows = [["id", "value", "unit", ...extra]];
  for (const field of schema.fields) {
    rows.push([field.id, String(checkNumber(locate(template, field.path).value, field)), field.unit, ...extra.map((header) => previous!.rows.get(field.id)![previous!.headers.indexOf(header)]!)]);
  }
  return stringifyCsv(rows, overrides);
}

export interface InputFingerprint {
  path: string;
  realPath: string;
  sha256: string;
  bytes: number;
}

export interface BundleArtifact {
  path: string;
  sha256: string;
  bytes: number;
}

export interface RefreshSnapshot {
  files: Readonly<Record<string, Uint8Array>>;
  inputs: Readonly<Record<string, InputFingerprint>>;
  context: Readonly<Record<string, string>>;
  inputFingerprint: string;
  text(name: string): string;
}

export interface SheetBundleManifest {
  version: 1;
  generation: string;
  generationPath: string;
  createdAt: string;
  inputs: Record<string, InputFingerprint>;
  context: Record<string, string>;
  inputFingerprint: string;
  artifacts: Record<string, BundleArtifact>;
}

export interface RefreshSheetBundleOptions {
  outputDir: string;
  inputFiles: Record<string, string>;
  context?: Record<string, string>;
  limits?: Partial<SheetLimits>;
  compute(snapshot: RefreshSnapshot): Promise<Record<string, string | Uint8Array>> | Record<string, string | Uint8Array>;
  beforeCommit?(): Promise<void> | void;
}

export interface SheetBundleStatus {
  state: "missing" | "current" | "stale";
  manifest?: SheetBundleManifest;
  staleReasons: string[];
}

function sha256(bytes: Uint8Array | string): string { return createHash("sha256").update(bytes).digest("hex"); }

function inputDigest(inputs: Readonly<Record<string, InputFingerprint>>, context: Readonly<Record<string, string>>): string {
  return sha256(JSON.stringify({
    inputs: Object.keys(inputs).sort().map((name) => [name, inputs[name]!.path, inputs[name]!.realPath, inputs[name]!.sha256, inputs[name]!.bytes]),
    context: Object.keys(context).sort().map((name) => [name, context[name]]),
  }));
}

function copyContext(context: Record<string, string> = {}): Record<string, string> {
  if (!isRecord(context) || Object.keys(context).length > 128) throw new Error("Context exceeds entry limit");
  const result: Record<string, string> = Object.create(null);
  for (const [name, value] of Object.entries(context)) {
    if (name === "" || name.length > 1024 || typeof value !== "string" || Buffer.byteLength(value) > 64 * 1024) throw new Error("Invalid context entry");
    result[name] = value;
  }
  if (Buffer.byteLength(JSON.stringify(result)) > 256 * 1024) throw new Error("Context exceeds byte limit");
  return result;
}

function validInputNames(inputFiles: Record<string, string>, limits: SheetLimits): string[] {
  if (!isRecord(inputFiles)) throw new Error("Input files must be a named file record");
  const names = Object.keys(inputFiles).sort();
  if (names.length === 0 || names.length > limits.maxInputFiles) throw new Error("Input file count exceeds limit or is empty");
  for (const name of names) {
    if (name === "" || name.length > 1024 || typeof inputFiles[name] !== "string" || inputFiles[name] === "") throw new Error("Invalid input file name/path");
  }
  return names;
}

/** Reads at most limit + 1 bytes even if the file grows after stat. */
async function boundedRead(path: string, limit: number): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error(`Not a regular file: ${path}`);
    if (stat.size > limit) throw new Error(`File exceeds byte limit: ${path}`);
    const chunks: Buffer[] = [];
    let size = 0;
    while (true) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, limit + 1 - size));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      size += bytesRead;
      if (size > limit) throw new Error(`File exceeds byte limit: ${path}`);
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, size);
  } finally { await handle.close(); }
}

async function snapshotInputs(inputFiles: Record<string, string>, contextValue: Record<string, string> | undefined, limits: SheetLimits): Promise<RefreshSnapshot> {
  const context = Object.freeze(copyContext(contextValue));
  const files: Record<string, Uint8Array> = Object.create(null);
  const inputs: Record<string, InputFingerprint> = Object.create(null);
  let total = 0;
  for (const name of validInputNames(inputFiles, limits)) {
    const path = resolve(inputFiles[name]!);
    const realPath = await realpath(path);
    const bytes = await boundedRead(realPath, Math.min(limits.maxInputBytes, limits.maxTotalInputBytes - total));
    total += bytes.length;
    if (total > limits.maxTotalInputBytes) throw new Error("Inputs exceed total byte limit");
    files[name] = bytes;
    inputs[name] = Object.freeze({ path, realPath, sha256: sha256(bytes), bytes: bytes.length });
  }
  const inputFingerprint = inputDigest(inputs, context);
  Object.freeze(files);
  Object.freeze(inputs);
  return Object.freeze({
    files, inputs, context, inputFingerprint,
    text(name: string): string {
      const bytes = files[name];
      if (!bytes) throw new Error(`Unknown snapshot input: ${name}`);
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    },
  });
}

export async function fingerprintInputs(inputFiles: Record<string, string>, context?: Record<string, string>, overrides?: Partial<SheetLimits>): Promise<{ inputs: Readonly<Record<string, InputFingerprint>>; inputFingerprint: string }> {
  const snapshot = await snapshotInputs(inputFiles, context, limitsFor(overrides));
  return { inputs: snapshot.inputs, inputFingerprint: snapshot.inputFingerprint };
}

async function canonicalOutput(path: string): Promise<string> {
  path = resolve(path);
  try { return await realpath(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return join(await canonicalOutput(parent), relative(parent, path));
  }
}

function isWithin(root: string, path: string): boolean {
  const part = relative(root, path);
  return part === "" || (!part.startsWith(`..${sep}`) && part !== ".." && !isAbsolute(part));
}

function checkCollisions(output: string, snapshot: RefreshSnapshot): void {
  for (const [name, input] of Object.entries(snapshot.inputs)) {
    if (isWithin(output, input.path) || isWithin(output, input.realPath)) throw new Error(`Output/input collision: ${name} is inside the bundle directory`);
  }
}

function artifactName(name: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(name) && name !== "manifest.json" && name !== "current.json";
}

async function durableWrite(path: string, bytes: Uint8Array, mode = 0o444): Promise<void> {
  const handle = await open(path, "wx", mode);
  try { await handle.writeFile(bytes); await handle.sync(); }
  finally { await handle.close(); }
}

/** Cooperative single-writer lock; current.json is the only publication point. */
export async function refreshSheetBundle(options: RefreshSheetBundleOptions): Promise<SheetBundleManifest> {
  const limits = limitsFor(options.limits);
  validInputNames(options.inputFiles, limits);
  const output = await canonicalOutput(options.outputDir);
  // Reject collisions before creating any bundle control files, including its lock.
  for (const [name, path] of Object.entries(options.inputFiles)) {
    if (isWithin(output, resolve(path)) || isWithin(output, await realpath(path))) throw new Error(`Output/input collision: ${name}`);
  }
  await mkdir(output, { recursive: true });
  const lockPath = join(output, ".refresh.lock");
  const lock = await open(lockPath, "wx", 0o600).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "EEXIST") throw new Error(`Refresh lock already exists: ${lockPath}`);
    throw error;
  });
  const lockStat = await lock.stat();
  const generation = randomUUID();
  const stage = join(output, `.staging-${generation}`);
  const pointerStage = join(output, `.current-${generation}.json`);
  const generations = join(output, "generations");
  const generationPath = join(generations, generation);
  let published = false;
  let generationCreated = false;
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, generation, startedAt: new Date().toISOString() }));
    const snapshot = await snapshotInputs(options.inputFiles, options.context, limits);
    checkCollisions(output, snapshot);
    const outputValues = await options.compute(snapshot);
    if (!isRecord(outputValues)) throw new Error("Compute must return named output files");
    const names = Object.keys(outputValues).sort();
    if (names.length === 0 || names.length > limits.maxOutputFiles) throw new Error("Output file count exceeds limit or is empty");
    const artifacts: Record<string, BundleArtifact> = Object.create(null);
    const outputBytes: Record<string, Uint8Array> = Object.create(null);
    let total = 0;
    for (const name of names) {
      if (!artifactName(name)) throw new Error(`Unsafe output file name: ${name}`);
      const value = outputValues[name];
      if (typeof value !== "string" && !(value instanceof Uint8Array)) throw new Error(`Invalid output bytes: ${name}`);
      const size = typeof value === "string" ? Buffer.byteLength(value) : value.byteLength;
      total += size;
      if (size > limits.maxOutputBytes || total > limits.maxTotalOutputBytes) throw new Error("Outputs exceed byte limit");
      const bytes = typeof value === "string" ? Buffer.from(value) : Buffer.from(value);
      outputBytes[name] = bytes;
      artifacts[name] = { path: join(generationPath, name), sha256: sha256(bytes), bytes: bytes.length };
    }
    const manifest: SheetBundleManifest = {
      version: 1, generation, generationPath, createdAt: new Date().toISOString(),
      inputs: { ...snapshot.inputs }, context: { ...snapshot.context }, inputFingerprint: snapshot.inputFingerprint, artifacts,
    };
    const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
    if (manifestBytes.length > 1024 * 1024) throw new Error("Bundle manifest exceeds byte limit");
    await mkdir(generations, { recursive: true });
    if (await realpath(generations) !== generations) throw new Error("Bundle generations directory must not be a symlink");
    await mkdir(stage);
    for (const name of names) await durableWrite(join(stage, name), outputBytes[name]!);
    await durableWrite(join(stage, "manifest.json"), manifestBytes);
    await options.beforeCommit?.();
    let current: RefreshSnapshot;
    try { current = await snapshotInputs(options.inputFiles, snapshot.context, limits); }
    catch (error) { throw new Error("Input changed during refresh; previous bundle preserved", { cause: error }); }
    if (current.inputFingerprint !== snapshot.inputFingerprint) throw new Error("Input conflict: files changed during refresh; previous bundle preserved");
    await rename(stage, generationPath);
    generationCreated = true;
    const pointer = Buffer.from(JSON.stringify({ version: 1, generation, manifestSha256: sha256(manifestBytes) }, null, 2) + "\n");
    await durableWrite(pointerStage, pointer, 0o644);
    await rename(pointerStage, join(output, "current.json"));
    published = true;
    return manifest;
  } finally {
    await lock.close().catch(() => {});
    await rm(stage, { recursive: true, force: true }).catch(() => {});
    await rm(pointerStage, { force: true }).catch(() => {});
    if (generationCreated && !published) await rm(generationPath, { recursive: true, force: true }).catch(() => {});
    const currentLock = await lstat(lockPath).catch(() => undefined);
    if (currentLock?.ino === lockStat.ino && currentLock?.dev === lockStat.dev) await rm(lockPath, { force: true }).catch(() => {});
  }
}

function validateManifest(value: unknown, output: string, generation: string, limits: SheetLimits): SheetBundleManifest {
  const generationPath = join(output, "generations", generation);
  if (!isRecord(value) || value.version !== 1 || value.generation !== generation || value.generationPath !== generationPath || typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt)) || !isRecord(value.inputs) || !isRecord(value.artifacts) || !isRecord(value.context) || typeof value.inputFingerprint !== "string" || !sha256Text.test(value.inputFingerprint)) throw new Error("Invalid bundle manifest");
  const inputs = value.inputs;
  const inputFiles: Record<string, string> = Object.create(null);
  let inputBytes = 0;
  for (const [name, input] of Object.entries(inputs)) {
    if (!isRecord(input) || typeof input.path !== "string" || !isAbsolute(input.path) || typeof input.realPath !== "string" || !isAbsolute(input.realPath) || typeof input.sha256 !== "string" || !sha256Text.test(input.sha256) || typeof input.bytes !== "number" || !Number.isSafeInteger(input.bytes) || input.bytes < 0 || input.bytes > limits.maxInputBytes) throw new Error("Invalid input fingerprint");
    inputFiles[name] = input.path;
    inputBytes += input.bytes;
    if (isWithin(output, input.path) || isWithin(output, input.realPath)) throw new Error("Manifest input/output collision");
  }
  validInputNames(inputFiles, limits);
  if (inputBytes > limits.maxTotalInputBytes) throw new Error("Manifest inputs exceed byte limit");
  copyContext(value.context as Record<string, string>);
  const artifacts = Object.entries(value.artifacts);
  if (artifacts.length === 0 || artifacts.length > limits.maxOutputFiles) throw new Error("Invalid artifact count");
  let outputBytes = 0;
  for (const [name, artifact] of artifacts) {
    if (!artifactName(name) || !isRecord(artifact) || artifact.path !== join(generationPath, name) || typeof artifact.sha256 !== "string" || !sha256Text.test(artifact.sha256) || typeof artifact.bytes !== "number" || !Number.isSafeInteger(artifact.bytes) || artifact.bytes < 0 || artifact.bytes > limits.maxOutputBytes) throw new Error("Invalid output artifact");
    outputBytes += artifact.bytes;
  }
  if (outputBytes > limits.maxTotalOutputBytes) throw new Error("Manifest outputs exceed byte limit");
  const manifest = value as unknown as SheetBundleManifest;
  if (inputDigest(manifest.inputs, manifest.context) !== manifest.inputFingerprint) throw new Error("Invalid combined input fingerprint");
  return manifest;
}

/** Verifies the pointer, immutable artifacts, and byte-exact current input fingerprints. */
export async function readCurrentBundle(outputDir: string, inputFiles?: Record<string, string>, options: { context?: Record<string, string>; limits?: Partial<SheetLimits> } = {}): Promise<SheetBundleStatus> {
  const limits = limitsFor(options.limits);
  const output = await canonicalOutput(outputDir);
  const staleReasons: string[] = [];
  let manifest: SheetBundleManifest | undefined;
  let pointerBytes: Buffer;
  try { pointerBytes = await boundedRead(join(output, "current.json"), 4096); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { state: "missing", staleReasons: [] };
    return { state: "stale", staleReasons: [`Cannot read bundle pointer: ${String(error)}`] };
  }
  try {
    const pointer: unknown = JSON.parse(pointerBytes.toString("utf8"));
    if (!isRecord(pointer) || pointer.version !== 1 || typeof pointer.generation !== "string" || !generationText.test(pointer.generation) || typeof pointer.manifestSha256 !== "string" || !sha256Text.test(pointer.manifestSha256)) throw new Error("Invalid bundle pointer");
    const generationPath = join(output, "generations", pointer.generation);
    if (await realpath(generationPath) !== generationPath) throw new Error("Bundle generation must not be a symlink");
    const manifestPath = join(generationPath, "manifest.json");
    if (await realpath(manifestPath) !== manifestPath) throw new Error("Bundle manifest must not be a symlink");
    const bytes = await boundedRead(manifestPath, 1024 * 1024);
    if (sha256(bytes) !== pointer.manifestSha256) throw new Error("Bundle manifest hash does not match pointer");
    manifest = validateManifest(JSON.parse(bytes.toString("utf8")), output, pointer.generation, limits);
    let outputBytesRead = 0;
    for (const [name, artifact] of Object.entries(manifest.artifacts)) {
      try {
        if (await realpath(artifact.path) !== artifact.path) throw new Error("Artifact is a symlink");
        const artifactBytes = await boundedRead(artifact.path, Math.min(limits.maxOutputBytes, limits.maxTotalOutputBytes - outputBytesRead));
        outputBytesRead += artifactBytes.length;
        if (artifactBytes.length !== artifact.bytes || sha256(artifactBytes) !== artifact.sha256) staleReasons.push(`Artifact changed: ${name}`);
      } catch (error) { staleReasons.push(`Cannot verify artifact ${name}: ${String(error)}`); }
    }
    const currentFiles = inputFiles ?? Object.fromEntries(Object.entries(manifest.inputs).map(([name, input]) => [name, input.path]));
    try {
      const current = await snapshotInputs(currentFiles, options.context ?? manifest.context, limits);
      if (current.inputFingerprint !== manifest.inputFingerprint) staleReasons.push("Input files or context have changed since refresh");
    } catch (error) { staleReasons.push(`Cannot verify current inputs: ${String(error)}`); }
  } catch (error) { staleReasons.push(`Cannot verify bundle: ${String(error)}`); }
  return { state: staleReasons.length === 0 ? "current" : "stale", ...(manifest ? { manifest } : {}), staleReasons };
}
