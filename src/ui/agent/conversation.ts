/**
 * Samtalen med veilederen (egen zustand-store, ikke den felles storen): historikken i Anthropic-format
 * som sendes til /api/agent, og linjene som vises i panelet. Løkken selv står i loop.ts.
 *
 * Samtalen nullstilles når en ny oppgave lastes inn (se isNewProblem nederst).
 */
import { create } from "zustand";
import { requireAccess } from "../api/access.js";
import { requireLogin } from "../auth/auth.js";
import { useStore } from "../state/store.js";
import { createAgentTransport, type AgentTransport } from "./client.js";
import { MAX_ROUNDS, runAgentLoop, type LoopOutcome } from "./loop.js";
import type { AgentContentBlock, AgentMessage, Usage } from "./protocol.js";

export type ChatEntry =
  | { id: number; kind: "student"; text: string }
  /** cut: svaret ble avbrutt av studenten eller kuttet fordi det ble for langt. */
  | { id: number; kind: "tutor"; text: string; streaming: boolean; cut?: "aborted" | "truncated" }
  | { id: number; kind: "action"; text: string; error: boolean }
  | { id: number; kind: "notice"; text: string; tone: "info" | "error" };

/** thinking: venter på svar. writing: teksten strømmer. acting: kjører verktøy (eller venter på en spådom). */
export type Activity = "thinking" | "writing" | "acting";

const ZERO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

export const NOTICES = {
  round_limit: "Veilederen stoppet etter mange steg. Skriv en ny melding for å fortsette.",
  refusal: "Veilederen kan ikke svare på dette. Prøv å spørre på en annen måte.",
  max_tokens: "Svaret ble for langt og ble kuttet. Prøv å spørre om noe mer avgrenset.",
  aborted: "Avbrutt.",
} as const;

interface AgentState {
  /** Samtalen i Anthropic-format, slik den sendes til /api/agent. Vokser bare i enden. */
  history: AgentMessage[];
  entries: ChatEntry[];
  /** null når veilederen ikke arbeider. */
  activity: Activity | null;
  /** Samlet forbruk i samtalen. */
  usage: Usage;
  costUsd: number;
  transport: AgentTransport;
  maxRounds: number;

  /** Sender en melding fra studenten og kjører løkken til veilederen er ferdig. Ignoreres mens veilederen arbeider. */
  send(text: string): Promise<LoopOutcome | undefined>;
  /** Kjører løkken på nytt når samtalen slutter med en melding som ikke fikk svar (f.eks. etter at tilgangskoden er skrevet inn). */
  retry(): Promise<LoopOutcome | undefined>;
  /** Stopper strømmen og eventuelle ventende spådommer. */
  abort(): void;
  /** Tømmer samtalen (avbryter det som pågår). */
  reset(): void;
  /** Ny samtale fra panelet: som reset, og fjerner uthevingene veilederen har laget. */
  newConversation(): void;
}

/**
 * Legger studentens tekst til samtalen. Slutter samtalen med en brukermelding som aldri fikk svar
 * (avbrudd, feil, taket på runder), legges teksten til i den, så rollene fortsatt veksler og
 * verktøyresultatene kommer først. Tidligere svar fra veilederen røres ikke.
 */
export function appendStudentText(history: AgentMessage[], text: string): AgentMessage[] {
  const block = { type: "text" as const, text };
  const last = history.at(-1);
  if (last?.role !== "user") return [...history, { role: "user", content: [block] }];
  const content = typeof last.content === "string" ? [{ type: "text" as const, text: last.content }] : last.content;
  return [...history.slice(0, -1), { role: "user", content: [...content, block] }];
}

/**
 * Teksten i et svar. Tekstblokker rett etter hverandre (eller rundt en fallback-blokk, der reservemodellen
 * fortsetter setningen) slås sammen; ellers blir de egne avsnitt.
 */
export function replyText(content: AgentContentBlock[]): string {
  let out = "";
  let gap = false;
  for (const b of content) {
    if (b.type === "text") {
      out += (out && gap ? "\n\n" : "") + b.text;
      gap = false;
    } else if (b.type !== "fallback" && b.type !== "thinking" && b.type !== "redacted_thinking") gap = true;
  }
  return out.trim();
}

let nextId = 1;
let controller: AbortController | null = null;
/** Øker ved reset, så en løkke fra en gammel samtale ikke skriver inn i den nye. */
let generation = 0;

export const useAgentStore = create<AgentState>()((set, get) => {
  /** Kjører løkken fra en samtale som slutter med en melding fra studenten. */
  async function run(history: AgentMessage[]): Promise<LoopOutcome> {
    const gen = generation;
    const live = () => gen === generation;
    const ctrl = new AbortController();
    controller = ctrl;
    set({ activity: "thinking" });

    /** Veilederens tekst i runden som pågår, eller null før første tekst. */
    let tutorId: number | null = null;
    const update = (fn: (s: AgentState) => Partial<AgentState>) => {
      if (live()) set(fn(get()));
    };
    const editTutor = (fn: (e: Extract<ChatEntry, { kind: "tutor" }>) => ChatEntry | null) =>
      update((s) => ({
        entries: s.entries.flatMap((e) => (e.id === tutorId && e.kind === "tutor" ? [fn(e)].filter((x): x is ChatEntry => x !== null) : [e])),
      }));

    const { outcome } = await runAgentLoop(history, {
      transport: get().transport,
      signal: ctrl.signal,
      maxRounds: get().maxRounds,
      events: {
        onRound: () => {
          tutorId = null;
          update(() => ({ activity: "thinking" }));
        },
        onText: (delta) => {
          if (tutorId === null) {
            tutorId = nextId++;
            const entry: ChatEntry = { id: tutorId, kind: "tutor", text: delta, streaming: true };
            update((s) => ({ entries: [...s.entries, entry], activity: "writing" }));
          } else editTutor((e) => ({ ...e, text: e.text + delta }));
        },
        onRestart: () => {
          editTutor(() => null);
          tutorId = null;
        },
        onReply: (reply) => {
          // Teksten i det ferdige svaret er fasit for visningen (deltaene var en forhåndsvisning).
          const final = replyText(reply.content);
          if (!final) editTutor(() => null);
          else if (tutorId === null) {
            tutorId = nextId++;
            const entry: ChatEntry = { id: tutorId, kind: "tutor", text: final, streaming: false };
            update((s) => ({ entries: [...s.entries, entry] }));
          } else editTutor((e) => ({ ...e, text: final, streaming: false }));
          update((s) => ({
            activity: reply.stop_reason === "tool_use" ? "acting" : s.activity,
            usage: {
              inputTokens: s.usage.inputTokens + reply.usage.inputTokens,
              outputTokens: s.usage.outputTokens + reply.usage.outputTokens,
              cacheReadTokens: s.usage.cacheReadTokens + reply.usage.cacheReadTokens,
              cacheWriteTokens: s.usage.cacheWriteTokens + reply.usage.cacheWriteTokens,
            },
            costUsd: s.costUsd + (reply.costUsd ?? 0),
          }));
        },
        onAction: (action) => update((s) => ({ entries: [...s.entries, { id: nextId++, kind: "action", ...action }] })),
        onMessages: (messages) => update(() => ({ history: messages })),
      },
    });

    if (!live()) return outcome;
    if (controller === ctrl) controller = null;
    // Svaret ved et avslag skal forkastes; ved kutt og avbrudd blir teksten stående, merket.
    if (outcome.status === "refusal") editTutor(() => null);
    else if (outcome.status === "max_tokens") editTutor((e) => ({ ...e, streaming: false, cut: "truncated" }));
    update((s) => ({
      activity: null,
      entries: [
        ...s.entries.map((e) => (e.kind === "tutor" && e.streaming ? { ...e, streaming: false, cut: "aborted" as const } : e)),
        ...(outcome.status === "done"
          ? []
          : [
              {
                id: nextId++,
                kind: "notice" as const,
                text: outcome.status === "error" ? outcome.message : NOTICES[outcome.status],
                tone: outcome.status === "aborted" || outcome.status === "round_limit" ? ("info" as const) : ("error" as const),
              },
            ]),
      ],
    }));
    if (outcome.status === "error" && outcome.code === "access") requireAccess(outcome.message, () => void get().retry());
    if (outcome.status === "error" && outcome.code === "login") requireLogin(outcome.message);
    return outcome;
  }

  return {
    history: [],
    entries: [],
    activity: null,
    usage: ZERO_USAGE,
    costUsd: 0,
    transport: createAgentTransport(),
    maxRounds: MAX_ROUNDS,

    async send(text) {
      const trimmed = text.trim();
      if (!trimmed || get().activity) return undefined;
      const history = appendStudentText(get().history, trimmed);
      set({ history, entries: [...get().entries, { id: nextId++, kind: "student", text: trimmed }] });
      return run(history);
    },

    async retry() {
      const history = get().history;
      if (get().activity || history.at(-1)?.role !== "user") return undefined;
      return run(history);
    },

    abort() {
      controller?.abort();
    },

    reset() {
      generation++;
      controller?.abort();
      controller = null;
      set({ history: [], entries: [], activity: null, usage: ZERO_USAGE, costUsd: 0 });
    },

    newConversation() {
      get().reset();
      const app = useStore.getState();
      app.setHighlights([]);
      app.setDiagramHighlight(null);
    },
  };
});

type AppState = ReturnType<typeof useStore.getState>;

/**
 * En ny oppgave er lastet inn (loadModel eller reset), ikke en endring av den samme: redigering, dra,
 * angre og gjør om gir alltid historikk (past/future) eller skjer under et drag (gestureStart).
 */
export function isNewProblem(next: AppState, prev: AppState): boolean {
  if (next.model === prev.model) return false;
  if (next.model === null) return true;
  return next.past.length === 0 && next.future.length === 0 && next.gestureStart === null && prev.gestureStart === null;
}

useStore.subscribe((next, prev) => {
  if (isNewProblem(next, prev)) useAgentStore.getState().reset();
});
