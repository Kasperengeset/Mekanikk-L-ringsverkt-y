/**
 * Det generiske MCP-laget: fagmoduler registrerer verktøy, og handleren kjører dem over Streamable HTTP
 * (tilstandsløst: én server og én transport per forespørsel, JSON-svar, GET/DELETE gir 405).
 *
 * Handleren tar seg av CORS, innlogging (OAuth-token → bruker) og kvote. Fagmodulene vet ingenting om
 * HTTP eller Supabase; de får en ToolContext med brukeren og en funksjon for å telle oppgaven.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import type { Entitlements } from "./entitlements.js";
import { bearerToken, publicOrigin, resourceMetadataUrl, type AuthUser, type TokenVerifier } from "./oauth.js";

export interface ToolContext {
  user?: AuthUser;
  /** Offentlig adresse til appen, f.eks. for lenken «Åpne i moment.no». */
  origin: string;
  /**
   * Teller oppgaven mot ukekvoten (én gang per oppgave). Gir en melding når kallet ikke er tillatt,
   * som verktøyet returnerer i stedet for resultatet.
   */
  consumeTask(taskKey: string): Promise<string | undefined>;
}

export interface ToolDefinition<S extends z.ZodObject = z.ZodObject> {
  name: string;
  title: string;
  description: string;
  inputSchema: S;
  run(input: z.infer<S>, ctx: ToolContext): Promise<CallToolResult> | CallToolResult;
}

/** En fagmodul (mekanikk er den første). */
export interface SubjectModule {
  id: string;
  title: string;
  /** Tekst til Claude om hvordan verktøyene i modulen skal brukes. */
  instructions: string;
  tools: ToolDefinition[];
}

export const SERVER_INFO = { name: "mekanikk-intuisjon", version: "0.2.0" };

export function buildServer(modules: SubjectModule[], ctx: ToolContext): McpServer {
  const server = new McpServer(SERVER_INFO, { instructions: modules.map((m) => m.instructions).join("\n\n") });
  for (const m of modules) {
    for (const tool of m.tools) {
      server.registerTool(
        tool.name,
        { title: tool.title, description: tool.description, inputSchema: tool.inputSchema, annotations: { readOnlyHint: true, openWorldHint: false } },
        async (input: unknown) => tool.run(input as never, ctx),
      );
    }
  }
  return server;
}

export interface McpHandlerDeps {
  modules: SubjectModule[];
  /** Uten verifier (lokal utvikling uten Supabase) er serveren åpen og uten kvote. */
  verifyToken?: TokenVerifier;
  entitlements?: Entitlements;
  env?: Record<string, string | undefined>;
  log?(message: string, err?: unknown): void;
}

const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, DELETE, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, accept, mcp-protocol-version, mcp-session-id, last-event-id",
  "access-control-expose-headers": "www-authenticate, mcp-session-id, mcp-protocol-version",
};

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

function jsonRpcError(status: number, message: string, headers: Record<string, string> = {}): Response {
  return withCors(Response.json({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }, { status, headers }));
}

export function quotaMessage(used: number, limit: number, origin: string): string {
  return `Du har brukt ukens ${limit} gratis oppgaver (${used} av ${limit}). Kvoten fylles opp igjen mandag. Med abonnement er det ingen grense: ${origin}/konto`;
}

export function createMcpHandler(deps: McpHandlerDeps): (req: Request) => Promise<Response> {
  const log = deps.log ?? ((message, err) => console.error(message, err));
  return async (req) => {
    if (req.method === "OPTIONS") return withCors(new Response(null, { status: 204 }));
    if (req.method !== "POST") return jsonRpcError(405, "Bare POST støttes (tilstandsløs server).", { allow: "POST, OPTIONS" });

    const origin = publicOrigin(req, deps.env);
    let user: AuthUser | undefined;
    if (deps.verifyToken) {
      const metadata = resourceMetadataUrl(origin);
      const token = bearerToken(req);
      if (!token) return jsonRpcError(401, "Logg inn for å bruke Mekanikk-intuisjon.", { "www-authenticate": `Bearer resource_metadata="${metadata}"` });
      try {
        user = await deps.verifyToken(token);
      } catch {
        return jsonRpcError(401, "Innloggingen er ugyldig eller utløpt.", {
          "www-authenticate": `Bearer error="invalid_token", error_description="Innloggingen er ugyldig eller utløpt.", resource_metadata="${metadata}"`,
        });
      }
    }

    const ctx: ToolContext = {
      ...(user ? { user } : {}),
      origin,
      consumeTask: async (taskKey) => {
        if (!user || !deps.entitlements) return undefined;
        const r = await deps.entitlements.consumeTask(user.id, taskKey);
        if ("error" in r) return r.error;
        return r.allowed ? undefined : quotaMessage(r.used, r.limit, origin);
      },
    };

    const server = buildServer(deps.modules, ctx);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    try {
      await server.connect(transport);
      const res = await transport.handleRequest(req);
      return withCors(res);
    } catch (err) {
      log("mcp: uventet feil", err);
      return jsonRpcError(500, "Noe gikk galt på serveren.");
    } finally {
      void server.close().catch(() => {});
    }
  };
}
