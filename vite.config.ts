import { readdirSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { dirname, extname, join } from "node:path";
import { loadEnv, type Plugin, type ViteDevServer } from "vite";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/** Hvor nettleseren finner pdf.js sine dekodere og fonter (se PDF_ASSETS i src/ui/upload/pdf.ts). */
const PDFJS_PUBLIC = "pdfjs";
const PDFJS_DIRS = ["wasm", "standard_fonts"];
const CONTENT_TYPES: Record<string, string> = {
  ".wasm": "application/wasm",
  ".js": "text/javascript",
  ".ttf": "font/ttf",
  ".pfb": "application/octet-stream",
};

/**
 * Serverer pdfjs-dist/wasm og pdfjs-dist/standard_fonts under /pdfjs/ i `pnpm dev`, og kopierer dem til
 * dist/pdfjs/ ved bygging. Uten dem forsvinner JBIG2-figurer i skannede PDF-er uten feilmelding.
 */
function pdfjsAssets(): Plugin {
  const root = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
  const files = PDFJS_DIRS.flatMap((dir) => readdirSync(join(root, dir)).map((name) => `${dir}/${name}`));
  const allowed = new Set(files);
  return {
    name: "pdfjs-assets",
    configureServer(server) {
      server.middlewares.use(`${server.config.base}${PDFJS_PUBLIC}`, (req, res, next) => {
        const path = decodeURIComponent((req.url ?? "").split("?")[0]!.replace(/^\//, ""));
        if (!allowed.has(path)) return next();
        res.setHeader("content-type", CONTENT_TYPES[extname(path)] ?? "text/plain; charset=utf-8");
        res.end(readFileSync(join(root, path)));
      });
    },
    generateBundle() {
      for (const f of files) this.emitFile({ type: "asset", fileName: `${PDFJS_PUBLIC}/${f}`, source: readFileSync(join(root, f)) });
    },
  };
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/** Node-forespørsel → Web Request → handleren i api/<navn>.ts → strømmet svar tilbake. */
async function serveApi(server: ViteDevServer, module: "/api/interpret.ts" | "/api/agent.ts", req: IncomingMessage, res: ServerResponse): Promise<void> {
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) abort.abort();
  });
  try {
    // Lastes for hver forespørsel, så endringer i api/ og server/ virker uten omstart.
    const { POST } = (await server.ssrLoadModule(module)) as typeof import("./api/interpret.js") | typeof import("./api/agent.js");
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === "string") headers.set(key, value);
      else if (Array.isArray(value)) for (const v of value) headers.append(key, v);
    }
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const request = new Request(new URL((req as { originalUrl?: string }).originalUrl ?? req.url ?? "/", "http://localhost"), {
      method: req.method,
      headers,
      signal: abort.signal,
      ...(hasBody ? { body: new Uint8Array(await readBody(req)) } : {}),
    });
    const response = await POST(request);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.flushHeaders();
    if (!response.body) return void res.end();
    const reader = response.body.getReader();
    abort.signal.addEventListener("abort", () => void reader.cancel().catch(() => {}), { once: true });
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  } catch (err) {
    server.config.logger.error(`${module}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: { code: "internal", message: "Noe gikk galt på utviklingsserveren." } }));
    } else res.end();
  }
}

/** Monterer /api/interpret og /api/agent i `pnpm dev`, så de virker lokalt uten Vercel CLI. Leser .env med loadEnv. */
function devApi(): Plugin {
  return {
    name: "dev-api",
    apply: "serve",
    configureServer(server) {
      if (process.env.VITEST) return;
      // En verdi som allerede er satt i skallet, går foran .env (som i eval-skriptet).
      const env = loadEnv(server.config.mode, server.config.envDir, ["ANTHROPIC_", "INTERPRET_", "AGENT_", "ACCESS_", "SUPABASE_", "VITE_SUPABASE_", "QUOTA_"]);
      for (const [key, value] of Object.entries(env)) if (value && !process.env[key]) process.env[key] = value;
      server.middlewares.use("/api/interpret", (req, res) => void serveApi(server, "/api/interpret.ts", req, res));
      server.middlewares.use("/api/agent", (req, res) => void serveApi(server, "/api/agent.ts", req, res));
    },
  };
}

export default defineConfig({
  plugins: [react(), pdfjsAssets(), devApi()],
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
