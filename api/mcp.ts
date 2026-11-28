/**
 * /mcp – MCP-serveren (Streamable HTTP, tilstandsløs). Studentene legger den til i Claude som connector:
 * https://<domene>/mcp. Uten Supabase-variablene (lokal utvikling) er den åpen og uten kvote.
 *
 * Miljø: VITE_SUPABASE_URL og VITE_SUPABASE_PUBLISHABLE_KEY (innlogging), SUPABASE_SECRET_KEY (kvote),
 * QUOTA_TASKS_PER_WEEK (gratis oppgaver per uke), PUBLIC_URL (valgfri fast adresse).
 */
import { mechanics } from "../server/modules/mechanics/tools.js";
import { createEntitlements } from "../server/platform/entitlements.js";
import { createMcpHandler } from "../server/platform/mcp.js";
import { createTokenVerifier } from "../server/platform/oauth.js";
import { supabaseFromEnv } from "../server/platform/supabase.js";

const supabase = supabaseFromEnv(process.env);
const entitlements = createEntitlements(process.env);

const handle = createMcpHandler({
  modules: [mechanics],
  env: process.env,
  ...(supabase ? { verifyToken: createTokenVerifier(supabase.url) } : {}),
  ...(entitlements ? { entitlements } : {}),
});

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
export const OPTIONS = handle;
