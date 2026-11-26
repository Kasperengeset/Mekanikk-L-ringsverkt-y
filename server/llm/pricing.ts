/**
 * Priser i USD per million tokens. Kilde: Anthropics prisliste per 2026-11-03.
 * Sjekk mot gjeldende priser før tallene brukes i økonomiske beslutninger.
 */
import type { Usage } from "./adapter";

interface Price {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

const PRICES: Record<string, Price> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  "claude-fable-5-2": { input: 8, output: 40, cacheRead: 0.2, cacheWrite: 10 },
};

export function costUsd(modelId: string, usage: Usage): number | undefined {
  const p = PRICES[modelId];
  if (!p) return undefined;
  return (
    (usage.inputTokens * p.input +
      usage.outputTokens * p.output +
      usage.cacheReadTokens * p.cacheRead +
      usage.cacheWriteTokens * p.cacheWrite) /
    1e6
  );
}
