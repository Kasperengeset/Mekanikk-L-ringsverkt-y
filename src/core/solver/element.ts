/**
 * 2D-elementer i lokale akser: x' langs elementet fra i til j, y' 90° mot klokka.
 * Frihetsgrader per element: [u1, v1, θ1, u2, v2, θ2].
 */
import { zeros, type Matrix } from "./linalg.js";

export interface SectionProps {
  E: number;
  A: number;
  I: number;
}

/** Euler–Bernoulli-rammeelement, eller stav (bare aksialstivhet). */
export function localStiffness(kind: "beam" | "truss", s: SectionProps, L: number): Matrix {
  const k = zeros(6, 6);
  const ea = (s.E * s.A) / L;
  k[0]![0] = ea;
  k[0]![3] = -ea;
  k[3]![0] = -ea;
  k[3]![3] = ea;
  if (kind === "truss") return k;
  const ei = s.E * s.I;
  const a = (12 * ei) / L ** 3;
  const b = (6 * ei) / L ** 2;
  const c = (4 * ei) / L;
  const d = (2 * ei) / L;
  const bend: [number, number, number][] = [
    [1, 1, a], [1, 2, b], [1, 4, -a], [1, 5, b],
    [2, 2, c], [2, 4, -b], [2, 5, d],
    [4, 4, a], [4, 5, -b],
    [5, 5, c],
  ];
  for (const [i, j, v] of bend) {
    k[i]![j] = v;
    k[j]![i] = v;
  }
  return k;
}

/**
 * Statisk kondensering av frigjorte rotasjoner (momentledd). Returnerer stivhet og lastvektor der
 * de frigjorte frihetsgradene er fjernet (rader og kolonner er null), så leddet ikke tar moment.
 */
export function condense(k: Matrix, f: Float64Array, released: number[]): { k: Matrix; f: Float64Array } {
  let K = k.map((r) => Float64Array.from(r));
  let F = Float64Array.from(f);
  for (const r of released) {
    const krr = K[r]![r]!;
    if (krr === 0) continue;
    const next = K.map((row) => Float64Array.from(row));
    const nextF = Float64Array.from(F);
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 6; j++) next[i]![j] = K[i]![j]! - (K[i]![r]! * K[r]![j]!) / krr;
      nextF[i] = F[i]! - (K[i]![r]! * F[r]!) / krr;
    }
    for (let i = 0; i < 6; i++) {
      next[r]![i] = 0;
      next[i]![r] = 0;
    }
    nextF[r] = 0;
    K = next;
    F = nextF;
  }
  return { k: K, f: F };
}

/** Transformasjon fra globale til lokale frihetsgrader for ett element (6 × 6). */
export function transformation(c: number, s: number): Matrix {
  const T = zeros(6, 6);
  for (const o of [0, 3]) {
    T[o]![o] = c;
    T[o]![o + 1] = s;
    T[o + 1]![o] = -s;
    T[o + 1]![o + 1] = c;
    T[o + 2]![o + 2] = 1;
  }
  return T;
}

export function mulMatVec(A: Matrix, x: ArrayLike<number>): Float64Array {
  const out = new Float64Array(A.length);
  for (let i = 0; i < A.length; i++) {
    let s = 0;
    const row = A[i]!;
    for (let j = 0; j < row.length; j++) s += row[j]! * x[j]!;
    out[i] = s;
  }
  return out;
}

/** Tᵀ k T */
export function toGlobal(k: Matrix, T: Matrix): Matrix {
  const n = k.length;
  const kt = zeros(n, n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    let s = 0;
    for (let m = 0; m < n; m++) s += k[i]![m]! * T[m]![j]!;
    kt[i]![j] = s;
  }
  const out = zeros(n, n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    let s = 0;
    for (let m = 0; m < n; m++) s += T[m]![i]! * kt[m]![j]!;
    out[i]![j] = s;
  }
  return out;
}

/** Tᵀ f */
export function vecToGlobal(f: ArrayLike<number>, T: Matrix): Float64Array {
  const out = new Float64Array(6);
  for (let i = 0; i < 6; i++) {
    let s = 0;
    for (let m = 0; m < 6; m++) s += T[m]![i]! * f[m]!;
    out[i] = s;
  }
  return out;
}
