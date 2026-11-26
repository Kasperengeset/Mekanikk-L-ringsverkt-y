/**
 * Viser hvilke bilder tolkningen får fra en PDF: rendrer sidene og lagrer dem som PNG.
 *
 *   pnpm pdf:render testset/bjelke-01/oppgave.pdf
 *   pnpm pdf:render oppgave.pdf --pages 2,3 --out /tmp/sider
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { renderPdfInNode } from "../server/pdf";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { pages: { type: "string" }, out: { type: "string" } },
});
const file = positionals[0];
if (!file) {
  console.error("Bruk: pnpm pdf:render <fil.pdf> [--pages 1,2] [--out mappe]");
  process.exit(1);
}
const out = values.out ?? "eval/results/pdf";
mkdirSync(out, { recursive: true });
const started = performance.now();
const pages = await renderPdfInNode(readFileSync(file), values.pages ? { pages: values.pages.split(",").map(Number) } : {});
for (const p of pages) {
  const target = join(out, `${basename(file, ".pdf")}-side-${p.page}.png`);
  writeFileSync(target, p.png);
  console.log(`side ${p.page}: ${p.width} × ${p.height} px (${((p.width * p.height) / 1e6).toFixed(2)} MP) → ${target}`);
}
console.log(`${pages.length} side(r) på ${(performance.now() - started).toFixed(0)} ms`);
