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
