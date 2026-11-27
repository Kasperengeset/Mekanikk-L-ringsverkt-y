/** Klient for /api/interpret: sender bildene og leser Server-Sent Events fortløpende (se protocol.ts). */
import { Model } from "../../core/schema.js";
import { SSE_CONTENT_TYPE, type ApiErrorBody, type ErrorCode, type InterpretRequest, type InterpretResponse, type Progress, type ServerEvent } from "./protocol.js";
import { createSseParser } from "./sse.js";

export class InterpretApiError extends Error {
  constructor(
    message: string,
    readonly code: ErrorCode | "network" | "aborted",
  ) {
    super(message);
    this.name = "InterpretApiError";
  }
}

export interface InterpretHandlers {
  onProgress?(progress: Progress): void;
  /** Ny tekst i Claudes beskrivelse. */
  onText?(delta: string): void;
  /** Beskrivelsen så langt erstattes (et kall ble sendt på nytt). */
  onDescription?(text: string): void;
  /** Delvis, uvalidert modell mens den strømmer. */
  onPartial?(model: unknown): void;
}

export interface InterpretClientOptions {
  signal?: AbortSignal;
  endpoint?: string;
  fetch?: typeof fetch;
}

function parseEvent(event: string, data: string): ServerEvent | undefined {
  try {
    return { event, data: JSON.parse(data) } as ServerEvent;
  } catch {
    return undefined;
  }
}

async function errorFromResponse(res: Response): Promise<InterpretApiError> {
  try {
    const body = (await res.json()) as { error?: ApiErrorBody };
    if (body.error?.message) return new InterpretApiError(body.error.message, body.error.code);
  } catch {
    // Ikke JSON (f.eks. en feilside fra en mellomtjener).
  }
  if (res.status === 413) return new InterpretApiError("Bildene er for store. Velg færre sider eller mindre bilder.", "too_large");
  return new InterpretApiError(`Serveren svarte med feil (${res.status}).`, "internal");
}

/** Kjører en tolkning. Kaster InterpretApiError med en melding som kan vises direkte. */
export async function interpretRemote(
  request: InterpretRequest,
  handlers: InterpretHandlers = {},
  options: InterpretClientOptions = {},
): Promise<InterpretResponse> {
  const doFetch = options.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(options.endpoint ?? "/api/interpret", {
      method: "POST",
      headers: { "content-type": "application/json", accept: SSE_CONTENT_TYPE },
      body: JSON.stringify(request),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (err) {
    if (options.signal?.aborted) throw new InterpretApiError("Tolkningen ble avbrutt.", "aborted");
    throw new InterpretApiError(`Fikk ikke kontakt med serveren${err instanceof Error ? ` (${err.message})` : ""}.`, "network");
  }
  if (!res.ok) throw await errorFromResponse(res);
  if (!res.body || !res.headers.get("content-type")?.startsWith(SSE_CONTENT_TYPE))
    throw new InterpretApiError("Uventet svar fra serveren.", "internal");

  let outcome: { ok: true; value: InterpretResponse } | { ok: false; error: InterpretApiError } | undefined;
  const parser = createSseParser(({ event, data }) => {
    if (outcome) return;
    const e = parseEvent(event, data);
    if (!e) return;
    switch (e.event) {
      case "progress":
        handlers.onProgress?.(e.data);
        break;
      case "text":
        handlers.onText?.(e.data.delta);
        break;
      case "description":
        handlers.onDescription?.(e.data.text);
        break;
      case "partial":
        handlers.onPartial?.(e.data.model);
        break;
      case "error":
        outcome = { ok: false, error: new InterpretApiError(e.data.message, e.data.code) };
        break;
      case "result": {
        const model = Model.safeParse(e.data.model);
        outcome = model.success
          ? { ok: true, value: { ...e.data, model: model.data } }
          : { ok: false, error: new InterpretApiError("Serveren sendte en modell som ikke følger skjemaet.", "invalid_model") };
        break;
      }
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
    if (options.signal?.aborted) throw new InterpretApiError("Tolkningen ble avbrutt.", "aborted");
    throw new InterpretApiError("Forbindelsen til serveren ble brutt under tolkningen.", "network");
  } finally {
    parser.end();
    reader.cancel().catch(() => {});
  }
  if (!outcome) throw new InterpretApiError("Forbindelsen ble brutt før tolkningen var ferdig.", "network");
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}
