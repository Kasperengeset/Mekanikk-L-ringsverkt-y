/**
 * Sampling av snittkraftpolynomene fra løseren (SI, lokal x i meter fra i-enden) for tegning,
 * og valg av karakteristiske verdier (endepunkter, sprang, ekstremer) og vendepunkter.
 * Rene funksjoner uten skjermkoordinater, så de kan testes direkte.
 */
import { evalPoly, type MemberResult, type Piece } from "../../core/solver/index.js";
import type { Quantity } from "../convention.js";

export type Poly = number[];

/** Effektiv grad over et intervall med lengde `span`: ledd som er numerisk null, teller ikke. */
export function degree(p: Poly, span: number): number {
  const terms = p.map((c, i) => Math.abs(c) * Math.max(span, 1e-12) ** i);
  const scale = Math.max(0, ...terms);
  for (let i = p.length - 1; i > 0; i--) if (terms[i]! > 1e-12 * scale) return i;
  return 0;
}

export function derivative(p: Poly): Poly {
  return p.slice(1).map((c, i) => c * (i + 1));
}

/** Nullpunkter for et polynom i det åpne intervallet (a, b), sortert (grad ≤ 2: også tangering). */
export function rootsIn(p: Poly, a: number, b: number): number[] {
  const span = b - a;
  const deg = degree(p, span);
  const inside = (r: number) => r > a + 1e-9 * span && r < b - 1e-9 * span;
  if (deg === 0) return [];
  if (deg === 1) {
    const r = -p[0]! / p[1]!;
    return inside(r) ? [r] : [];
  }
  if (deg === 2) {
    const [c0, c1, c2] = [p[0]!, p[1]!, p[2]!];
    const disc = c1 * c1 - 4 * c2 * c0;
    if (disc < 0) return [];
    const q = -0.5 * (c1 + Math.sign(c1 || 1) * Math.sqrt(disc));
    const roots = [q / c2, ...(q !== 0 ? [c0 / q] : [])];
    return [...new Set(roots.filter(inside))].sort((x, y) => x - y);
  }
  // Høyere grad: fortegnsskifter i et tett rutenett, finjustert med halvering.
  const n = 128;
  const out: number[] = [];
  let x0 = a;
  let f0 = evalPoly(p, a);
  for (let k = 1; k <= n; k++) {
    const x1 = a + (span * k) / n;
    const f1 = evalPoly(p, x1);
    if (f1 === 0) out.push(x1);
    else if (f0 * f1 < 0) out.push(bisect(p, x0, x1));
    x0 = x1;
    f0 = f1;
  }
  return out.filter(inside);
}

function bisect(p: Poly, lo: number, hi: number): number {
  let flo = evalPoly(p, lo);
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    const fm = evalPoly(p, mid);
    if (fm === 0) return mid;
    if (fm * flo < 0) hi = mid;
    else {
      lo = mid;
      flo = fm;
    }
  }
  return (lo + hi) / 2;
}

/** Polynomet forskjøvet langs x: q(x) = p(x − a). */
export function shiftPoly(p: Poly, a: number): Poly {
  const out: Poly = new Array<number>(p.length).fill(0);
  p.forEach((c, i) => {
    let binom = 1;
    for (let k = 0; k <= i; k++) {
      out[k]! += c * binom * (-a) ** (i - k);
      binom = (binom * (i - k)) / (k + 1);
    }
  });
  return out;
}

/** Bitene til flere elementer etter hverandre langs samme linje, med x målt fra første elements i-ende. */
export function joinPieces(members: Pick<MemberResult, "pieces" | "length">[]): Piece[] {
  const out: Piece[] = [];
  let offset = 0;
  for (const m of members) {
    for (const p of m.pieces) {
      out.push({ x0: p.x0 + offset, x1: p.x1 + offset, N: shiftPoly(p.N, offset), V: shiftPoly(p.V, offset), M: shiftPoly(p.M, offset) });
    }
    offset += m.length;
  }
  return out;
}

/** Største |verdi| av en størrelse i hele konstruksjonen (fra løserens ekstremer). */
export function maxAbs(members: MemberResult[], q: Quantity): number {
  let max = 0;
  for (const m of members) max = Math.max(max, Math.abs(m.extremes[q].max.value), Math.abs(m.extremes[q].min.value));
  return max;
}

/** Verdien i x; i et sprang gjelder biten til venstre (x er bitens sluttpunkt). */
export function valueAt(pieces: Piece[], q: Quantity, x: number): number {
  const p = pieces.find((piece) => x <= piece.x1) ?? pieces[pieces.length - 1];
  return p ? evalPoly(p[q], x) : 0;
}

export interface SignRegion {
  x0: number;
  x1: number;
  sign: 1 | -1;
}

/** Sammenhengende deler av elementet der størrelsen har samme fortegn (|verdi| > tol). */
export function signRegions(pieces: Piece[], q: Quantity, tol: number): SignRegion[] {
  const out: SignRegion[] = [];
  for (const p of pieces) {
    const cuts = [p.x0, ...rootsIn(p[q], p.x0, p.x1), p.x1];
    for (let k = 0; k + 1 < cuts.length; k++) {
      const a = cuts[k]!;
      const b = cuts[k + 1]!;
      const mid = evalPoly(p[q], (a + b) / 2);
      if (Math.abs(mid) <= tol || b - a <= 0) continue;
      const sign = mid > 0 ? 1 : -1;
      const last = out[out.length - 1];
      if (last && last.sign === sign && Math.abs(last.x1 - a) <= 1e-12 * Math.max(1, p.x1)) last.x1 = b;
      else out.push({ x0: a, x1: b, sign });
    }
  }
  return out;
}

export interface Sample {
  /** Lokal x i meter fra i-enden. */
  x: number;
  value: number;
  /** Indeks til biten (piece) verdien er regnet fra. */
  piece: number;
}

/**
 * Verdier langs et element for tegning. Hver bit samples med eksakte endepunkter, så et sprang
 * mellom to biter blir to punkter med samme x (en loddrett strek). Lineære biter får bare
 * endepunktene; krumme biter får tette punkter (avstand ≤ `step`) og de eksakte toppunktene.
 */
export function samplePieces(pieces: Piece[], q: Quantity, step: number): Sample[] {
  const out: Sample[] = [];
  pieces.forEach((p, k) => {
    const poly = p[q];
    const span = p.x1 - p.x0;
    const xs = [p.x0];
    if (degree(poly, span) >= 2) {
      const n = Math.min(96, Math.max(8, Math.ceil(span / Math.max(step, 1e-9))));
      for (let i = 1; i < n; i++) xs.push(p.x0 + (span * i) / n);
      xs.push(...rootsIn(derivative(poly), p.x0, p.x1));
      xs.sort((a, b) => a - b);
    }
    xs.push(p.x1);
    for (const x of xs) out.push({ x, value: evalPoly(poly, x), piece: k });
  });
  return out;
}

export type CharacteristicKind = "extreme" | "jump" | "end" | "boundary" | "constant";

export interface CharacteristicPoint {
  x: number;
  value: number;
  kind: CharacteristicKind;
  /** −1: verdien like før x (venstre side av et sprang), +1: like etter, 0: i punktet. */
  side: -1 | 0 | 1;
}

/**
 * Verdiene som bør stå som tall i diagrammet: i elementender, på begge sider av sprang, i
 * knekkpunkter (bitgrenser) og i lokale ekstremer (for M: der V = 0). En konstant bit får ett tall
 * midt på i stedet for ett i hver ende. Verdier med |verdi| ≤ tol utelates (null står ikke som tall).
 */
export function characteristicPoints(pieces: Piece[], q: Quantity, tol: number): CharacteristicPoint[] {
  const out: CharacteristicPoint[] = [];
  const n = pieces.length;
  if (n === 0) return out;
  const constant = pieces.map((p) => degree(p[q], p.x1 - p.x0) === 0);
  const constValue = (k: number) => evalPoly(pieces[k]![q], pieces[k]!.x0);
  const add = (x: number, value: number, kind: CharacteristicKind, side: -1 | 0 | 1) => {
    if (Math.abs(value) > tol) out.push({ x, value, kind, side });
  };
  const near = (a: number, b: number) => Math.abs(a - b) <= tol;

  for (let j = 0; j <= n; j++) {
    const left = j > 0 ? pieces[j - 1]! : undefined;
    const right = j < n ? pieces[j]! : undefined;
    const x = right ? right.x0 : left!.x1;
    const l = left ? evalPoly(left[q], x) : undefined;
    const r = right ? evalPoly(right[q], x) : undefined;
    const leftConst = j > 0 && constant[j - 1]!;
    const rightConst = j < n && constant[j]!;
    if (l === undefined) {
      if (!rightConst) add(x, r!, "end", 1);
    } else if (r === undefined) {
      if (!leftConst) add(x, l, "end", -1);
    } else if (near(l, r)) {
      const coveredByConstant = (leftConst && near(constValue(j - 1), l)) || (rightConst && near(constValue(j), r));
      if (!coveredByConstant) add(x, l, "boundary", 0);
    } else {
      if (!leftConst) add(x, l, "jump", -1);
      if (!rightConst) add(x, r, "jump", 1);
    }
  }
  for (let k = 0; k < n; k++) {
    const p = pieces[k]!;
    if (!constant[k]) {
      for (const x of rootsIn(derivative(p[q]), p.x0, p.x1)) add(x, evalPoly(p[q], x), "extreme", 0);
      continue;
    }
    // Påfølgende konstante biter med samme verdi (f.eks. delt av et moment) får ett tall midt på.
    let end = k;
    while (end + 1 < n && constant[end + 1] && near(constValue(end + 1), constValue(k))) end++;
    add((p.x0 + pieces[end]!.x1) / 2, constValue(k), "constant", 0);
    k = end;
  }
  return out.sort((a, b) => a.x - b.x || a.side - b.side);
}

/**
 * Stedene der en størrelse skifter fortegn inne i elementet (for M: vendepunktene i den deformerte
 * formen). Tangering uten fortegnsskifte og nullverdier i elementendene teller ikke. Et sprang over
 * null (moment påført i elementet) gir et vendepunkt i sprangets x.
 */
export function signChanges(pieces: Piece[], q: Quantity, tol: number): number[] {
  const out: number[] = [];
  if (!pieces.length) return out;
  const L = pieces[pieces.length - 1]!.x1;
  let last: { x: number; sign: number; piece: number } | undefined;
  for (const s of samplePieces(pieces, q, L / 200)) {
    if (Math.abs(s.value) <= tol) continue;
    const sign = Math.sign(s.value);
    if (last && sign !== last.sign) {
      const poly = pieces[s.piece]![q];
      const x = last.piece === s.piece ? bisect(poly, last.x, s.x) : pieces[s.piece]!.x0;
      if (x > 1e-6 * L && x < L * (1 - 1e-6)) out.push(x);
    }
    last = { x: s.x, sign, piece: s.piece };
  }
  return out;
}
