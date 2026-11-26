/**
 * Tynt adapterlag mellom tolkningen og LLM-leverandøren. Eval-skriptet og /interpret bruker bare
 * dette grensesnittet, så flere leverandører kan sammenlignes på samme testsett.
 */
import type { Model } from "../../src/core/schema";
import type { Issue } from "../../src/core/validate";

export type ImageMediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

export interface InterpretInput {
  /** Bilder av oppgaven, base64-kodet. PDF-er gjøres om til bilder før de sendes hit. */
  images: { mediaType: ImageMediaType; data: string }[];
  /** Oppgaveteksten, hvis den finnes som tekst. */
  text?: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export const EMPTY_USAGE: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

export interface InterpretResult {
  model: Model;
  questions: string[];
  /** Beskrivelsen av figuren som LLM-en skrev før den sendte modellen (steg 1). */
  description: string;
  /** Advarsler fra valideringen av den endelige modellen. Feil gir nytt forsøk i stedet. */
  warnings: Issue[];
  usage: Usage;
  /** Kostnad i USD, eller undefined hvis modellen mangler i pristabellen. */
  costUsd: number | undefined;
  latencyMs: number;
  /** Antall kall til API-et (1 hvis første svar var gyldig). */
  attempts: number;
  /** Hvorfor tidligere forsøk ble forkastet, ett element per forkastet forsøk. */
  retryReasons: string[];
  /** Modellen som faktisk svarte (kan avvike ved fallback). */
  servedBy: string;
}

export type InterpretFailure = "refusal" | "max_tokens" | "invalid_model";

export class InterpretError extends Error {
  constructor(
    message: string,
    readonly reason: InterpretFailure,
    readonly usage: Usage,
    readonly costUsd: number | undefined,
    readonly attempts: number,
    readonly latencyMs: number,
  ) {
    super(message);
    this.name = "InterpretError";
  }
}

/**
 * Hendelser mens en tolkning strømmer, for fortløpende visning. Påvirker ikke selve tolkningen.
 *  - request: et nytt strømmet kall starter. attempt er forsøket (1 = første); resend er true når
 *    samme forsøk sendes på nytt fordi svaret ikke kunne leses (teksten fra kallet før forkastes).
 *  - text: tekst-delta (beskrivelsen av oppgaven).
 *  - input_json: delta av verktøyargumentene, med hele den delvis tolkede inputen så langt.
 */
export type InterpretStreamEvent =
  | { type: "request"; attempt: number; resend: boolean }
  | { type: "text"; delta: string }
  | { type: "input_json"; delta: string; snapshot: unknown };

export interface InterpretProvider {
  /** F.eks. "claude:claude-opus-5-5". */
  readonly name: string;
  interpret(input: InterpretInput): Promise<InterpretResult>;
}
