import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, resolve } from "node:path";

// npm reads the manifest it sends to the registry before prepack runs, so a lifecycle-only
// rewrite reaches the tarball but not the registry metadata that installers resolve.
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const packages = [
  { dir: "money", dependencies: {} },
  { dir: "core", dependencies: { "@idlekit/money": "workspace:*" } },
  { dir: "cli", dependencies: { "@idlekit/core": "workspace:*" } },
] as const;

type Upload = { name: string; versions: Record<string, { dependencies?: Record<string, string> }> };
let uploads: Upload[] = [];
let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      if (request.method !== "PUT") return new Response("{}", { status: 404 });
      uploads.push((await request.json()) as Upload);
      return Response.json({ ok: true });
    },
  });
});
afterAll(() => server.stop(true));

async function createFixture(): Promise<{ root: string; originals: Map<string, string> }> {
  const root = await mkdtemp(resolve(tmpdir(), "idlekit-publish-manifest-"));
  await mkdir(resolve(root, "tools"));
  await Bun.write(resolve(root, "tools/package-manifest.ts"), await readFile(resolve(import.meta.dir, "package-manifest.ts")));
  await Bun.write(resolve(root, ".npmrc"), `registry=${server.url.href}\n//127.0.0.1:${server.port}/:_authToken=fixture-token\n`);
  const originals = new Map<string, string>();
  for (const pkg of packages) {
    const dir = resolve(root, "packages", pkg.dir);
    const manifest = `${JSON.stringify({
      name: `@idlekit/${pkg.dir}`,
      version: "0.2.0",
      files: ["index.js"],
      dependencies: pkg.dependencies,
      scripts: {
        prepack: `cd ../.. && bun tools/package-manifest.ts prepare packages/${pkg.dir}`,
        postpack: `cd ../.. && bun tools/package-manifest.ts restore packages/${pkg.dir}`,
      },
    }, null, 2)}\n`;
    await Bun.write(resolve(dir, "index.js"), "export {};\n");
    await Bun.write(resolve(dir, "package.json"), manifest);
    originals.set(pkg.dir, manifest);
  }
  return { root, originals };
}

// Async: a synchronous spawn would block the in-process registry the publish talks to.
async function run(command: string[], cwd: string, root: string): Promise<void> {
  const env: Record<string, string | undefined> = {
    ...process.env,
    PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ""}`,
    NPM_CONFIG_USERCONFIG: resolve(root, ".npmrc"),
  };
  for (const key of Object.keys(env)) {
    if (/^(npm_config_|NODE_AUTH_TOKEN$)/i.test(key) && key !== "NPM_CONFIG_USERCONFIG") delete env[key];
  }
  const child = Bun.spawn(command, { cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (exitCode !== 0) throw new Error(`${command.join(" ")} exited ${exitCode}\n${stderr}${stdout}`);
}

/** Sampo validates every package with --dry-run before the real publish, in dependency order. */
async function publishLikeSampo(root: string): Promise<void> {
  for (const args of [["--dry-run"], []]) {
    for (const pkg of packages) await run([npm, "publish", "--access", "public", ...args], resolve(root, "packages", pkg.dir), root);
  }
}

test("registry metadata carries concrete internal versions after a held publish", async () => {
  const { root, originals } = await createFixture();
  uploads = [];
  try {
    await run([process.execPath, "tools/package-manifest.ts", "hold"], root, root);
    try {
      await publishLikeSampo(root);
    } finally {
      await run([process.execPath, "tools/package-manifest.ts", "release"], root, root);
    }

    expect(uploads.map((upload) => upload.name)).toEqual(packages.map((pkg) => `@idlekit/${pkg.dir}`));
    const dependencies = Object.fromEntries(uploads.map((upload) => [upload.name, upload.versions["0.2.0"]?.dependencies ?? {}]));
    expect(dependencies).toEqual({
      "@idlekit/money": {},
      "@idlekit/core": { "@idlekit/money": "0.2.0" },
      "@idlekit/cli": { "@idlekit/core": "0.2.0" },
    });
    for (const pkg of packages) {
      const dir = resolve(root, "packages", pkg.dir);
      expect(await Bun.file(resolve(dir, "package.json")).text()).toBe(originals.get(pkg.dir)!);
      expect(await Bun.file(resolve(dir, ".package.json.prepack.backup")).exists()).toBeFalse();
    }
    expect(await Bun.file(resolve(root, ".publish-manifests.hold")).exists()).toBeFalse();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);

test("release restores every manifest after a failed publish", async () => {
  const { root, originals } = await createFixture();
  try {
    await run([process.execPath, "tools/package-manifest.ts", "hold"], root, root);
    expect(await Bun.file(resolve(root, "packages/core/package.json")).text()).not.toContain("workspace:");
    await run([process.execPath, "tools/package-manifest.ts", "release"], root, root);
    for (const pkg of packages) {
      expect(await Bun.file(resolve(root, "packages", pkg.dir, "package.json")).text()).toBe(originals.get(pkg.dir)!);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("hold refuses an internal dependency it cannot resolve to a workspace version", async () => {
  const { root, originals } = await createFixture();
  try {
    const cli = resolve(root, "packages/cli/package.json");
    const broken = originals.get("cli")!.replace('"@idlekit/core"', '"@idlekit/missing"');
    await Bun.write(cli, broken);
    await expect(run([process.execPath, "tools/package-manifest.ts", "hold"], root, root)).rejects.toThrow("workspace:");
    expect(await Bun.file(cli).text()).toBe(broken);
    expect(await Bun.file(resolve(root, "packages/core/package.json")).text()).toBe(originals.get("core")!);
    expect(await Bun.file(resolve(root, ".publish-manifests.hold")).exists()).toBeFalse();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
