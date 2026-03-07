import { spawnSync } from "node:child_process";

const result = spawnSync("sampo", ["release", "--dry-run"], {
  cwd: process.cwd(),
  stdio: "inherit",
  env: {
    ...process.env,
    SAMPO_RELEASE_BRANCH: process.env.SAMPO_RELEASE_BRANCH ?? "main",
  },
});

if (result.status === 0) {
  process.exit(0);
}

if (result.status === 2) {
  process.exit(0);
}

process.exit(result.status ?? 1);
