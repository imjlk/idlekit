import { expect, test } from "bun:test";
import { withFileLock } from "./_bun";

test("file locks serialize concurrent package operations", async () => {
  const key = `lock-test-${crypto.randomUUID()}`;
  const order: string[] = [];
  let release!: () => void;
  let started!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const entered = new Promise<void>((resolve) => { started = resolve; });
  const first = withFileLock(key, async () => {
    order.push("first");
    started();
    await held;
    return 1;
  });
  await Promise.race([entered, first]);
  const second = withFileLock(key, async () => {
    order.push("second");
    return 2;
  }, { pollMs: 5 });
  try {
    await Bun.sleep(20);
    expect(order).toEqual(["first"]);
  } finally {
    release();
  }
  expect(await Promise.all([first, second])).toEqual([1, 2]);
  expect(order).toEqual(["first", "second"]);
});

test("file locks release ownership when a package operation fails", async () => {
  const key = `lock-failure-${crypto.randomUUID()}`;
  await expect(withFileLock(key, async () => { throw new Error("operation failed"); })).rejects.toThrow("operation failed");
  expect(await withFileLock(key, async () => "next operation", { timeoutMs: 100 })).toBe("next operation");
});
