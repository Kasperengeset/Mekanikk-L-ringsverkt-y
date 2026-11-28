/**
 * Tallene for snittet i tekst: hvor snittet står, og N, V og M med kursets ord (strekk/trykk,
 * strekksiden for M). Tall studenten ikke har prøvd seg på ennå, skrives som «?».
 */
import { cutForces, type Cut, type CutForces } from "../../core/cut.js";
import { isDiagramValueHidden, type HiddenValues } from "../../core/pedagogy.js";
import type { Model } from "../../core/schema.js";
import type { SolveResult } from "../../core/solver/index.js";
import { formatQuantity } from "../format.js";

export interface ReadoutRow {
  q: "N" | "V" | "M";
  name: string;
  value: string;
  note?: string;
  masked: boolean;
}

export interface CutReadout {
  member: string;
  /** F.eks. "2,4 m fra A". */
  position: string;
  rows: ReadoutRow[];
  truss: boolean;
  forces: CutForces;
}

/** Siden som får strekk for momentet M i snittet, i ord. */
export function tensionSideText(forces: CutForces): string {
  // M > 0 gir strekk på −y'-siden.
  const sign = forces.M > 0 ? -1 : 1;
  const t = { x: sign * forces.normal.x, y: sign * forces.normal.y };
  if (Math.abs(t.y) >= Math.abs(t.x) * 0.999) return t.y < 0 ? "strekk i underkant" : "strekk i overkant";
  return t.x < 0 ? "strekk på venstre side" : "strekk på høyre side";
}

export function cutReadout(model: Model, result: Extract<SolveResult, { status: "ok" }>, cut: Cut, hidden?: HiddenValues): CutReadout | undefined {
  const forces = cutForces(result, cut);
  const m = result.members.find((x) => x.id === cut.member);
  const member = model.members.find((x) => x.id === cut.member);
  if (!forces || !m || !member) return undefined;
  const span = Math.max(...result.members.map((x) => x.length), 1e-9);
  const scale = Math.max(1e-300, ...result.members.flatMap((x) => [x.extremes.N, x.extremes.V].flatMap((e) => [Math.abs(e.max.value), Math.abs(e.min.value)])), ...result.members.map((x) => Math.max(Math.abs(x.extremes.M.max.value), Math.abs(x.extremes.M.min.value)) / span));
  const zero = (v: number, factor = 1) => Math.abs(v) <= 1e-9 * scale * factor;
  const masked = (q: "N" | "V" | "M") => hidden !== undefined && isDiagramValueHidden(hidden, q, cut.member);
  const truss = m.kind === "truss";

  const rows: ReadoutRow[] = [];
  const N = zero(forces.N) ? 0 : forces.N;
  rows.push({
    q: "N",
    name: "Normalkraft",
    value: masked("N") ? "?" : formatQuantity("force", Math.abs(N), model),
    note: masked("N") ? undefined : N > 0 ? "strekk" : N < 0 ? "trykk" : undefined,
    masked: masked("N"),
  });
  if (!truss) {
    const V = zero(forces.V) ? 0 : forces.V;
    rows.push({ q: "V", name: "Skjærkraft", value: masked("V") ? "?" : formatQuantity("force", Math.abs(V), model), masked: masked("V") });
    const M = zero(forces.M, span) ? 0 : forces.M;
    rows.push({
      q: "M",
      name: "Bøyemoment",
      value: masked("M") ? "?" : formatQuantity("moment", Math.abs(M), model),
      note: masked("M") || M === 0 ? undefined : tensionSideText(forces),
      masked: masked("M"),
    });
  }
  return { member: cut.member, position: `${formatQuantity("length", forces.x, model)} fra ${member.i}`, rows, truss, forces };
}
