/**
 * Handleren bak /api/agent: validerer samtalen, legger på systemprompten og verktøyene, kaller Claude
 * strømmet og sender tekst, verktøykall og hele svaret tilbake som Server-Sent Events
 * (formatet står i src/ui/agent/protocol.ts).
 *
 * Tilstandsløs: klienten eier samtalen og kjører verktøyene i nettleseren, der modellen og løseren bor.
 * Standard Web Request/Response, så samme kode kjører i Vercel (api/agent.ts), i Vite under `pnpm dev`
 * (vite.config.ts) og i testene. Anthropic-klienten sendes inn, så testene slipper ekte API-kall.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { AGENT_SYSTEM_PROMPT, AGENT_TOOLS } from "../src/core/llm/agent";
import {
  AgentRequest,
  MAX_REQUEST_BYTES,
  type AgentContentBlock,
  type AgentErrorBody,
  type AgentErrorCode,
  type AgentMessage,
  type AgentReply,
  type AgentServerEvent,
  type Usage,
} from "../src/ui/agent/protocol";
import { SSE_CONTENT_TYPE } from "../src/ui/api/protocol";
import { encodeSseEvent, SSE_HEARTBEAT } from "../src/ui/api/sse";
import { costUsd } from "./llm/pricing";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];

export interface AgentConfig {
  model: string;
  effort: Effort;
  /** Tenkingen teller med. Svarene er korte, så taket er der mest for å begrense kostnaden ved et løpsk svar. */
  maxTokens: number;
}

export const DEFAULT_AGENT_CONFIG: AgentConfig = { model: "claude-opus-5-5", effort: "medium", maxTokens: 32_000 };

/** AGENT_MODEL og AGENT_EFFORT fra miljøet; ukjente verdier gir standarden. */
export function agentConfigFromEnv(env: Record<string, string | undefined> = process.env): AgentConfig {
  const effort = env.AGENT_EFFORT as Effort | undefined;
  return {
    ...DEFAULT_AGENT_CONFIG,
    ...(env.AGENT_MODEL?.trim() ? { model: env.AGENT_MODEL.trim() } : {}),
    ...(effort && EFFORTS.includes(effort) ? { effort } : {}),
  };
}

export interface AgentHandlerDeps {
  /** Kalles per forespørsel etter at konfigurasjonen er sjekket. */
  createClient(): Anthropic;
  config?: Partial<AgentConfig>;
  /** Sjekkes før strømmen starter; en melding her gir 500 med koden config (f.eks. manglende API-nøkkel). */
  checkConfig?(): string | undefined;
  /** Hjerteslag mens Claude tenker, så mellomtjenere ikke lukker forbindelsen. */
  heartbeatMs?: number;
  /** Logging av feil (standard console.error). Detaljer og stacktrace går hit, aldri til klienten. */
  log?(message: string, err: unknown): void;
}

/** Modeller der server-side fallback ved avslag er tilgjengelig (som i server/llm/claude.ts). */
const supportsFallbacks = (model: string) => /^claude-(opus-5|sonnet-5-5|fable-5)/.test(model);
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** Verktøyene fra fundamentet. Strømmet input valideres i nettleseren med AgentTools (Zod) før de kjøres. */
const TOOLS: Anthropic.Beta.BetaTool[] = AGENT_TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: t.input_schema as Anthropic.Beta.BetaTool.InputSchema,
  eager_input_streaming: true,
}));

/** Antall ganger et svar hentes på nytt når strømmen ikke kunne leses (ugyldig verktøy-JSON, brutt forbindelse). */
const STREAM_RETRIES = 2;

function jsonError(status: number, code: AgentErrorCode, message: string): Response {
  return Response.json({ error: { code, message } satisfies AgentErrorBody }, { status });
}

function toUsage(u: Anthropic.Beta.BetaUsage): Usage {
  return {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
  };
}

/**
 * Blokkene slik de skal sendes tilbake. Uendret, unntatt etter et avslag midt i svaret (server-side fallback):
 * da skal thinking-, tool_use- og andre modellinterne blokker før den siste fallback-blokken utelates, mens
 * tekst og fallback-blokkene beholdes der de står.
 */
export function replayContent(content: AgentContentBlock[]): AgentContentBlock[] {
  const boundary = content.map((b) => b.type).lastIndexOf("fallback");
  if (boundary < 0) return content;
  return content.filter((b, i) => i >= boundary || b.type === "text" || b.type === "fallback");
}

/** API-feil til en kort melding på norsk. Detaljene logges på serveren. */
export function describeAgentError(err: unknown): AgentErrorBody & { status: number } {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError)
    return { status: 500, code: "auth", message: "API-nøkkelen ble avvist. Sjekk ANTHROPIC_API_KEY på serveren." };
  if (err instanceof Anthropic.RateLimitError)
    return { status: 503, code: "rate_limit", message: "Veilederen har for mange samtaler akkurat nå. Vent litt og prøv igjen." };
  if (err instanceof Anthropic.APIConnectionError)
    return { status: 502, code: "connection", message: "Fikk ikke kontakt med Claude. Prøv igjen om litt." };
  if (err instanceof Anthropic.APIError) {
    if (err.status === 529 || (err.status !== undefined && err.status >= 500))
      return { status: 503, code: "overloaded", message: "Claude er overbelastet akkurat nå. Prøv igjen om litt." };
    return { status: 502, code: "api", message: "Claude avviste samtalen. Prøv igjen, eller start en ny samtale." };
  }
  if (err instanceof Anthropic.AnthropicError)
    return { status: 502, code: "connection", message: "Svaret fra Claude ble brutt eller kunne ikke leses. Prøv igjen." };
  return { status: 500, code: "internal", message: "Noe gikk galt hos veilederen. Prøv igjen." };
}

/** Første valideringsfeil som én lesbar setning. Feil uten egen melding får en generell norsk tekst. */
function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Samtalen har et ugyldig format.";
}

export function createAgentHandler(deps: AgentHandlerDeps): (req: Request) => Promise<Response> {
  const config: AgentConfig = { ...DEFAULT_AGENT_CONFIG, ...deps.config };
  const heartbeatMs = deps.heartbeatMs ?? 15_000;
  const log = deps.log ?? ((message, err) => console.error(message, err));

  return async function handle(req: Request): Promise<Response> {
    if (req.method !== "POST") return jsonError(405, "bad_request", "Bruk POST.");

    const tooLarge = () => jsonError(413, "too_large", "Samtalen er blitt for lang. Start en ny samtale.");
    if (Number(req.headers.get("content-length") ?? 0) > MAX_REQUEST_BYTES) return tooLarge();

    let body: unknown;
    try {
      const raw = await req.text();
      if (new TextEncoder().encode(raw).length > MAX_REQUEST_BYTES) return tooLarge();
      body = JSON.parse(raw);
    } catch {
      return jsonError(400, "bad_request", "Forespørselen er ikke gyldig JSON.");
    }
    // Skjemaets egne meldinger går foran; resten (f.eks. ukjente felt) får en generell norsk melding.
    const parsed = AgentRequest.safeParse(body, { error: () => "Samtalen har et ugyldig format." });
    if (!parsed.success) return jsonError(400, "bad_request", firstIssue(parsed.error));

    const configProblem = deps.checkConfig?.();
    if (configProblem) return jsonError(500, "config", configProblem);

    // Meldingene sendes videre nøyaktig slik klienten sendte dem (skjemaet fjerner ingenting fra svarblokkene).
    const messages = (body as { messages: AgentMessage[] }).messages;
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
        const send = (e: AgentServerEvent) => write(encodeSseEvent(e.event, e.data));
        const heartbeat = setInterval(() => write(SSE_HEARTBEAT), heartbeatMs);

        const run = async (): Promise<AgentReply> => {
          const client = deps.createClient();
          for (let retry = 0; ; retry++) {
            if (retry > 0) send({ event: "restart", data: {} });
            const s = client.beta.messages.stream(
              {
                model: config.model,
                max_tokens: config.maxTokens,
                ...(supportsFallbacks(config.model) ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
                thinking: { type: "adaptive" },
                output_config: { effort: config.effort },
                // Fast systemprompt med eget bruddpunkt, og automatisk caching av samtalen så langt.
                system: [{ type: "text", text: AGENT_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
                cache_control: { type: "ephemeral" },
                tools: TOOLS,
                messages,
              },
              { signal: abort.signal },
            );
            s.on("text", (delta) => send({ event: "text", data: { delta } }));
            s.on("contentBlock", (block) => {
              if (block.type === "tool_use") send({ event: "tool_use", data: { id: block.id, name: block.name, input: block.input } });
            });
            try {
              const message = await s.finalMessage();
              const usage = toUsage(message.usage);
              return {
                content: replayContent(message.content),
                stop_reason: message.stop_reason,
                stop_details: message.stop_details,
                model: message.model,
                usage,
                costUsd: costUsd(message.model, usage) ?? null,
              };
            } catch (err) {
              // API-feil (rate limit, avvist nøkkel, avbrudd, ...) prøves ikke på nytt her; SDK-en har allerede
              // prøvd de som kan prøves. Ugyldig verktøy-JSON og brutt strøm hentes på nytt.
              if (err instanceof Anthropic.APIError || abort.signal.aborted || retry >= STREAM_RETRIES) throw err;
              log("Strømmen fra Claude kunne ikke leses, prøver på nytt:", err);
            }
          }
        };

        run()
          .then((reply) => send({ event: "message", data: reply }))
          .catch((err: unknown) => {
            if (abort.signal.aborted) return;
            const e = describeAgentError(err);
            log("Feil i /api/agent:", err);
            send({ event: "error", data: { code: e.code, message: e.message } });
          })
          .finally(() => {
            clearInterval(heartbeat);
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
