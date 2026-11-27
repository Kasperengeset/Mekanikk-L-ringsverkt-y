/**
 * Sjekker at funksjonene i api/ kan lastes slik Vercel kjører dem: hver TypeScript-fil oversettes for seg
 * (ingen bundling), og resultatet lastes som ESM i ren Node. Fanger relative importer uten .js og
 * JSON-importer uten `with { type: "json" }`, som ellers først feiler etter en deploy.
 *
 * Kjøres med ren `node` (ikke tsx, som ville skjult nettopp disse feilene). ANTHROPIC_API_KEY fjernes,
 * så kallet til hver funksjon stopper ved konfigurasjonssjekken og aldri når Claude.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const work = mkdtempSync(join(tmpdir(), "check-api-"));
const out = join(work, "out");
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ACCESS_CODES;

/** En gyldig forespørsel til hver funksjon, så sjekken kommer forbi valideringen og til konfigurasjonen. */
const requests = {
  agent: { messages: [{ role: "user", content: "Hei" }] },
  interpret: { text: "Fritt opplagt bjelke, L = 4 m, jevnt fordelt last q = 5 kN/m." },
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
      if (typeof mod.POST !== "function") throw new Error("eksporterer ikke POST");
      const body = requests[name];
      if (!body) throw new Error("mangler testforespørsel i scripts/check-api.mjs");
      const res = await mod.POST(
        new Request(`http://localhost/api/${name}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      );
      const json = await res.json().catch(() => undefined);
      if (res.status !== 500 || json?.error?.code !== "config") throw new Error(`uventet svar ${res.status}: ${JSON.stringify(json)}`);
      console.log(`api/${name}: laster og svarer (${json.error.message})`);
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
