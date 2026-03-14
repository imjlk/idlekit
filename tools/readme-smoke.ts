import { $ } from "bun";
import { resolve } from "path";
import { ROOT, readText, sha256Hex, withFileLock, writeText } from "./_bun";

type SnippetSpec = Readonly<{
  readmePath: string;
  snippetPath: string;
  language: string;
}>;

const README_SPECS = [
  {
    readmePath: "packages/money/README.md",
    snippetPath: "snippets/readme/money-quick-example.ts",
    language: "ts",
  },
  {
    readmePath: "packages/core/README.md",
    snippetPath: "snippets/readme/core-quick-example.ts",
    language: "ts",
  },
  {
    readmePath: "packages/cli/README.md",
    snippetPath: "snippets/readme/cli-quick-start.sh",
    language: "bash",
  },
] as const satisfies readonly SnippetSpec[];

function marker(spec: SnippetSpec): string {
  return `<!-- snippet: ${spec.snippetPath} -->`;
}

function normalize(body: string): string {
  return body.trim().replace(/\r\n/g, "\n");
}

function extractSnippetBody(readme: string, spec: SnippetSpec): string {
  const escapedMarker = marker(spec).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedLang = spec.language.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escapedMarker}\\s*\\n\`\`\`${escapedLang}\\n([\\s\\S]*?)\\n\`\`\``);
  const match = readme.match(re);
  if (!match?.[1]) {
    throw new Error(`README snippet not found for ${spec.readmePath} -> ${spec.snippetPath}`);
  }
  return normalize(match[1]);
}

async function verifySnippetSync(spec: SnippetSpec): Promise<void> {
  const readme = await readText(resolve(ROOT, spec.readmePath));
  const snippet = await readText(resolve(ROOT, spec.snippetPath));
  const fromReadme = extractSnippetBody(readme, spec);
  const fromSource = normalize(snippet);
  if (fromReadme !== fromSource) {
    throw new Error(
      `${spec.readmePath} snippet drifted from ${spec.snippetPath}\nreadme=${sha256Hex(fromReadme)} source=${sha256Hex(fromSource)}`,
    );
  }
}

async function packPackage(pkgDir: string, outDir: string): Promise<string> {
  const absDir = resolve(ROOT, pkgDir);
  return withFileLock(`npm-pack-${pkgDir}`, async () => {
    const raw = await $`npm pack --json --pack-destination ${outDir}`.cwd(absDir).text();
    const parsed = JSON.parse(raw.match(/(\[\s*{[\s\S]*}\s*\])\s*$/)?.[1] ?? "[]") as Array<{ filename: string }>;
    const pack = parsed[0];
    if (!pack) throw new Error(`npm pack returned no entries for ${pkgDir}`);
    return resolve(outDir, pack.filename);
  });
}

async function prepareConsumer(): Promise<string> {
  const tmpRoot = resolve(ROOT, "tmp", "readme-smoke");
  const packsDir = resolve(tmpRoot, "packs");
  const consumerDir = resolve(tmpRoot, "consumer");
  await $`rm -rf ${tmpRoot}`.quiet();
  await $`mkdir -p ${packsDir} ${consumerDir}`.quiet();

  const tarballs = await Promise.all(
    ["packages/money", "packages/core", "packages/cli"].map((pkgDir) => packPackage(pkgDir, packsDir)),
  );
  await writeText(
    resolve(consumerDir, "package.json"),
    `${JSON.stringify({ name: "idlekit-readme-smoke", private: true, type: "module" }, null, 2)}\n`,
  );
  await $`npm install --no-audit --no-fund ${tarballs}`.cwd(consumerDir).quiet();
  return consumerDir;
}

async function runSnippetInConsumer(consumerDir: string, spec: SnippetSpec): Promise<void> {
  const snippetBody = await readText(resolve(ROOT, spec.snippetPath));
  const localName = spec.snippetPath.split("/").pop();
  if (!localName) throw new Error(`invalid snippet path: ${spec.snippetPath}`);
  const localPath = resolve(consumerDir, localName);
  await writeText(localPath, `${snippetBody}\n`);
  if (spec.language === "ts") {
    await $`bun ${localPath}`.cwd(consumerDir).quiet();
    return;
  }
  await $`bash ${localPath}`.cwd(consumerDir).quiet();
}

async function runCliSnippet(consumerDir: string, path: string): Promise<void> {
  const scriptBody = await readText(resolve(ROOT, path));
  const scriptPath = resolve(consumerDir, "cli-quick-start.sh");
  await writeText(scriptPath, `${scriptBody}\n`);
  const proc = Bun.spawnSync(["bash", scriptPath], {
    cwd: consumerDir,
    env: {
      ...process.env,
      PATH: `${resolve(consumerDir, "node_modules", ".bin")}:${process.env.PATH ?? ""}`,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) {
    throw new Error(proc.stderr.toString().trim() || proc.stdout.toString().trim() || "cli snippet failed");
  }
}

async function main(): Promise<void> {
  for (const spec of README_SPECS) {
    await verifySnippetSync(spec);
  }

  const consumerDir = await prepareConsumer();
  await runSnippetInConsumer(consumerDir, README_SPECS[0]);
  await runSnippetInConsumer(consumerDir, README_SPECS[1]);
  await runCliSnippet(consumerDir, "snippets/readme/cli-quick-start.sh");
  console.log("readme smoke passed");
}

await main();
