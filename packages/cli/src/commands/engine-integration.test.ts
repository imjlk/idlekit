import { describe, expect, it } from "bun:test";
import { resolve } from "path";
import Ajv2020 from "ajv/dist/2020";
import {
  createTempDir,
  readJson,
  readSchema,
  readText,
  removePath,
  runCli,
  runCliFailure,
  runCliJson,
  writeText,
} from "../testkit/bun";

const ajv = new Ajv2020({ allErrors: true, strict: true });
const EXAMPLE = "../../examples/engine-integration";
const SCENARIO = `${EXAMPLE}/scenario.json`;
const PLUGIN = `${EXAMPLE}/ts-runtime/runtime-plugin.ts`;
// Windows checkouts may convert committed text to CRLF; compare content, not line endings.
const readLf = async (path: string) => (await readText(path)).replaceAll("\r\n", "\n");
const PLUGIN_FLAGS = ["--plugin", PLUGIN, "--allow-plugin", "true"];

async function expectSchema(name: string, value: unknown): Promise<void> {
  const schema = (await readSchema(name)) as { $id?: string };
  if (schema.$id) ajv.removeSchema(schema.$id);
  const validate = ajv.compile(schema);
  const ok = validate(value);
  if (!ok) throw new Error(`${name}: ${JSON.stringify(validate.errors)}`);
}

describe("idk export engine", () => {
  it("writes the generic intermediate document that matches its schema", async () => {
    const doc = runCliJson(["export", "engine", SCENARIO, "--levels", "5"]);
    await expectSchema("engine-params.v1.schema.json", doc);
    expect(doc.format).toBe("idlekit.engine-params");
    expect(doc.model).toEqual({ id: "linear", version: 1 });
    expect(doc.parameters.map((p: { key: string }) => p.key)).toEqual([
      "incomePerSec",
      "buyCostBase",
      "buyCostGrowth",
      "buyIncomeDelta",
    ]);
    expect(doc.levels.rows).toHaveLength(5);
    expect(doc.levels.rows[0]).toEqual({ level: 0, cost: "12", totalCost: "0", incomePerSec: "1" });
    expect(doc.levels.rows[1]).toEqual({ level: 1, cost: "13.32", totalCost: "12", incomePerSec: "2.35" });
    expect(doc.curves.map((c: { id: string }) => c.id)).toEqual(["buy.generator.cost", "income"]);
  });

  it("is deterministic and matches the committed example exports", async () => {
    const a = runCli(["export", "engine", SCENARIO, "--levels", "25"]).stdout;
    const b = runCli(["export", "engine", SCENARIO, "--levels", "25"]).stdout;
    expect(a).toBe(b);
    // The CLI version is stamped into the export; ignore it so a release version bump does not fail this test.
    const withoutCliVersion = (text: string) => text.replace(/"cliVersion": "[^"]*"/g, '"cliVersion": "<version>"');
    expect(withoutCliVersion(a)).toBe(withoutCliVersion(await readLf(resolve(EXAMPLE, "cafe.engine-params.json"))));
    const tres = runCli(["export", "engine", SCENARIO, "--target", "godot", "--levels", "25"]).stdout;
    expect(tres).toBe(await readLf(resolve(EXAMPLE, "godot/data/cafe_economy.tres")));
    const unity = runCli(["export", "engine", SCENARIO, "--target", "unity", "--levels", "25"]).stdout;
    expect(unity).toBe(await readLf(resolve(EXAMPLE, "unity/cafe_economy.json")));
  });

  it("renders a Godot resource bound to the IdlekitEconomy script", () => {
    const tres = runCli(["export", "engine", SCENARIO, "--target", "godot", "--levels", "3", "--godot-script", "res://econ.gd"]).stdout;
    expect(tres.startsWith('[gd_resource type="Resource" script_class="IdlekitEconomy" load_steps=2 format=3]')).toBe(true);
    expect(tres).toContain('[ext_resource type="Script" path="res://econ.gd" id="1_idlekit"]');
    expect(tres).toContain("cost_table = PackedFloat64Array(12.0, 13.32, 14.7852)");
    expect(tres).toContain("income_table = PackedFloat64Array(1.0, 2.35, 3.7)");
    expect(tres).toContain('"buyCostGrowth": 1.11');
  });

  it("renders Godot JSON, Unity JSON, and Unity CSV", () => {
    const godot = JSON.parse(runCli(["export", "engine", SCENARIO, "--target", "godot", "--file-format", "json", "--levels", "2"]).stdout);
    expect(godot.cost_table).toEqual([12, 13.32]);
    expect(godot.parameters.buyCostBase).toBe(12);
    const unity = runCliJson(["export", "engine", SCENARIO, "--target", "unity", "--levels", "2"]);
    expect(unity.levels).toEqual([
      { level: 0, cost: 12, costText: "12", totalCost: 0, incomePerSec: 1 },
      { level: 1, cost: 13.32, costText: "13.32", totalCost: 12, incomePerSec: 2.35 },
    ]);
    expect(unity.parameters[2]).toEqual({ key: "buyCostGrowth", type: "number", role: "growth", text: "1.11", value: 1.11 });
    const levels = runCli(["export", "engine", SCENARIO, "--target", "unity", "--file-format", "csv", "--levels", "2"]).stdout;
    expect(levels).toBe("level,cost,totalCost,incomePerSec\n0,12,0,1\n1,13.32,12,2.35\n");
    const params = runCli([
      "export", "engine", SCENARIO, "--target", "unity", "--file-format", "csv", "--csv-table", "parameters",
    ]).stdout;
    expect(params.split("\n")[0]).toBe("key,type,role,value");
    expect(params).toContain("buyCostBase,amount,cost,12");
  });

  it("rejects a file format the target does not support", () => {
    const failed = runCliFailure(["export", "engine", SCENARIO, "--target", "godot", "--file-format", "csv"]);
    expect(failed.exitCode).not.toBe(0);
    expect(`${failed.stdout}${failed.stderr}`).toContain("csv");
  });
});

describe("idk import scenario", () => {
  it("round-trips an engine export back to a valid scenario", async () => {
    const dir = await createTempDir("idk-engine-roundtrip");
    try {
      const params = resolve(dir, "params.json");
      const scenario = resolve(dir, "scenario.json");
      runCli(["export", "engine", SCENARIO, "--out", params]);
      runCli(["import", "scenario", params, "--out", scenario]);
      const original = await readJson<Record<string, any>>(resolve(EXAMPLE, "scenario.json"));
      const imported = await readJson<Record<string, any>>(scenario);
      expect(imported.model).toEqual(original.model);
      expect(imported.clock).toEqual(original.clock);
      expect(imported.policy).toEqual(original.policy);
      expect(imported.initial).toEqual(original.initial);
      expect(imported.strategy).toEqual(original.strategy);
      expect(runCli(["validate", scenario]).stdout).toContain("OK");
    } finally {
      await removePath(dir);
    }
  });

  it("fits a level table with suffixes and per-minute income", async () => {
    const dir = await createTempDir("idk-import-fit");
    try {
      const out = resolve(dir, "scenario.json");
      const reportPath = resolve(dir, "report.json");
      runCli([
        "import", "scenario", `${EXAMPLE}/import/shop-levels.csv`,
        "--mapping", `${EXAMPLE}/import/shop-levels.mapping.json`,
        "--out", out, "--report-out", reportPath,
      ]);
      const scenario = await readJson<Record<string, any>>(out);
      const report = await readJson<Record<string, any>>(reportPath);
      expect(scenario.meta.id).toBe("imported-shop");
      expect(scenario.model.params.incomePerSec).toBe("0.5");
      expect(scenario.model.params.buyIncomeDelta).toBe("0.25");
      expect(Number(scenario.model.params.buyCostBase)).toBeCloseTo(25, 1);
      expect(scenario.model.params.buyCostGrowth).toBeCloseTo(1.12, 4);
      expect(scenario.initial.wallet.amount).toBe("50");
      expect(report.rowsSelected).toBe(21);
      expect(report.fits.cost.r2).toBeGreaterThan(0.9999);
      expect(report.params.every((p: { source: string }) => p.source === "fit")).toBe(true);
      expect(runCli(["validate", out]).stdout).toContain("OK");
    } finally {
      await removePath(dir);
    }
  });

  it("maps nested JSON fields, filters rows, and converts hourly rates", async () => {
    const scenario = runCliJson([
      "import", "scenario", `${EXAMPLE}/import/balance-sheet.json`,
      "--mapping", `${EXAMPLE}/import/balance-sheet.mapping.json`,
    ]);
    expect(scenario.meta.id).toBe("imported-mine");
    expect(scenario.unit).toEqual({ code: "GOLD", symbol: "G" });
    expect(scenario.model.params).toEqual({
      buyCostBase: "12000",
      buyCostGrowth: 1.14,
      buyIncomeDelta: "2.5",
      incomePerSec: "5",
    });
    expect(scenario.initial.wallet.amount).toBe("2500");
    expect(scenario.initial.vars).toEqual({ owned: 0 });
  });

  it("fills unmapped linear parameters with defaults and warns", async () => {
    const dir = await createTempDir("idk-import-defaults");
    try {
      const table = resolve(dir, "table.csv");
      const mapping = resolve(dir, "mapping.json");
      await writeText(table, "name,base_cost\nstarter,\"1,500\"\n");
      await writeText(
        mapping,
        JSON.stringify({
          format: "idlekit.import-mapping",
          formatVersion: 1,
          scenario: { id: "defaults", unit: { code: "COIN" }, clock: { stepSec: 1, durationSec: 60 } },
          model: { params: { buyCostBase: { from: "base_cost" } } },
        }),
      );
      const result = runCli(["import", "scenario", table, "--mapping", mapping]);
      const scenario = JSON.parse(result.stdout);
      expect(scenario.model.params).toEqual({
        buyCostBase: "1500",
        buyCostGrowth: 1.15,
        buyIncomeDelta: "1",
        incomePerSec: "1",
      });
      expect(result.stderr).toContain("incomePerSec is not mapped");
    } finally {
      await removePath(dir);
    }
  });

  it("rejects an invalid mapping and an unknown linear parameter", async () => {
    const dir = await createTempDir("idk-import-invalid");
    try {
      const table = resolve(dir, "table.csv");
      const mapping = resolve(dir, "mapping.json");
      await writeText(table, "a\n1\n");
      await writeText(mapping, JSON.stringify({ format: "idlekit.import-mapping", formatVersion: 2 }));
      expect(runCliFailure(["import", "scenario", table, "--mapping", mapping]).exitCode).not.toBe(0);
      await writeText(
        mapping,
        JSON.stringify({
          format: "idlekit.import-mapping",
          formatVersion: 1,
          scenario: { id: "x", unit: { code: "COIN" }, clock: { stepSec: 1 } },
          model: { params: { nope: { from: "a" } } },
        }),
      );
      const failed = runCliFailure(["import", "scenario", table, "--mapping", mapping]);
      expect(`${failed.stdout}${failed.stderr}`).toContain("not a linear model parameter");
      expect(runCliFailure(["import", "scenario", table]).exitCode).not.toBe(0);
    } finally {
      await removePath(dir);
    }
  });

  it("example mappings match the import mapping schema", async () => {
    for (const name of ["shop-levels", "balance-sheet"]) {
      await expectSchema("import-mapping.v1.schema.json", await readJson(resolve(EXAMPLE, `import/${name}.mapping.json`)));
    }
  });
});

describe("idk verify runtime", () => {
  it("passes when the runtime matches the model and follows the output schema", async () => {
    const out = runCliJson([
      "verify", "runtime", SCENARIO, ...PLUGIN_FLAGS, "--runtime", "cafe.runtime.exact", "--seed", "7", "--format", "json",
    ]);
    await expectSchema("runtime.verify.output.schema.json", out);
    expect(out.ok).toBe(true);
    expect(out.seed).toBe(7);
    expect(out._meta.seed).toBe(7);
    expect(out.samples).toBe(1201);
    expect(out.metrics.map((m: { metric: string; mismatches: number }) => [m.metric, m.mismatches])).toEqual([
      ["incomePerSec", 0],
      ["cost:buy.generator", 0],
    ]);
  });

  it("reports rounding differences and exits non-zero", async () => {
    const dir = await createTempDir("idk-verify-runtime");
    try {
      const outPath = resolve(dir, "verify.json");
      const failed = runCliFailure([
        "verify", "runtime", SCENARIO, ...PLUGIN_FLAGS, "--runtime", "cafe.runtime", "--seed", "7", "--max-rows", "2", "--out", outPath,
      ]);
      expect(failed.exitCode).toBe(1);
      const out = await readJson<Record<string, any>>(outPath);
      await expectSchema("runtime.verify.output.schema.json", out);
      expect(out.ok).toBe(false);
      expect(out.firstMismatch).toMatchObject({ metric: "cost:buy.generator", idlekit: 13.32, runtime: 14, vars: { owned: 1 } });
      expect(out.mismatches).toHaveLength(2);
      expect(out.truncatedMismatches).toBeGreaterThan(0);
    } finally {
      await removePath(dir);
    }
  });

  it("accepts the rounding with an absolute tolerance and can report without failing", () => {
    const tolerated = runCliJson([
      "verify", "runtime", SCENARIO, ...PLUGIN_FLAGS, "--runtime", "cafe.runtime", "--seed", "7", "--abs-tolerance", "1", "--format", "json",
    ]);
    expect(tolerated.ok).toBe(true);
    const reported = runCli([
      "verify", "runtime", SCENARIO, ...PLUGIN_FLAGS, "--runtime", "cafe.runtime", "--fail-on-mismatch", "false", "--format", "md",
    ]);
    expect(reported.exitCode).toBe(0);
    expect(reported.stdout).toContain("# Runtime verification: cafe.runtime");
    expect(reported.stdout).toContain("FAIL");
  });

  it("is deterministic for a seed and derives a stable seed when none is given", () => {
    const args = ["verify", "runtime", SCENARIO, ...PLUGIN_FLAGS, "--runtime", "cafe.runtime.exact", "--trace-every", "60", "--format", "json"];
    const a = runCliJson(args);
    const b = runCliJson(args);
    const strip = (x: Record<string, any>) => ({ ...x, _meta: undefined });
    expect(strip(a)).toEqual(strip(b));
    expect(Number.isInteger(a.seed)).toBe(true);
    expect(a.samples).toBe(21);
  });

  it("fails clearly for an unknown runtime id", () => {
    const failed = runCliFailure(["verify", "runtime", SCENARIO, ...PLUGIN_FLAGS, "--runtime", "missing.runtime"]);
    expect(failed.exitCode).not.toBe(0);
    expect(`${failed.stdout}${failed.stderr}`).toContain("missing.runtime");
  });
});
