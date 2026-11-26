/**
 * Appens tilstand (zustand). Modellen er kilden til alt som vises; løsningen regnes ut fra den
 * (se useSolveResult). Alle endringer går gjennom src/core/edit.ts.
 *
 * Dra-operasjoner: beginGesture() ved pointerdown, updateGesture() for hvert bilde (ingen historikk),
 * endGesture() ved pointerup (ett steg i angre-historikken). Klikk og glidebrytere bruker edit().
 */
import { create } from "zustand";
import { setParams, type EditResult } from "../../core/edit";
import type { Model } from "../../core/schema";

export type EntityKind = "node" | "member" | "support" | "load" | "section";
/** Peker på en entitet. Opplager adresseres med node-id. */
export interface EntityRef {
  kind: EntityKind;
  id: string;
}

/** upload: ingen modell ennå. confirm: tolket modell venter på studentens bekreftelse. explore: utforsking. */
export type Phase = "upload" | "confirm" | "explore";

export interface DiagramSettings {
  N: boolean;
  V: boolean;
  M: boolean;
  deformed: boolean;
  /** Forstørrelse av forskyvningene; "auto" gir største utbøyning ≈ 10 % av konstruksjonen. */
  deformationScale: number | "auto";
}

export interface InterpretationState {
  status: "idle" | "uploading" | "interpreting" | "done" | "error";
  /** Claudes beskrivelse av figuren (bokmål). */
  description: string;
  questions: string[];
  error?: string;
  /** Strømmet, ufullstendig modell mens tolkningen pågår (for fortløpende tegning). */
  partial?: unknown;
}

export interface Change {
  path: string;
  value: unknown;
}

interface AppState {
  phase: Phase;
  model: Model | null;
  past: Model[];
  future: Model[];
  /** Modellen da en dra-operasjon startet, eller null. */
  gestureStart: Model | null;
  selection: EntityRef | null;
  /** Uthevinger fra agenten eller bekreftelsessteget. */
  highlights: EntityRef[];
  /** Tall for størrelsene i model.asked vises først når studenten har gjort et forsøk (uke 4). */
  revealed: boolean;
  diagrams: DiagramSettings;
  interpretation: InterpretationState;

  setPhase(phase: Phase): void;
  /** Ny modell uten historikk (f.eks. etter tolkning eller fra URL). */
  loadModel(model: Model, phase?: Phase): void;
  /** Endring med ett steg i angre-historikken. */
  edit(changes: Change | Change[]): EditResult;
  /** Bytter hele modellen med ett steg i historikken (f.eks. når et element deles). */
  replaceModel(model: Model): void;
  beginGesture(): void;
  /** Endring under dra, uten historikk. Avvises den, beholdes forrige gyldige modell. */
  updateGesture(changes: Change | Change[] | Model): EditResult;
  endGesture(): void;
  cancelGesture(): void;
  undo(): void;
  redo(): void;
  select(ref: EntityRef | null): void;
  setHighlights(refs: EntityRef[]): void;
  setRevealed(revealed: boolean): void;
  setDiagrams(partial: Partial<DiagramSettings>): void;
  setInterpretation(partial: Partial<InterpretationState>): void;
}

const HISTORY_LIMIT = 100;
const asArray = (c: Change | Change[]) => (Array.isArray(c) ? c : [c]);
const isModel = (x: unknown): x is Model => typeof x === "object" && x !== null && "schemaVersion" in x;

export const useStore = create<AppState>()((set, get) => ({
  phase: "upload",
  model: null,
  past: [],
  future: [],
  gestureStart: null,
  selection: null,
  highlights: [],
  revealed: false,
  diagrams: { N: true, V: true, M: true, deformed: true, deformationScale: "auto" },
  interpretation: { status: "idle", description: "", questions: [] },

  setPhase: (phase) => set({ phase }),
  loadModel: (model, phase = "explore") => set({ model, phase, past: [], future: [], selection: null, highlights: [], gestureStart: null }),

  edit: (changes) => {
    const { model, past } = get();
    if (!model) return { ok: false, error: "Ingen modell" };
    const r = setParams(model, asArray(changes));
    if (r.ok) set({ model: r.model, past: [...past, model].slice(-HISTORY_LIMIT), future: [] });
    return r;
  },
  replaceModel: (next) => {
    const { model, past } = get();
    set({ model: next, past: model ? [...past, model].slice(-HISTORY_LIMIT) : past, future: [] });
  },

  beginGesture: () => set({ gestureStart: get().model }),
  updateGesture: (changes) => {
    const { model, gestureStart } = get();
    const base = gestureStart ?? model;
    if (!base) return { ok: false, error: "Ingen modell" };
    // Endringene regnes alltid fra modellen da draget startet, så avrunding ikke hoper seg opp.
    const r = isModel(changes) ? ({ ok: true, model: changes } as const) : setParams(base, asArray(changes));
    if (r.ok) set({ model: r.model });
    return r;
  },
  endGesture: () => {
    const { gestureStart, model, past } = get();
    if (gestureStart && model && gestureStart !== model) set({ past: [...past, gestureStart].slice(-HISTORY_LIMIT), future: [] });
    set({ gestureStart: null });
  },
  cancelGesture: () => {
    const { gestureStart } = get();
    if (gestureStart) set({ model: gestureStart, gestureStart: null });
  },

  undo: () => {
    const { past, model, future } = get();
    const prev = past[past.length - 1];
    if (!prev || !model) return;
    set({ model: prev, past: past.slice(0, -1), future: [model, ...future] });
  },
  redo: () => {
    const { past, model, future } = get();
    const next = future[0];
    if (!next || !model) return;
    set({ model: next, past: [...past, model], future: future.slice(1) });
  },

  select: (selection) => set({ selection }),
  setHighlights: (highlights) => set({ highlights }),
  setRevealed: (revealed) => set({ revealed }),
  setDiagrams: (partial) => set({ diagrams: { ...get().diagrams, ...partial } }),
  setInterpretation: (partial) => set({ interpretation: { ...get().interpretation, ...partial } }),
}));
