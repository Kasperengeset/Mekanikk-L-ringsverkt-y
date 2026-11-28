/** Bilder i nettleseren: skalerer ned til Claudes grenser og koder på nytt ved behov (se planImage). */
import type { ImageMediaType } from "../api/protocol.js";
import { planImage, SENDABLE_TYPES, stripDataUrl, type EncodeFormat } from "./logic.js";

export interface PreparedImage {
  mediaType: ImageMediaType;
  /** Base64 uten data:-prefiks. */
  data: string;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(stripDataUrl(String(reader.result)));
    reader.onerror = () => reject(reader.error ?? new Error("Kunne ikke lese bildet."));
    reader.readAsDataURL(blob);
  });
}

type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Et lerret med 2D-kontekst og koding til fil. Vanlig canvas der det finnes, ellers OffscreenCanvas. */
export function makeCanvas(width: number, height: number): { context: Canvas2D; encode(format: EncodeFormat): Promise<Blob> } {
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Nettleseren kan ikke tegne bilder (canvas).");
    return {
      context,
      encode: (f) =>
        new Promise((resolve, reject) =>
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Kunne ikke kode bildet."))), f.type, f.quality),
        ),
    };
  }
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Nettleseren kan ikke tegne bilder (OffscreenCanvas).");
  return { context, encode: (f) => canvas.convertToBlob({ type: f.type, ...(f.quality !== undefined ? { quality: f.quality } : {}) }) };
}

/** Gjør klar ett bilde for sending, innenfor `budget` byte så langt det går. */
export async function prepareImage(blob: Blob, mediaType: string, budget: number): Promise<PreparedImage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new Error("Bildet kunne ikke leses. Prøv PNG eller JPEG.");
  }
  try {
    const plan = planImage({ width: bitmap.width, height: bitmap.height }, blob.size, mediaType, budget);
    if (plan.action === "keep") return { mediaType: mediaType as ImageMediaType, data: await blobToBase64(blob) };

    const { context, encode } = makeCanvas(plan.width, plan.height);
    // Hvit bakgrunn: gjennomsiktige figurer blir ellers svarte i JPEG.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, plan.width, plan.height);
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, plan.width, plan.height);
    let out: Blob | undefined;
    for (const format of plan.formats) {
      out = await encode(format);
      if (out.size <= budget) break;
    }
    const type = (SENDABLE_TYPES as readonly string[]).includes(out!.type) ? (out!.type as ImageMediaType) : "image/png";
    return { mediaType: type, data: await blobToBase64(out!) };
  } finally {
    bitmap.close();
  }
}
