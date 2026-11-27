/**
 * Opplastingen: vedlegg, tekstfeltene og en pågående tolkning. Egen liten store (ikke appens), så
 * «Last opp på nytt» i bekreftelsessteget viser de samme filene og tekstene igjen.
 *
 * Tolkningsstatus, beskrivelse og spørsmål skrives til appens store (setInterpretation), og
 * resultatet lastes med loadModel(model, "confirm").
 */
import { create } from "zustand";
import { interpretRemote } from "../api/interpret.js";
import { MAX_IMAGES, type InterpretResponse, type Progress } from "../api/protocol.js";
import { useStore } from "../state/store.js";
import { prepareImage, type PreparedImage } from "./images.js";
import { classifyFile, composeText, defaultPages, imageByteBudget, maxPagesFor, togglePage } from "./logic.js";

/** Flere miniatyrer enn dette vises ikke (eksamenssett er sjelden lengre). */
export const MAX_THUMBNAILS = 40;

export type Attachment =
  | { id: string; kind: "image"; name: string; blob: Blob; mediaType: string; url: string }
  | {
      id: string;
      kind: "pdf";
      name: string;
      data: Uint8Array;
      status: "loading" | "ready" | "error";
      numPages: number;
      thumbnails: string[];
      selected: number[];
      error?: string;
    };

export type ResultMeta = Pick<InterpretResponse, "warnings" | "usage" | "costUsd" | "consistency">;

interface UploadSession {
  attachments: Attachment[];
  problemText: string;
  which: string;
  /** Melding til studenten om noe som ikke gikk (f.eks. for mange bilder). */
  notice: string | null;
  progress: Progress | null;
  busy: boolean;
  /** Det som ikke har plass i appens store: advarsler, forbruk og self-consistency fra siste tolkning. */
  meta: ResultMeta | null;
}

let controller: AbortController | null = null;
let nextId = 1;

export const useUploadSession = create<UploadSession>()(() => ({
  attachments: [],
  problemText: "",
  which: "",
  notice: null,
  progress: null,
  busy: false,
  meta: null,
}));

const set = useUploadSession.setState;
const get = useUploadSession.getState;

/** Antall bilder som sendes: hvert bilde og hver valgte PDF-side. */
export function imageCount(attachments: Attachment[]): number {
  return attachments.reduce((n, a) => n + (a.kind === "image" ? 1 : a.selected.length), 0);
}

function updatePdf(id: string, patch: Partial<Extract<Attachment, { kind: "pdf" }>>) {
  set({ attachments: get().attachments.map((a) => (a.id === id && a.kind === "pdf" ? { ...a, ...patch } : a)) });
}

async function loadPdf(id: string, file: File) {
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    updatePdf(id, { data });
    const pdf = await import("./pdf.js");
    const numPages = await pdf.pdfPageCount(data);
    const others = imageCount(get().attachments.filter((a) => a.id !== id));
    updatePdf(id, { numPages, selected: defaultPages(numPages).slice(0, maxPagesFor(others)) });
    const pages = Array.from({ length: Math.min(numPages, MAX_THUMBNAILS) }, (_, i) => i + 1);
    const thumbnails = await pdf.renderThumbnails(data, pages);
    if (!get().attachments.some((a) => a.id === id)) {
      thumbnails.forEach((u) => URL.revokeObjectURL(u));
      return;
    }
    updatePdf(id, { status: "ready", thumbnails });
  } catch (err) {
    console.error(err);
    updatePdf(id, { status: "error", selected: [], error: "Kunne ikke lese PDF-en. Er filen skadet eller passordbeskyttet?" });
  }
}

export function addFiles(files: File[]): void {
  const notices: string[] = [];
  for (const file of files) {
    const kind = classifyFile(file);
    const id = `v${nextId++}`;
    if (kind === "image") {
      if (imageCount(get().attachments) >= MAX_IMAGES) {
        notices.push(`Høyst ${MAX_IMAGES} bilder per tolkning, så «${file.name}» ble ikke lagt til.`);
        continue;
      }
      const mediaType = file.type || (/\.png$/i.test(file.name) ? "image/png" : "image/jpeg");
      set({ attachments: [...get().attachments, { id, kind: "image", name: file.name || "Bilde", blob: file, mediaType, url: URL.createObjectURL(file) }] });
    } else if (kind === "pdf") {
      set({
        attachments: [
          ...get().attachments,
          { id, kind: "pdf", name: file.name, data: new Uint8Array(), status: "loading", numPages: 0, thumbnails: [], selected: [] },
        ],
      });
      void loadPdf(id, file);
    } else if (kind === "text") {
      void file.text().then((text) => appendText(text));
    } else {
      notices.push(`«${file.name}» kan ikke brukes. Last opp et bilde (PNG, JPEG, WebP), en PDF eller en tekstfil.`);
    }
  }
  set({ notice: notices.length ? notices.join(" ") : null });
}

/** Legger tekst (fra en tekstfil eller dratt inn) til oppgaveteksten. */
export function appendText(text: string): void {
  const t = text.trim();
  if (!t) return;
  const current = get().problemText.trim();
  set({ problemText: current ? `${current}\n\n${t}` : t });
}

export function removeAttachment(id: string): void {
  const a = get().attachments.find((x) => x.id === id);
  if (!a) return;
  if (a.kind === "image") URL.revokeObjectURL(a.url);
  else a.thumbnails.forEach((u) => URL.revokeObjectURL(u));
  set({ attachments: get().attachments.filter((x) => x.id !== id), notice: null });
}

export function togglePdfPage(id: string, page: number): void {
  const attachments = get().attachments;
  const a = attachments.find((x) => x.id === id);
  if (!a || a.kind !== "pdf") return;
  const max = maxPagesFor(imageCount(attachments.filter((x) => x.id !== id)));
  const selected = togglePage(a.selected, page, max);
  const refused = selected.length === a.selected.length && !a.selected.includes(page);
  updatePdf(id, { selected });
  set({ notice: refused ? `Høyst ${MAX_IMAGES} bilder per tolkning. Fjern en side eller et bilde først.` : null });
}

export function setProblemText(problemText: string): void {
  set({ problemText });
}

export function setWhich(which: string): void {
  set({ which });
}

async function prepareAll(attachments: Attachment[], signal: AbortSignal, onProgress: (p: Progress) => void): Promise<PreparedImage[]> {
  const budget = imageByteBudget(imageCount(attachments));
  const out: PreparedImage[] = [];
  for (const a of attachments) {
    if (signal.aborted) break;
    if (a.kind === "image") {
      onProgress({ stage: "start", message: "Gjør klar bildene …" });
      out.push(await prepareImage(a.blob, a.mediaType, budget));
    } else if (a.selected.length > 0) {
      const pdf = await import("./pdf.js");
      for (const page of a.selected) {
        if (signal.aborted) break;
        onProgress({ stage: "start", message: `Gjør om side ${page} i ${a.name} til et bilde …` });
        const [blob] = await pdf.renderPages(a.data, [page]);
        out.push(await prepareImage(blob!, "image/png", budget));
      }
    }
  }
  return out;
}

/** Sender oppgaven til tolkning. Fremdrift og beskrivelse vises fortløpende; resultatet går til bekreftelsessteget. */
export async function startInterpretation(): Promise<void> {
  const { attachments, problemText, which, busy } = get();
  if (busy) return;
  const text = composeText(problemText, which);
  if (attachments.some((a) => a.kind === "pdf" && a.status === "loading")) return void set({ notice: "Vent til PDF-en er lest inn." });
  if (imageCount(attachments) === 0 && !problemText.trim()) {
    return void set({
      notice: attachments.length
        ? "Velg minst én side i PDF-en, eller skriv inn oppgaveteksten."
        : "Last opp et bilde eller en PDF av oppgaven, eller lim inn oppgaveteksten.",
    });
  }

  controller?.abort();
  const own = new AbortController();
  controller = own;
  const signal = own.signal;
  // Etter Avbryt (eller en ny tolkning) skal en gammel kjøring ikke røre tilstanden.
  const current = () => controller === own && !signal.aborted;
  const app = () => useStore.getState();
  set({ busy: true, notice: null, meta: null, progress: { stage: "start", message: "Gjør klar oppgaven …" } });
  app().setInterpretation({ status: "uploading", description: "", questions: [], error: undefined, partial: undefined });

  try {
    const images = await prepareAll(attachments, signal, (progress) => current() && set({ progress }));
    if (!current()) return;
    set({ progress: { stage: "start", message: "Sender oppgaven til Claude …" } });
    app().setInterpretation({ status: "interpreting" });
    const result = await interpretRemote(
      { images, ...(text ? { text } : {}) },
      {
        onProgress: (progress) => current() && set({ progress }),
        onText: (delta) => current() && app().setInterpretation({ description: app().interpretation.description + delta }),
        onDescription: (description) => current() && app().setInterpretation({ description }),
        onPartial: (partial) => current() && app().setInterpretation({ partial }),
      },
      { signal },
    );
    if (!current()) return;
    app().setInterpretation({ status: "done", description: result.description, questions: result.questions, partial: undefined });
    set({ busy: false, progress: null, meta: { warnings: result.warnings, usage: result.usage, costUsd: result.costUsd, consistency: result.consistency } });
    app().loadModel(result.model, "confirm");
  } catch (err) {
    if (!current()) return;
    // InterpretApiError og feilene fra bilde- og PDF-behandlingen har meldinger som kan vises direkte.
    const message = err instanceof Error && err.message ? err.message : "Noe gikk galt under tolkningen.";
    set({ busy: false, progress: null });
    app().setInterpretation({ status: "error", error: message, partial: undefined });
  } finally {
    if (controller === own) controller = null;
  }
}

/** Avbryter med en gang: forespørselen stoppes, og opplastingen kan brukes igjen. */
export function cancelInterpretation(): void {
  if (!controller) return;
  controller.abort();
  controller = null;
  set({ busy: false, progress: null });
  useStore.getState().setInterpretation({ status: "idle", partial: undefined });
}

/** «Last opp på nytt»: tilbake til opplastingen med de samme vedleggene og tekstene. */
export function resetToUpload(): void {
  useStore.getState().reset();
  set({ meta: null, progress: null, notice: null });
}
