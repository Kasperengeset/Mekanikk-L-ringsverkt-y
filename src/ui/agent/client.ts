/** Klient for /api/agent: sender samtalen og leser Server-Sent Events fortløpende (se protocol.ts). */
import { accessHeaders } from "../api/access.js";
import { SSE_CONTENT_TYPE } from "../api/protocol.js";
import { createSseParser } from "../api/sse.js";
import type { AgentErrorBody, AgentErrorCode, AgentMessage, AgentReply, AgentServerEvent, AgentToolUseEvent } from "./protocol.js";

export class AgentApiError extends Error {
  constructor(
    message: string,
    readonly code: AgentErrorCode | "network" | "aborted",
  ) {
    super(message);
    this.name = "AgentApiError";
  }
}

export interface AgentStreamHandlers {
  /** Ny tekst fra veilederen. */
  onText?(delta: string): void;
  /** Et ferdig verktøykall (bare til visning; verktøyene kjøres fra det endelige svaret). */
  onToolUse?(call: AgentToolUseEvent): void;
  /** Svaret hentes på nytt: tekst og verktøykall fra dette svaret så langt gjelder ikke. */
  onRestart?(): void;
}

export interface AgentClientOptions {
  endpoint?: string;
  fetch?: typeof fetch;
}

/** Ett svar fra veilederen. Svaret strømmes; signalet stopper både strømmen og kallet til Claude. */
export type AgentTransport = (messages: AgentMessage[], handlers: AgentStreamHandlers, signal: AbortSignal) => Promise<AgentReply>;

function parseEvent(event: string, data: string): AgentServerEvent | undefined {
  try {
    return { event, data: JSON.parse(data) } as AgentServerEvent;
  } catch {
    return undefined;
  }
}

async function errorFromResponse(res: Response): Promise<AgentApiError> {
  try {
    const body = (await res.json()) as { error?: AgentErrorBody };
    if (body.error?.message) return new AgentApiError(body.error.message, body.error.code);
  } catch {
    // Ikke JSON (f.eks. en feilside fra en mellomtjener).
  }
  if (res.status === 413) return new AgentApiError("Samtalen er blitt for lang. Start en ny samtale.", "too_large");
  return new AgentApiError(`Serveren svarte med feil (${res.status}).`, "internal");
}

const isReply = (x: unknown): x is AgentReply =>
  typeof x === "object" && x !== null && Array.isArray((x as AgentReply).content) && "stop_reason" in x;

/** Transport mot /api/agent med fetch. Kaster AgentApiError med en melding som kan vises direkte. */
export function createAgentTransport(options: AgentClientOptions = {}): AgentTransport {
  return async (messages, handlers, signal) => {
    const doFetch = options.fetch ?? fetch;
    const aborted = () => new AgentApiError("Avbrutt.", "aborted");
    let res: Response;
    try {
      res = await doFetch(options.endpoint ?? "/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json", accept: SSE_CONTENT_TYPE, ...accessHeaders() },
        body: JSON.stringify({ messages }),
        signal,
      });
    } catch (err) {
      if (signal.aborted) throw aborted();
      throw new AgentApiError(`Fikk ikke kontakt med serveren${err instanceof Error ? ` (${err.message})` : ""}.`, "network");
    }
    if (!res.ok) throw await errorFromResponse(res);
    if (!res.body || !res.headers.get("content-type")?.startsWith(SSE_CONTENT_TYPE))
      throw new AgentApiError("Uventet svar fra serveren.", "internal");

    let outcome: { ok: true; value: AgentReply } | { ok: false; error: AgentApiError } | undefined;
    const parser = createSseParser(({ event, data }) => {
      if (outcome) return;
      const e = parseEvent(event, data);
      if (!e) return;
      switch (e.event) {
        case "text":
          handlers.onText?.(e.data.delta);
          break;
        case "tool_use":
          handlers.onToolUse?.(e.data);
          break;
        case "restart":
          handlers.onRestart?.();
          break;
        case "error":
          outcome = { ok: false, error: new AgentApiError(e.data.message, e.data.code) };
          break;
        case "message":
          outcome = isReply(e.data)
            ? { ok: true, value: e.data }
            : { ok: false, error: new AgentApiError("Serveren sendte et svar som ikke kunne leses.", "internal") };
          break;
      }
    });

    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.push(value);
        if (outcome) break;
      }
    } catch {
      if (signal.aborted) throw aborted();
      throw new AgentApiError("Forbindelsen til serveren ble brutt.", "network");
    } finally {
      parser.end();
      reader.cancel().catch(() => {});
    }
    if (signal.aborted) throw aborted();
    if (!outcome) throw new AgentApiError("Forbindelsen ble brutt før veilederen var ferdig.", "network");
    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  };
}
