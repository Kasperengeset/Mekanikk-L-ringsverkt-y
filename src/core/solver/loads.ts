/**
 * Laster på elementer i lokale akser, og ekvivalente nodelaster (arbeidsekvivalente, eksakte
 * for punktlast, moment og lineært varierende fordelt last).
 */
import type { DistributedLoad } from "../schema.js";

/** Last i elementets lokale akser. Posisjoner i meter fra i-enden. */
export type LocalLoad =
  | { kind: "point"; x: number; Pa: number; Pp: number }
  | { kind: "moment"; x: number; M: number }
  | { kind: "dist"; x1: number; x2: number; qa: [number, number]; qp: [number, number] };

/** Global retning per enhet intensitet og per lengde langs elementet, for en fordelt last. */
export function distributedDirection(load: Pick<DistributedLoad, "direction" | "basis">, c: number, s: number): [number, number] {
  if (load.direction === "local_y") return [-s, c];
  if (load.direction === "global_y") return [0, load.basis === "projection" ? Math.abs(c) : 1];
  return [load.basis === "projection" ? Math.abs(s) : 1, 0];
}

/** Komponenter av en global vektor langs og vinkelrett på elementet. */
export function toLocal(gx: number, gy: number, c: number, s: number): [number, number] {
  return [gx * c + gy * s, -gx * s + gy * c];
}

// Hermite-formfunksjoner for tverrforskyvning, og deres deriverte, med ξ = x/L.
function hermite(xi: number, L: number): [number, number, number, number] {
  return [1 - 3 * xi ** 2 + 2 * xi ** 3, L * (xi - 2 * xi ** 2 + xi ** 3), 3 * xi ** 2 - 2 * xi ** 3, L * (-(xi ** 2) + xi ** 3)];
}

function hermiteSlope(xi: number, L: number): [number, number, number, number] {
  return [(-6 * xi + 6 * xi ** 2) / L, 1 - 4 * xi + 3 * xi ** 2, (6 * xi - 6 * xi ** 2) / L, -2 * xi + 3 * xi ** 2];
}

const GAUSS3: [number, number][] = [
  [-Math.sqrt(3 / 5), 5 / 9],
  [0, 8 / 9],
  [Math.sqrt(3 / 5), 5 / 9],
];

function addPoint(f: Float64Array, L: number, x: number, Pa: number, Pp: number, truss: boolean) {
  const xi = x / L;
  f[0]! += Pa * (1 - xi);
  f[3]! += Pa * xi;
  if (truss) {
    // En stav har ingen bøyestivhet: tverrlasten fordeles som på en fritt opplagt bjelke.
    f[1]! += Pp * (1 - xi);
    f[4]! += Pp * xi;
    return;
  }
  const [n1, n2, n3, n4] = hermite(xi, L);
  f[1]! += Pp * n1;
  f[2]! += Pp * n2;
  f[4]! += Pp * n3;
  f[5]! += Pp * n4;
}

/** Ekvivalent nodelastvektor [u1, v1, θ1, u2, v2, θ2] i lokale akser. */
export function equivalentNodalLoads(loads: LocalLoad[], L: number, truss: boolean): Float64Array {
  const f = new Float64Array(6);
  for (const load of loads) {
    if (load.kind === "point") addPoint(f, L, load.x, load.Pa, load.Pp, truss);
    else if (load.kind === "moment") {
      const [d1, d2, d3, d4] = hermiteSlope(load.x / L, L);
      f[1]! += load.M * d1;
      f[2]! += load.M * d2;
      f[4]! += load.M * d3;
      f[5]! += load.M * d4;
    } else {
      // Integranden er et polynom av grad ≤ 4, så 3-punkts Gauss er eksakt.
      const half = (load.x2 - load.x1) / 2;
      const mid = (load.x1 + load.x2) / 2;
      const at = (q: [number, number], x: number) => q[0] + ((q[1] - q[0]) * (x - load.x1)) / (load.x2 - load.x1);
      for (const [g, w] of GAUSS3) {
        const x = mid + g * half;
        addPoint(f, L, x, w * half * at(load.qa, x), w * half * at(load.qp, x), truss);
      }
    }
  }
  return f;
}
