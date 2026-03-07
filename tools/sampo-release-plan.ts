const proc = Bun.spawn([
  "sampo",
  "release",
  "--dry-run",
], {
  cwd: process.cwd(),
  stdout: "inherit",
  stderr: "inherit",
  env: {
    ...process.env,
    SAMPO_RELEASE_BRANCH: process.env.SAMPO_RELEASE_BRANCH ?? "main",
  },
});

const exitCode = await proc.exited;
if (exitCode === 0 || exitCode === 2) {
  process.exit(0);
}

process.exit(exitCode);
