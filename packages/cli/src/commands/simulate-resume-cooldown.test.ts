import { expect, test } from "bun:test";
import { resolve } from "path";
import { createTempDir, readJson, removePath, runCliJson, writeText } from "../testkit/bun";

test("saved simulations preserve the prestige cooldown across online and offline resumes", async () => {
  const dir = await createTempDir("idlekit-resume-cooldown");
  try {
    const scenarioPath = resolve(dir, "scenario.json");
    const statePath = resolve(dir, "state.json");
    const secondStatePath = resolve(dir, "second-state.json");
    await writeText(scenarioPath, JSON.stringify({
      schemaVersion: 1,
      meta: { id: "resume-cooldown", title: "Resume cooldown" },
      unit: { code: "COIN" },
      policy: { mode: "accumulate", maxLogGap: 14 },
      model: { id: "plugin.generators", version: 1, params: { prestigeRequirement: "1" } },
      initial: {
        t: 0,
        wallet: { unit: "COIN", amount: "80", bucket: "0" },
        vars: { producers: 0, upgrades: 0, gems: 0 },
        prestige: { count: 0, points: "0", multiplier: "1" },
      },
      clock: { stepSec: 1, durationSec: 40 },
      constraints: { minPrestigeIntervalSec: 60 },
      strategy: { id: "scripted", params: { schemaVersion: 1, program: [{ actionId: "prestige.reboot" }], onCannotApply: "skip", loop: true } },
    }));
    const common = ["simulate", scenarioPath, "--seed", "7", "--plugin", "../../examples/plugins/custom-econ-plugin.ts", "--allow-plugin", "true", "--format", "json"];
    const full = runCliJson([...common, "--duration", "40"]);
    const first = runCliJson([...common, "--duration", "20", "--state-out", statePath]);
    const resumed = runCliJson([...common, "--duration", "20", "--resume", statePath, "--state-out", secondStatePath]);
    const offline = runCliJson([...common, "--duration", "10", "--offline-seconds", "10", "--resume", statePath]);
    expect(full.prestige.count).toBe(1);
    expect(first.prestige.count).toBe(1);
    expect(resumed.prestige.count).toBe(full.prestige.count);
    expect(offline.prestige.count).toBe(full.prestige.count);
    expect(resumed.endT).toBe(full.endT);
    expect(offline.endT).toBe(full.endT);
    const saved = await readJson<any>(statePath);
    expect(saved.meta.lastPrestigeResetT).toBe(0);
    expect((await readJson<any>(secondStatePath)).meta.lastPrestigeResetT).toBe(0);
    const changedStatePath = resolve(dir, "changed-state.json");
    await writeText(changedStatePath, JSON.stringify({ ...saved, meta: { ...saved.meta, lastPrestigeResetT: 10 } }));
    const early = runCliJson([...common, "--duration", "45", "--resume", statePath]);
    const late = runCliJson([...common, "--duration", "45", "--resume", changedStatePath]);
    expect(early.prestige.count).toBe(2);
    expect(late.prestige.count).toBe(1);
    expect(early._meta.effectiveRunHash).not.toBe(late._meta.effectiveRunHash);
  } finally {
    await removePath(dir);
  }
}, 180_000);
