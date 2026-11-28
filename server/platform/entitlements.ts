/**
 * Hvor mye en bruker får bruke verktøyene: aktivt abonnement gir fri bruk, ellers en ukekvote med
 * oppgaver. Selve tellingen skjer atomisk i Postgres (consume_task i supabase/migrations/0002).
 *
 * Feiler kontakten med Supabase, nektes kallet: bedre at studenten prøver igjen enn at kvoten omgås.
 */
import { keyHeaders, supabaseFromEnv, type Env } from "./supabase.js";

export interface TaskAllowance {
  allowed: boolean;
  subscribed: boolean;
  used: number;
  limit: number;
}

export interface Entitlements {
  /** `taskKey` identifiserer oppgaven (hash), så gjentatte kall for samme oppgave telles én gang. */
  consumeTask(userId: string, taskKey: string): Promise<TaskAllowance | { error: string }>;
}

export const DEFAULT_TASKS_PER_WEEK = 5;
export const UNAVAILABLE = "Fikk ikke sjekket abonnementet akkurat nå. Prøv igjen om litt.";

export function tasksPerWeek(env: Env): number {
  const n = Number(env.QUOTA_TASKS_PER_WEEK);
  return env.QUOTA_TASKS_PER_WEEK?.trim() && Number.isInteger(n) && n >= 0 ? n : DEFAULT_TASKS_PER_WEEK;
}

export function createEntitlements(env: Env, fetchImpl: typeof fetch = fetch): Entitlements | undefined {
  const supabase = supabaseFromEnv(env);
  if (!supabase) return undefined;
  const limit = tasksPerWeek(env);
  return {
    async consumeTask(userId, taskKey) {
      if (!supabase.secretKey) return { error: "Kvoten er ikke satt opp på serveren (SUPABASE_SECRET_KEY mangler)." };
      let res: Response;
      try {
        res = await fetchImpl(`${supabase.url}/rest/v1/rpc/consume_task`, {
          method: "POST",
          headers: { ...keyHeaders(supabase.secretKey), "content-type": "application/json" },
          body: JSON.stringify({ p_user: userId, p_task: taskKey, p_limit: limit }),
        });
      } catch {
        return { error: UNAVAILABLE };
      }
      if (!res.ok) return { error: UNAVAILABLE };
      const rows = (await res.json().catch(() => undefined)) as unknown;
      const row = (Array.isArray(rows) ? rows[0] : rows) as Partial<{ allowed: boolean; subscribed: boolean; used: number; task_limit: number }> | undefined;
      if (typeof row?.allowed !== "boolean") return { error: UNAVAILABLE };
      return { allowed: row.allowed, subscribed: row.subscribed === true, used: row.used ?? 0, limit: row.task_limit ?? limit };
    },
  };
}
