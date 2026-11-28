/**
 * Sjekker at funksjonene i api/ kan lastes slik Vercel kjører dem: hver TypeScript-fil oversettes for seg
 * (ingen bundling), og resultatet lastes som ESM i ren Node. Fanger relative importer uten .js og
 * JSON-importer uten `with { type: "json" }`, som ellers først feiler etter en deploy.
 *
 * Kjøres med ren `node` (ikke tsx, som ville skjult nettopp disse feilene). ANTHROPIC_API_KEY og
 * Supabase-variablene fjernes, så tolkningen og veilederen stopper ved konfigurasjonssjekken, MCP-serveren
 * kjører åpen (som lokalt), og ingenting går mot nettverket.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const work = mkdtempSync(join(tmpdir(), "check-api-"));
const out = join(work, "out");
for (const key of Object.keys(process.env)) if (key.includes("SUPABASE")) delete process.env[key];
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ACCESS_CODES;

/** Tolkningen og veilederen: en gyldig forespørsel stopper ved konfigurasjonssjekken (ingen nøkkel), før Claude. */
const stopsAtConfig = (name, body) => ({
  request: () => new Request(`http://localhost/api/${name}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  method: "POST",
  ok: (res, json) => res.status === 500 && json?.error?.code === "config",
  describe: (json) => `svarer (${json.error.message})`,
});

/** Én forespørsel per funksjon og hva svaret skal være. */
const checks = {
  agent: stopsAtConfig("agent", { messages: [{ role: "user", content: "Hei" }] }),
  interpret: stopsAtConfig("interpret", { text: "Fritt opplagt bjelke, L = 4 m, jevnt fordelt last q = 5 kN/m." }),
  mcp: {
    request: () =>
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "check-api", version: "1" } } }),
      }),
    method: "POST",
    ok: (res, json) => res.status === 200 && json?.result?.serverInfo?.name === "mekanikk-intuisjon",
    describe: (json) => `initialize svarer (${json.result.serverInfo.name} ${json.result.serverInfo.version})`,
  },
  "oauth-protected-resource": {
    request: () => new Request("http://localhost/.well-known/oauth-protected-resource/mcp"),
    method: "GET",
    // Uten Supabase finnes det ingen autorisasjonsserver å peke på.
    ok: (res) => res.status === 404,
    describe: () => "svarer (404 uten Supabase, som forventet)",
  },
};

let failed = false;
try {
  writeFileSync(
    join(work, "tsconfig.json"),
    JSON.stringify({
      extends: join(root, "tsconfig.json"),
      include: [join(root, "api")],
      compilerOptions: { noEmit: false, noCheck: true, outDir: out, rootDir: root, types: [] },
    }),
  );
  const tsc = spawnSync(process.execPath, [join(root, "node_modules/typescript/bin/tsc"), "-p", join(work, "tsconfig.json")], { encoding: "utf8" });
  if (tsc.status !== 0) throw new Error(`tsc feilet:\n${tsc.stdout}${tsc.stderr}`);
  writeFileSync(join(out, "package.json"), JSON.stringify({ type: "module" }));
  symlinkSync(join(root, "node_modules"), join(out, "node_modules"), "dir");

  const names = readdirSync(join(root, "api"))
    .filter((f) => f.endsWith(".ts"))
    .map((f) => f.slice(0, -3));
  for (const name of names) {
    try {
      const mod = await import(pathToFileURL(join(out, "api", `${name}.js`)).href);
      const check = checks[name];
      if (!check) throw new Error("mangler sjekk i scripts/check-api.mjs");
      if (typeof mod[check.method] !== "function") throw new Error(`eksporterer ikke ${check.method}`);
      const res = await mod[check.method](check.request());
      const json = await res.json().catch(() => undefined);
      if (!check.ok(res, json)) throw new Error(`uventet svar ${res.status}: ${JSON.stringify(json)}`);
      console.log(`api/${name}: laster og ${check.describe(json)}`);
    } catch (err) {
      failed = true;
      console.error(`api/${name}: ${err instanceof Error ? err.message : err}`);
    }
  }
} catch (err) {
  failed = true;
  console.error(err instanceof Error ? err.message : err);
} finally {
  rmSync(work, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
