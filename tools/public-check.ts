import { $ } from "bun";
import { dirname, resolve } from "path";
import { ROOT, ensureDir } from "./_bun";

type PackageManifest = Readonly<{
  name?: string;
  repository?: unknown;
  homepage?: unknown;
  bugs?: unknown;
  license?: unknown;
  publishConfig?: Readonly<{ access?: string }>;
}>;

const DOCS_WITH_KO = [
  "README.md",
  ".sampo/README.md",
  "docs/money-library.md",
  "docs/plugin-and-adapter.md",
  "docs/release-process.md",
  "docs/scenario-and-tuning.md",
  "docs/start-here-cli-designer.md",
  "docs/testing.md",
  "docs/tutorial-step-by-step.md",
  "docs/usage-guide.md",
  "docs/virtual-scenario-design.md",
  "docs/schemas/README.md",
  "examples/plugins/README.md",
  "examples/tutorials/README.md",
] as const;
const PUBLIC_JSON_FILES = ["examples/bench/kpi-baseline.json"] as const;

const PACKAGE_DIRS = ["packages/money", "packages/core", "packages/cli"] as const;
const LOCAL_LINK = /\[[^\]]*]\((?!https?:\/\/|mailto:|#)([^)]+)\)/g;
const ABSOLUTE_LOCAL_PATH = /\/Users\/|[A-Z]:\\/;

function koVariantFor(path: string): string {
  if (path === "README.md") return "README_ko.md";
  const idx = path.lastIndexOf(".md");
  return `${path.slice(0, idx)}_ko.md`;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function localLinks(body: string): string[] {
  return [...body.matchAll(LOCAL_LINK)].map((match) => match[1]!).filter((href) => !href.startsWith("file:"));
}

async function checkMarkdownLinks(path: string): Promise<void> {
  const abs = resolve(ROOT, path);
  const body = await Bun.file(abs).text();
  assert(!ABSOLUTE_LOCAL_PATH.test(body), `${path} contains local absolute filesystem paths`);
  for (const href of localLinks(body)) {
    const target = href.split("#")[0]!;
    if (!target || target.startsWith("http")) continue;
    const resolved = resolve(dirname(abs), target);
    const proc = Bun.spawnSync(["test", "-e", resolved], { cwd: ROOT, stdout: "ignore", stderr: "ignore" });
    assert(proc.exitCode === 0, `${path} links to missing local target: ${href}`);
  }
}

async function checkPackageManifest(pkgDir: string): Promise<void> {
  const manifest = await Bun.file(resolve(ROOT, pkgDir, "package.json")).json() as PackageManifest;
  assert(typeof manifest.name === "string" && manifest.name.length > 0, `${pkgDir} missing package name`);
  assert(manifest.license === "MIT", `${pkgDir} must declare MIT license`);
  assert(!!manifest.repository, `${pkgDir} missing repository metadata`);
  assert(!!manifest.homepage, `${pkgDir} missing homepage metadata`);
  assert(!!manifest.bugs, `${pkgDir} missing bugs metadata`);
  assert(manifest.publishConfig?.access === "public", `${pkgDir} must set publishConfig.access=public`);
  assert(await Bun.file(resolve(ROOT, pkgDir, "README.md")).exists(), `${pkgDir} missing README.md`);
  assert(await Bun.file(resolve(ROOT, pkgDir, "LICENSE")).exists(), `${pkgDir} missing LICENSE`);
}

async function packPackage(pkgDir: string, outDir: string): Promise<string> {
  const absDir = resolve(ROOT, pkgDir);
  const raw = await $`npm pack --json`.cwd(absDir).text();
  const parsed = JSON.parse(raw.match(/(\[\s*{[\s\S]*}\s*\])\s*$/)?.[1] ?? "[]") as Array<{ filename: string }>;
  const filename = parsed[0]?.filename;
  assert(!!filename, `npm pack returned no filename for ${pkgDir}`);
  const sourceTarball = resolve(absDir, filename!);
  const targetTarball = resolve(outDir, filename!);
  await $`mv ${sourceTarball} ${targetTarball}`.quiet();
  return targetTarball;
}

async function checkTarballContents(tarballPath: string, label: string): Promise<void> {
  const listing = await $`tar -tzf ${tarballPath}`.text();
  const files = listing.trim().split("\n").filter(Boolean);
  assert(files.some((file) => /package\/README\.md$/i.test(file)), `${label} tarball missing README.md`);
  assert(files.some((file) => /package\/LICENSE$/i.test(file)), `${label} tarball missing LICENSE`);
  assert(!files.some((file) => /\.test\.(d\.ts|js|js\.map|ts|tsx)$/.test(file)), `${label} tarball contains test artifacts`);
  assert(!files.some((file) => /package\/src\//.test(file)), `${label} tarball should not include src/`);
  assert(!files.some((file) => /package\/tsconfig/.test(file)), `${label} tarball should not include tsconfig files`);
}

const tmpDir = resolve(ROOT, "tmp", "public-check");
await $`rm -rf ${tmpDir}`.quiet();
await ensureDir(tmpDir);

for (const path of DOCS_WITH_KO) {
  assert(await Bun.file(resolve(ROOT, path)).exists(), `missing canonical doc: ${path}`);
  assert(await Bun.file(resolve(ROOT, koVariantFor(path))).exists(), `missing Korean variant: ${koVariantFor(path)}`);
  await checkMarkdownLinks(path);
  await checkMarkdownLinks(koVariantFor(path));
}

for (const path of PUBLIC_JSON_FILES) {
  const body = await Bun.file(resolve(ROOT, path)).text();
  assert(!ABSOLUTE_LOCAL_PATH.test(body), `${path} contains local absolute filesystem paths`);
}

for (const pkgDir of PACKAGE_DIRS) {
  await checkPackageManifest(pkgDir);
  await checkMarkdownLinks(`${pkgDir}/README.md`);
}

for (const pkgDir of PACKAGE_DIRS) {
  const tarball = await packPackage(pkgDir, tmpDir);
  await checkTarballContents(tarball, pkgDir);
}

console.log("public readiness check passed");
