/**
 * Innlogging med Supabase Auth: lenke på e-post (uten passord) eller Google. Første innlogging oppretter
 * brukeren. Er VITE_SUPABASE_URL og VITE_SUPABASE_PUBLISHABLE_KEY ikke satt, er innloggingen av
 * (status "disabled"), og appen virker som før (lokal utvikling, tilgangskoder).
 *
 * Tokenet sendes til API-et i Authorization (authHeaders), der server/gate.ts sjekker det og trekker kvote.
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

/** Authorization-hodet for API-kall, når studenten er logget inn. */
export async function authHeaders(): Promise<Record<string, string>> {
  const sb = supabase();
  if (!sb) return {};
  const { data } = await sb.auth.getSession();
  return data.session ? { authorization: `Bearer ${data.session.access_token}` } : {};
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

/** Serveren sier at innloggingen mangler eller er utgått. */
export function requireLogin(message: string): void {
  useAuth.setState({ notice: message, ...(useAuth.getState().status === "signedIn" ? {} : { status: authEnabled ? "signedOut" : "disabled" }) });
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}
