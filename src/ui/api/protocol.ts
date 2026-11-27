/**
 * Kontrakten for /api/interpret, delt av serveren (api/interpret.ts) og nettleseren (src/ui/api/interpret.ts).
 *
 * Forespørsel: POST med JSON `{ images: [{ mediaType, data }], text? }` (data er base64 uten data:-prefiks).
 * Ugyldige forespørsler gir 4xx med JSON `{ error: { code, message } }` før strømmen starter.
 *
 * Svar: Server-Sent Events (text/event-stream). Hver hendelse er `event: <navn>` + én `data:`-linje med JSON:
 *   progress     { stage, message }       fremdrift, meldingen er klar til visning
 *   text         { delta }                Claudes beskrivelse, fortløpende
 *   description  { text }                 erstatter beskrivelsen så langt (etter at et kall ble sendt på nytt)
 *   partial      { model }                delvis modell mens verktøyargumentene strømmer (ufullstendig, ikke validert);
 *                                        null når et nytt forsøk starter
 *   result       InterpretResponse        sluttresultatet; strømmen lukkes etterpå
 *   error        { code, message }        feil; strømmen lukkes etterpå
 * Linjer som begynner med kolon er hjerteslag (holder forbindelsen åpen mens Claude tenker).
 */
import { z } from "zod";
import type { Disagreement } from "../../core/consistency.js";
import type { Model } from "../../core/schema.js";
import type { Issue } from "../../core/validate.js";

export const MAX_IMAGES = 4;
/** Samlet størrelse på bildene (dekodet). */
export const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
/** Claude godtar bilder på inntil 5 MB. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_TEXT_LENGTH = 20_000;
export const IMAGE_MEDIA_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number];

/** Antall byte base64-strengen dekodes til. */
export function base64DecodedSize(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - padding;
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

const formatMb = (bytes: number) => `${(bytes / 1024 / 1024).toLocaleString("nb-NO", { maximumFractionDigits: 1 })} MB`;

export const InterpretRequest = z
  .object({
    images: z
      .array(
        z.object({
          mediaType: z.enum(IMAGE_MEDIA_TYPES, { error: "Bildet må være PNG, JPEG, WebP eller GIF." }),
          data: z
            .string({ error: "Bildet mangler data." })
            .min(1, { error: "Bildet er tomt." })
            .regex(BASE64, { error: "Bildedataene er ikke gyldig base64." })
            .refine((d) => base64DecodedSize(d) <= MAX_IMAGE_BYTES, { error: `Et bilde er større enn ${formatMb(MAX_IMAGE_BYTES)}.` }),
        }),
        { error: "images må være en liste med bilder." },
      )
      .max(MAX_IMAGES, { error: `Høyst ${MAX_IMAGES} bilder per tolkning.` })
      .default([]),
    text: z.string().max(MAX_TEXT_LENGTH, { error: `Teksten er lengre enn ${MAX_TEXT_LENGTH} tegn.` }).optional(),
  })
  .refine((r) => r.images.length > 0 || Boolean(r.text?.trim()), { error: "Last opp et bilde eller skriv inn oppgaveteksten." });

export type InterpretRequest = z.infer<typeof InterpretRequest>;

/** Feilkoder: access, bad_request og too_large før strømmen, resten i error-hendelsen (eller som 5xx). */
export type ErrorCode =
  | "bad_request"
  | "access"
  | "too_large"
  | "config"
  | "auth"
  | "rate_limit"
  | "overloaded"
  | "connection"
  | "refusal"
  | "max_tokens"
  | "invalid_model"
  | "api"
  | "internal";

export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
}

export type ProgressStage = "start" | "describing" | "modelling" | "retry" | "resend" | "consistency";

export interface Progress {
  stage: ProgressStage;
  message: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface InterpretResponse {
  model: Model;
  questions: string[];
  description: string;
  warnings: Issue[];
  usage: Usage;
  /** USD, eller null hvis prisen ikke er kjent. */
  costUsd: number | null;
  consistency?: { runs: number; succeeded: number; disagreements: Disagreement[] };
}

export interface ServerEventMap {
  progress: Progress;
  text: { delta: string };
  description: { text: string };
  partial: { model: unknown };
  result: InterpretResponse;
  error: ApiErrorBody;
}

export type ServerEvent = { [K in keyof ServerEventMap]: { event: K; data: ServerEventMap[K] } }[keyof ServerEventMap];

export const SSE_CONTENT_TYPE = "text/event-stream";

/** Tilgangskoden sendes i denne headeren når serveren har ACCESS_CODES (se server/access.ts). */
export const ACCESS_HEADER = "x-access-code";
/** Lovlige tegn i en tilgangskode, så den kan stå i en lenke og i en header uten koding. */
export const ACCESS_CODE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Grensen for hele forespørselen (base64 er 4/3 av bildene, pluss tekst og JSON). */
export const MAX_REQUEST_BYTES = Math.ceil((MAX_TOTAL_BYTES * 4) / 3) + MAX_TEXT_LENGTH * 4 + 64 * 1024;

/** Kontroll av samlet størrelse, etter at hvert bilde er godkjent. */
export function totalImageBytes(request: Pick<InterpretRequest, "images">): number {
  return request.images.reduce((s, img) => s + base64DecodedSize(img.data), 0);
}

export function tooLargeMessage(): string {
  return `Bildene er til sammen større enn ${formatMb(MAX_TOTAL_BYTES)}. Velg færre sider eller mindre bilder.`;
}
