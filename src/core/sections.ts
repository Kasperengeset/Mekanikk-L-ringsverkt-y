/**
 * Tverrsnittsdata. Modellen kan oppgi E, A og I direkte, eller formen (mål eller profilnavn).
 * A og I regnes da ut her, deterministisk, så LLM-en bare skriver av målene fra oppgaven.
 */
import ipe from "./data/ipe.json";
import type { Section, SectionShape } from "./schema";

export interface ResolvedSection {
  E: number;
  A: number;
  I: number;
  /** true når noe av E, A eller I ikke står i oppgaven: deformasjonen er da bare kvalitativ. */
  assumed: boolean;
}

/** Brukes når oppgaven ikke oppgir tverrsnitt. Stort A i forhold til I gjør aksialdeformasjonen neglisjerbar. */
export const DEFAULT_SECTION: ResolvedSection = { E: 210e9, A: 1, I: 1e-4, assumed: true };
const DEFAULT_E = 210e9;

const TO_M = { mm: 1e-3, cm: 1e-2, m: 1 } as const;

interface Profile {
  h: number;
  b: number;
  tw: number;
  tf: number;
  r: number;
  A: number;
  Iy: number;
  Iz: number;
}

export const PROFILES: Record<string, Profile> = ipe.profiles;

export function normalizeProfileName(name: string): string {
  return name.replace(/\s+/g, "").toUpperCase();
}

/** A (m²) og I (m⁴) om aksen vinkelrett på rammens plan. */
export function shapeProperties(shape: SectionShape): { A: number; I: number } {
  switch (shape.type) {
    case "rectangle": {
      const b = shape.b * TO_M[shape.unit];
      const h = shape.h * TO_M[shape.unit];
      return { A: b * h, I: (b * h ** 3) / 12 };
    }
    case "circle": {
      const D = shape.D * TO_M[shape.unit];
      return { A: (Math.PI * D ** 2) / 4, I: (Math.PI * D ** 4) / 64 };
    }
    case "tube": {
      const D = shape.D * TO_M[shape.unit];
      const d = D - 2 * shape.t * TO_M[shape.unit];
      return { A: (Math.PI * (D ** 2 - d ** 2)) / 4, I: (Math.PI * (D ** 4 - d ** 4)) / 64 };
    }
    case "profile": {
      const p = PROFILES[normalizeProfileName(shape.name)];
      if (!p) throw new Error(`Ukjent profil: ${shape.name}`);
      return { A: p.A * 1e-6, I: (shape.axis === "weak" ? p.Iz : p.Iy) * 1e-12 };
    }
    case "composite": {
      const u = TO_M[shape.unit];
      const parts = shape.parts.map((p) => ({ A: (p.hole ? -1 : 1) * p.b * p.h * u * u, zc: (p.z + p.h / 2) * u, I0: (p.hole ? -1 : 1) * ((p.b * p.h ** 3) / 12) * u ** 4 }));
      const A = parts.reduce((s, p) => s + p.A, 0);
      const zc = parts.reduce((s, p) => s + p.A * p.zc, 0) / A;
      return { A, I: parts.reduce((s, p) => s + p.I0 + p.A * (p.zc - zc) ** 2, 0) };
    }
  }
}

/** Arealsenterets avstand fra underkant (m). Bare for sammensatte tverrsnitt; ellers midt på. */
export function centroidFromBottom(shape: SectionShape): number | undefined {
  if (shape.type !== "composite") return undefined;
  const u = TO_M[shape.unit];
  let A = 0;
  let S = 0;
  for (const p of shape.parts) {
    const a = (p.hole ? -1 : 1) * p.b * p.h;
    A += a;
    S += a * (p.z + p.h / 2);
  }
  return (S / A) * u;
}

export function resolveSection(section: Section | undefined): ResolvedSection {
  if (!section) return DEFAULT_SECTION;
  const fromShape = section.shape ? shapeProperties(section.shape) : undefined;
  const A = section.A ?? fromShape?.A;
  const I = section.I ?? fromShape?.I;
  return {
    E: section.E ?? DEFAULT_E,
    A: A ?? DEFAULT_SECTION.A,
    I: I ?? DEFAULT_SECTION.I,
    assumed: section.assumed || section.E === undefined || A === undefined || I === undefined,
  };
}
