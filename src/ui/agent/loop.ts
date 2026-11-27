/**
 * Agentløkken i nettleseren: send samtalen → vis teksten fortløpende → kjør verktøykallene i svaret →
 * send alle tool_result-blokkene tilbake i én brukermelding → gjenta til veilederen er ferdig (end_turn)
 * eller taket på antall runder er nådd.
 *
 * Samtalen vokser bare i enden (append-only), og svarene legges inn nøyaktig slik serveren sendte dem:
 * thinking-blokkene er bundet til samtalen før dem, så tidligere meldinger endres aldri.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { AgentStreamHandlers, AgentTransport } from "./client";
import type { AgentMessage, AgentReply, AgentToolResult } from "./protocol";
import { runAgentTool, type AgentAction } from "./tools";

/** Høyst så mange kall til veilederen per melding fra studenten. */
export const MAX_ROUNDS = 8;

export const ROUND_LIMIT_RESULT = "Ikke kjørt: grensen for antall steg i dette svaret er nådd. Vent på studentens neste melding.";
export const ABORTED_RESULT = "Ikke kjørt: studenten avbrøt.";

export interface AgentLoopEvents extends AgentStreamHandlers {
  /** Et nytt kall til veilederen starter (runde 1, 2, …). */
  onRound?(round: number): void;
  /** Hele svaret fra et kall, før verktøyene kjøres. */
  onReply?(reply: AgentReply): void;
  /** En handling som skal vises i samtalen. */
  onAction?(action: AgentAction): void;
  /** Samtalen har vokst (svar fra veilederen eller verktøyresultater). */
  onMessages?(messages: AgentMessage[]): void;
}

export type LoopOutcome =
  | { status: "done" }
  | { status: "round_limit" }
  /** Claude (og eventuelle reservemodeller) avslo. Svaret er forkastet. */
  | { status: "refusal" }
  /** Svaret ble kuttet (max_tokens eller full kontekst). Svaret er forkastet. */
  | { status: "max_tokens" }
  | { status: "aborted" }
  | { status: "error"; message: string };

export interface AgentLoopOptions {
  transport: AgentTransport;
  signal: AbortSignal;
  maxRounds?: number;
  events?: AgentLoopEvents;
  /** Kjører ett verktøykall (standard: runAgentTool mot storen). */
  runTool?: typeof runAgentTool;
}

const skipped = (id: string, text: string): AgentToolResult => ({ type: "tool_result", tool_use_id: id, content: text, is_error: true });

/**
 * Kjører løkken fra en samtale som slutter med en melding fra studenten (tekst eller verktøyresultater).
 * Returnerer utfallet og samtalen slik den er nå. Ved avbrudd får alle verktøykall i siste svar et
 * tool_result (de som ikke ble kjørt, med is_error), så samtalen alltid kan fortsette.
 */
export async function runAgentLoop(initial: AgentMessage[], options: AgentLoopOptions): Promise<{ outcome: LoopOutcome; messages: AgentMessage[] }> {
  const { transport, signal, events = {} } = options;
  const maxRounds = options.maxRounds ?? MAX_ROUNDS;
  const runTool = options.runTool ?? runAgentTool;
  let messages = initial;
  const push = (m: AgentMessage) => {
    messages = [...messages, m];
    events.onMessages?.(messages);
  };
  const finish = (outcome: LoopOutcome) => ({ outcome, messages });

  for (let round = 1; round <= maxRounds; round++) {
    if (signal.aborted) return finish({ status: "aborted" });
    events.onRound?.(round);
    let reply: AgentReply;
    try {
      reply = await transport(messages, events, signal);
    } catch (err) {
      if (signal.aborted) return finish({ status: "aborted" });
      return finish({ status: "error", message: err instanceof Error ? err.message : "Noe gikk galt hos veilederen." });
    }
    events.onReply?.(reply);
    if (reply.stop_reason === "refusal") return finish({ status: "refusal" });
    if (reply.stop_reason === "max_tokens" || reply.stop_reason === "model_context_window_exceeded") return finish({ status: "max_tokens" });
    // Et tomt svar kan ikke legges i samtalen (API-et avviser tomme assistentmeldinger).
    if (reply.content.length === 0) return finish({ status: "done" });
    push({ role: "assistant", content: reply.content });
    if (reply.stop_reason === "pause_turn") continue;

    const calls = reply.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (reply.stop_reason !== "tool_use" || calls.length === 0) return finish({ status: "done" });
    if (round === maxRounds) {
      push({ role: "user", content: calls.map((c) => skipped(c.id, ROUND_LIMIT_RESULT)) });
      return finish({ status: "round_limit" });
    }

    // Kallene kjøres i rekkefølge (ask_prediction venter på studenten), og alle svarene går i én melding.
    const results: AgentToolResult[] = [];
    for (const call of calls) {
      if (signal.aborted) {
        results.push(skipped(call.id, ABORTED_RESULT));
        continue;
      }
      try {
        const outcome = await runTool({ id: call.id, name: call.name, input: call.input }, signal);
        results.push(outcome.result);
        if (outcome.action) events.onAction?.(outcome.action);
      } catch (err) {
        results.push(skipped(call.id, signal.aborted ? ABORTED_RESULT : `Verktøyet feilet: ${err instanceof Error ? err.message : String(err)}`));
      }
    }
    push({ role: "user", content: results });
    if (signal.aborted) return finish({ status: "aborted" });
  }
  return finish({ status: "round_limit" });
}
