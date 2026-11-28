/** Supabase-oppsettet fra miljøet (samme variabler som nettleseren bruker, pluss den hemmelige nøkkelen). */
export type Env = Record<string, string | undefined>;

export interface SupabaseConfig {
  url: string;
  publishableKey: string;
  secretKey?: string;
}

export function supabaseFromEnv(env: Env): SupabaseConfig | undefined {
  const url = (env.SUPABASE_URL ?? env.VITE_SUPABASE_URL)?.trim().replace(/\/+$/, "");
  const publishableKey = (env.SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_ANON_KEY)?.trim();
  if (!url || !publishableKey) return undefined;
  const secretKey = (env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY)?.trim() || undefined;
  return { url, publishableKey, ...(secretKey ? { secretKey } : {}) };
}

/** Nøkkelhodene til Supabase. De nye nøklene (sb_…) er ikke JWT og skal bare stå i apikey. */
export function keyHeaders(key: string): Record<string, string> {
  return key.startsWith("eyJ") ? { apikey: key, authorization: `Bearer ${key}` } : { apikey: key };
}
