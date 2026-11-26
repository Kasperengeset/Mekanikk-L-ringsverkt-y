/**
 * Handleren bak /api/interpret: validerer forespørselen, kjører tolkningen og strømmer fremdrift,
 * beskrivelse, delvis modell og resultat som Server-Sent Events (formatet står i src/ui/api/protocol.ts).
 *
 * Standard Web Request/Response, så den samme koden kjører i Vercel (api/interpret.ts), i Vite-serveren
 * under `pnpm dev` (vite.config.ts) og i testene. Leverandøren sendes inn, så testene slipper ekte API-kall.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  InterpretRequest,
  MAX_REQUEST_BYTES,
  MAX_TOTAL_BYTES,
  SSE_CONTENT_TYPE,
  tooLargeMessage,
  totalImageBytes,
  type ApiErrorBody,
  type ErrorCode,
  type InterpretResponse,
  type ProgressStage,
  type ServerEvent,
} from "../src/ui/api/protocol";
import { encodeSseEvent, SSE_HEARTBEAT } from "../src/ui/api/sse";
import { interpretProblem, type ConsistencyMode, type InterpretOptions, type InterpretOutcome } from "./interpret";
import { InterpretError, type InterpretProvider, type InterpretStreamEvent } from "./llm/adapter";

export interface ProviderOptions {
  /** Strømhendelser fra tolkningen. Bare den første tolkningen strømmes (ikke ekstra kjøringer for self-consistency). */
  onEvent?: (event: InterpretStreamEvent) => void;
  /** Avbrytes når klienten kobler fra. */
  signal: AbortSignal;
}

export interface InterpretHandlerDeps {
  createProvider(options: ProviderOptions): InterpretProvider;
  /** Sjekkes før strømmen starter; en melding her gir 500 med koden config (f.eks. manglende API-nøkkel). */
  checkConfig?(): string | undefined;
  interpretOptions?: InterpretOptions;
  /** Hjerteslag mens Claude tenker, så mellomtjenere ikke lukker forbindelsen. */
  heartbeatMs?: number;
  /** Delvis modell sendes høyst så ofte. */
  partialIntervalMs?: number;
  /** Logging av uventede feil (standard console.error). Stacktrace går hit, aldri til klienten. */
  log?(message: string, err: unknown): void;
}

const STAGE_MESSAGES: Record<Exclude<ProgressStage, "retry">, string> = {
  start: "Claude leser oppgaven …",
  describing: "Claude beskriver oppgaven …",
  modelling: "Claude bygger modellen …",
  resend: "Svaret kunne ikke leses. Prøver på nytt …",
  consistency: "Noe i tolkningen er usikkert. Claude tolker oppgaven noen ganger til og sammenligner …",
};

function jsonError(status: number, code: ErrorCode, message: string): Response {
  return Response.json({ error: { code, message } satisfies ApiErrorBody }, { status });
}

/** Første valideringsfeil som én lesbar setning. */
function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Ugyldig forespørsel.";
  return issue.message;
}

/** API- og tolkningsfeil til en ryddig melding på norsk (aldri stacktrace). */
export function describeError(err: unknown): ApiErrorBody & { status: number } {
  if (err instanceof InterpretError) {
    const messages: Record<InterpretError["reason"], string> = {
      refusal: "Claude ville ikke tolke denne oppgaven. Prøv et annet bilde eller skriv inn oppgaveteksten.",
      max_tokens: "Svaret fra Claude ble for langt og ble kuttet. Prøv å velge bare én oppgave.",
      invalid_model: `Claude klarte ikke å lage en gyldig modell etter ${err.attempts} forsøk. Prøv igjen, eller beskriv oppgaven tydeligere.`,
    };
    return { status: 502, code: err.reason, message: messages[err.reason] };
  }
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError)
    return { status: 500, code: "auth", message: "API-nøkkelen ble avvist. Sjekk ANTHROPIC_API_KEY på serveren." };
  if (err instanceof Anthropic.RateLimitError)
    return { status: 503, code: "rate_limit", message: "For mange tolkninger akkurat nå. Vent litt og prøv igjen." };
  if (err instanceof Anthropic.APIConnectionError)
    return { status: 502, code: "connection", message: "Fikk ikke kontakt med Claude. Prøv igjen om litt." };
  if (err instanceof Anthropic.APIError) {
    if (err.status === 529 || (err.status !== undefined && err.status >= 500))
      return { status: 503, code: "overloaded", message: "Claude er overbelastet akkurat nå. Prøv igjen om litt." };
    // 4xx fra API-et (f.eks. et bilde API-et ikke godtar). Meldingen fra API-et er kort og nyttig.
    const detail = err.apiMessage?.slice(0, 300);
    return { status: 502, code: "api", message: `Claude avviste forespørselen${detail ? `: ${detail}` : "."}` };
  }
  return { status: 500, code: "internal", message: "Noe gikk galt under tolkningen. Prøv igjen." };
}

function toResponse(outcome: InterpretOutcome): InterpretResponse {
  return {
    model: outcome.model,
    questions: outcome.questions,
    description: outcome.description,
    warnings: outcome.warnings,
    usage: outcome.usage,
    costUsd: outcome.costUsd ?? null,
    ...(outcome.consistency ? { consistency: outcome.consistency } : {}),
  };
}

/** Self-consistency fra miljøet (INTERPRET_CONSISTENCY), ellers standarden i interpretProblem. */
export function consistencyFromEnv(env: Record<string, string | undefined> = process.env): InterpretOptions {
  const mode = env.INTERPRET_CONSISTENCY as ConsistencyMode | undefined;
  return mode && ["never", "low_confidence", "always"].includes(mode) ? { consistency: mode } : {};
}

export function createInterpretHandler(deps: InterpretHandlerDeps): (req: Request) => Promise<Response> {
  const heartbeatMs = deps.heartbeatMs ?? 15_000;
  const partialIntervalMs = deps.partialIntervalMs ?? 250;
  const log = deps.log ?? ((message, err) => console.error(message, err));

  return async function handle(req: Request): Promise<Response> {
    if (req.method !== "POST") return jsonError(405, "bad_request", "Bruk POST.");

    const length = Number(req.headers.get("content-length") ?? 0);
    if (length > MAX_REQUEST_BYTES) return jsonError(413, "too_large", tooLargeMessage());

    let body: unknown;
    try {
      const raw = await req.text();
      if (raw.length > MAX_REQUEST_BYTES) return jsonError(413, "too_large", tooLargeMessage());
      body = JSON.parse(raw);
    } catch {
      return jsonError(400, "bad_request", "Forespørselen er ikke gyldig JSON.");
    }
    const parsed = InterpretRequest.safeParse(body);
    if (!parsed.success) return jsonError(400, "bad_request", firstIssue(parsed.error));
    if (totalImageBytes(parsed.data) > MAX_TOTAL_BYTES) return jsonError(413, "too_large", tooLargeMessage());

    const configProblem = deps.checkConfig?.();
    if (configProblem) return jsonError(500, "config", configProblem);

    const input = { images: parsed.data.images, ...(parsed.data.text?.trim() ? { text: parsed.data.text.trim() } : {}) };
    const abort = new AbortController();
    req.signal?.addEventListener("abort", () => abort.abort(), { once: true });
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        const write = (chunk: string) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            closed = true;
          }
        };
        const send = (e: ServerEvent) => write(encodeSseEvent(e.event, e.data));
        const progress = (stage: Exclude<ProgressStage, "retry">) => send({ event: "progress", data: { stage, message: STAGE_MESSAGES[stage] } });

        // Beskrivelsen: `committed` er teksten fra ferdige forsøk, `current` fra forsøket som pågår.
        let committed = "";
        let current = "";
        let described = false;
        let modelling = false;
        let latest: unknown;
        let partialTimer: ReturnType<typeof setTimeout> | undefined;
        const flushPartial = () => {
          partialTimer = undefined;
          const model = latest && typeof latest === "object" ? (latest as { model?: unknown }).model : undefined;
          if (model !== undefined) send({ event: "partial", data: { model } });
        };

        const onEvent = (e: InterpretStreamEvent) => {
          if (e.type === "request") {
            if (e.resend) {
              current = "";
              send({ event: "description", data: { text: committed } });
              progress("resend");
            } else if (e.attempt > 1) {
              committed = [committed, current].filter(Boolean).join("\n\n");
              current = "";
              send({
                event: "progress",
                data: { stage: "retry", message: `Modellen hadde feil. Claude retter den (forsøk ${e.attempt}) …` },
              });
            }
            described = false;
            modelling = false;
            latest = undefined;
            if (partialTimer) clearTimeout(partialTimer);
            partialTimer = undefined;
            // Den delvise modellen fra forrige forsøk gjelder ikke lenger.
            if (e.attempt > 1 || e.resend) send({ event: "partial", data: { model: null } });
          } else if (e.type === "text") {
            if (!described) {
              described = true;
              progress("describing");
            }
            const delta = current === "" && committed !== "" ? `\n\n${e.delta}` : e.delta;
            current += e.delta;
            send({ event: "text", data: { delta } });
          } else {
            if (!modelling) {
              modelling = true;
              progress("modelling");
            }
            latest = e.snapshot;
            partialTimer ??= setTimeout(flushPartial, partialIntervalMs);
          }
        };

        let silent: InterpretProvider | undefined;
        let calls = 0;
        // Bare første tolkning strømmes; ekstra kjøringer for self-consistency går stille i parallell.
        const provider: InterpretProvider = {
          name: "interpret-stream",
          async interpret(i) {
            calls++;
            if (calls === 1) {
              try {
                return await deps.createProvider({ onEvent, signal: abort.signal }).interpret(i);
              } finally {
                // Den delvise modellen er utdatert når tolkningen er ferdig (resultatet kommer, eller flere kjøringer).
                if (partialTimer) clearTimeout(partialTimer);
                partialTimer = undefined;
                latest = undefined;
              }
            }
            if (calls === 2) progress("consistency");
            silent ??= deps.createProvider({ signal: abort.signal });
            return silent.interpret(i);
          },
        };

        const heartbeat = setInterval(() => write(SSE_HEARTBEAT), heartbeatMs);
        progress("start");

        interpretProblem(provider, input, deps.interpretOptions)
          .then((outcome) => send({ event: "result", data: toResponse(outcome) }))
          .catch((err: unknown) => {
            if (abort.signal.aborted) return;
            const e = describeError(err);
            if (e.code === "internal") log("Uventet feil i /api/interpret:", err);
            send({ event: "error", data: { code: e.code, message: e.message } });
          })
          .finally(() => {
            clearInterval(heartbeat);
            if (partialTimer) clearTimeout(partialTimer);
            if (!closed) {
              closed = true;
              try {
                controller.close();
              } catch {
                // Allerede lukket av klienten.
              }
            }
          });
      },
      cancel() {
        abort.abort();
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": `${SSE_CONTENT_TYPE}; charset=utf-8`,
        "cache-control": "no-cache, no-transform",
        "x-accel-buffering": "no",
      },
    });
  };
}
