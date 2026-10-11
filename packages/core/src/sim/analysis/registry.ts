import type { AnalysisCapabilityName, CapabilityKnowledge } from "./contracts";
import { capabilityKnowledge } from "./metrics";
import type { GoalDefinition, MetricDefinition } from "./metrics";

/**
 * What one model version can explain.
 * AnalyzerRegistry, which chooses an analysis method, is DX-02 and is not this type.
 * Flow and advance method bodies stay in later PRs.
 */
export type ModelAnalysisAdapter<N, U extends string, Vars> = Readonly<{
  modelId: string;
  modelVersion: number;
  capabilities?: Partial<Record<AnalysisCapabilityName, "statically-known" | "unsupported">>;
  metrics?: readonly MetricDefinition<N, U, Vars>[];
  goals?: readonly GoalDefinition<N, U, Vars>[];
}>;

export type ModelAnalysisRegistry<N, U extends string, Vars> = Readonly<{
  register: (adapter: ModelAnalysisAdapter<N, U, Vars>) => void;
  get: (modelId: string, modelVersion: number) => ModelAnalysisAdapter<N, U, Vars> | undefined;
  list: () => readonly Readonly<{ modelId: string; modelVersion: number }>[];
  knowledge: (modelId: string, modelVersion: number, name: AnalysisCapabilityName) => CapabilityKnowledge;
}>;

function keyOf(modelId: string, modelVersion: number): string {
  return `${modelId}@${modelVersion}`;
}

export function createModelAnalysisRegistry<N, U extends string, Vars>(): ModelAnalysisRegistry<N, U, Vars> {
  const map = new Map<string, ModelAnalysisAdapter<N, U, Vars>>();
  return {
    register(adapter) {
      map.set(keyOf(adapter.modelId, adapter.modelVersion), adapter);
    },
    get(modelId, modelVersion) {
      return map.get(keyOf(modelId, modelVersion));
    },
    list() {
      return [...map.values()].map((adapter) => ({
        modelId: adapter.modelId,
        modelVersion: adapter.modelVersion,
      }));
    },
    knowledge(modelId, modelVersion, name) {
      const adapter = map.get(keyOf(modelId, modelVersion));
      if (!adapter) return "unknown";
      return capabilityKnowledge(adapter.capabilities, name);
    },
  };
}

export function flowResult(knowledge: CapabilityKnowledge): Readonly<{
  capability: "flow";
  knowledge: CapabilityKnowledge;
  status: "unsupported" | "insufficient-data";
}> | Readonly<{ capability: "flow"; knowledge: "statically-known"; status: "unsupported"; reason: string }> {
  if (knowledge === "unknown") return { capability: "flow", knowledge, status: "insufficient-data" };
  if (knowledge === "statically-known") {
    return {
      capability: "flow",
      knowledge,
      status: "unsupported",
      reason: "flow method body is not in this PR",
    };
  }
  return { capability: "flow", knowledge: "unsupported", status: "unsupported" };
}

export function resetResult(knowledge: CapabilityKnowledge): Readonly<{
  capability: "reset";
  knowledge: CapabilityKnowledge;
  status: "unsupported" | "insufficient-data";
  reason?: string;
}> {
  if (knowledge === "unknown") return { capability: "reset", knowledge, status: "insufficient-data" };
  if (knowledge === "statically-known") {
    return {
      capability: "reset",
      knowledge,
      status: "unsupported",
      reason: "reset execution is not in this PR",
    };
  }
  return { capability: "reset", knowledge: "unsupported", status: "unsupported" };
}
