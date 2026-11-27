/**
 * PDF i nettleseren med pdf.js (lastes først når studenten velger en PDF). Samme rendring som i
 * eval-skriptet (src/pdf/render.ts), så testsettet prøves med de samme bildene studentene sender.
 */
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import { renderPdfPages, type CanvasFactory, type PdfAssets } from "../../pdf/render.js";
import { makeCanvas } from "./images.js";

GlobalWorkerOptions.workerSrc = workerUrl;

/** Serveres av pdfjsAssets i vite.config.ts. Uten wasmUrl forsvinner JBIG2-figurer i skannede PDF-er. */
const base = new URL(import.meta.env.BASE_URL, window.location.href);
export const PDF_ASSETS: PdfAssets = {
  wasmUrl: new URL("pdfjs/wasm/", base).href,
  standardFontDataUrl: new URL("pdfjs/standard_fonts/", base).href,
};

/** Miniatyrene er så små at de bare skal kjennes igjen. */
const THUMBNAIL_EDGE = 200;

const browserCanvas: CanvasFactory = (width, height) => {
  const c = makeCanvas(width, height);
  return { context: c.context, toPng: async () => new Uint8Array(await (await c.encode({ type: "image/png" })).arrayBuffer()) };
};

export async function pdfPageCount(data: Uint8Array): Promise<number> {
  const task = getDocument({ data: new Uint8Array(data), ...PDF_ASSETS });
  try {
    return (await task.promise).numPages;
  } finally {
    await task.destroy();
  }
}

/** Miniatyrer som objekt-URL-er (frigis med URL.revokeObjectURL når PDF-en fjernes). */
export async function renderThumbnails(data: Uint8Array, pages: number[]): Promise<string[]> {
  const rendered = await renderPdfPages(getDocument, data, browserCanvas, PDF_ASSETS, {
    pages,
    maxLongEdge: THUMBNAIL_EDGE,
    maxPixels: Number.MAX_SAFE_INTEGER,
  });
  return rendered.map((p) => URL.createObjectURL(new Blob([p.png as BlobPart], { type: "image/png" })));
}

/** Sidene i full oppløsning innenfor Claudes grenser, som PNG. */
export async function renderPages(data: Uint8Array, pages: number[]): Promise<Blob[]> {
  const rendered = await renderPdfPages(getDocument, data, browserCanvas, PDF_ASSETS, { pages });
  return rendered.map((p) => new Blob([p.png as BlobPart], { type: "image/png" }));
}
