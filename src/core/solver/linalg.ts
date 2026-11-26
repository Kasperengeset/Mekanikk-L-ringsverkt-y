/** Tett lineær algebra for små systemer (typisk under 150 frihetsgrader). */

export type Matrix = Float64Array[];

export function zeros(rows: number, cols: number): Matrix {
  return Array.from({ length: rows }, () => new Float64Array(cols));
}

/**
 * Løser A x = b med Gausseliminasjon og delvis pivotering. A og b endres ikke.
 * Er matrisen singulær (relativ pivot under `tol`), returneres kolonnen som ikke lot seg løse:
 * den frihetsgraden der systemet er en mekanisme.
 */
export function solveDense(A: Matrix, b: Float64Array, tol = 1e-11): { x: Float64Array } | { singular: number } {
  const n = b.length;
  const M = A.map((row) => Float64Array.from(row));
  const rhs = Float64Array.from(b);
  let scale = 0;
  for (let i = 0; i < n; i++) scale = Math.max(scale, Math.abs(M[i]![i]!));
  if (scale === 0) return n === 0 ? { x: new Float64Array(0) } : { singular: 0 };
  const perm = Array.from({ length: n }, (_, i) => i);

  for (let k = 0; k < n; k++) {
    let p = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(M[i]![k]!) > Math.abs(M[p]![k]!)) p = i;
    if (Math.abs(M[p]![k]!) <= tol * scale) return { singular: k };
    if (p !== k) {
      [M[p], M[k]] = [M[k]!, M[p]!];
      [rhs[p], rhs[k]] = [rhs[k]!, rhs[p]!];
      [perm[p], perm[k]] = [perm[k]!, perm[p]!];
    }
    const rowK = M[k]!;
    const pivot = rowK[k]!;
    for (let i = k + 1; i < n; i++) {
      const row = M[i]!;
      const f = row[k]! / pivot;
      if (f === 0) continue;
      for (let j = k; j < n; j++) row[j]! -= f * rowK[j]!;
      rhs[i]! -= f * rhs[k]!;
    }
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    const row = M[i]!;
    let s = rhs[i]!;
    for (let j = i + 1; j < n; j++) s -= row[j]! * x[j]!;
    x[i] = s / row[i]!;
  }
  return { x };
}
