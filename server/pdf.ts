/** PDF til bilder i Node (eval-skriptet og testene), med samme rendring som i nettleseren. */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { renderPdfPages, type PdfAssets, type PdfImageOptions, type RenderedPage } from "../src/pdf/render";

const pdfjsRoot = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
const ASSETS: PdfAssets = {
  wasmUrl: join(pdfjsRoot, "wasm") + "/",
  standardFontDataUrl: join(pdfjsRoot, "standard_fonts") + "/",
};

export function renderPdfInNode(data: Uint8Array, options: PdfImageOptions = {}): Promise<RenderedPage[]> {
  return renderPdfPages(
    getDocument,
    data,
    (width, height) => {
      const canvas = createCanvas(width, height);
      return { context: canvas.getContext("2d"), toPng: async () => new Uint8Array(await canvas.encode("png")) };
    },
    ASSETS,
    options,
  );
}
