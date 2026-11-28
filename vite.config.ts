import type { IncomingMessage, ServerResponse } from "node:http";
import { loadEnv, type Plugin, type ViteDevServer } from "vite";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/** Node-forespørsel → Web Request → funksjonen i api/<navn>.ts (eksporten for metoden) → svaret tilbake. */
async function serveApi(server: ViteDevServer, module: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    // Lastes for hver forespørsel, så endringer i api/ og server/ virker uten omstart.
    const mod = (await server.ssrLoadModule(module)) as Record<string, ((req: Request) => Response | Promise<Response>) | undefined>;
    const fn = mod[req.method ?? "GET"];
    if (!fn) {
      res.statusCode = 405;
      return void res.end();
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === "string") headers.set(key, value);
      else if (Array.isArray(value)) for (const v of value) headers.append(key, v);
    }
    const hasBody = req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS";
    const request = new Request(new URL((req as { originalUrl?: string }).originalUrl ?? req.url ?? "/", `http://${req.headers.host ?? "localhost"}`), {
      method: req.method,
      headers,
      ...(hasBody ? { body: new Uint8Array(await readBody(req)) } : {}),
    });
    const response = await fn(request);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    server.config.logger.error(`${module}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: { code: "internal", message: "Noe gikk galt på utviklingsserveren." } }));
    } else res.end();
  }
}

/** Monterer /mcp og OAuth-metadataene i `pnpm dev`, som rewrites i vercel.json gjør i produksjon. Leser .env med loadEnv. */
function devApi(): Plugin {
  return {
    name: "dev-api",
    apply: "serve",
    configureServer(server) {
      if (process.env.VITEST) return;
      // En verdi som allerede er satt i skallet, går foran .env.
      const env = loadEnv(server.config.mode, server.config.envDir, ["SUPABASE_", "VITE_SUPABASE_", "QUOTA_", "PUBLIC_URL"]);
      for (const [key, value] of Object.entries(env)) if (value && !process.env[key]) process.env[key] = value;
      const mount = (path: string, module: string) => server.middlewares.use(path, (req, res) => void serveApi(server, module, req, res));
      mount("/.well-known/oauth-protected-resource", "/api/oauth-protected-resource.ts");
      mount("/api/oauth-protected-resource", "/api/oauth-protected-resource.ts");
      mount("/api/mcp", "/api/mcp.ts");
      server.middlewares.use((req, res, next) => (req.url?.split("?")[0] === "/mcp" ? void serveApi(server, "/api/mcp.ts", req, res) : next()));
    },
  };
}

export default defineConfig({
  plugins: [react(), devApi()],
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
