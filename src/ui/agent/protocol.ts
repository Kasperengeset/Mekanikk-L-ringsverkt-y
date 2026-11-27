/**
 * Kontrakten for /api/agent, delt av serveren (server/agentHandler.ts) og nettleseren (src/ui/agent/client.ts).
 *
 * Serveren er tilstandsløs. Forespørsel: POST med JSON `{ messages }`, hele samtalen i Anthropic-format.
 * Tidligere svar fra veilederen sendes tilbake slik de kom i `message`-hendelsen (også thinking-blokker),
 * og verktøyresultater som tool_result-blokker i brukermeldinger. Systemprompten og verktøyene legger
 * serveren til; klienten sender dem aldri. Ugyldige forespørsler gir 4xx med JSON `{ error: { code, message } }`
 * før strømmen starter.
 *
 * Svar: Server-Sent Events (text/event-stream). Hver hendelse er `event: <navn>` + én `data:`-linje med JSON:
 *   text      { delta }              tekst fra veilederen, fortløpende
 *   tool_use  { id, name, input }    et ferdig verktøykall, til visning. Verktøyene kjøres fra `message`.
 *   restart   {}                     svaret kunne ikke leses og hentes på nytt: forkast tekst og verktøykall så langt
 *   message   AgentReply             hele assistentmeldingen med stop_reason, usage og kostnad; strømmen lukkes etterpå
 *   error     { code, message }      feil; strømmen lukkes etterpå
 * Linjer som begynner med kolon er hjerteslag (holder forbindelsen åpen mens Claude tenker).
 */
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

/** Meldinger i samtalen, i Anthropic-format. */
export type AgentMessage = Anthropic.Beta.BetaMessageParam;
export type AgentContentBlock = Anthropic.Beta.BetaContentBlock;
export type AgentToolResult = Anthropic.Beta.BetaToolResultBlockParam;

export const MAX_MESSAGES = 300;
/** Én melding fra studenten (tekstfeltet har samme grense). */
export const MAX_STUDENT_TEXT = 4000;
/** Én tekst i et verktøyresultat (get_state er typisk noen få kB). */
export const MAX_TOOL_RESULT_TEXT = 100_000;
export const MAX_BLOCKS_PER_MESSAGE = 64;
/** Hele forespørselen. */
export const MAX_REQUEST_BYTES = 2 * 1024 * 1024;

const TOO_LONG = "Samtalen er blitt for lang. Start en ny samtale.";

const TextBlock = z.strictObject({
  type: z.literal("text"),
  text: z
    .string()
    .min(1, { error: "En melding er tom." })
    .max(MAX_STUDENT_TEXT, { error: `En melding er lengre enn ${MAX_STUDENT_TEXT} tegn.` }),
});

const ToolResultBlock = z.strictObject({
  type: z.literal("tool_result"),
  tool_use_id: z.string().min(1).max(200),
  content: z
    .union([
      z.string().max(MAX_TOOL_RESULT_TEXT, { error: TOO_LONG }),
      z.array(z.strictObject({ type: z.literal("text"), text: z.string().max(MAX_TOOL_RESULT_TEXT, { error: TOO_LONG }) })).max(16),
    ])
    .optional(),
  is_error: z.boolean().optional(),
});

/** Studentens tekst og verktøyresultater. Ingen bilder, dokumenter eller cache_control fra klienten. */
const UserMessage = z.strictObject({
  role: z.literal("user"),
  content: z.union([
    TextBlock.shape.text,
    z.array(z.discriminatedUnion("type", [TextBlock, ToolResultBlock])).min(1).max(MAX_BLOCKS_PER_MESSAGE, { error: TOO_LONG }),
  ]),
});

/**
 * Veilederens tidligere svar. Blokkene kommer fra API-et og sendes tilbake uendret, så bare typen sjekkes
 * (nye blokktyper skal ikke stoppe samtalen). Størrelsen begrenses av grensen for hele forespørselen.
 */
const AssistantMessage = z.strictObject({
  role: z.literal("assistant"),
  content: z.array(z.looseObject({ type: z.string().min(1).max(64) })).min(1).max(MAX_BLOCKS_PER_MESSAGE, { error: TOO_LONG }),
});

export const AgentRequest = z
  .strictObject({
    messages: z
      .array(z.discriminatedUnion("role", [UserMessage, AssistantMessage]), { error: "messages må være en liste med meldinger." })
      .min(1, { error: "Samtalen er tom." })
      .max(MAX_MESSAGES, { error: TOO_LONG }),
  })
  .superRefine((r, ctx) => {
    if (r.messages[0]?.role !== "user") ctx.addIssue({ code: "custom", message: "Samtalen må begynne med en melding fra studenten." });
    if (r.messages.at(-1)?.role !== "user") ctx.addIssue({ code: "custom", message: "Siste melding må være fra studenten." });
  });

export type AgentRequest = z.infer<typeof AgentRequest>;

/** Feilkoder: access, bad_request og too_large før strømmen, resten i error-hendelsen (eller som 5xx). */
export type AgentErrorCode = "access" | "bad_request" | "too_large" | "config" | "auth" | "rate_limit" | "overloaded" | "connection" | "api" | "internal";

export interface AgentErrorBody {
  code: AgentErrorCode;
  message: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface AgentReply {
  /**
   * Innholdsblokkene slik klienten skal sende dem tilbake: uendret, med ett unntak fra API-et: etter et
   * avslag midt i svaret (server-side fallback) er thinking- og tool_use-blokkene fra modellen som avslo, fjernet.
   */
  content: AgentContentBlock[];
  stop_reason: Anthropic.Beta.BetaStopReason | null;
  stop_details: Anthropic.Beta.BetaRefusalStopDetails | null;
  /** Modellen som faktisk svarte (en annen enn den som ble bedt om etter fallback). */
  model: string;
  usage: Usage;
  /** USD, eller null hvis prisen ikke er kjent. */
  costUsd: number | null;
}

export interface AgentToolUseEvent {
  id: string;
  name: string;
  input: unknown;
}

export interface AgentEventMap {
  text: { delta: string };
  tool_use: AgentToolUseEvent;
  restart: Record<string, never>;
  message: AgentReply;
  error: AgentErrorBody;
}

export type AgentServerEvent = { [K in keyof AgentEventMap]: { event: K; data: AgentEventMap[K] } }[keyof AgentEventMap];
