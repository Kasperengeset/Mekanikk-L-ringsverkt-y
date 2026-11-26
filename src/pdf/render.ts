/**
 * Gjør om PDF-sider til PNG-bilder som sendes til tolkningen. Samme kode brukes i nettleseren
 * (uke 3) og i eval-skriptet, så testsettet prøves med de samme bildene som studentene sender.
 * Bare canvas-implementasjonen og pdf.js-bygget avhenger av miljøet; de sendes inn.
 */
import type { getDocument as GetDocument } from "pdfjs-dist";

/** Grensene for bilder til Claude (Opus 4.7 og nyere): større bilder skaleres ned av API-et. */
export const CLAUDE_MAX_LONG_EDGE = 2576;
export const CLAUDE_MAX_PIXELS = 3_750_000;

export interface PdfImageOptions {
  /** Sidene som skal rendres, 1-basert. Standard: alle. */
  pages?: number[];
  maxLongEdge?: number;
  maxPixels?: number;
  /** Høyeste oppløsning i dpi, så små sider ikke blåses opp unødig. */
  maxDpi?: number;
}

export interface RasterCanvas {
  /** 2D-konteksten pdf.js tegner i. */
  context: unknown;
  toPng(): Promise<Uint8Array>;
}

export type CanvasFactory = (width: number, height: number) => RasterCanvas;

export interface RenderedPage {
  /** Sidenummer, 1-basert. */
  page: number;
  width: number;
  height: number;
  png: Uint8Array;
}

/** Skalaen (piksler per PDF-punkt) som gir størst mulig bilde innenfor grensene. */
export function pageScale(widthPt: number, heightPt: number, options: PdfImageOptions = {}): number {
  const maxLongEdge = options.maxLongEdge ?? CLAUDE_MAX_LONG_EDGE;
  const maxPixels = options.maxPixels ?? CLAUDE_MAX_PIXELS;
  const maxDpi = options.maxDpi ?? 300;
  return Math.min(maxLongEdge / Math.max(widthPt, heightPt), Math.sqrt(maxPixels / (widthPt * heightPt)), maxDpi / 72);
}

export async function renderPdfPages(
  getDocument: typeof GetDocument,
  data: Uint8Array,
  createCanvas: CanvasFactory,
  options: PdfImageOptions = {},
): Promise<RenderedPage[]> {
  // pdf.js tar over bufferen og godtar ikke Node-Buffer, så dataene kopieres til en ny Uint8Array.
  const task = getDocument({ data: new Uint8Array(data) });
  const doc = await task.promise;
  try {
    const pages = options.pages ?? Array.from({ length: doc.numPages }, (_, i) => i + 1);
    const out: RenderedPage[] = [];
    for (const n of pages) {
      if (!Number.isInteger(n) || n < 1 || n > doc.numPages) throw new Error(`Siden ${n} finnes ikke (PDF-en har ${doc.numPages} sider).`);
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: pageScale(base.width, base.height, options) });
      const width = Math.floor(viewport.width);
      const height = Math.floor(viewport.height);
      const canvas = createCanvas(width, height);
      const ctx = canvas.context as CanvasRenderingContext2D;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      await page.render({ canvas: null, canvasContext: ctx, viewport }).promise;
      out.push({ page: n, width, height, png: await canvas.toPng() });
      page.cleanup();
    }
    return out;
  } finally {
    await task.destroy();
  }
}
