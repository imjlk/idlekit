import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  applySheetCsv,
  exportSheetCsv,
  parseCsv,
  readCurrentBundle,
  refreshSheetBundle,
  stringifyCsv,
  validateSheetSchema,
  type SheetSchema,
} from "./sheet";

const schema: SheetSchema = {
  version: 1,
  fields: [
    { id: "price", path: "/shop/price", unit: "coins", type: "number", min: 0 },
    { id: "count", path: "/items/0/count", unit: "items", type: "integer", min: 0, max: 100 },
  ],
};
const source = { shop: { price: 1.5 }, items: [{ count: 2 }], unrelated: true };
const csv = "id,value,unit\r\nprice,0,coins\r\ncount,3,items\r\n";
const temporary: string[] = [];
async function canCreateFileSymlink(): Promise<boolean> {
  const prefix = resolve(tmpdir(), "idlekit-sheet-link-probe-");
  const root = await mkdtemp(prefix);
  try {
    const target = join(root, "target.csv");
    await writeFile(target, csv);
    try {
      await symlink(target, join(root, "alias.csv"), "file");
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "EACCES") return false;
      throw error;
    }
  } finally {
    if (!resolve(root).startsWith(prefix)) throw new Error("Unexpected link probe path");
    await rm(root, { recursive: true, force: true });
  }
}
const fileSymlinksAvailable = process.platform !== "win32" || await canCreateFileSymlink();
const directoryLinkType = process.platform === "win32" ? "junction" : "dir";
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "idlekit-sheet-"));
  temporary.push(root);
  const input = join(root, "edit.csv");
  await writeFile(input, csv);
  return { root, input, outputDir: join(root, "bundle"), inputFiles: { csv: input } };
}

describe("typed sheet CSV", () => {
  test("round-trips quoted commas, quotes, CRLF, embedded newlines and Unicode", () => {
    const rows = [["id", "value", "unit", "notes"], ["price", "1.5", "coins", 'a, "quote"\n한글'], ["count", "2", "items", ""]];
    expect(parseCsv(stringifyCsv(rows))).toEqual(rows);
    expect(parseCsv("\ufeff" + stringifyCsv(rows))).toEqual(rows);
  });
  test("applies stable IDs independent of row order, preserves source and valid zero", () => {
    const edited = applySheetCsv(source, schema, "id,value,unit\ncount,3,items\nprice,0,coins\n");
    expect(edited).toEqual({ shop: { price: 0 }, items: [{ count: 3 }], unrelated: true });
    expect(source.shop.price).toBe(1.5);
  });
  test("exports current source values while preserving unknown columns by row ID", () => {
    const previous = 'notes,unit,id,value,owner\n"a, b",items,count,3,"Lee"\n"quoted ""text""",coins,price,0,Kim\n';
    const rows = parseCsv(exportSheetCsv(source, schema, previous));
    expect(rows).toEqual([
      ["id", "value", "unit", "notes", "owner"],
      ["price", "1.5", "coins", 'quoted "text"', "Kim"],
      ["count", "2", "items", "a, b", "Lee"],
    ]);
    expect(applySheetCsv(source, schema, exportSheetCsv(source, schema, previous))).toEqual(source);
  });
  test("neutralizes formula-like text, including whitespace, without damaging negative numbers", () => {
    expect(parseCsv(stringifyCsv([["=HYPERLINK(1)", " @SUM(A1)", "\tcmd", "-5", "+2.5", "-oops"]]))[0]).toEqual([
      "'=HYPERLINK(1)", "' @SUM(A1)", "'\tcmd", "-5", "+2.5", "'-oops",
    ]);
  });
  test("round-trips negative decimal/exponent values without formula prefixes", () => {
    const negativeSchema: SheetSchema = { version: 1, fields: [{ id: "offset", path: "/offset", unit: "coins", type: "number", min: -2000 }] };
    expect(applySheetCsv({ offset: 0 }, negativeSchema, "id,value,unit\noffset,-1e3,coins\n")).toEqual({ offset: -1000 });
    const exported = exportSheetCsv({ offset: -2 }, negativeSchema);
    expect(exported).toContain("offset,-2,coins");
    expect(applySheetCsv({ offset: 0 }, negativeSchema, exported)).toEqual({ offset: -2 });
  });
  test("parent ID binding rejects changed or reordered template array items", () => {
    const guarded: SheetSchema = { version: 1, fields: [{ id: "alpha.price", path: "/facilities/0/price", unit: "coins", type: "number", parentId: "alpha" }] };
    const original = { facilities: [{ id: "alpha", price: 1 }, { id: "beta", price: 2 }] };
    const edited = "id,value,unit\nalpha.price,3,coins\n";
    expect(applySheetCsv(original, guarded, edited).facilities[0]!.price).toBe(3);
    expect(() => applySheetCsv({ facilities: [...original.facilities].reverse() }, guarded, edited)).toThrow(/parent ID/i);
    expect(() => exportSheetCsv({ facilities: [{ price: 1 }] }, guarded)).toThrow(/parent ID/i);
  });
  test("integer validation checks decimal literals exactly before rounding", () => {
    for (const literal of ["3.00000000000000001", "1e-9999", "9007199254740991.1"]) {
      expect(() => applySheetCsv(source, schema, csv.replace("count,3", `count,${literal}`))).toThrow();
    }
    for (const literal of ["3.0", "30e-1", "0e9999", "-0.0"]) {
      expect(applySheetCsv(source, schema, csv.replace("count,3", `count,${literal}`)).items[0]!.count).toBe(Number(literal));
    }
    expect(() => applySheetCsv(source, schema, csv.replace("price,0", "price,1e-9999"))).toThrow(/underflow/);
  });
  test("can replace an existing out-of-range template value with a valid imported value", () => {
    expect(applySheetCsv({ ...source, shop: { price: -10 } }, schema, csv).shop.price).toBe(0);
    expect(() => exportSheetCsv({ ...source, shop: { price: -10 } }, schema)).toThrow();
  });
  for (const [name, invalid] of [
    ["blank", csv.replace("price,0", "price,")],
    ["whitespace", csv.replace("price,0", "price, ")],
    ["formula", csv.replace("price,0", "price,=1+1")],
    ["infinity", csv.replace("price,0", "price,1e999")],
    ["hex", csv.replace("price,0", "price,0x10")],
    ["nan", csv.replace("price,0", "price,NaN")],
    ["unsafe integer", csv.replace("count,3", "count,9007199254740993")],
    ["fractional integer", csv.replace("count,3", "count,3.2")],
    ["below min", csv.replace("price,0", "price,-1")],
    ["above max", csv.replace("count,3", "count,101")],
    ["unit", csv.replace("price,0,coins", "price,0,seconds")],
    ["unknown ID", csv.replace("price,0", "other,0")],
    ["duplicate row", csv + "price,1,coins\n"],
    ["missing row", "id,value,unit\nprice,0,coins\n"],
    ["duplicate header", "id,value,unit,value\nprice,0,coins,2\ncount,3,items,4\n"],
    ["extra cell", csv.replace("price,0,coins", "price,0,coins,oops")],
    ["missing header", "id,value\nprice,0\ncount,3\n"],
  ]) {
    test(`rejects ${name}`, () => expect(() => applySheetCsv(source, schema, invalid!)).toThrow());
  }
  test("rejects malformed quotes, embedded quotes, NUL, and bounded input", () => {
    for (const invalid of ['"open', 'a"b,c', '"a"oops,b', "a,\0b"]) expect(() => parseCsv(invalid)).toThrow();
    expect(() => parseCsv("a,b,c", { maxColumns: 2 })).toThrow();
    expect(() => parseCsv("ab", { maxCellBytes: 1 })).toThrow();
    expect(() => parseCsv("a\nb", { maxRows: 1 })).toThrow();
    expect(() => parseCsv("aa", { maxCsvBytes: 1 })).toThrow();
  });
  test("supports escaped JSON pointers and existing array entries", () => {
    const special: SheetSchema = { version: 1, fields: [{ id: "escaped", path: "/a~1b/~0value", unit: "x", type: "number" }] };
    expect(applySheetCsv({ "a/b": { "~value": 1 } }, special, "id,value,unit\nescaped,2,x\n")).toEqual({ "a/b": { "~value": 2 } });
  });
  test("rejects unsafe, nonexistent, malformed, duplicate and overlapping paths", () => {
    for (const path of ["", "shop/price", "/__proto__/x", "/shop/constructor", "/shop/prototype", "/missing", "/items/01/count", "/items/-/count", "/shop/~2price"]) {
      expect(() => validateSheetSchema({ version: 1, fields: [{ ...schema.fields[0], path }] }, source)).toThrow();
    }
    expect(() => validateSheetSchema({ version: 1, fields: [schema.fields[0], schema.fields[0]] }, source)).toThrow();
    expect(() => validateSheetSchema({ version: 1, fields: [schema.fields[0], { ...schema.fields[1], path: "/shop/price" }] })).toThrow();
    expect(() => validateSheetSchema({ version: 1, fields: [schema.fields[0], { ...schema.fields[1], path: "/shop" }] })).toThrow();
    expect(() => validateSheetSchema({ version: 2, fields: [] })).toThrow();
    expect(() => validateSheetSchema({ version: 1, fields: [{ ...schema.fields[0], min: 2, max: 1 }] })).toThrow();
  });
});

describe("atomic refresh bundle", () => {
  test("publishes byte-exact provenance, sidecar outputs, and current status", async () => {
    const fixture = await setup();
    const result = await refreshSheetBundle({
      ...fixture,
      context: { plugin: "abc123" },
      compute: async (snapshot) => {
        expect(snapshot.text("csv")).toBe(csv);
        expect(snapshot.context).toEqual({ plugin: "abc123" });
        expect(snapshot.inputs.csv!.bytes).toBe(Buffer.byteLength(csv));
        return { "result.csv": snapshot.text("csv"), "report.json": "{}\n" };
      },
    });
    expect(result.inputFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(result.inputs.csv!.sha256).toBe(createHash("sha256").update(csv).digest("hex"));
    expect(result.artifacts["result.csv"]!.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(await readFile(fixture.input, "utf8")).toBe(csv);
    expect(await readFile(result.artifacts["result.csv"]!.path, "utf8")).toBe(csv);
    expect((await readCurrentBundle(fixture.outputDir, fixture.inputFiles, { context: { plugin: "abc123" } })).state).toBe("current");
    expect((await readCurrentBundle(fixture.outputDir, fixture.inputFiles, { context: { plugin: "changed" } })).state).toBe("stale");
    await writeFile(fixture.input, csv.replaceAll("\r\n", "\n"));
    expect((await readCurrentBundle(fixture.outputDir)).state).toBe("stale");
  });
  test("returns missing before the first successful refresh", async () => {
    const fixture = await setup();
    expect(await readCurrentBundle(fixture.outputDir)).toEqual({ state: "missing", staleReasons: [] });
  });
  test("fingerprints schema, template, config and plugin bytes as well as editable CSV", async () => {
    const fixture = await setup();
    const inputFiles: Record<string, string> = { ...fixture.inputFiles };
    for (const name of ["schema", "template", "config", "plugin"]) {
      inputFiles[name] = join(fixture.root, `${name}.input`);
      await writeFile(inputFiles[name]!, "original\n");
    }
    await refreshSheetBundle({ ...fixture, inputFiles, compute: async () => ({ "result.csv": "result" }) });
    for (const name of ["schema", "template", "config", "plugin"]) {
      await writeFile(inputFiles[name]!, "changed\n");
      expect((await readCurrentBundle(fixture.outputDir, inputFiles)).state).toBe("stale");
      await writeFile(inputFiles[name]!, "original\n");
      expect((await readCurrentBundle(fixture.outputDir, inputFiles)).state).toBe("current");
    }
  });
  test("preserves previous pointer on compute failure and mid-run input conflict", async () => {
    const fixture = await setup();
    const previous = await refreshSheetBundle({ ...fixture, compute: async () => ({ "result.csv": "first" }) });
    const pointer = await readFile(join(fixture.outputDir, "current.json"), "utf8");
    await expect(refreshSheetBundle({ ...fixture, compute: async () => { throw new Error("compute failed"); } })).rejects.toThrow("compute failed");
    await expect(refreshSheetBundle({ ...fixture, compute: async () => {
      await writeFile(fixture.input, csv + "\n");
      return { "result.csv": "second" };
    } })).rejects.toThrow(/changed|conflict/i);
    expect(await readFile(join(fixture.outputDir, "current.json"), "utf8")).toBe(pointer);
    expect(await readFile(previous.artifacts["result.csv"]!.path, "utf8")).toBe("first");
    expect((await readdir(fixture.outputDir)).filter((name) => name.startsWith(".staging") || name.endsWith(".lock"))).toEqual([]);
  });
  test("rechecks inputs after beforeCommit and preserves current on hook failure", async () => {
    const fixture = await setup();
    await refreshSheetBundle({ ...fixture, compute: async () => ({ "result.csv": "first" }) });
    const pointer = await readFile(join(fixture.outputDir, "current.json"), "utf8");
    await expect(refreshSheetBundle({ ...fixture, compute: async () => ({ "result.csv": "second" }), beforeCommit: async () => { throw new Error("plugin changed"); } })).rejects.toThrow("plugin changed");
    await expect(refreshSheetBundle({ ...fixture, compute: async () => ({ "result.csv": "second" }), beforeCommit: async () => { await writeFile(fixture.input, "changed"); } })).rejects.toThrow(/changed|conflict/i);
    expect(await readFile(join(fixture.outputDir, "current.json"), "utf8")).toBe(pointer);
  });
  test("cooperative lock rejects a concurrent refresh without running its compute", async () => {
    const fixture = await setup();
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const first = refreshSheetBundle({ ...fixture, compute: async () => { entered(); await barrier; return { "result.csv": "first" }; } });
    await started;
    let called = false;
    try {
      await expect(refreshSheetBundle({ ...fixture, compute: async () => { called = true; return { "result.csv": "bad" }; } })).rejects.toThrow(/lock/i);
      expect(called).toBe(false);
    } finally { release(); }
    await first;
    expect((await readCurrentBundle(fixture.outputDir)).state).toBe("current");
  });
  test("bounds input/output counts and bytes and rejects unsafe output names", async () => {
    const fixture = await setup();
    await expect(refreshSheetBundle({ ...fixture, limits: { maxInputBytes: 2 }, compute: async () => ({ "result.csv": "ok" }) })).rejects.toThrow();
    await expect(refreshSheetBundle({ ...fixture, limits: { maxInputFiles: 1 }, inputFiles: { csv: fixture.input, other: fixture.input }, compute: async () => ({ "result.csv": "ok" }) })).rejects.toThrow();
    const badOutputs: Record<string, string>[] = [{ "../edit.csv": "evil" }, { "/tmp/escape": "evil" }, { "manifest.json": "evil" }, { "sub/file.csv": "evil" }];
    for (const outputs of badOutputs) {
      await expect(refreshSheetBundle({ ...fixture, compute: async () => outputs })).rejects.toThrow();
    }
    await expect(refreshSheetBundle({ ...fixture, limits: { maxOutputBytes: 2 }, compute: async () => ({ "result.csv": "long" }) })).rejects.toThrow();
    await expect(refreshSheetBundle({ ...fixture, limits: { maxOutputFiles: 1 }, compute: async () => ({ "a.csv": "a", "b.csv": "b" }) })).rejects.toThrow();
    expect(await readFile(fixture.input, "utf8")).toBe(csv);
  });
  test("rejects input/output directory collision", async () => {
    const fixture = await setup();
    await expect(refreshSheetBundle({ ...fixture, outputDir: fixture.root, compute: async () => ({ "result.csv": "evil" }) })).rejects.toThrow(/input|collision/i);
    expect(await readFile(fixture.input, "utf8")).toBe(csv);
  });
  test("rejects input/output directory collision through directory aliases", async () => {
    const fixture = await setup();
    await mkdir(fixture.outputDir);
    const inside = join(fixture.outputDir, "source.csv");
    await writeFile(inside, csv);
    const alias = join(fixture.root, "alias");
    await symlink(fixture.outputDir, alias, directoryLinkType);
    await expect(refreshSheetBundle({ ...fixture, inputFiles: { csv: join(alias, "source.csv") }, compute: async () => ({ "result.csv": "evil" }) })).rejects.toThrow(/input|collision/i);
    expect(await readFile(inside, "utf8")).toBe(csv);
  });
  test.skipIf(!fileSymlinksAvailable)("rejects input/output directory collision through file symlink aliases", async () => {
    const fixture = await setup();
    await mkdir(fixture.outputDir);
    const inside = join(fixture.outputDir, "source.csv");
    await writeFile(inside, csv);
    const alias = join(fixture.root, "alias.csv");
    await symlink(inside, alias, "file");
    await expect(refreshSheetBundle({ ...fixture, inputFiles: { csv: alias }, compute: async () => ({ "result.csv": "evil" }) })).rejects.toThrow(/input|collision/i);
    expect(await readFile(inside, "utf8")).toBe(csv);
  });
  test("detects changed, missing and corrupt artifacts or metadata", async () => {
    const fixture = await setup();
    const result = await refreshSheetBundle({ ...fixture, compute: async () => ({ "result.csv": "first" }) });
    await rm(result.artifacts["result.csv"]!.path);
    expect((await readCurrentBundle(fixture.outputDir)).state).toBe("stale");
    await writeFile(result.artifacts["result.csv"]!.path, "wrong");
    const tampered = await readCurrentBundle(fixture.outputDir);
    expect(tampered.state).toBe("stale");
    expect(tampered.staleReasons).toContain("Artifact changed: result.csv");
    await writeFile(join(fixture.outputDir, "current.json"), '{"version":1,"generation":"../escape"}');
    expect((await readCurrentBundle(fixture.outputDir)).state).toBe("stale");
  });
  test("rejects output control-directory symlinks without changing previous publication", async () => {
    const fixture = await setup();
    const first = await refreshSheetBundle({ ...fixture, compute: async () => ({ "result.csv": "first" }) });
    const pointer = await readFile(join(fixture.outputDir, "current.json"), "utf8");
    const external = join(fixture.root, "external");
    await mkdir(external);
    await rm(join(fixture.outputDir, "generations"), { recursive: true });
    await symlink(external, join(fixture.outputDir, "generations"), directoryLinkType);
    await expect(refreshSheetBundle({ ...fixture, compute: async () => ({ "result.csv": "second" }) })).rejects.toThrow(/symlink/i);
    expect(await readFile(join(fixture.outputDir, "current.json"), "utf8")).toBe(pointer);
    expect(await readdir(external)).toEqual([]);
    expect((await readCurrentBundle(fixture.outputDir)).state).toBe("stale");
    expect(first.generationPath).toContain("generations");
  });
  test.skipIf(!fileSymlinksAvailable)("treats replacing the input symlink as a conflict even when bytes match", async () => {
    const fixture = await setup();
    const same = join(fixture.root, "same.csv");
    const alias = join(fixture.root, "alias.csv");
    await writeFile(same, csv);
    await symlink(fixture.input, alias, "file");
    await expect(refreshSheetBundle({ ...fixture, inputFiles: { csv: alias }, compute: async () => {
      await rm(alias);
      await symlink(same, alias, "file");
      return { "result.csv": "second" };
    } })).rejects.toThrow(/changed|conflict/i);
  });
});
