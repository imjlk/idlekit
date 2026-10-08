import { expect, test } from "bun:test";
import {
  duplicateFullNamesAcross,
  registeredSuites,
  registrationLines,
  unresolvedRunnerCalls,
} from "./runner-registry";

test("arrow parameters shadow runner imports without hiding later registrations", () => {
  for (const callback of [
    "(test) => test.t",
    "test => test.t",
    "(test: Row) => test.t",
    "(test) => { return test.t; }",
    "(test: Row): number => test.t",
    "async (test) => test.t",
    "({ value: test }) => test.t",
    "([test]) => test.t",
    "(...test) => test[0].t",
    "(test) => ({ value: test.t })",
    "(test) => `${test.t}`",
  ]) {
    const body = `import { test } from "bun:test"; rows.map(${callback}); test("real", callback);`;
    expect(unresolvedRunnerCalls(body)).toEqual([]);
    expect(registrationLines(body, "real")).toEqual([1]);
  }
});

test("parameter scopes end before following statements and restore namespace runners", () => {
  const body = `import { test } from "bun:test";
    import * as runners from "bun:test";
    const read = test => test.t
    test("real", callback);
    rows.map((runners) => runners.test);
    runners.test("namespace", callback);
    function value(test: Row): number { return test.t; }
    const run: (title: string, callback: () => void) => void = test;
    run("typed", callback);`;
  expect(unresolvedRunnerCalls(body)).toEqual([]);
  expect(registrationLines(body, "real")).toEqual([4]);
  expect(registrationLines(body, "namespace")).toEqual([6]);
  expect(registrationLines(body, "typed")).toEqual([9]);
});

test("scoped parameters do not receive evidence credit as imported runners", () => {
  const body = `import { test } from "bun:test";
    rows.forEach((test) => test("fake", callback));
    test("real", callback);`;
  expect(registrationLines(body, "fake")).toEqual([]);
  expect(registrationLines(body, "real")).toEqual([3]);
  expect(unresolvedRunnerCalls(body)).toContain("test");
});

test("typed runner containers retain their signal through object and array spreads", () => {
  for (const [type, value, copy, call] of [
    ["Runners", "{ run: it }", "{ ...hidden }", "copied.run"],
    ["readonly unknown[]", "[it]", "[...hidden]", "copied[0]"],
  ]) {
    const make = (typed: boolean) => `import { it } from "bun:test";
      const hidden${typed ? `: ${type}` : ""} = ${value};
      const copied = ${copy};
      ${call}("fake", callback);`;
    const untyped = unresolvedRunnerCalls(make(false));
    expect(untyped).toContain("copied");
    expect(unresolvedRunnerCalls(make(true))).toEqual(untyped);
  }
});

test("typed data containers and genuine typed runner aliases stay distinct", () => {
  const body = `import { test } from "bun:test";
    const hidden: Data = { run: 42 };
    const copied = { ...hidden };
    consume(copied);
    const run: typeof test = test;
    run("real", callback);`;
  expect(unresolvedRunnerCalls(body)).toEqual([]);
  expect(registrationLines(body, "real")).toEqual([6]);
});

test("bodyless signatures do not shadow the next registration", () => {
  for (const declaration of [
    "declare function helper(test: string): void;",
    "function helper(test: string): void;",
  ]) {
    const body = `import { test } from "bun:test"; ${declaration} test("real", () => {});`;
    expect(registrationLines(body, "real")).toEqual([1]);
    expect(unresolvedRunnerCalls(body)).toEqual([]);
  }
});

test("expression parameter scopes end before a standalone block", () => {
  const body = `import { test } from "bun:test";
    const f = test => test
    { test("real", () => {}); }`;
  expect(registrationLines(body, "real")).toEqual([3]);
  expect(unresolvedRunnerCalls(body)).toEqual([]);
});

test("conditional separators do not become arrow return annotations", () => {
  const body = `import { test } from "bun:test";
    const f = condition ? (test) : () => test("real", () => {});`;
  expect(registrationLines(body, "real")).toEqual([2]);
});

test("optional parameter annotations do not bind referenced runner names", () => {
  const body = `import { test as run } from "bun:test";
    function helper(value?: typeof run) { run("real", () => {}); }`;
  expect(registrationLines(body, "real")).toEqual([2]);
  expect(unresolvedRunnerCalls(body)).toEqual([]);
});

test("destructured defaults reference runners without binding them", () => {
  for (const pattern of ["{ value = run }", "{ value: alias = run }", "[value = run]"]) {
    const body = `import { test as run } from "bun:test";
      const helper = (${pattern}: Options) => run("real", () => {});`;
    expect(registrationLines(body, "real")).toEqual([2]);
  }
});

test("typed declarations without initializers end at ASI boundaries", () => {
  for (const annotation of ["unknown", "unknown // no initializer", "unknown /* comment\n */"]) {
    const body = `import { test } from "bun:test";
      let placeholder: ${annotation}
      const run = test;
      run("real", () => {});`;
    expect(registrationLines(body, "real")).toEqual([body.split("\n").length]);
    expect(unresolvedRunnerCalls(body)).toEqual([]);
  }
  const continued = `import { test } from "bun:test";
    const run:
      | typeof test
      | never
      = test;
    run("real", () => {});`;
  expect(registrationLines(continued, "real")).toEqual([6]);
});

test("local classes in typed containers do not inherit imported runner identity", () => {
  const body = `import { test as Runner } from "bun:test";
    {
      class Runner {};
      const hidden: Data = { value: Runner };
      const copied = { ...hidden };
      consume(copied.value);
    }
    Runner("real", () => {});`;
  expect(unresolvedRunnerCalls(body)).toEqual([]);
  expect(registrationLines(body, "real")).toEqual([8]);
  const expression = `import { test as Runner } from "bun:test";
    const Carrier = class Runner { value: Data = { local: Runner }; };
    const hidden: Data = { value: Runner };
    const copied = { ...hidden };
    copied.value("fake", () => {});`;
  expect(unresolvedRunnerCalls(expression)).toContain("copied");
});

test("multiline import types preserve registrations", () => {
  for (const annotation of ["typeof\nimport(\"bun:test\").test", "\nimport(\"bun:test\").test"]) {
    const body = `import { test } from "bun:test";
      const run: ${annotation} = test;
      run("real", () => {});`;
    expect(registrationLines(body, "real")).toEqual([body.split("\n").length]);
    expect(unresolvedRunnerCalls(body)).toEqual([]);
  }
});

test("template literal parameter types preserve registrations", () => {
  for (const type of ["`foo,bar`", "`foo;bar`", "`foo=bar`", "`foo)bar`"]) {
    const body = `import { test } from "bun:test";
      function helper(value: ${type}) { test("real", () => {}); }`;
    expect(registrationLines(body, "real")).toEqual([2]);
    expect(unresolvedRunnerCalls(body)).toEqual([]);
  }
});

test("local function shadows and ordinary class constructors remain data", () => {
  for (const declaration of ["function Runner() {}", "async function Runner() {}", "function* Runner() {}"]) {
    const body = `import { test as Runner } from "bun:test";
    {
      ${declaration};
      const hidden: Data = { value: Runner };
      const copied = { ...hidden };
      consume(copied.value);
    }
    Runner("real", () => {});
    class Fault extends Error {}
    throw new Fault("message");`;
    expect(unresolvedRunnerCalls(body)).toEqual([]);
    expect(registrationLines(body, "real")).toEqual([8]);
  }
});

test("captured imported runners register across helpers while passed parameters stay opaque", () => {
  const captured = `import { it } from "bun:test";
    export function register() { it("real", callback); }`;
  const forwarded = `export function register(it) { it("fake", callback); }`;
  expect(registrationLines(captured, "real")).toEqual([2]);
  expect(unresolvedRunnerCalls(captured)).toEqual([]);
  expect(registrationLines(forwarded, "fake")).toEqual([]);
  expect(unresolvedRunnerCalls(forwarded)).toContain("it");
  expect(duplicateFullNamesAcross([captured, 'it("real", callback);'])).toEqual(["real"]);
});

test("function return types do not introduce runtime parameter shadows", () => {
  const body = `import { test as run } from "bun:test";
    const f = (value): (run: string) => void => (run("real", () => {}), (_arg: string) => {});`;
  expect(registrationLines(body, "real")).toEqual([2]);
  expect(unresolvedRunnerCalls(body)).toEqual([]);
});

test("comments before conditional operands do not change parameter scopes", () => {
  for (const comment of ["/* note */", "// note\n"]) {
    const body = `import { test } from "bun:test";
      const f = condition ? ${comment} (test) : () => test("real", () => {});`;
    expect(registrationLines(body, "real")).toEqual([body.split("\n").length]);
  }
});

test("consequent arrow scopes end at the owning conditional separator", () => {
  const body = `import { test } from "bun:test";
    const f = condition ? test => test.name : test("real", () => {});
    const g = test => condition ? test.name : test.title;
    test("later", () => {});`;
  expect(registrationLines(body, "real")).toEqual([2]);
  expect(registrationLines(body, "later")).toEqual([4]);
  expect(unresolvedRunnerCalls(body)).toEqual([]);
});

test("annotation comment delimiters do not truncate runtime scopes", () => {
  for (const comment of ["/* , */", "/* ; */", "/* = */", "// , ; =\n"]) {
    const body = `import { test } from "bun:test";
      function helper(value: Type ${comment}) { test("real", () => {}); }`;
    expect(registrationLines(body, "real")).toEqual([body.split("\n").length]);
    expect(unresolvedRunnerCalls(body)).toEqual([]);
  }
});

test("namespace blocks contain their local class shadows", () => {
  const body = `import { test as Runner } from "bun:test";
    namespace Tools {
      class Runner {}
      const hidden: Data = { value: Runner };
      const copied = { ...hidden };
      consume(copied.value);
    }
    Runner("real", () => {});`;
  expect(unresolvedRunnerCalls(body)).toEqual([]);
  expect(registrationLines(body, "real")).toEqual([8]);
});

test("method names and getter modifiers are not runner calls", () => {
  const body = `import { test } from "bun:test";
    import * as get from "bun:test";
    const data = { test(value) { return value.name; } };
    class Carrier { test(value) { return value.name; } get value() { return 42; } }
    test("real", () => {});
    get.test("namespace", () => {});`;
  expect(unresolvedRunnerCalls(body)).toEqual([]);
  expect(registrationLines(body, "real")).toEqual([5]);
  expect(registrationLines(body, "namespace")).toEqual([6]);
});

test("switch case shadows do not hide discriminant registrations", () => {
  const body = `import { test } from "bun:test";
    switch (test("real", callback)) { case 1: class test {} }`;
  expect(registrationLines(body, "real")).toEqual([2]);
});

test("type declarations at offset zero do not bypass runtime shadows", () => {
  const body = 'type Row = string; class test {}; if (false) test("fake", callback);';
  expect(registrationLines(body, "fake")).toEqual([]);
});

test("enum declarations shadow imports without turning data into runner containers", () => {
  const body = `import { test as Runner } from "bun:test";
    { enum Runner { Value }; const hidden: Data = { value: Runner }; const copied = { ...hidden }; consume(copied.value); }
    Runner("real", callback);`;
  expect(unresolvedRunnerCalls(body)).toEqual([]);
  expect(registrationLines(body, "real")).toEqual([3]);
  const held = `import { test as real } from "bun:test"; enum Holder { Value = real as any }`;
  expect(unresolvedRunnerCalls(held)).toContain("real");
});

test("ordinary destructuring bindings shadow runner imports", () => {
  for (const pattern of ["{ Runner }", "{ value: Runner }", "[Runner]"]) {
    const body = `import { test as Runner } from "bun:test";
      { const ${pattern} = data; const hidden: Data = { value: Runner }; const copied = { ...hidden }; consume(copied.value); }
      Runner("real", callback);`;
    expect(unresolvedRunnerCalls(body)).toEqual([]);
    expect(registrationLines(body, "real")).toEqual([3]);
  }
});

test("parameter decorators use the surrounding runner binding", () => {
  const body = `import { test } from "bun:test";
    class Carrier { method(first: string, @decorate(test("real", callback)) test: string) {} }`;
  expect(registrationLines(body, "real")).toEqual([2]);
  expect(unresolvedRunnerCalls(body)).toEqual([]);
});

test("scoped declaration aliases do not prevent loop binding cleanup", () => {
  for (const declaration of ["class Local {}", "function Local() {}", "enum Local { Value }"]) {
    const body = `import { test as run } from "bun:test";
      for (const run = ordinary; false;) { ${declaration} }
      run("real", callback);`;
    expect(registrationLines(body, "real")).toEqual([3]);
    expect(unresolvedRunnerCalls(body)).toEqual([]);
  }
});

test("parameter rebindings expire with expression-bodied arrows", () => {
  for (const value of ["ordinary", "{ held: it }", 'require("bun:test")']) {
    const body = `import { it } from "bun:test"; const f = (it) => (it = ${value}); it("real", callback);`;
    expect(registrationLines(body, "real")).toEqual([1]);
    expect(unresolvedRunnerCalls(body)).toEqual([]);
  }
});

test("nested runtime namespace bindings shadow runner imports", () => {
  const body = `import { test as Runner } from "bun:test";
    namespace Tools { namespace Runner {}; const hidden: Data = { value: Runner }; const copied = { ...hidden }; consume(copied.value); }
    Runner("real", callback);`;
  expect(unresolvedRunnerCalls(body)).toEqual([]);
  expect(registrationLines(body, "real")).toEqual([3]);
});

test("hoisted ordinary bindings shadow imports before container inference", () => {
  const body = `import { test as Runner } from "bun:test";
    function f() { if (false) { const hidden: Data = { value: Runner }; const copied = { ...hidden }; consume(copied.value); } var Runner = ordinary; }
    Runner("real", callback);`;
  expect(unresolvedRunnerCalls(body)).toEqual([]);
  expect(registrationLines(body, "real")).toEqual([3]);
});

test("object methods and accessors do not store body runner references", () => {
  for (const method of ["method() { void it; }", "get method() { void it; return ordinary; }", "set method(next) { void it; }"]) {
    const body = `import { it } from "bun:test"; const hidden: Data = { ${method} }; const copied = { ...hidden }; consume(copied.method);`;
    expect(unresolvedRunnerCalls(body)).toEqual([]);
  }
});

test("local arrow helpers with string arguments remain ordinary functions", () => {
  const body = `function f() { const goal = (id, at) => ({ id, met: (state) => state.t >= at }); goal("never", Infinity); }`;
  expect(unresolvedRunnerCalls(body)).toEqual([]);
});

test("typed declarations end before an ASI assignment statement", () => {
  const body = `import { test } from "bun:test"; let run = ordinary; let placeholder: unknown
    run = test; run("real", callback);`;
  expect(registrationLines(body, "real")).toEqual([2]);
  expect(unresolvedRunnerCalls(body)).toEqual([]);
});

test("direct aliases preserve runner container identity", () => {
  for (const copy of ["hidden", "(hidden)", "hidden as Data"]) {
    const body = `import { it } from "bun:test"; const hidden: Data = { run: it }; const copied = ${copy}; copied.run("fake", callback);`;
    expect(unresolvedRunnerCalls(body)).toContain("copied");
    expect(registrationLines(body, "fake")).toEqual([]);
  }
});

test("parameter rebindings survive nested blocks", () => {
  const body = `import { it as runner } from "bun:test"; function f(it) { { it = runner; } it("real", callback); }`;
  expect(registrationLines(body, "real")).toEqual([1]);
  expect(unresolvedRunnerCalls(body)).toEqual([]);
});

test("runner-like arrow wrappers remain opaque", () => {
  const body = `const it = (title, _callback, runner) => runner(title, unrelated); it("credited", citedExport, realIt);`;
  expect(unresolvedRunnerCalls(body)).toContain("it");
  expect(registrationLines(body, "credited")).toEqual([]);
});

test("rebound suite helpers cannot credit their original callback", () => {
  const body = `let suiteBody = () => { it("credited", citedExport); }; suiteBody = () => { it("credited", unrelated); }; describe("s", suiteBody);`;
  expect(unresolvedRunnerCalls(body)).toContain("suiteBody");
  expect(registeredSuites(body, "citedExport", "credited").every((path) => path[0] !== "s")).toBe(true);
});

test("destructuring assignments update shadowing parameters", () => {
  for (const assignment of ["({ it } = { it: runner })", "({ run: it } = { run: runner })", "([it] = [runner])"]) {
    const body = `import { it as runner } from "bun:test"; function f(it) { ${assignment}; it("real", callback); }`;
    expect(registrationLines(body, "real")).toEqual([1]);
    expect(unresolvedRunnerCalls(body)).toEqual([]);
  }
});

test("enum member references do not inherit runner imports", () => {
  const body = `import { test } from "bun:test"; enum E { test, Copy = test } test("real", callback);`;
  expect(unresolvedRunnerCalls(body)).toEqual([]);
  expect(registrationLines(body, "real")).toEqual([1]);
});

test("deferred imports preserve later runner registrations", () => {
  const body = `import defer * as feature from "./feature.js";
    import { test } from "bun:test";
    test("real", callback);`;
  expect(registrationLines(body, "real")).toEqual([3]);
  expect(unresolvedRunnerCalls(body)).toEqual([]);
});

test("destructuring rebindings preserve statically selected defaults", () => {
  for (const assignment of ["({ it = runner } = {})", "({ it = runner } = { it: undefined })", "([it = runner] = [])", "([it = runner] = [void 0])"]) {
    const body = `import { it as runner } from "bun:test"; function f(it) { ${assignment}; it("real", callback); }`;
    expect(registrationLines(body, "real")).toEqual([1]);
    expect(unresolvedRunnerCalls(body)).toEqual([]);
  }
});

test("auto-accessor syntax preserves later runner registrations", () => {
  const body = `import { test } from "bun:test"; class State { accessor value = 0 } test("real", callback);`;
  expect(registrationLines(body, "real")).toEqual([1]);
  expect(unresolvedRunnerCalls(body)).toEqual([]);
});

test("canonical function wrappers remain opaque", () => {
  const body = `function it(title, cb, runner) { runner(title, cb); } it("credited", citedExport, realIt);`;
  expect(unresolvedRunnerCalls(body)).toContain("it");
  expect(registrationLines(body, "credited")).toEqual([]);
});

test("destructuring defaults follow the target assignment order", () => {
  const inherited = `import { it as runner } from "bun:test"; function f(a, b) { ([a, b = a] = [runner]); b("real", callback); }`;
  expect(registrationLines(inherited, "real")).toEqual([1]);
  expect(unresolvedRunnerCalls(inherited)).toEqual([]);
  const earlier = `import { it as runner } from "bun:test"; function f(a, b) { ([a = b, b] = [void 0, runner]); a("fake", callback); }`;
  expect(registrationLines(earlier, "fake")).toEqual([]);
  expect(unresolvedRunnerCalls(earlier)).toContain("a");
});

test("shadowed undefined and unknown properties do not select defaults", () => {
  for (const body of [
    `import { it as runner } from "bun:test"; function f(it, undefined) { ({ it = runner } = { it: undefined }); it("fake", callback); }`,
    `import { it as runner } from "bun:test"; const undefined = ordinary; function f(it) { ({ it = runner } = { it: undefined }); it("fake", callback); }`,
    `import { it as runner } from "bun:test"; function f(it) { ({ it = runner } = { ...data }); it("fake", callback); }`,
  ]) {
    expect(registrationLines(body, "fake")).toEqual([]);
    expect(unresolvedRunnerCalls(body)).toContain("it");
  }
});

test("conditional and logical values preserve runner containers", () => {
  for (const value of [
    "condition ? { run: it } : { run: ordinary }",
    "condition && { run: it }",
    "ordinary || { run: it }",
    "(condition && { run: ordinary }) || { run: it }",
    "((condition && { run: ordinary }) as Data) || { run: it }",
  ]) {
    const body = `import { it } from "bun:test"; const copied = ${value}; copied.run("fake", callback);`;
    expect(unresolvedRunnerCalls(body)).toContain("copied");
    expect(registrationLines(body, "fake")).toEqual([]);
  }
});

test("returning a bare runner container remains an unresolved escape", () => {
  for (const value of ["{ run: it }", "[it]"]) {
    const body = `import { it } from "bun:test"; const hidden = ${value}; function expose() { return hidden; }`;
    expect(unresolvedRunnerCalls(body)).toContain("return");
  }
});

test("class field names do not rewrite imported callbacks", () => {
  const body = `import { citedExport } from "./case"; class Carrier { citedExport = ordinary; } it("credited", citedExport);`;
  expect(registeredSuites(body, "citedExport", "credited")).toEqual([[]]);
  expect(unresolvedRunnerCalls(body)).toEqual([]);
});

test("conditional spread operands preserve runner containers", () => {
  for (const value of ["{ ...(condition ? { run: it } : {}) }", "[...(condition ? [it] : [])]", "{ ...(condition && { run: it }) }"]) {
    const body = `import { it } from "bun:test"; const copied = ${value}; consume(copied.run);`;
    expect(unresolvedRunnerCalls(body)).toContain("copied");
  }
});

test("erased ambient namespaces do not shadow global runners", () => {
  const body = `declare function test(title: string, callback: () => void): void; declare namespace test { type Metadata = string } test("real", callback);`;
  expect(registrationLines(body, "real")).toEqual([1]);
  expect(unresolvedRunnerCalls(body)).toEqual([]);
});

test("literal rest assignments retain unselected runner properties", () => {
  const body = `import { it } from "bun:test"; let copied: any; ({ value: ignored, ...copied } = { value: 0, run: it }); copied.run("fake", callback);`;
  expect(unresolvedRunnerCalls(body)).toContain("copied");
  expect(registrationLines(body, "fake")).toEqual([]);
  const excluded = `import { it } from "bun:test"; let copied: any; ({ run: ignored, ...copied } = { value: 0, run: it }); consume(copied.value);`;
  expect(unresolvedRunnerCalls(excluded)).toEqual([]);
});

test("class fields initialized from runner containers remain escapes", () => {
  for (const field of ["static handlers", "static handlers: Data", "handlers!: Data"]) {
    const body = `import { it } from "bun:test"; const hidden = { run: it }; class Carrier { ${field} = hidden; }`;
    expect(unresolvedRunnerCalls(body)).toContain("handlers");
    expect(unresolvedRunnerCalls(body.replace("run: it", "run: ordinary"))).toEqual([]);
  }
});

test("forwarding wrappers shadowing renamed runner imports remain opaque", () => {
  for (const wrapper of [
    "function run(title, cb, runner) { runner(title, cb); }",
    "const run = (title, cb, runner) => runner(title, cb);",
  ]) {
    const body = `import { it as run, it as realIt } from "bun:test";
      { ${wrapper} run("credited", citedExport, realIt); }
      run("real", () => {});`;
    expect(registrationLines(body, "credited")).toEqual([]);
    expect(unresolvedRunnerCalls(body)).toContain("run");
    expect(registrationLines(body, "real")).toEqual([3]);
  }
});

test("qualified namespace segments do not shadow runners outside their parent", () => {
  for (const declaration of ["namespace A.test {}", "namespace A.B.test {}"]) {
    const body = `namespace Outer { ${declaration} test("real", callback); }`;
    expect(registrationLines(body, "real")).toEqual([1]);
    expect(unresolvedRunnerCalls(body)).toEqual([]);
  }
});
