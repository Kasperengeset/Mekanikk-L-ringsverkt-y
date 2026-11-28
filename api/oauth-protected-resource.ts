/**
 * /.well-known/oauth-protected-resource(/mcp) – RFC 9728: forteller MCP-klienter (Claude) at /mcp er
 * beskyttet, og at Supabase Auth er autorisasjonsserveren. Se server/platform/oauth.ts.
 */
import { protectedResourceMetadata, publicOrigin } from "../server/platform/oauth.js";
import { supabaseFromEnv } from "../server/platform/supabase.js";

export function GET(req: Request): Response {
  const supabase = supabaseFromEnv(process.env);
  const headers = { "access-control-allow-origin": "*", "cache-control": "public, max-age=300" };
  if (!supabase) return Response.json({ error: "Innlogging er ikke satt opp." }, { status: 404, headers });
  return Response.json(protectedResourceMetadata(`${publicOrigin(req, process.env)}/mcp`, supabase.url), { headers });
}

export const OPTIONS = () =>
  new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, OPTIONS", "access-control-allow-headers": "mcp-protocol-version" } });
