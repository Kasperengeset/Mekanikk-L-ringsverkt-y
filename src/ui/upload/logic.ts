/** Ren logikk for opplastingen (testes uten nettleser): nedskalering, koding, sidevalg og tekst. */
import { CLAUDE_MAX_LONG_EDGE, CLAUDE_MAX_PIXELS } from "../../pdf/render.js";
import { MAX_IMAGES, type ImageMediaType } from "../api/protocol.js";

export interface Size {
  width: number;
  height: number;
}

/** Største størrelse innenfor Claudes grenser (langside og antall piksler). Skalerer aldri opp. */
export function fitWithinLimits(size: Size, maxLongEdge = CLAUDE_MAX_LONG_EDGE, maxPixels = CLAUDE_MAX_PIXELS): Size & { scale: number } {
  const { width, height } = size;
  const scale = Math.min(1, maxLongEdge / Math.max(width, height), Math.sqrt(maxPixels / (width * height)));
  if (scale >= 1) return { width, height, scale: 1 };
  // Avrund nedover, så begge grensene holder også etter avrundingen.
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)), scale };
}

/**
 * Bytebudsjettet per bilde. Hele forespørselen holdes under ca. 4 MB (base64), så den går gjennom
 * grensen på 4,5 MB for serverløse funksjoner på Vercel.
 */
export function imageByteBudget(imageCount: number): number {
  const totalRaw = 3 * 1024 * 1024;
  return Math.floor(totalRaw / Math.max(1, imageCount));
}

/** Filtyper Claude godtar direkte. */
export const SENDABLE_TYPES: readonly ImageMediaType[] = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export type ImagePlan = { action: "keep" } | { action: "encode"; width: number; height: number; formats: EncodeFormat[] };

export interface EncodeFormat {
  type: "image/png" | "image/jpeg";
  quality?: number;
}

/** Kodingene som prøves etter tur til bildet er innenfor budsjettet; den siste brukes uansett. */
const JPEG_STEPS: EncodeFormat[] = [
  { type: "image/jpeg", quality: 0.9 },
  { type: "image/jpeg", quality: 0.8 },
  { type: "image/jpeg", quality: 0.7 },
];

/**
 * Hva som skal gjøres med et bilde før det sendes: beholdes som det er hvis Claude godtar filtypen
 * og både størrelsen og antall byte er innenfor grensene, ellers skaleres og kodes det på nytt.
 * PNG prøves først for tegninger (skarpe streker), JPEG for foto og når PNG blir for stort.
 */
export function planImage(size: Size, bytes: number, mediaType: string, budget: number): ImagePlan {
  const fit = fitWithinLimits(size);
  const sendable = (SENDABLE_TYPES as readonly string[]).includes(mediaType);
  if (sendable && fit.scale === 1 && bytes <= budget) return { action: "keep" };
  const formats: EncodeFormat[] = mediaType === "image/jpeg" ? JPEG_STEPS : [{ type: "image/png" }, ...JPEG_STEPS];
  return { action: "encode", width: fit.width, height: fit.height, formats };
}

/** Klikk på en side i en PDF: velg eller fjern den. Over grensen endres ingenting. Sortert. */
export function togglePage(selected: readonly number[], page: number, maxSelectable: number): number[] {
  if (selected.includes(page)) return selected.filter((p) => p !== page);
  if (selected.length >= maxSelectable) return [...selected];
  return [...selected, page].sort((a, b) => a - b);
}

/** Standardvalget for en ny PDF: første side. */
export function defaultPages(numPages: number): number[] {
  return numPages > 0 ? [1] : [];
}

/** Antall sider som kan velges i én PDF når resten av vedleggene allerede gir `otherImages` bilder. */
export function maxPagesFor(otherImages: number): number {
  return Math.max(0, MAX_IMAGES - otherImages);
}

/**
 * Teksten som sendes: oppgaveteksten (hvis studenten har limt inn en) og «Hvilken oppgave?».
 * Bare den ene gir den alene; begge gir oppgaveteksten først og ønsket på en egen linje.
 */
export function composeText(problemText: string, which: string): string | undefined {
  const p = problemText.trim();
  const w = which.trim();
  if (p && w) return `${p}\n\nHvilken oppgave: ${w}`;
  return p || w || undefined;
}

/** Filtype ut fra MIME-type eller filnavn (utklippstavla og noen systemer gir tom type). */
export function classifyFile(file: { name: string; type: string }): "image" | "pdf" | "text" | "unsupported" {
  const name = file.name.toLowerCase();
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type) || /\.(png|jpe?g|webp|gif)$/.test(name)) return "image";
  if (file.type.startsWith("text/") || /\.(txt|md)$/.test(name)) return "text";
  return "unsupported";
}

/** Kort oppsummering av en delvis modell mens den strømmer, f.eks. «3 noder · 2 elementer · 1 last». */
export function summarizePartial(partial: unknown): string | null {
  if (!partial || typeof partial !== "object") return null;
  const p = partial as Record<string, unknown>;
  const count = (key: string) => (Array.isArray(p[key]) ? (p[key] as unknown[]).length : 0);
  const parts = (
    [
      ["nodes", "node", "noder"],
      ["members", "element", "elementer"],
      ["supports", "opplager", "opplagere"],
      ["loads", "last", "laster"],
    ] as const
  ).flatMap(([key, one, many]) => {
    const n = count(key);
    return n ? [`${n} ${n === 1 ? one : many}`] : [];
  });
  return parts.length ? parts.join(" · ") : null;
}

/** Base64 uten data:-prefiks fra en data-URL. */
export function stripDataUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma < 0 ? dataUrl : dataUrl.slice(comma + 1);
}
