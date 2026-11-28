/**
 * Appens tilstand (zustand). Modellen er kilden til alt som vises; løsningen regnes ut fra den
 * (se useSolveResult). Alle endringer går gjennom src/core/edit.ts.
 *
 * Dra-operasjoner: beginGesture() ved pointerdown, updateGesture() for hvert bilde (ingen historikk),
 * endGesture() ved pointerup (ett steg i angre-historikken). Klikk og glidebrytere bruker edit().
 */
import { create } from "zustand";
import { setParams, type EditResult } from "../../core/edit.js";
import type { Cut, Vec2 } from "../../core/cut.js";
import type { ForceSystemResult } from "../../core/forces.js";
import type { Attempt } from "../../core/pedagogy.js";
import type { Model } from "../../core/schema.js";

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

/** Snittet studenten har lagt (klikk eller dra på et element), med punktet det står i (modellkoordinater). */
export interface CutState extends Cut {
  point: Vec2;
}

/** Et kraftsystem fra Claude (force_system), vist i stedet for en konstruksjon. */
export interface ForcesView {
  units: { force: string; length: string };
  result: Pick<ForceSystemResult, "forces" | "resultant" | "moment" | "equilibrium">;
}

/** Hva 3D-visningen av snittet viser: resultantene N, V og M, eller spenningene i tverrsnittet. */
export type CutMode = "forces" | "stress";

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

/** Glidebryter lagt til av agenten (add_control) eller av appen. */
export interface Control {
  path: string;
  label: string;
  min: number;
  max: number;
  step: number;
}

/** Spådomsspørsmål fra agenten (ask_prediction), vist til studenten svarer. */
export interface PredictionRequest {
  id: string;
  question: string;
  /** Tom liste betyr fritekst. */
  options: string[];
}

export interface PredictionAnswer {
  text: string;
  optionIndex?: number;
}

/** Et punkt i et diagram som skal utheves (agentens highlight-verktøy). */
export interface DiagramPoint {
  member: string;
  quantity: "N" | "V" | "M";
  /** Andel av elementlengden fra i-enden. */
  at: number;
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
  /** Utheving av et punkt i et diagram (agenten). */
  diagramHighlight: DiagramPoint | null;
  /**
   * Studentens forsøk per indeks i model.asked. Tallene for et spørsmål vises først når det finnes
   * et forsøk (se src/core/pedagogy.ts: hiddenValues).
   */
  attempts: Record<number, Attempt>;
  controls: Control[];
  /** Åpent spådomsspørsmål, eller null. */
  prediction: PredictionRequest | null;
  /** Svar på spådomsspørsmål, etter id. */
  predictionAnswers: Record<string, PredictionAnswer>;
  diagrams: DiagramSettings;
  interpretation: InterpretationState;
  /** Snittet som vises i 3D, eller null. Ikke en del av angre-historikken. */
  cut: CutState | null;
  cutMode: CutMode;
  /** Kraftsystem fra Claude (direktekoblingen). Vises når det ikke er noen modell. */
  forces: ForcesView | null;

  setPhase(phase: Phase): void;
  /** Ny modell uten historikk (f.eks. etter tolkning eller fra URL). */
  loadModel(model: Model, phase?: Phase): void;
  /** Tilbake til opplastingen uten modell (ny oppgave). */
  reset(): void;
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
  setDiagramHighlight(point: DiagramPoint | null): void;
  recordAttempt(index: number, attempt: Attempt): void;
  addControl(control: Control): void;
  removeControl(path: string): void;
  /** null lukker et åpent spørsmål uten svar. */
  askPrediction(request: PredictionRequest | null): void;
  answerPrediction(id: string, answer: PredictionAnswer): void;
  setDiagrams(partial: Partial<DiagramSettings>): void;
  setInterpretation(partial: Partial<InterpretationState>): void;
  setCut(cut: CutState | null): void;
  showForces(forces: ForcesView | null): void;
  setCutMode(mode: CutMode): void;
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
  diagramHighlight: null,
  attempts: {},
  controls: [],
  prediction: null,
  predictionAnswers: {},
  diagrams: { N: true, V: true, M: true, deformed: true, deformationScale: "auto" },
  interpretation: { status: "idle", description: "", questions: [] },
  cut: null,
  cutMode: "forces",
  forces: null,

  setPhase: (phase) => set({ phase }),
  loadModel: (model, phase = "explore") =>
    set({
      model,
      phase,
      past: [],
      future: [],
      selection: null,
      highlights: [],
      diagramHighlight: null,
      gestureStart: null,
      attempts: {},
      controls: [],
      prediction: null,
      cut: null,
      forces: null,
    }),
  reset: () =>
    set({
      model: null,
      phase: "upload",
      past: [],
      future: [],
      gestureStart: null,
      selection: null,
      highlights: [],
      diagramHighlight: null,
      attempts: {},
      controls: [],
      prediction: null,
      cut: null,
      forces: null,
      interpretation: { status: "idle", description: "", questions: [] },
    }),

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
  setDiagramHighlight: (diagramHighlight) => set({ diagramHighlight }),
  recordAttempt: (index, attempt) => set({ attempts: { ...get().attempts, [index]: attempt } }),
  addControl: (control) => set({ controls: [...get().controls.filter((c) => c.path !== control.path), control] }),
  removeControl: (path) => set({ controls: get().controls.filter((c) => c.path !== path) }),
  askPrediction: (prediction) => set({ prediction }),
  answerPrediction: (id, answer) => {
    const { prediction, predictionAnswers } = get();
    set({ predictionAnswers: { ...predictionAnswers, [id]: answer }, prediction: prediction?.id === id ? null : prediction });
  },
  setDiagrams: (partial) => set({ diagrams: { ...get().diagrams, ...partial } }),
  setInterpretation: (partial) => set({ interpretation: { ...get().interpretation, ...partial } }),
  setCut: (cut) => set({ cut }),
  showForces: (forces) => set({ forces, ...(forces ? { model: null, phase: "upload" as Phase, past: [], future: [], cut: null } : {}) }),
  setCutMode: (cutMode) => set({ cutMode }),
}));
