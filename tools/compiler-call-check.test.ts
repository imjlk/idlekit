import { describe, expect, it } from "bun:test";
import { compilerCallLeft } from "./compiler-call-check";

describe("compiler references in emitted JavaScript", () => {
  it("ignores documented calls, strings, regexes, and template text", () => {
    for (const source of [
      "/** @evidenceReview The call is typia.createValidate of ConcreteQuota. */ export const ok = true;",
      "// import '@ttsc/unplugin';\nexport const ok = true;",
      'const label = "typia.createValidate and @ttsc/unplugin";',
      "const pattern = /typia.createValidate/;",
      "const label = `typia.createValidate ${'@ttsc/unplugin'}`;",
      "import typia from 'typia'; typia.is(value);",
    ]) {
      expect(compilerCallLeft(source)).toBeFalse();
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
