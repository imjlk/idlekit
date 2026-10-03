import {
  BREAK_ETERNITY_EXPERIMENTAL_MESSAGE,
  builtinStrategyFactories,
  compileScenario,
  createBreakInfinityEngine,
  createModelRegistry,
  createNumberEngine,
  createRunFactory,
  createScriptedStrategy,
  createStrategyRegistry,
  runScenario,
  simulateSessionPattern,
  type ModelFactory,
  type ScenarioV1,
  type StrategyFactory,
} from "@idlekit/core";
import { describe, expect, it } from "bun:test";
import {
  effectiveRunHash,
  engineSeedOption,
  pluginDigestValues,
  prepareResolvedRun,
  resolveEffectiveEngine,
  resolvedRunContract,
  sessionCaseSeed,
  strategySeedOption,
  workflowRunHash,
} from "./runConfiguration";

const modelFactory: ModelFactory = {
  id: "m",
  version: 1,
  create: () => ({
    id: "m",
    version: 1,
    income: (ctx: any) => {
      const seen = (ctx as { seen?: number[] }).seen;
      if (seen && ctx.stepSec !== undefined) seen.push(ctx.stepSec);
      return { unit: ctx.unit, amount: ctx.E.from(0) };
    },
    actions: (ctx: any) => [
      {
        id: "buy",
        kind: "buy" as const,
        actor: "automation" as const,
        canApply: () => true,
        cost: () => ({ unit: ctx.unit, amount: ctx.E.from(1) }),
        apply: (_ctx: any, state: any) => ({
          ...state,
          vars: { ...state.vars, bought: Number((state.vars as { bought?: number }).bought ?? 0) + 1 },
        }),
      },
    ],
  }),
};

const customStrategy: StrategyFactory = {
  id: "custom.once",
  defaultParams: { schemaVersion: 1, program: [{ actionId: "buy" }], loop: false, onCannotApply: "stop" },
  create: (params) => createScriptedStrategy(params),
};

function scenario(): ScenarioV1 {
  return {
    schemaVersion: 1,
    unit: { code: "COIN" },
    policy: { mode: "drop" },
    model: { id: "m", version: 1 },
    initial: {
      wallet: { unit: "COIN", amount: "10" },
      vars: { bought: 0 },
    },
    clock: { stepSec: 1, durationSec: 1, untilExpr: "t >= 1" },
    strategy: { id: "greedy" },
    engine: { name: "breakInfinity", version: "metadata-only" },
    design: { sessionPattern: { id: "offline-heavy", days: 1 } },
  };
}

function registries() {
  return {
    modelRegistry: createModelRegistry([modelFactory]),
    strategyRegistry: createStrategyRegistry([...builtinStrategyFactories, customStrategy]),
  };
}

/**
 * @evidence docs/requirements/active/cli-resolved-run.md#req-pr07-resolved-run Runs the shared plan, fresh stages, engine selection, suffix goal, and directory-independent digest.
 * @evidenceReview docs/requirements/active/cli-resolved-run.md#req-pr07-resolved-run #1396a16 Re-read the section, including the stage digest paragraph, the plugin digest value sentences (this function passes digest values in and does not load a plugin), the evaluate default seed sentence, and the override that replaces the scenario strategy, then ran this function: both stages buy once, breakInfinity keeps 1e400 finite, the digest ignores the directory, and a swapped plugin order changes it.
 * @evidence ./runConfiguration.ts#resolvedRunContract Reads the resolved-run contract and checks a fresh stage against a standalone open.
 * @evidenceReview ./runConfiguration.ts#resolvedRunContract #2719478 The declaration is idlekit.resolved-run-configuration. This test reads that property.
 * @evidence ./runConfiguration.ts#sessionCaseSeed Reads the repro label. The runs use seed 1.
 * @evidenceReview ./runConfiguration.ts#sessionCaseSeed #47c0b85 The declaration is 0x7107. The runs do not draw from that label.
 * @evidence ./runConfiguration.ts#stageApply Simulate applies strategy, step, and fast, experience applies strategy and session only, and consistent overrides carry step 5 into experience.
 * @evidenceReview ./runConfiguration.ts#stageApply #b89c928 Re-read stageApply: experience applies strategy and session, and step and fast only with consistent overrides, while simulate and ltv apply strategy, step, and fast. Ran this function: the two applies objects match, experience runs on step 1, and the consistent experience runs on step 5.
 * @evidence ./runConfiguration.ts#pluginDigestValues Digest values in one order from different plugin paths give the same simulate stage hash, and a swapped order changes it.
 * @evidenceReview ./runConfiguration.ts#pluginDigestValues #1e76250 Re-read pluginDigestValues: it keeps only the digest values, in load order. Ran this function: plugin maps with different paths and the same values in the same order give equal simulate stage hashes, and the swapped map gives a different one.
 * @evidence ./runConfiguration.ts#resolveEffectiveEngine A metadata-only scenario engine stays number, breakInfinity keeps 1e400 finite, breakEternity throws, a trusted custom factory is created once, and an untrusted id throws.
 * @evidenceReview ./runConfiguration.ts#resolveEffectiveEngine #e88a2e5 Re-read resolveEffectiveEngine: an empty request is the number default with the scenario engine kept as metadata, number and breakInfinity are built in, breakEternity throws the experimental message, and any other id needs a trusted factory. Ran this function: the metadata engine is number, 1e400 stays a finite breakInfinity value, breakEternity and plugin.hidden throw, and the custom factory is created once.
 * @evidence ./runConfiguration.ts#resolveStrategySelection A custom.once override reaches both stages and buys once, a planner override opens a planner that previews on step 5, and an unknown override throws Unknown strategy.
 * @evidenceReview ./runConfiguration.ts#resolveStrategySelection #9c2f62f Re-read resolveStrategySelection: an override must be in the registry and takes its default params, otherwise the scenario strategy is resolved, and an unknown id throws unknownStrategyError. Ran this function: custom.once buys once in both stages, the planner override previews on step 5, and plugin.not-loaded throws Unknown strategy.
 * @evidence ./runConfiguration.ts#effectiveRunHash The digest ignores cwd, scenario path, and generatedAt, and changes with stepSec and strategy id.
 * @evidenceReview ./runConfiguration.ts#effectiveRunHash #6dc9a0b Re-read effectiveRunHash: it ignores cwd, scenarioPath, and generatedAt and hashes the contract, scenario, engine, strategy, params mode, step, session, seed, plugin digests in load order, the fast mode object or null, stage, and inputs. Ran this function: two directories give one hash, and stepSec 2 or strategy greedy changes it.
 * @evidence ./runConfiguration.ts#openResolvedStage Each stage opens a fresh compiled scenario with its own strategy, simulate on step 5 and experience on step 1.
 * @evidenceReview ./runConfiguration.ts#openResolvedStage #79dfd66 Re-read openResolvedStage: it binds a new createRunFactory with stageBindOptions, the scenario model and the plan strategy, and opens a fresh trial with the plan seed and an execution plan built from the stage plan. Ran this function: the opened simulate scenario is not the prepared definition, the two stages hold different strategies, and simulate runs on step 5 while experience runs on step 1.
 * @evidence ./runConfiguration.ts#prepareResolvedRun One prepared run opens simulate and experience stages that each buy once and match a standalone simulate open.
 * @evidenceReview ./runConfiguration.ts#prepareResolvedRun #1ca60bb Re-read prepareResolvedRun: it resolves the engine, rejects an unknown strategy before any stage opens, compiles once without the scenario strategy when an override or validated params replace it, and open builds a stage plan, its stage hash with the compiled scenario fast mode, a fresh stage scenario, and the registries and bind options that rebuild that stage's model and strategy. Ran this function: simulate and experience each end with bought 1, the standalone simulate matches, and an unknown override throws at prepare.
 */
export function keepsResolvedRunConfiguration(): void {
  expect(resolvedRunContract).toBe("idlekit.resolved-run-configuration");
  expect(sessionCaseSeed).toBe(0x7107);

  const loaded = registries();
  const input = scenario();
  const prepared = prepareResolvedRun({
    scenario: input,
    ...loaded,
    strategyOverride: "custom.once",
    stepSec: 5,
    fast: true,
    seed: 1,
    pluginDigest: { "/tmp/a/plugin.ts": "abc", "/tmp/b/plugin.ts": "def" },
  });
  const standalone = prepareResolvedRun({
    scenario: input,
    ...loaded,
    strategyOverride: "custom.once",
    stepSec: 5,
    fast: true,
    seed: 1,
    pluginDigest: { "/var/other/copy.ts": "abc", "/var/other/plugin.ts": "def" },
  });
  expect(prepared.open("simulate", "x").hash).toBe(standalone.open("simulate", "y").hash);
  const swapped = prepareResolvedRun({
    scenario: input,
    ...loaded,
    strategyOverride: "custom.once",
    stepSec: 5,
    fast: true,
    seed: 1,
    pluginDigest: { "/tmp/b/plugin.ts": "def", "/tmp/a/plugin.ts": "abc" },
  });
  expect(swapped.open("simulate", "x").hash).not.toBe(prepared.open("simulate", "x").hash);
  expect(prepared.definition).not.toBe(prepared.open("simulate", "evaluate:simulate").scenario);

  const simulate = prepared.open("simulate", "evaluate:simulate");
  const experience = prepared.open("experience", "evaluate:experience");
  expect(simulate.plan.stage.applies).toEqual({ strategy: true, step: true, fast: true, session: false });
  expect(experience.plan.stage.applies).toEqual({ strategy: true, step: false, fast: false, session: true });
  expect(simulate.scenario.ctx.stepSec).toBe(5);
  expect(simulate.scenario.run.stepSec).toBe(5);
  expect(experience.scenario.ctx.stepSec).toBe(1);
  expect(experience.scenario.run.stepSec).toBe(1);
  expect(simulate.scenario.strategy).not.toBe(experience.scenario.strategy);

  const simulateRun = runScenario(simulate.scenario);
  const experienceRun = simulateSessionPattern({
    scenario: experience.scenario,
    pattern: { id: "offline-heavy", days: 1, schedule: [{ day: 0, startOffsetSec: 0, durationSec: 1 }] },
    seed: 1,
  });
  expect(simulateRun.end.vars).toEqual({ bought: 1 });
  expect(experienceRun.end.vars).toEqual({ bought: 1 });

  const alone = standalone.open("simulate", "standalone:simulate");
  const aloneRun = runScenario(alone.scenario);
  expect(aloneRun.end.vars).toEqual(simulateRun.end.vars);
  expect(aloneRun.end.t).toBe(simulateRun.end.t);

  const consistent = prepareResolvedRun({
    scenario: input,
    ...loaded,
    strategyOverride: "custom.once",
    stepSec: 5,
    seed: 1,
    consistentOverrides: true,
  });
  expect(consistent.open("experience", "consistent").scenario.ctx.stepSec).toBe(5);

  const seen: number[] = [];
  const plannerModel: ModelFactory = {
    id: "m",
    version: 1,
    create: () => ({
      id: "m",
      version: 1,
      income: (ctx: any) => {
        if (ctx.stepSec !== undefined) seen.push(ctx.stepSec);
        return { unit: ctx.unit, amount: ctx.E.from(0) };
      },
      netWorth: (_ctx: any, state: any) => state.wallet.money,
      actions: () => [],
    }),
  };
  const plannerPrepared = prepareResolvedRun({
    scenario: { ...input, strategy: { id: "planner" } },
    modelRegistry: createModelRegistry([plannerModel]),
    strategyRegistry: loaded.strategyRegistry,
    strategyOverride: "planner",
    stepSec: 5,
    seed: 1,
  });
  const plannerScenario = plannerPrepared.open("simulate", "planner").scenario;
  plannerScenario.strategy?.decide(plannerScenario.ctx, plannerScenario.model, plannerScenario.initial);
  expect(plannerScenario.ctx.stepSec).toBe(5);
  expect(seen.some((step) => step === 5)).toBeTrue();

  const metadataEngine = resolveEffectiveEngine({
    scenarioEngine: { name: "breakInfinity", version: "9" },
  });
  expect(metadataEngine.effectiveId).toBe("number");
  expect(metadataEngine.scenarioEngineRole).toBe("metadata");
  expect(metadataEngine.engine.zero()).toBe(0);

  const big = resolveEffectiveEngine({ requested: "breakInfinity" });
  const huge = big.engine.from("1e400");
  expect(typeof huge).not.toBe("number");
  expect(big.engine.isFinite(huge)).toBeTrue();
  expect(Number.isFinite(Number("1e400"))).toBeFalse();
  expect(() => resolveEffectiveEngine({ requested: "breakEternity" })).toThrow(BREAK_ETERNITY_EXPERIMENTAL_MESSAGE);

  let created = 0;
  const custom = resolveEffectiveEngine({
    requested: "custom.fixed",
    customEngines: [
      {
        id: "custom.fixed",
        trusted: true,
        create: () => {
          created += 1;
          return createNumberEngine();
        },
      },
    ],
  });
  expect(custom.effectiveId).toBe("custom.fixed");
  expect(created).toBe(1);
  expect(() => resolveEffectiveEngine({ requested: "plugin.hidden" })).toThrow(/Untrusted engines are not loaded/);
  expect(() =>
    prepareResolvedRun({
      scenario: input,
      ...loaded,
      strategyOverride: "plugin.not-loaded",
      seed: 1,
    }),
  ).toThrow(/Unknown strategy: plugin.not-loaded/);

  const digest = {
    scenario: input,
    engineId: "number",
    strategyId: "custom.once",
    strategyParams: customStrategy.defaultParams,
    paramsMode: "legacy-raw" as const,
    stepSec: 1,
    seed: 1,
    pluginDigests: pluginDigestValues({ "/tmp/one/plugin.ts": "abc" }),
  };
  expect(effectiveRunHash({ ...digest, cwd: "/tmp/one", scenarioPath: "/tmp/one/scenario.json", generatedAt: "t0" })).toBe(
    effectiveRunHash({ ...digest, cwd: "/tmp/two", scenarioPath: "/tmp/two/scenario.json", generatedAt: "t1" }),
  );
  expect(effectiveRunHash({ ...digest, stepSec: 2 })).not.toBe(effectiveRunHash(digest));
  expect(effectiveRunHash({ ...digest, strategyId: "greedy" })).not.toBe(effectiveRunHash(digest));

  const suffixScenario: ScenarioV1 = {
    ...input,
    clock: { stepSec: 1, durationSec: 1, untilExpr: "money >= 1aa" },
  };
  const suffixNumber = compileScenario({
    E: createNumberEngine(),
    scenario: suffixScenario,
    registry: loaded.modelRegistry,
    strategyRegistry: loaded.strategyRegistry,
    opts: { allowSuffixNotation: true },
  });
  const atThousand = {
    ...suffixNumber.initial,
    wallet: {
      ...suffixNumber.initial.wallet,
      money: { ...suffixNumber.initial.wallet.money, amount: 1000 },
    },
  };
  expect(suffixNumber.run.until?.(suffixNumber.initial)).toBeFalse();
  expect(suffixNumber.run.until?.(atThousand)).toBeTrue();

  const bigEngine = createBreakInfinityEngine();
  const wide = compileScenario({
    E: bigEngine,
    scenario: {
      ...suffixScenario,
      clock: { stepSec: 1, durationSec: 1, untilExpr: "money >= 1e400" },
    },
    registry: loaded.modelRegistry,
    strategyRegistry: loaded.strategyRegistry,
    opts: { allowSuffixNotation: true },
  });
  const wideAmount = bigEngine.from("1e400");
  expect(typeof wideAmount).not.toBe("number");
  expect(
    wide.run.until?.({
      ...wide.initial,
      wallet: { ...wide.initial.wallet, money: { ...wide.initial.wallet.money, amount: wideAmount } },
    }),
  ).toBeTrue();
}

/**
 * @evidence docs/requirements/active/cli-resolved-run.md#req-pr07-resolved-run Opens simulate, experience, and ltv stages with different command inputs and hashes their stage digests into one workflow digest.
 * @evidenceReview docs/requirements/active/cli-resolved-run.md#req-pr07-resolved-run #1396a16 Re-read the section, including the stage digest paragraph, the plugin digest value sentences, and the executed tests, then ran this function: duration, offline seconds, stage, step, fast, and ltv inputs change stage digests, an empty plugin map does not, a step or fast that repeats the scenario value does not, experience ignores step and fast without consistent overrides, a scenario without a session pattern plans always-on for 7 days and an explicit always-on for 7 days keeps that experience digest while days 6 changes it, and the workflow digest follows the experience stage.
 * @evidence ./runConfiguration.ts#effectiveRunHash Stage digests ignore an empty plugin digest map, change with simulate duration, offline seconds, the stage name, step and fast on simulate, and ltv horizons, draws, and value per worth.
 * @evidenceReview ./runConfiguration.ts#effectiveRunHash #6dc9a0b Re-read effectiveRunHash and stageRunHash: the stage name, applied scope, and command inputs are part of the hash, plugin digests keep their load order, and fast is the plan override or else the compiled scenario fast mode. Ran this function: an empty plugin map matches the default, durationSec 10 and 20 differ, offlineSeconds 0 and 60 differ, simulate and experience differ, step 5 with fast changes simulate only, fast alone changes simulate, a step equal to the scenario stepSec keeps it, on a sim.fast scenario fast true and false keep the simulate and ltv hashes, and each ltv input change gives a new hash.
 * @evidence ./runConfiguration.ts#workflowRunHash The workflow digest ignores stage key order and changes when consistent overrides change the experience stage digest.
 * @evidenceReview ./runConfiguration.ts#workflowRunHash #d62f84a Re-read workflowRunHash: it hashes the contract, version, and the stage digest record. Ran this function: reordering the stage keys gives the same digest, and swapping in the consistent experience digest changes it.
 */
export function digestsEachStageFromItsAppliedPlan(): void {
  const loaded = registries();
  const input = scenario();
  const base = { scenario: input, ...loaded, seed: 1 };
  const plain = prepareResolvedRun(base);
  const again = prepareResolvedRun({ ...base, pluginDigest: {} });
  const stepped = prepareResolvedRun({ ...base, stepSec: 5, fast: true });
  const consistent = prepareResolvedRun({ ...base, stepSec: 5, fast: true, consistentOverrides: true });

  const sim = (p: typeof plain, inputs?: Record<string, unknown>) => p.open("simulate", "a", inputs).hash;
  const exp = (p: typeof plain, inputs?: Record<string, unknown>) => p.open("experience", "b", inputs).hash;

  expect(sim(plain, { durationSec: 10 })).toBe(sim(again, { durationSec: 10 }));
  expect(sim(plain, { durationSec: 10 })).not.toBe(sim(plain, { durationSec: 20 }));
  expect(sim(plain, { offlineSeconds: 0 })).not.toBe(sim(plain, { offlineSeconds: 60 }));
  expect(sim(plain)).not.toBe(exp(plain));

  expect(sim(stepped)).not.toBe(sim(plain));
  // Experience leaves --step and --fast off unless overrides are consistent.
  expect(exp(stepped)).toBe(exp(plain));
  expect(exp(consistent)).not.toBe(exp(stepped));
  expect(sim(consistent)).toBe(sim(stepped));
  expect(sim(prepareResolvedRun({ ...base, fast: true }))).not.toBe(sim(plain));
  // A redundant --step equal to the scenario stepSec runs the same stage.
  expect(sim(prepareResolvedRun({ ...base, stepSec: input.clock.stepSec }))).toBe(sim(plain));
  // Without a declared pattern, experience runs always-on for 7 days, so flags that repeat them keep its hash.
  const { design: _design, ...bare } = input;
  const bareBase = { ...base, scenario: bare };
  const barePlain = prepareResolvedRun(bareBase);
  expect(barePlain.open("experience", "b").plan.session).toEqual({ id: "always-on", days: 7, source: "scenario" });
  expect(exp(prepareResolvedRun({ ...bareBase, sessionId: "always-on", days: 7 }))).toBe(exp(barePlain));
  expect(exp(prepareResolvedRun({ ...bareBase, days: 6 }))).not.toBe(exp(barePlain));

  // The scenario already runs fast, so --fast true is redundant and --fast false does not turn it off.
  const fastBase = { ...base, scenario: { ...input, sim: { fast: true } } };
  const fastPlain = prepareResolvedRun(fastBase);
  for (const flag of [true, false]) {
    const flagged = prepareResolvedRun({ ...fastBase, fast: flag });
    expect(flagged.open("simulate", "a").scenario.run.fast).toEqual(fastPlain.open("simulate", "a").scenario.run.fast);
    expect(sim(flagged)).toBe(sim(fastPlain));
    expect(flagged.open("ltv", "c").hash).toBe(fastPlain.open("ltv", "c").hash);
  }
  expect(fastPlain.open("simulate", "a").scenario.run.fast?.enabled).toBeTrue();

  const ltv =(inputs: Record<string, unknown>) => plain.open("ltv", "c", inputs).hash;
  const ltvBase = { horizons: [{ label: "30m", seconds: 1800 }], draws: null, valuePerWorth: null };
  expect(ltv(ltvBase)).toBe(ltv({ ...ltvBase }));
  expect(ltv({ ...ltvBase, horizons: [{ label: "2h", seconds: 7200 }] })).not.toBe(ltv(ltvBase));
  expect(ltv({ ...ltvBase, draws: 8 })).not.toBe(ltv(ltvBase));
  expect(ltv({ ...ltvBase, valuePerWorth: 2 })).not.toBe(ltv(ltvBase));

  const stages = { simulate: sim(plain), experience: exp(plain) };
  expect(workflowRunHash(stages)).toBe(workflowRunHash({ experience: exp(again), simulate: sim(again) }));
  expect(workflowRunHash({ ...stages, experience: exp(consistent) })).not.toBe(workflowRunHash(stages));
}

/**
 * @evidence docs/requirements/active/cli-resolved-run.md#req-pr07-resolved-run An override runs over an unregistered scenario strategy and over invalid scenario strategy params, and without the override both still fail. Validated params build the scenario strategy only from the schema value.
 * @evidenceReview docs/requirements/active/cli-resolved-run.md#req-pr07-resolved-run #1396a16 Re-read the strategy paragraph: the flag replaces the scenario strategy, which is not built, and without the flag a broken one still fails. Re-read the params mode paragraph: validated mode compiles without the scenario strategy and each stage builds it from result.value. Ran this function: custom.once buys once over plugin.missing and over scripted params without a program, and without the override they throw Unknown strategy and Invalid strategy params. A schema that coerces n "1" to 1 runs in validated mode, its create sees only 1, and legacy-raw still throws the create error at prepare. A schema that turns "1" into 1 and rejects 1 opens and buys once in validated mode, the stage and a rebind from its isolation options both create with 1, and legacy-raw with n 1 throws Invalid strategy params.
 * @evidence ./runConfiguration.ts#prepareResolvedRun An override or validated params compile without the scenario strategy, and a legacy-raw run without an override keeps the scenario strategy errors.
 * @evidenceReview ./runConfiguration.ts#prepareResolvedRun #1ca60bb Re-read prepareResolvedRun: resolveStrategySelection runs first, and a command-selected strategy or a validated selection compiles the scenario without its strategy field. Ran this function: both broken scenarios open a simulate stage that buys once under the override, and prepare throws the scenario strategy error without it. The validated custom.coerce scenario plans params { n: 1 }, buys once, and its create is called only with 1, while legacy-raw throws the create error at prepare. The validated custom.transform scenario, whose schema rejects its own value, opens and buys once, and its isolation options rebind with 1.
 */
export function overrideReplacesBrokenScenarioStrategy(): void {
  const loaded = registries();
  const broken: ScenarioV1[] = [
    { ...scenario(), strategy: { id: "plugin.missing" } },
    { ...scenario(), strategy: { id: "scripted", params: { schemaVersion: 1 } } },
  ];
  for (const input of broken) {
    const prepared = prepareResolvedRun({ scenario: input, ...loaded, strategyOverride: "custom.once", seed: 1 });
    expect(runScenario(prepared.open("simulate", "override").scenario).end.vars).toEqual({ bought: 1 });
  }
  expect(() => prepareResolvedRun({ scenario: broken[0]!, ...loaded, seed: 1 })).toThrow(
    /^Unknown strategy: plugin.missing$/,
  );
  expect(() => prepareResolvedRun({ scenario: broken[1]!, ...loaded, seed: 1 })).toThrow(/^Invalid strategy params: /);

  // A coercing schema: validated mode builds only from { n: 1 }, legacy-raw still builds from { n: "1" }.
  const created: unknown[] = [];
  const coercing: StrategyFactory = {
    id: "custom.coerce",
    paramsSchema: {
      "~standard": {
        validate: (input: unknown) => ({ success: true as const, value: { n: Number((input as { n: unknown }).n) } }),
      },
    } as StrategyFactory["paramsSchema"],
    create: (params) => {
      const { n } = params as { n: unknown };
      if (typeof n !== "number") throw new Error("custom.coerce needs a number n");
      created.push(n);
      return createScriptedStrategy({ schemaVersion: 1, program: [{ actionId: "buy" }], loop: false, onCannotApply: "stop" });
    },
  };
  const coerced = {
    ...loaded,
    strategyRegistry: createStrategyRegistry([...builtinStrategyFactories, coercing]),
  };
  const raw: ScenarioV1 = { ...scenario(), strategy: { id: "custom.coerce", params: { n: "1" } } };
  const validated = prepareResolvedRun({ scenario: raw, ...coerced, paramsMode: "validated", seed: 1 });
  const stage = validated.open("simulate", "validated");
  expect(stage.plan.strategy).toEqual({ id: "custom.coerce", params: { n: 1 }, paramsMode: "validated", source: "scenario" });
  expect(runScenario(stage.scenario).end.vars).toEqual({ bought: 1 });
  expect(created).toEqual([1]);
  expect(() => prepareResolvedRun({ scenario: raw, ...coerced, seed: 1 })).toThrow(/^custom.coerce needs a number n$/);

  // A transforming schema that rejects its own value: the stage and its Monte Carlo bind options
  // build from { n: 1 } without a second check, and legacy-raw still checks the raw params.
  created.length = 0;
  const transforming: StrategyFactory = {
    ...coercing,
    id: "custom.transform",
    paramsSchema: {
      "~standard": {
        validate: (input: unknown) => {
          const { n } = input as { n: unknown };
          return typeof n === "string"
            ? { success: true as const, value: { n: Number(n) } }
            : { success: false as const, issues: [{ message: "n must be a string" }] };
        },
      },
    } as StrategyFactory["paramsSchema"],
  };
  const transformed = {
    ...loaded,
    strategyRegistry: createStrategyRegistry([...builtinStrategyFactories, transforming]),
  };
  const strict: ScenarioV1 = { ...scenario(), strategy: { id: "custom.transform", params: { n: "1" } } };
  const opened = prepareResolvedRun({ scenario: strict, ...transformed, paramsMode: "validated", seed: 1 }).open(
    "simulate",
    "transform",
  );
  expect(runScenario(opened.scenario).end.vars).toEqual({ bought: 1 });
  const draws = createRunFactory(opened.isolation.registries).bind(opened.scenario, opened.isolation.options);
  draws.fresh({ trialId: "draw", seed: 1 });
  expect(created).toEqual([1, 1]);
  expect(() =>
    prepareResolvedRun({ scenario: { ...strict, strategy: { id: "custom.transform", params: { n: 1 } } }, ...transformed, seed: 1 }),
  ).toThrow(/^Invalid strategy params: n must be a string$/);
}

/**
 * @evidence docs/requirements/active/cli-resolved-run.md#req-pr07-resolved-run The default seed reads the engine that runs, so the default and an explicit number engine give the same seed input.
 * @evidenceReview docs/requirements/active/cli-resolved-run.md#req-pr07-resolved-run #1396a16 Re-read the section: number is the default engine and the default evaluate seed reads the scenario, strategy, and engine. Ran this function: no flag and number give the same seed input, and breakInfinity adds its id.
 * @evidence ./runConfiguration.ts#engineSeedOption No flag, an empty flag, and `number` leave the engine out of the seed input, and another engine id stays in it.
 * @evidenceReview ./runConfiguration.ts#engineSeedOption #4e78301 Re-read engineSeedOption: it trims the flag and returns no engine field for a missing, empty, or number flag, and the trimmed id otherwise. Ran this function: undefined, blank, number, and padded number give {}, and breakInfinity gives { engine: "breakInfinity" }.
 */
export function seedsTheDefaultEngineOnce(): void {
  expect(engineSeedOption(undefined)).toEqual({});
  expect(engineSeedOption("  ")).toEqual({});
  expect(engineSeedOption("number")).toEqual({});
  expect(engineSeedOption(" number ")).toEqual({});
  expect(engineSeedOption("breakInfinity")).toEqual({ engine: "breakInfinity" });
}

/**
 * @evidence docs/requirements/active/cli-resolved-run.md#req-pr07-resolved-run The default seed reads the strategy that runs, so an override that resolves to the scenario strategy gives the no-flag seed input.
 * @evidenceReview docs/requirements/active/cli-resolved-run.md#req-pr07-resolved-run #1396a16 Re-read the section: the default evaluate seed reads the scenario, strategy, and engine, and an override replaces the scenario strategy with the factory defaults. Ran this function: no flag, a blank flag, and greedy over the greedy scenario give no strategy field, and custom.once adds its id.
 * @evidence ./runConfiguration.ts#strategySeedOption No flag and an override that resolves to the scenario id and params add nothing, another id adds its id, and the scenario id with other params adds those params.
 * @evidenceReview ./runConfiguration.ts#strategySeedOption #9d764c0 Re-read strategySeedOption: no trimmed override gives {}, an override with another id than the scenario adds that id, and the scenario id adds its resolved params unless the scenario strategy resolves to the same params and mode. Ran this function: greedy, padded greedy, and custom.once with default params give {}, custom.once with loop true adds the defaults, a missing scenario strategy and plugin.missing add the id, an invalid scripted scenario adds the scripted defaults, and plugin.not-loaded throws Unknown strategy.
 */
export function seedsTheScenarioStrategyOnce(): void {
  const { strategyRegistry } = registries();
  const seed = (input: ScenarioV1, overrideId?: string) => strategySeedOption({ scenario: input, strategyRegistry, overrideId });
  const greedy = scenario();
  expect(seed(greedy)).toEqual({});
  expect(seed(greedy, " ")).toEqual({});
  expect(seed(greedy, "greedy")).toEqual({});
  expect(seed(greedy, " greedy ")).toEqual({});
  expect(seed(greedy, "custom.once")).toEqual({ strategy: "custom.once" });
  expect(seed({ ...greedy, strategy: undefined }, "greedy")).toEqual({ strategy: "greedy" });

  const defaults = customStrategy.defaultParams as Record<string, unknown>;
  expect(seed({ ...greedy, strategy: { id: "custom.once", params: { ...defaults } } }, "custom.once")).toEqual({});
  const looping = { ...greedy, strategy: { id: "custom.once", params: { ...defaults, loop: true } } };
  expect(seed(looping, "custom.once")).toEqual({ strategy: "custom.once", strategyParams: defaults });

  expect(seed({ ...greedy, strategy: { id: "plugin.missing" } }, "custom.once")).toEqual({ strategy: "custom.once" });
  const invalid = { ...greedy, strategy: { id: "scripted", params: { schemaVersion: 1 } } };
  expect(seed(invalid, "scripted")).toEqual({
    strategy: "scripted",
    strategyParams: strategyRegistry.get("scripted")!.defaultParams,
  });
  expect(() => seed(greedy, "plugin.not-loaded")).toThrow(/^Unknown strategy: plugin.not-loaded$/);
}

describe("PR-07 resolved run", () => {
  it("keeps resolved run configuration", keepsResolvedRunConfiguration);

  it("builds an override without the scenario strategy it replaces", overrideReplacesBrokenScenarioStrategy);

  it("digests each stage from its applied plan and command inputs", digestsEachStageFromItsAppliedPlan);

  it("seeds the default engine once", seedsTheDefaultEngineOnce);

  it("seeds the scenario strategy once", seedsTheScenarioStrategyOnce);
});

