/**
 * Tolkningsløpet: én tolkning, og ved behov flere parallelle tolkninger som sammenlignes
 * (self-consistency). Brukes av eval-skriptet og senere av /interpret.
 */
import { applyDisagreements, selectConsensus, type Disagreement } from "../src/core/consistency.js";
import { addUsage, type InterpretInput, type InterpretProvider, type InterpretResult } from "./llm/adapter.js";

export type ConsistencyMode = "never" | "low_confidence" | "always";

export interface InterpretOptions {
  /** never: én tolkning. low_confidence: flere bare når første tolkning har usikre entiteter. */
  consistency?: ConsistencyMode;
  /** Antall tolkninger totalt når self-consistency slår inn. */
  runs?: number;
  /** Under denne sikkerheten regnes en entitet som usikker. */
  lowConfidence?: number;
}

export interface InterpretOutcome extends InterpretResult {
  consistency?: { runs: number; succeeded: number; disagreements: Disagreement[] };
}

export async function interpretProblem(provider: InterpretProvider, input: InterpretInput, options: InterpretOptions = {}): Promise<InterpretOutcome> {
  const mode = options.consistency ?? "low_confidence";
  const runs = options.runs ?? 3;
  const threshold = options.lowConfidence ?? 0.7;

  const first = await provider.interpret(input);
  const uncertain = first.model.provenance.some((p) => p.confidence < threshold) || first.questions.length > 0;
  if (mode === "never" || runs < 2 || (mode === "low_confidence" && !uncertain)) return first;

  const extra = await Promise.allSettled(Array.from({ length: runs - 1 }, () => provider.interpret(input)));
  const results = [first, ...extra.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []))];
  const usage = results.slice(1).reduce((u, r) => addUsage(u, r.usage), first.usage);
  const costUsd = results.every((r) => r.costUsd !== undefined) ? results.reduce((s, r) => s + r.costUsd!, 0) : undefined;
  const latencyMs = first.latencyMs + Math.max(0, ...results.slice(1).map((r) => r.latencyMs));
  if (results.length < 2) return { ...first, usage, costUsd, latencyMs, consistency: { runs, succeeded: 1, disagreements: [] } };

  const { index, disagreements } = selectConsensus(results.map((r) => r.model));
  const chosen = results[index]!;
  const applied = applyDisagreements(chosen.model, disagreements, results.length);
  return {
    ...chosen,
    model: applied.model,
    questions: [...chosen.questions, ...applied.questions],
    usage,
    costUsd,
    latencyMs,
    attempts: results.reduce((s, r) => s + r.attempts, 0),
    retryReasons: results.flatMap((r) => r.retryReasons),
    consistency: { runs, succeeded: results.length, disagreements },
  };
}
