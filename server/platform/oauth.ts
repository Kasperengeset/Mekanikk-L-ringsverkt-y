/**
 * MCP-serveren er en OAuth 2.1-ressursserver. Supabase Auth (OAuth 2.1 Server) er autorisasjonsserveren:
 * Claude registrerer seg dynamisk der, studenten logger inn og godkjenner på /oauth/samtykke, og Claude
 * får et access token (JWT signert med prosjektets asymmetriske nøkkel). Her valideres tokenet lokalt
 * mot JWKS, og `sub` er brukeren.
 *
 * Oppdagelse (RFC 9728): uten gyldig token svarer /mcp 401 med `WWW-Authenticate: Bearer resource_metadata=…`,
 * og /.well-known/oauth-protected-resource peker på Supabase som autorisasjonsserver.
 */
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export interface AuthUser {
  id: string;
  email?: string;
  clientId?: string;
}

export type TokenVerifier = (token: string) => Promise<AuthUser>;

export function issuerOf(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/auth/v1`;
}

/** Validerer Supabase-tokens: signatur (JWKS), utsteder, publikum («authenticated») og utløp. */
export function createTokenVerifier(supabaseUrl: string, keys?: JWTVerifyGetKey): TokenVerifier {
  const issuer = issuerOf(supabaseUrl);
  const jwks = keys ?? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  return async (token) => {
    const { payload } = await jwtVerify(token, jwks, { issuer, audience: "authenticated", algorithms: ["ES256", "RS256"] });
    if (typeof payload.sub !== "string" || !payload.sub) throw new Error("Tokenet mangler bruker.");
    const email = typeof payload.email === "string" ? payload.email : undefined;
    const clientId = typeof payload.client_id === "string" ? payload.client_id : undefined;
    return { id: payload.sub, ...(email ? { email } : {}), ...(clientId ? { clientId } : {}) };
  };
}

export function protectedResourceMetadata(resource: string, supabaseUrl: string) {
  return {
    resource,
    authorization_servers: [issuerOf(supabaseUrl)],
    bearer_methods_supported: ["header"],
    scopes_supported: ["email"],
    resource_name: "Mekanikk-intuisjon",
  };
}

export const bearerToken = (req: Request) => req.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];

/** Offentlig adresse (bak Vercel kommer verten i x-forwarded-host). */
export function publicOrigin(req: Request, env: Record<string, string | undefined> = {}): string {
  const fixed = env.PUBLIC_URL?.trim().replace(/\/+$/, "");
  if (fixed) return fixed;
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export const resourceMetadataUrl = (origin: string) => `${origin}/.well-known/oauth-protected-resource/mcp`;
