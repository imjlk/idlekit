import assert from "assert/strict";
import { execFileSync } from "child_process";
import { createRequire } from "module";
import { resolve } from "path";
import { pathToFileURL } from "url";
import { readFile } from "fs/promises";
import type { CompiledScenario } from "@idlekit/core";
import { resolveCaptureOutput, writeCaptureOutput } from "./capture-output";

// Optional cross-repository capture. CI replays the committed data without this checkout.
const repository = process.argv[2];
if (!repository) throw new Error("Usage: bun tools/capture-tower-regression.ts <mpgd-games checkout> [output.json]");
const gameRoot = resolve(repository, "games/idle-arcane-tower");
const gameRequire = createRequire(resolve(gameRoot, "package.json"));
const git = (...args: string[]) => execFileSync("git", ["-C", repository, ...args], { encoding: "utf8" }).trim();
assert.equal(git("status", "--porcelain", "--", "games/idle-arcane-tower"), "", "capture requires a clean game source");
const sourceCommit = git("rev-parse", "HEAD");
const referenceCheckout = git("rev-parse", "--show-toplevel");
const output = resolveCaptureOutput(referenceCheckout, process.argv[3] ?? "fixtures/regressions/research-tower.json");
const load = (file: string) => import(pathToFileURL(resolve(gameRoot, file)).href);
const { buildResearchScenario, packResearchState, idlekitVersion } = await load("tools/research-scenario.ts");
const { applyResearchAbsence } = await load("tools/research-offline.ts");
const { settleAbsence, offlineCapSec, buy } = await load("src/model.ts");
const { assignAssistant, assignResearcher } = await load("src/research.ts");
const { newPacts } = await load("src/commerce/shop.ts");
const { manaText } = await load("src/mana.ts");
const reference = await import(pathToFileURL(gameRequire.resolve("@idlekit/core")).href);
const { buildResearchCohort } = await load("tools/research-cohort.ts");
const { readResearchBmAssumptions, researchBmScenario } = await load("tools/research-bm-assumptions.ts");
const installKey = (n: number) => `anon-00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const event = (id: string, user: number, day: number, gameEvent = "app_ready") => ({
  name: gameEvent === "app_ready" ? "game_started" : "stage_finished", target: "browser", sessionId: "fixture-session",
  occurredAt: new Date(Date.UTC(2026, 9, 1 + day, 12)).toISOString(),
  properties: { schemaVersion: 1, gameId: "idle-arcane-tower", appVersion: "0.13.3", buildId: "fixture",
    sourceGitSha: "fixture", buildTarget: "web", runtimeTarget: "browser", configTarget: "web",
    anonymousInstall: installKey(user), eventId: id, gameEvent },
});
const cohortInput = { schemaVersion: 1, gameId: "idle-arcane-tower", cohortDate: "2026-10-01", buildTarget: "web",
  observedThroughDay: 7, exportedAt: "2026-10-10T00:00:00.000Z", completeInstalls: true, completeActivity: true,
  installs: [1, 2, 3].map(n => ({ anonymousInstall: installKey(n), installedAt: "2026-10-01T12:00:00.000Z" })),
  events: [event("a0", 1, 0), event("a1", 1, 1, "first_collect"), event("a7", 1, 7),
    event("a1", 1, 1, "first_collect"), event("b0", 2, 0), event("c1", 3, 1, "art_load_failed"), event("a8", 1, 8)],
};
const converted = buildResearchCohort(cohortInput);
const assumptions = readResearchBmAssumptions(JSON.parse(await readFile(resolve(gameRoot, "tools/research-bm-assumptions.base.json"), "utf8")));
const cohort = { input: cohortInput, rows: converted.rows, observedThroughDay: converted.observedThroughDay,
  revenue: converted.revenue, scenario: researchBmScenario(assumptions, 0) };

function snapshot(sc: CompiledScenario<unknown, "MANA", Record<string, unknown>>, state: typeof sc.initial) {
  const text = sc.ctx.E.toString;
  return { t: state.t, money: text(state.wallet.money.amount), bucket: text(state.wallet.bucket),
    maxMoneyEver: text(state.maxMoneyEver.amount),
    prestige: { count: state.prestige.count, points: text(state.prestige.points), multiplier: text(state.prestige.multiplier) },
    vars: structuredClone(state.vars) };
}

const cases = [];
for (const name of ["default-dreamcatcher", "owl", "extended-cap", "silva-return", "manual", "huge-mana"]) {
  const scenario = buildResearchScenario({ crew: name === "default-dreamcatcher", events: name === "default-dreamcatcher",
    discoveries: name === "default-dreamcatcher", speed: 1 });
  if (name !== "default-dreamcatcher") {
    const game = structuredClone(scenario.initial.vars);
    assert.ok(buy(game, 0));
    game.research.manualCollections = 1;
    if (name === "owl") assert.ok(assignAssistant(game.research, 0, "owl"));
    if (name === "extended-cap") {
      assert.ok(assignAssistant(game.research, 0, "rune"));
      game.research.pacts = { ...newPacts(), offline: 1 };
      game.stars = { shards: 0, nodes: { vigil: 1 } };
    }
    if (name === "silva-return") {
      game.research.staff = [{ id: "silva", level: 1, copies: 0 }];
      assert.ok(assignResearcher(game.research, 0, "silva"));
    }
    if (name === "huge-mana") {
      assert.ok(assignAssistant(game.research, 0, "folio"));
      game.series = "verdant"; game.gold = "1e400";
    }
    scenario.initial = packResearchState(scenario.initial, game);
  }
  let state = scenario.initial;
  const initial = snapshot(scenario, state);
  const segments = [];
  let credited = 0;
  for (const [wallStart, wallEnd, active] of [[0, 600, true], [600, 45000, false], [45000, 45600, true], [45600, 86400, false]] as const) {
    if (active) {
      state = reference.runScenario({ ...scenario, initial: state,
        run: { ...scenario.run, durationSec: wallEnd - wallStart } }).end;
      segments.push({ kind: "active", wallStart, wallEnd, after: snapshot(scenario, state) });
    } else {
      const game = structuredClone(state.vars);
      const cap = offlineCapSec(game);
      const settlement = settleAbsence(game, wallStart * 1000, wallEnd * 1000);
      const away = applyResearchAbsence(scenario, state, wallEnd - wallStart, wallStart);
      assert.deepEqual(away.end.vars, game, name);
      assert.equal(away.offline.simulatedSec, settlement.creditedSeconds, name);
      assert.equal(manaText(away.end.wallet.money.amount), manaText(game.gold), name);
      state = away.end;
      credited += settlement.creditedSeconds;
      segments.push({ kind: "offline", wallStart, wallEnd, cap, credited: settlement.creditedSeconds,
        reward: manaText(settlement.mana), after: snapshot(scenario, state) });
    }
  }
  assert.deepEqual(snapshot(scenario, scenario.initial), initial, `${name}: reference preserves input`);
  cases.push({ name, initial, segments, expected: { elapsedSec: 86400,
    activeSec: 1200, offlineCreditedSec: credited, lostRewardSec: 85200 - credited } });
}
await writeCaptureOutput(referenceCheckout, output, `${JSON.stringify({ schemaVersion: 1, source: {
  repository: "https://github.com/imjlk/mpgd-games", commit: sourceCommit, referenceCoreVersion: idlekitVersion,
  game: "games/idle-arcane-tower", seed: 61973,
}, cohort, cases }, null, 2)}\n`);
console.log(`Captured ${cases.length} Tower cases from ${sourceCommit} to ${output}`);
