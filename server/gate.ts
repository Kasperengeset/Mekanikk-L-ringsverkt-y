/**
 * Hvem som får bruke API-et (og dermed API-nøkkelen), og hvor mye.
 *
 * Rekkefølge i admit (før forespørselen leses):
 *  1. Gyldig tilgangskode (ACCESS_CODES, se access.ts): slipper gjennom uten kvote (testbrukere).
 *  2. Supabase satt opp (VITE_SUPABASE_URL + VITE_SUPABASE_PUBLISHABLE_KEY): innlogget bruker kreves.
 *     Tokenet i Authorization: Bearer sjekkes mot Supabase Auth.
 *  3. Ellers: tilgangskoder kreves hvis de finnes, ellers er API-et åpent (lokal utvikling).
 *
 * consume (etter at forespørselen er gyldig, rett før Claude-kallet) trekker én enhet av brukerens
 * ukekvote i Postgres (funksjonen consume_quota i supabase/migrations). Feiler kvotesjekken, stoppes
 * forespørselen: det er bedre at en student må prøve igjen enn at kostnaden løper løpsk.
 */
import { ACCESS_HEADER } from "../src/ui/api/protocol.js";
import { ACCESS_INVALID, ACCESS_MISSING, checkAccess, parseAccessCodes } from "./access.js";

export type DenialCode = "access" | "login" | "quota" | "config" | "unavailable";

export interface Denial {
  status: number;
  code: DenialCode;
  message: string;
}

export interface GateUser {
  id: string;
  email?: string;
}

/** Det som telles: tolkninger, spørsmål fra studenten til veilederen, og alle kall til veilederen (også verktøyrunder). */
export type QuotaKind = "interpret" | "agent" | "agent_call";

export interface Gate {
  admit(req: Request): Promise<{ user?: GateUser } | { denial: Denial }>;
  consume(user: GateUser | undefined, kind: QuotaKind): Promise<Denial | undefined>;
}

export type GateEnv = Record<string, string | undefined>;

export const LOGIN_REQUIRED = "Logg inn for å tolke egne oppgaver og bruke veilederen. Eksemplene kan du prøve uten bruker.";
export const LOGIN_EXPIRED = "Innloggingen har gått ut. Logg inn på nytt.";
export const UNAVAILABLE = "Fikk ikke sjekket innloggingen akkurat nå. Prøv igjen om litt.";

/** Standardkvoter per uke (mandag–søndag, norsk tid). */
export const DEFAULT_QUOTA: Record<QuotaKind, number> = { interpret: 10, agent: 60, agent_call: 400 };

export function quotaFromEnv(env: GateEnv): Record<QuotaKind, number> {
  const num = (v: string | undefined, fallback: number) => {
    const n = Number(v);
    return v !== undefined && v.trim() !== "" && Number.isInteger(n) && n >= 0 ? n : fallback;
  };
  const agent = num(env.QUOTA_AGENT_PER_WEEK, DEFAULT_QUOTA.agent);
  return { interpret: num(env.QUOTA_INTERPRET_PER_WEEK, DEFAULT_QUOTA.interpret), agent, agent_call: Math.max(agent * 7, 20) };
}

function quotaMessage(kind: QuotaKind, limit: number): string {
  if (kind === "interpret") return `Du har brukt alle ${limit} tolkningene denne uken. Kvoten fylles opp igjen mandag.`;
  return `Du har brukt ukens kvote for veilederen (${limit} spørsmål). Kvoten fylles opp igjen mandag.`;
}

export interface SupabaseConfig {
  url: string;
  publishableKey: string;
  secretKey?: string;
}

export function supabaseFromEnv(env: GateEnv): SupabaseConfig | undefined {
  const url = (env.SUPABASE_URL ?? env.VITE_SUPABASE_URL)?.trim().replace(/\/+$/, "");
  const publishableKey = (env.SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_ANON_KEY)?.trim();
  if (!url || !publishableKey) return undefined;
  const secretKey = (env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY)?.trim() || undefined;
  return { url, publishableKey, ...(secretKey ? { secretKey } : {}) };
}

/** Nøkkelhodene til Supabase. De nye nøklene (sb_…) er ikke JWT og skal bare stå i apikey. */
function keyHeaders(key: string): Record<string, string> {
  return key.startsWith("eyJ") ? { apikey: key, authorization: `Bearer ${key}` } : { apikey: key };
}

const bearer = (req: Request) => req.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];

export function createGate(env: GateEnv, fetchImpl: typeof fetch = fetch): Gate {
  const codes = parseAccessCodes(env.ACCESS_CODES);
  const supabase = supabaseFromEnv(env);
  const quota = quotaFromEnv(env);

  return {
    async admit(req) {
      if (codes.length > 0 && req.headers.get(ACCESS_HEADER)?.trim()) {
        const denied = checkAccess(req, env.ACCESS_CODES);
        return denied ? { denial: { status: 401, code: "access", message: denied } } : {};
      }
      if (!supabase) {
        if (codes.length === 0) return {};
        return { denial: { status: 401, code: "access", message: ACCESS_MISSING } };
      }
      const token = bearer(req);
      if (!token) return { denial: { status: 401, code: "login", message: LOGIN_REQUIRED } };
      let res: Response;
      try {
        res = await fetchImpl(`${supabase.url}/auth/v1/user`, { headers: { apikey: supabase.publishableKey, authorization: `Bearer ${token}` } });
      } catch {
        return { denial: { status: 503, code: "unavailable", message: UNAVAILABLE } };
      }
      if (res.status === 401 || res.status === 403) return { denial: { status: 401, code: "login", message: LOGIN_EXPIRED } };
      if (!res.ok) return { denial: { status: 503, code: "unavailable", message: UNAVAILABLE } };
      const user = (await res.json().catch(() => undefined)) as { id?: unknown; email?: unknown } | undefined;
      if (typeof user?.id !== "string") return { denial: { status: 401, code: "login", message: LOGIN_EXPIRED } };
      return { user: { id: user.id, ...(typeof user.email === "string" ? { email: user.email } : {}) } };
    },

    async consume(user, kind) {
      if (!user || !supabase) return undefined;
      if (!supabase.secretKey) return { status: 500, code: "config", message: "Kvoten er ikke satt opp på serveren (SUPABASE_SECRET_KEY mangler)." };
      const limit = quota[kind];
      let res: Response;
      try {
        res = await fetchImpl(`${supabase.url}/rest/v1/rpc/consume_quota`, {
          method: "POST",
          headers: { ...keyHeaders(supabase.secretKey), "content-type": "application/json" },
          body: JSON.stringify({ p_user: user.id, p_kind: kind, p_limit: limit }),
        });
      } catch {
        return { status: 503, code: "unavailable", message: UNAVAILABLE };
      }
      if (!res.ok) return { status: 503, code: "unavailable", message: UNAVAILABLE };
      const rows = (await res.json().catch(() => undefined)) as { allowed?: boolean }[] | { allowed?: boolean } | undefined;
      const row = Array.isArray(rows) ? rows[0] : rows;
      if (row?.allowed === true) return undefined;
      if (row?.allowed === false) return { status: 429, code: "quota", message: quotaMessage(kind, kind === "agent_call" ? quota.agent : limit) };
      return { status: 503, code: "unavailable", message: UNAVAILABLE };
    },
  };
}

export { ACCESS_INVALID, ACCESS_MISSING };
