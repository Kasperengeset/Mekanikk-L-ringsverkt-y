/**
 * Innlogging med Supabase Auth: lenke på e-post (uten passord) eller Google. Første innlogging oppretter
 * brukeren. Er VITE_SUPABASE_URL og VITE_SUPABASE_PUBLISHABLE_KEY ikke satt, er innloggingen av
 * (status "disabled"), og appen virker som før (lokal utvikling, tilgangskoder).
 *
 * Innloggingen brukes også når Claude kobler til MCP-serveren (OAuth): studenten godkjenner på /oauth/samtykke.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { create } from "zustand";

export type AuthStatus = "disabled" | "loading" | "signedOut" | "signedIn";

export interface AuthUser {
  id: string;
  email?: string;
}

interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  /** Melding til studenten når serveren ber om ny innlogging (f.eks. utgått økt). */
  notice: string | null;
}

const env = import.meta.env as Record<string, string | undefined>;
const url = env.VITE_SUPABASE_URL?.trim();
const key = (env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_ANON_KEY)?.trim();

let client: SupabaseClient | null = null;
function supabase(): SupabaseClient | null {
  if (!url || !key) return null;
  // Implisitt flyt: lenken i e-posten virker også når den åpnes i en annen nettleser enn den som ba om den.
  client ??= createClient(url, key, { auth: { flowType: "implicit", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  return client;
}

export const authEnabled = Boolean(url && key);

export const useAuth = create<AuthState>()(() => ({ status: authEnabled ? "loading" : "disabled", user: null, notice: null }));

let started = false;

/** Leser økten (også fra innloggingslenken i adressen) og følger endringer. Kalles én gang ved oppstart. */
export function startAuth(): void {
  const sb = supabase();
  if (!sb || started) return;
  started = true;
  const apply = (session: { user: { id: string; email?: string } } | null) =>
    useAuth.setState(session ? { status: "signedIn", user: { id: session.user.id, ...(session.user.email ? { email: session.user.email } : {}) }, notice: null } : { status: "signedOut", user: null });
  void sb.auth.getSession().then(({ data }) => apply(data.session));
  sb.auth.onAuthStateChange((_event, session) => apply(session));
}

// ---------------------------------------------------------------- OAuth-samtykke (Claude som connector)

export type ConsentDetails =
  | { kind: "consent"; clientName: string; scopes: string[]; email?: string }
  | { kind: "redirect"; url: string }
  | { kind: "error"; message: string };

/** Hva Claude (eller en annen klient) ber om. Har studenten godkjent før, gir Supabase en adresse rett tilbake. */
export async function oauthConsentDetails(authorizationId: string): Promise<ConsentDetails> {
  const sb = supabase();
  if (!sb) return { kind: "error", message: "Innlogging er ikke satt opp i denne versjonen." };
  const { data, error } = await sb.auth.oauth.getAuthorizationDetails(authorizationId);
  if (error || !data) return { kind: "error", message: "Fant ikke forespørselen. Start tilkoblingen på nytt fra Claude." };
  if ("redirect_url" in data && !("authorization_id" in data)) return { kind: "redirect", url: data.redirect_url };
  const details = data as { client?: { name?: string; client_name?: string }; scope?: string; user?: { email?: string } };
  return {
    kind: "consent",
    clientName: details.client?.name ?? details.client?.client_name ?? "En app",
    scopes: (details.scope ?? "").split(/\s+/).filter(Boolean),
    ...(details.user?.email ? { email: details.user.email } : {}),
  };
}

/** Godkjenner eller avslår, og gir adressen klienten skal få studenten tilbake til. */
export async function oauthDecide(authorizationId: string, approve: boolean): Promise<{ url: string } | { error: string }> {
  const sb = supabase();
  if (!sb) return { error: "Innlogging er ikke satt opp i denne versjonen." };
  const call = approve ? sb.auth.oauth.approveAuthorization : sb.auth.oauth.denyAuthorization;
  const { data, error } = await call.call(sb.auth.oauth, authorizationId, { skipBrowserRedirect: true });
  if (error || !data?.redirect_url) return { error: "Fikk ikke fullført tilkoblingen. Prøv igjen fra Claude." };
  return { url: data.redirect_url };
}

// ---------------------------------------------------------------- konto

export interface AccountStatus {
  subscribed: boolean;
  periodEnd?: string;
  tasksThisWeek: number;
}

/** Abonnement og ukens bruk for innlogget student (radene leses med RLS: bare egne). */
export async function accountStatus(): Promise<AccountStatus | undefined> {
  const sb = supabase();
  if (!sb) return undefined;
  const now = new Date();
  // Mandag denne uken (ISO-dato); serveren bruker norsk tid, en dags avvik rundt midnatt spiller ingen rolle her.
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const week = monday.toISOString().slice(0, 10);
  const [sub, usage] = await Promise.all([
    sb.from("subscriptions").select("status,current_period_end").maybeSingle(),
    sb.from("task_usage").select("task_key", { count: "exact", head: true }).eq("week", week),
  ]);
  const row = sub.data as { status?: string; current_period_end?: string | null } | null;
  const active = row?.status === "active" || row?.status === "trialing";
  const stillValid = !row?.current_period_end || new Date(row.current_period_end) > now;
  return { subscribed: Boolean(active && stillValid), ...(row?.current_period_end ? { periodEnd: row.current_period_end } : {}), tasksThisWeek: usage.count ?? 0 };
}

/** Hvor studenten havner etter innlogging. */
export function afterLoginUrl(next = "/app"): string {
  return `${window.location.origin}${next.startsWith("/") ? next : "/app"}`;
}

export async function signInWithEmail(email: string, next?: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const sb = supabase();
  if (!sb) return { ok: false, message: "Innlogging er ikke satt opp i denne versjonen." };
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: afterLoginUrl(next), shouldCreateUser: true } });
  if (!error) return { ok: true };
  if (error.status === 429) return { ok: false, message: "Du har bedt om mange lenker på kort tid. Vent litt og prøv igjen." };
  return { ok: false, message: "Fikk ikke sendt lenken. Sjekk e-postadressen og prøv igjen." };
}

export async function signInWithGoogle(next?: string): Promise<{ ok: false; message: string } | void> {
  const sb = supabase();
  if (!sb) return { ok: false, message: "Innlogging er ikke satt opp i denne versjonen." };
  const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: afterLoginUrl(next) } });
  if (error) return { ok: false, message: "Fikk ikke startet innloggingen med Google. Prøv igjen, eller bruk e-post." };
}

export async function signOut(): Promise<void> {
  await supabase()?.auth.signOut();
  useAuth.setState({ status: authEnabled ? "signedOut" : "disabled", user: null });
}


export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}
