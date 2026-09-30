import { statSync } from "fs";
import { resolve } from "path";

const root = resolve(import.meta.dir, "..");

type Solution = {
  files?: string[];
  references?: Array<{ path: string }>;
};

type Project = {
  files?: string[];
  include?: string[];
};

const failures: string[] = [];

function fail(message: string): void {
  failures.push(message);
}

async function readJson<T>(path: string): Promise<T> {
  return (await Bun.file(path).json()) as T;
}

const rootPackage = await readJson<{ scripts?: Record<string, string> }>(resolve(root, "package.json"));
const typecheck = rootPackage.scripts?.typecheck ?? "";
if (typecheck.includes("tsconfig.solution.json")) {
  fail("root typecheck must not treat the empty solution config as a program");
}

const solution = await readJson<Solution>(resolve(root, "tsconfig.solution.json"));
if ((solution.files ?? []).length !== 0) {
  fail("tsconfig.solution.json must keep files empty; project configs own the sources");
}
const references = solution.references ?? [];
if (references.length === 0) fail("tsconfig.solution.json has no project references");

for (const reference of references) {
  const projectPath = reference.path.endsWith(".json")
    ? resolve(root, reference.path)
    : resolve(root, reference.path, "tsconfig.json");
  const project = await readJson<Project>(projectPath);
  const patterns = [...(project.files ?? []), ...(project.include ?? [])];
  if (patterns.length === 0) {
    fail(`${reference.path} has no files or include patterns`);
    continue;
  }
  let count = 0;
  const cwd = projectPath.endsWith("tsconfig.json") ? resolve(projectPath, "..") : root;
  for (const pattern of patterns) {
    const asDir = resolve(cwd, pattern);
    let directory = false;
    try {
      directory = statSync(asDir).isDirectory();
    } catch {
      directory = false;
    }
    const expanded = directory ? `${pattern.replace(/\/$/, "")}/**/*` : pattern;
    const glob = new Bun.Glob(expanded);
    for await (const _file of glob.scan({ cwd, onlyFiles: true })) {
      count += 1;
      if (count > 0) break;
    }
    if (count > 0) break;
  }
  if (count === 0) fail(`${reference.path} includes no source files`);
}

if (failures.length > 0) {
  for (const message of failures) console.error(message);
  process.exit(1);
}

console.log(`tsconfig programs are non-empty (${references.length})`);
