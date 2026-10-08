import { expect, test } from "bun:test";
import {
  duplicateFullNamesAcross,
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
