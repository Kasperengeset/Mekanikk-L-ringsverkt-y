/**
 * Snittkrefter langs et element som eksakte, stykkevise polynomer i lokal x (meter fra i-enden).
 *
 * Fortegn: N er positiv i strekk. V og M er definert slik at dM/dx = V og dV/dx = q⊥.
 * M > 0 gir strekk på siden −y' (til høyre når man går fra i mot j), altså underkanten for en
 * bjelke tegnet fra venstre mot høyre. Presentasjonen kan snu dette til kursets konvensjon.
 */
import type { LocalLoad } from "./loads";

/** Polynomkoeffisienter c0 + c1 x + c2 x² + c3 x³. */
export type Poly = number[];

export interface Piece {
  x0: number;
  x1: number;
  N: Poly;
  V: Poly;
  M: Poly;
}

export interface Extreme {
  value: number;
  x: number;
}

export interface Extremes {
  N: { max: Extreme; min: Extreme };
  V: { max: Extreme; min: Extreme };
  M: { max: Extreme; min: Extreme };
}

export function evalPoly(p: Poly, x: number): number {
  let v = 0;
  for (let i = p.length - 1; i >= 0; i--) v = v * x + p[i]!;
  return v;
}

function add(p: Poly, q: Poly, factor = 1): Poly {
  const out = p.slice();
  q.forEach((c, i) => (out[i] = (out[i] ?? 0) + factor * c));
  return out;
}

function derivative(p: Poly): Poly {
  return p.slice(1).map((c, i) => c * (i + 1));
}

/** Reelle røtter av et polynom av grad ≤ 2 innenfor (a, b). */
function rootsIn(p: Poly, a: number, b: number): number[] {
  const [c0 = 0, c1 = 0, c2 = 0] = p;
  const scale = Math.max(Math.abs(c0), Math.abs(c1) * (b - a), Math.abs(c2) * (b - a) ** 2, 1e-300);
  let roots: number[] = [];
  if (Math.abs(c2) * (b - a) ** 2 <= 1e-14 * scale) {
    if (Math.abs(c1) * (b - a) > 1e-14 * scale) roots = [-c0 / c1];
  } else {
    const disc = c1 * c1 - 4 * c2 * c0;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      const q = -0.5 * (c1 + Math.sign(c1 || 1) * sq);
      roots = [q / c2, ...(q !== 0 ? [c0 / q] : [])];
    }
  }
  return roots.filter((r) => r > a && r < b);
}

/** Bidraget fra en lineært varierende last q(s) = A + B·s fra x1 til x (inne i lasten). */
function insideIntegrals(A: number, B: number, x1: number): { force: Poly; moment: Poly } {
  return {
    force: [-A * x1 - (B * x1 * x1) / 2, A, B / 2],
    moment: [(A * x1 * x1) / 2 + (B * x1 ** 3) / 3, -A * x1 - (B * x1 * x1) / 2, A / 2, B / 6],
  };
}

/**
 * @param p endekrefter som virker på elementet, lokale akser: [N1, V1, M1, N2, V2, M2]
 */
export function internalForces(p: ArrayLike<number>, loads: LocalLoad[], L: number): Piece[] {
  const tol = 1e-12 * L;
  const cuts = [0, L];
  for (const l of loads) {
    if (l.kind === "dist") cuts.push(l.x1, l.x2);
    else cuts.push(l.x);
  }
  const xs = [...new Set(cuts.map((x) => Math.min(L, Math.max(0, x))))].sort((a, b) => a - b).filter((x, i, arr) => i === 0 || x - arr[i - 1]! > tol);
  if (xs[xs.length - 1]! < L - tol) xs.push(L);

  const pieces: Piece[] = [];
  for (let k = 0; k + 1 < xs.length; k++) {
    const a = xs[k]!;
    const b = xs[k + 1]!;
    const mid = (a + b) / 2;
    let N: Poly = [-p[0]!];
    let V: Poly = [p[1]!];
    let M: Poly = [-p[2]!, p[1]!];
    for (const l of loads) {
      if (l.kind === "point") {
        if (l.x >= mid) continue;
        N = add(N, [-l.Pa]);
        V = add(V, [l.Pp]);
        M = add(M, [-l.Pp * l.x, l.Pp]);
      } else if (l.kind === "moment") {
        if (l.x >= mid) continue;
        M = add(M, [-l.M]);
      } else {
        if (l.x1 >= mid) continue;
        const span = l.x2 - l.x1;
        const lin = (q: [number, number]) => {
          const B = (q[1] - q[0]) / span;
          return { A: q[0] - B * l.x1, B };
        };
        const qa = lin(l.qa);
        const qp = lin(l.qp);
        if (l.x2 > mid) {
          const ia = insideIntegrals(qa.A, qa.B, l.x1);
          const ip = insideIntegrals(qp.A, qp.B, l.x1);
          N = add(N, ia.force, -1);
          V = add(V, ip.force);
          M = add(M, ip.moment);
        } else {
          const total = (A: number, B: number) => ({
            Q: A * span + (B * (l.x2 ** 2 - l.x1 ** 2)) / 2,
            S: (A * (l.x2 ** 2 - l.x1 ** 2)) / 2 + (B * (l.x2 ** 3 - l.x1 ** 3)) / 3,
          });
          const ta = total(qa.A, qa.B);
          const tp = total(qp.A, qp.B);
          N = add(N, [-ta.Q]);
          V = add(V, [tp.Q]);
          M = add(M, [-tp.S, tp.Q]);
        }
      }
    }
    pieces.push({ x0: a, x1: b, N, V, M });
  }
  return pieces;
}

export function extremes(pieces: Piece[]): Extremes {
  const pick = (key: "N" | "V" | "M") => {
    let max: Extreme = { value: -Infinity, x: 0 };
    let min: Extreme = { value: Infinity, x: 0 };
    for (const piece of pieces) {
      const poly = piece[key];
      const candidates = [piece.x0, piece.x1, ...rootsIn(derivative(poly), piece.x0, piece.x1)];
      for (const x of candidates) {
        const value = evalPoly(poly, x);
        if (value > max.value) max = { value, x };
        if (value < min.value) min = { value, x };
      }
    }
    return { max, min };
  };
  return { N: pick("N"), V: pick("V"), M: pick("M") };
}
