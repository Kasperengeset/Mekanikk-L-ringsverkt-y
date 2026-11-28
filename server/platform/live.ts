/**
 * Direktekoblingen: hvert resultat fra MCP-verktøyene lagres som brukerens siste visning
 * (put_live_view i supabase/migrations/0003), og webappen (/app) følger raden i sanntid.
 * Feil her stopper aldri verktøysvaret; visningen er et tillegg.
 */
import { keyHeaders, supabaseFromEnv, type Env } from "./supabase.js";

export interface LiveSync {
  publish(userId: string, payload: Record<string, unknown>): Promise<void>;
}

export function createLiveSync(env: Env, fetchImpl: typeof fetch = fetch, log: (msg: string) => void = console.warn): LiveSync | undefined {
  const supabase = supabaseFromEnv(env);
  if (!supabase?.secretKey) return undefined;
  const secret = supabase.secretKey;
  return {
    async publish(userId, payload) {
      try {
        const res = await fetchImpl(`${supabase.url}/rest/v1/rpc/put_live_view`, {
          method: "POST",
          headers: { ...keyHeaders(secret), "content-type": "application/json" },
          body: JSON.stringify({ p_user: userId, p_payload: payload }),
        });
        if (!res.ok) log(`live: kunne ikke lagre visningen (${res.status})`);
      } catch {
        log("live: kunne ikke lagre visningen (nettverk)");
      }
    },
  };
}
