import { expect, test } from "bun:test";
import { registrationLines, unresolvedRunnerCalls } from "./runner-registry";

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
