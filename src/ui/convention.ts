/**
 * Fortegnskonvensjon for visning (Mekanikk 1, NTNU):
 *  - M-diagrammet tegnes på strekksiden, uten fortegn.
 *  - N- og V-diagrammene tegnes med virkningssymbol; N > 0 er strekk.
 *
 * Løseren (src/core/solver/internal.ts) bruker: N > 0 strekk, dM/dx = V, og M > 0 gir strekk på
 * −y'-siden, der y' er 90° mot klokka fra elementets retning i → j.
 */
import type { Point } from "./geometry";

export type Quantity = "N" | "V" | "M";

/**
 * Retningen (enhetsvektor i modellkoordinater, y opp) som en positiv verdi tegnes mot.
 * For M er det strekksiden, så hele M-diagrammet havner på strekksiden uansett fortegn.
 * For N og V er det elementets +y'-side.
 */
export function positiveSide(q: Quantity, cos: number, sin: number): Point {
  const n = { x: -sin, y: cos }; // +y'
  return q === "M" ? { x: -n.x, y: -n.y } : n;
}

/** Siden av elementet som får strekk for et gitt moment: "−y'" for M > 0. */
export function tensionSide(M: number): "-y" | "+y" | "none" {
  return M > 0 ? "-y" : M < 0 ? "+y" : "none";
}

export function axialLabel(N: number): "strekk" | "trykk" | "" {
  return N > 0 ? "strekk" : N < 0 ? "trykk" : "";
}
