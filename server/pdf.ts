/** PDF til bilder i Node (eval-skriptet og testene), med samme rendring som i nettleseren. */
import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { renderPdfPages, type PdfImageOptions, type RenderedPage } from "../src/pdf/render";

export function renderPdfInNode(data: Uint8Array, options: PdfImageOptions = {}): Promise<RenderedPage[]> {
  return renderPdfPages(
    getDocument,
    data,
    (width, height) => {
      const canvas = createCanvas(width, height);
      return { context: canvas.getContext("2d"), toPng: async () => new Uint8Array(await canvas.encode("png")) };
    },
    options,
  );
}
