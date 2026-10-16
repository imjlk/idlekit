import { describe, expect, it } from "bun:test";
import { compilerCallLeft } from "./compiler-call-check";
import { createRequire } from "node:module";
import { resolve } from "node:path";

describe("compiler references in emitted JavaScript", () => {
  it("ignores documented calls, strings, regexes, and template text", () => {
    for (const source of [
      "/** @evidenceReview The call is typia.createValidate of ConcreteQuota. */ export const ok = true;",
      "// import '@ttsc/unplugin';\nexport const ok = true;",
      'const label = "typia.createValidate and @ttsc/unplugin";',
      "const pattern = /typia.createValidate/;",
      "const label = `typia.createValidate ${'@ttsc/unplugin'}`;",
      "import typia from 'typia'; typia.is(value);",
      "import { createValidate as unusedFactory } from 'typia'; export const validate = value => value;",
      "const createValidate = () => value => value; createValidate();",
      "function NoTransformConfigurationError() { throw new Error(`no transform has been configured`); } function createValidate() { NoTransformConfigurationError('createValidate'); } const ns = __exportAll({ createValidate: () => createValidate }); export const validate = value => value;",
      "import { createValidate as factory } from 'typia'; export function validate(factory) { return factory(); }",
      "function NoTransformConfigurationError() { throw new Error(`no transform has been configured`); } function createValidate() { NoTransformConfigurationError('createValidate'); } export function validate(createValidate) { return createValidate(); }",
    ]) {
      expect(compilerCallLeft(source)).toBeFalse();
    }
  });

  it.each(["esm", "commonjs"] as const)("detects an actual untransformed Bun bundle using %s typia", async mode => {
    const root = resolve(import.meta.dir, "..");
    const require = createRequire(resolve(root, "package.json"));
    for (const entry of ["concrete.ts", "schema.ts"]) {
      const result = await Bun.build({
        entrypoints: [resolve(root, "fixtures/toolchain/typia-generic/src", entry)],
        target: "bun",
        format: "esm",
        plugins: mode === "commonjs" ? [{
          name: "typia-commonjs-control",
          setup(build) { build.onResolve({ filter: /^typia$/ }, () => ({ path: require.resolve("typia") })); },
        }] : [],
      });
      expect(result.success).toBeTrue();
      const output = await result.outputs[0]!.text();
      await expect(import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`)).rejects.toThrow("no transform has been configured");
      expect(compilerCallLeft(output)).toBeTrue();
    }
  });

  it("detects actual factory references, including template expressions", () => {
    for (const source of [
      "const validate = typia.createValidate();",
      "const schema = typia.json.schema();",
      "const factory = typia['createValidate'];",
      "typia?.createValidate?.();",
      "const text = `${`nested ${typia.createValidate()}`}`;",
      "import t from 'typia'; t.createValidate();",
      "import { createValidate as factory } from 'typia'; factory();",
      "import { json as j } from 'typia'; j.schema();",
    ]) {
      expect(compilerCallLeft(source)).toBeTrue();
    }
  });

  it("detects compiler module imports and reexports", () => {
    for (const source of [
      "import '@ttsc/unplugin';",
      "export * from '@ttsc/graph';",
      "export { default } from 'ttsc';",
      "const plugin = require('@ttsc/unplugin');",
      "const plugin = import('@ttsc/unplugin');",
      "const plugin = import(`@ttsc/unplugin`);",
      "const plugin = require(`@ttsc/unplugin`);",
      "const plugin = import(`@ttsc/${name}`);",
      "const plugin = require('@ttsc/' + name);",
      "import 'ttsc/lib/transform';",
    ]) {
      expect(compilerCallLeft(source)).toBeTrue();
    }
  });

  it("fails closed when emitted JavaScript is invalid", () => {
    expect(() => compilerCallLeft("export const = ;")).toThrow();
  });
});
