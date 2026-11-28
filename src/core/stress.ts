/**
 * Spenninger i et tverrsnitt fra snittkreftene, etter elementær bjelketeori:
 *
 *   σ(y) = N/A − M·y/I          (normalspenning, strekk positiv)
 *   τ(y) = V·S(y) / (I·b(y))     (skjærspenning, middelverdi over bredden b(y))
 *
 * y måles fra arealsenteret langs elementets +y' (90° mot klokka fra i → j). Med løserens fortegn gir
 * M > 0 strekk på −y'-siden, derfor minustegnet. S(y) er statisk moment om arealsenteret av arealet
 * over y. σ bruker A og I som løseren bruker (tabellverdier for profiler). τ bruker A og I for den
 * forenklede formen her (rektangler uten avrundinger, sirkler), så ∫ τ·b dy = V nøyaktig.
 *
 * Tverrsnittet beskrives i koordinater (z, y) i meter, med origo i arealsenteret: z på tvers av
 * rammens plan (bredden), y i planet (høyden).
 */
import type { Section, SectionShape } from "./schema.js";
import { PROFILES, normalizeProfileName, resolveSection } from "./sections.js";

const TO_M = { mm: 1e-3, cm: 1e-2, m: 1 } as const;

export interface Rect {
  z0: number;
  z1: number;
  y0: number;
  y1: number;
}

export type SectionGeometry = {
  /** Øverste (+y') og nederste (−y') fiber, målt fra arealsenteret. top > 0 > bottom. */
  top: number;
  bottom: number;
  /** Største bredde. */
  width: number;
  /** Areal og arealmoment for formen her (uten avrundinger). */
  A: number;
  I: number;
  /** true: formen står ikke i oppgaven. Da vises et rektangel bare som illustrasjon. */
  assumed: boolean;
} & ({ kind: "rects"; rects: Rect[] } | { kind: "circle"; R: number; r: number });

/** Bredde og høyde (b : h = 1 : 2) for tverrsnittet som tegnes når oppgaven ikke oppgir et. */
export const ASSUMED_RECT = { b: 0.5, h: 1 };

/** Rektangler (fra underkant, sentrert om z = 0) gjort om til ikke-overlappende bånd, uten utsparingene. */
function bands(parts: { z0: number; z1: number; y0: number; y1: number; hole: boolean }[]): Rect[] {
  const ys = [...new Set(parts.flatMap((p) => [p.y0, p.y1]))].sort((a, b) => a - b);
  const out: Rect[] = [];
  for (let k = 0; k + 1 < ys.length; k++) {
    const ya = ys[k]!;
    const yb = ys[k + 1]!;
    const mid = (ya + yb) / 2;
    const covering = parts.filter((p) => p.y0 < mid && p.y1 > mid);
    // Union av de faste delene, minus utsparingene.
    let intervals: [number, number][] = [];
    for (const p of covering.filter((c) => !c.hole).sort((a, b) => a.z0 - b.z0)) {
      const last = intervals[intervals.length - 1];
      if (last && p.z0 <= last[1]) last[1] = Math.max(last[1], p.z1);
      else intervals.push([p.z0, p.z1]);
    }
    for (const h of covering.filter((c) => c.hole)) {
      intervals = intervals.flatMap(([a, b]): [number, number][] => {
        if (h.z1 <= a || h.z0 >= b) return [[a, b]];
        const pieces: [number, number][] = [
          [a, Math.min(b, h.z0)],
          [Math.max(a, h.z1), b],
        ];
        return pieces.filter(([x, y]) => y - x > 0);
      });
    }
    for (const [z0, z1] of intervals) out.push({ z0, z1, y0: ya, y1: yb });
  }
  return out;
}

function rectsGeometry(rects: Rect[], assumed: boolean): SectionGeometry {
  const A = rects.reduce((s, r) => s + (r.z1 - r.z0) * (r.y1 - r.y0), 0);
  const yc = rects.reduce((s, r) => s + (r.z1 - r.z0) * (r.y1 - r.y0) * ((r.y0 + r.y1) / 2), 0) / A;
  const shifted = rects.map((r) => ({ ...r, y0: r.y0 - yc, y1: r.y1 - yc }));
  const I = shifted.reduce((s, r) => s + ((r.z1 - r.z0) * (r.y1 ** 3 - r.y0 ** 3)) / 3, 0);
  return {
    kind: "rects",
    rects: shifted,
    top: Math.max(...shifted.map((r) => r.y1)),
    bottom: Math.min(...shifted.map((r) => r.y0)),
    width: Math.max(...shifted.map((r) => r.z1)) - Math.min(...shifted.map((r) => r.z0)),
    A,
    I,
    assumed,
  };
}

function circleGeometry(R: number, r: number): SectionGeometry {
  return { kind: "circle", R, r, top: R, bottom: -R, width: 2 * R, A: Math.PI * (R * R - r * r), I: (Math.PI * (R ** 4 - r ** 4)) / 4, assumed: false };
}

const centered = (b: number, y0: number, h: number, hole = false) => ({ z0: -b / 2, z1: b / 2, y0, y1: y0 + h, hole });

/** Formen på tverrsnittet. Uten form i oppgaven brukes et rektangel (assumed). */
export function shapeGeometry(shape: SectionShape | undefined): SectionGeometry {
  if (!shape) return rectsGeometry(bands([centered(ASSUMED_RECT.b, 0, ASSUMED_RECT.h)]), true);
  switch (shape.type) {
    case "rectangle": {
      const u = TO_M[shape.unit];
      return rectsGeometry([{ z0: (-shape.b * u) / 2, z1: (shape.b * u) / 2, y0: 0, y1: shape.h * u }], false);
    }
    case "circle":
      return circleGeometry((shape.D * TO_M[shape.unit]) / 2, 0);
    case "tube": {
      const R = (shape.D * TO_M[shape.unit]) / 2;
      return circleGeometry(R, Math.max(0, R - shape.t * TO_M[shape.unit]));
    }
    case "profile": {
      const p = PROFILES[normalizeProfileName(shape.name)];
      if (!p) return shapeGeometry(undefined);
      const [h, b, tw, tf] = [p.h, p.b, p.tw, p.tf].map((v) => v * 1e-3) as [number, number, number, number];
      if (shape.axis === "weak") {
        // Bøyd om svak akse: flensene står loddrett, steget ligger vannrett midt i høyden b.
        return rectsGeometry(
          bands([
            { z0: -h / 2, z1: -h / 2 + tf, y0: 0, y1: b, hole: false },
            { z0: h / 2 - tf, z1: h / 2, y0: 0, y1: b, hole: false },
            { z0: -h / 2 + tf, z1: h / 2 - tf, y0: (b - tw) / 2, y1: (b + tw) / 2, hole: false },
          ]),
          false,
        );
      }
      return rectsGeometry(bands([centered(b, 0, tf), centered(tw, tf, h - 2 * tf), centered(b, h - tf, tf)]), false);
    }
    case "composite": {
      const u = TO_M[shape.unit];
      return rectsGeometry(bands(shape.parts.map((p) => centered(p.b * u, p.z * u, p.h * u, p.hole))), false);
    }
  }
}

export function sectionGeometry(section: Section | undefined): SectionGeometry {
  return shapeGeometry(section?.shape);
}

/** Materialet langs z i høyden y, som intervaller [z0, z1]. */
export function intervalsAt(g: SectionGeometry, y: number): [number, number][] {
  if (g.kind === "circle") {
    if (Math.abs(y) >= g.R) return [];
    const cR = Math.sqrt(g.R * g.R - y * y);
    if (Math.abs(y) >= g.r) return [[-cR, cR]];
    const cr = Math.sqrt(g.r * g.r - y * y);
    return [
      [-cR, -cr],
      [cr, cR],
    ];
  }
  return g.rects
    .filter((r) => y >= r.y0 && y <= r.y1)
    .map((r): [number, number] => [r.z0, r.z1])
    .sort((a, b) => a[0] - b[0])
    .filter((iv, k, all) => k === 0 || iv[0] >= all[k - 1]![1] - 1e-15);
}

/** Bredden b(y). I en kant mellom to bånd gjelder båndet over når `above`, ellers båndet under. */
export function widthAt(g: SectionGeometry, y: number, above = true): number {
  if (g.kind === "circle") return intervalsAt(g, y).reduce((s, [a, b]) => s + b - a, 0);
  return g.rects.filter((r) => (above ? y >= r.y0 && y < r.y1 : y > r.y0 && y <= r.y1)).reduce((s, r) => s + r.z1 - r.z0, 0);
}

/** Statisk moment om arealsenteret av arealet over y. */
export function firstMoment(g: SectionGeometry, y: number): number {
  if (g.kind === "circle") {
    const part = (R: number) => (Math.abs(y) < R ? (2 / 3) * (R * R - y * y) ** 1.5 : 0);
    return part(g.R) - part(g.r);
  }
  let S = 0;
  for (const r of g.rects) {
    if (y >= r.y1) continue;
    const from = Math.max(y, r.y0);
    S += ((r.z1 - r.z0) * (r.y1 * r.y1 - from * from)) / 2;
  }
  return S;
}

export interface StressSample {
  y: number;
  sigma: number;
  tau: number;
}

export interface StressProfile {
  geometry: SectionGeometry;
  /** Fra underkant til overkant. I et sprang i bredden står samme y to ganger (verdien under, så over). */
  samples: StressSample[];
  sigmaTop: number;
  sigmaBottom: number;
  /** Største |τ| og hvor den er. */
  tauMax: { value: number; y: number };
  /** Nøytralaksen (σ = 0) når den ligger innenfor tverrsnittet. */
  neutralAxis?: number;
  /** A og I som σ er regnet med. */
  A: number;
  I: number;
}

/**
 * Normal- og skjærspenningene over høyden for snittkreftene N, V og M (SI). `section` er tverrsnittet
 * elementet har i modellen; uten det brukes et rektangel med A og I fra løserens standardtverrsnitt,
 * og tallene er bare en illustrasjon (geometry.assumed).
 */
export function stressProfile(section: Section | undefined, forces: { N: number; V: number; M: number }, perBand = 24): StressProfile {
  const geometry = sectionGeometry(section);
  const resolved = resolveSection(section);
  const A = section?.shape || section?.A !== undefined ? resolved.A : geometry.A;
  const I = section?.shape || section?.I !== undefined ? resolved.I : geometry.I;
  const sigma = (y: number) => forces.N / A - (forces.M * y) / I;
  const tau = (y: number, above: boolean) => {
    const b = widthAt(geometry, y, above);
    return b > 1e-12 * geometry.width ? (forces.V * firstMoment(geometry, y)) / (geometry.I * b) : 0;
  };

  const samples: StressSample[] = [];
  const push = (y: number, above: boolean) => samples.push({ y, sigma: sigma(y), tau: tau(y, above) });
  if (geometry.kind === "circle") {
    const n = 4 * perBand;
    for (let k = 0; k <= n; k++) push(geometry.bottom + ((geometry.top - geometry.bottom) * k) / n, true);
  } else {
    const ys = [...new Set(geometry.rects.flatMap((r) => [r.y0, r.y1]))].sort((a, b) => a - b);
    for (let k = 0; k + 1 < ys.length; k++) {
      const [ya, yb] = [ys[k]!, ys[k + 1]!];
      for (let s = 0; s <= perBand; s++) push(ya + ((yb - ya) * s) / perBand, s < perBand);
    }
  }

  let tauMax = { value: 0, y: 0 };
  for (const s of samples) if (Math.abs(s.tau) > Math.abs(tauMax.value)) tauMax = { value: s.tau, y: s.y };
  const scale = Math.max(Math.abs(forces.N / A), Math.abs((forces.M * geometry.top) / I), Math.abs((forces.M * geometry.bottom) / I));
  let neutralAxis: number | undefined;
  if (Math.abs(forces.M) > 0 && scale > 0) {
    const y = (forces.N * I) / (A * forces.M);
    if (y > geometry.bottom && y < geometry.top) neutralAxis = y;
  }
  return { geometry, samples, sigmaTop: sigma(geometry.top), sigmaBottom: sigma(geometry.bottom), tauMax, neutralAxis, A, I };
}
