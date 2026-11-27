/**
 * Rendrer en SVG-komponent med en eksempelmodell til PNG, uten nettleser.
 * Komponenten får CanvasProps ({ model, result, viewport }) og må ha <svg> som rot.
 *
 *   pnpm snapshot --component src/ui/structure/StructureSvg.tsx#StructureSvg --fixture gerber
 *   pnpm snapshot --component src/ui/diagrams/DiagramsView.tsx#DiagramsView --fixture ramme --width 900 --height 400
 *
 * PNG-en skrives til --out (standard: eval/results/snapshots/<komponent>-<eksempel>.png) og kan åpnes
 * med Read-verktøyet for å se resultatet.
 */
import { Resvg } from "@resvg/resvg-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { solve } from "../src/core/solver/index.js";
import { FIXTURES } from "../src/ui/fixtures.js";
import { fitViewport } from "../src/ui/geometry.js";
import type { CanvasProps } from "../src/ui/types.js";

const { values } = parseArgs({
  options: {
    component: { type: "string" },
    fixture: { type: "string", default: "gerber" },
    width: { type: "string", default: "900" },
    height: { type: "string", default: "450" },
    out: { type: "string" },
    dark: { type: "boolean", default: false },
  },
});

const [file, exportName = "default"] = (values.component ?? "").split("#");
if (!file) {
  console.error("Bruk: pnpm snapshot --component <fil>#<eksport> [--fixture navn] [--width px] [--height px] [--out fil.png]");
  console.error(`Eksempler: ${Object.keys(FIXTURES).join(", ")}`);
  process.exit(1);
}
const fixture = FIXTURES[values.fixture!];
if (!fixture) throw new Error(`Ukjent eksempel '${values.fixture}'. Finnes: ${Object.keys(FIXTURES).join(", ")}`);

const mod = await import(pathToFileURL(resolve(file)).href);
const Component = mod[exportName] as ComponentType<CanvasProps>;
if (!Component) throw new Error(`Fant ikke eksporten '${exportName}' i ${file}`);

const width = Number(values.width);
const height = Number(values.height);
const viewport = fitViewport(fixture.model, width, height);
const result = solve(fixture.model);
let svg = renderToStaticMarkup(createElement(Component, { model: fixture.model, result, viewport }));
if (!svg.startsWith("<svg")) throw new Error("Komponenten må ha <svg> som rot.");
// currentColor og CSS-variabler finnes ikke utenfor nettleseren: sett forgrunnsfargen eksplisitt.
const fg = values.dark ? "#e6e9ef" : "#1d2330";
svg = svg.replace("<svg", `<svg color="${fg}"`);
const png = new Resvg(svg, {
  background: values.dark ? "#0f131a" : "#ffffff",
  font: { loadSystemFonts: true, defaultFontFamily: "Helvetica" },
}).render().asPng();
const out = values.out ?? `eval/results/snapshots/${exportName}-${values.fixture}.png`;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png);
console.log(`Lagret ${out} (${width} × ${height})`);
