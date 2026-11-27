/**
 * Deformert form langs et element, eksakt for Euler–Bernoulli: w'' = M/EI og u' = N/EA.
 *
 * w(x) er forskyvningen langs lokal y' (90° mot klokka fra i → j), u(x) langs elementet.
 * Med fortegnet i internal.ts (M > 0 gir strekk på −y'-siden) gir positivt M krumning w'' > 0,
 * altså nedbøyning for en fritt opplagt bjelke med last nedover.
 * Randbetingelsene er forskyvningene i endene, så et momentledd gir automatisk en knekk.
 */
import { evalPoly, type Piece, type Poly } from "./internal.js";

export interface DeflectionPiece {
  x0: number;
  x1: number;
  /** Forskyvning langs elementet (m). */
  u: Poly;
  /** Forskyvning vinkelrett på elementet, langs y' (m). */
  w: Poly;
  /** Rotasjon w'(x) (rad, mot klokka). */
  rotation: Poly;
}

function integrate(p: Poly): Poly {
  return [0, ...p.map((c, i) => c / (i + 1))];
}

function plus(p: Poly, q: Poly): Poly {
  const out = p.slice();
  q.forEach((c, i) => (out[i] = (out[i] ?? 0) + c));
  return out;
}

const scale = (p: Poly, f: number) => p.map((c) => c * f);

/**
 * @param d lokale endeforskyvninger [u1, v1, θ1, u2, v2, θ2]
 */
export function deflection(pieces: Piece[], d: ArrayLike<number>, L: number, EI: number, EA: number, truss: boolean): DeflectionPiece[] {
  const [u1, v1, , u2, v2] = [d[0]!, d[1]!, d[2]!, d[3]!, d[4]!];
  if (truss) {
    const slope = (v2 - v1) / L;
    return pieces.map((p) => ({ x0: p.x0, x1: p.x1, u: [u1, (u2 - u1) / L], w: [v1, slope], rotation: [slope] }));
  }

  // Første gjennomgang med w'(0) = 0; deretter legges en stiv rotasjon til så w(L) = v2.
  const out: DeflectionPiece[] = [];
  let theta = 0;
  let w = v1;
  let u = u1;
  for (const p of pieces) {
    const K1 = integrate(scale(p.M, 1 / EI));
    const K2 = integrate(K1);
    const E1 = integrate(scale(p.N, 1 / EA));
    const a = p.x0;
    const c1 = theta - evalPoly(K1, a);
    const rotation = plus(K1, [c1]);
    const wPoly = plus(K2, [w - c1 * a - evalPoly(K2, a), c1]);
    const uPoly = plus(E1, [u - evalPoly(E1, a)]);
    out.push({ x0: p.x0, x1: p.x1, u: uPoly, w: wPoly, rotation });
    theta = evalPoly(rotation, p.x1);
    w = evalPoly(wPoly, p.x1);
    u = evalPoly(uPoly, p.x1);
  }
  const C = (v2 - w) / L;
  return out.map((p) => ({ ...p, w: plus(p.w, [0, C]), rotation: plus(p.rotation, [C]) }));
}
