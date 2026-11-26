/**
 * Omregning mellom oppgavens enheter (`model.units`) og SI (m, N).
 * Løseren og sammenligningen jobber alltid på SI-modellen.
 */
import type { Load, Model, Units } from "./schema";

const LENGTH_TO_M: Record<Units["length"], number> = { mm: 1e-3, cm: 1e-2, m: 1 };
const FORCE_TO_N: Record<Units["force"], number> = { N: 1, kN: 1e3, MN: 1e6 };

export const SI_UNITS: Units = { length: "m", force: "N" };

export function lengthFactor(units: Units): number {
  return LENGTH_TO_M[units.length];
}

export function forceFactor(units: Units): number {
  return FORCE_TO_N[units.force];
}

function scaleLoad(load: Load, f: number, l: number): Load {
  switch (load.type) {
    case "point":
      return { ...load, P: load.P * f };
    case "moment":
      return { ...load, M: load.M * f * l };
    case "distributed":
      return { ...load, w_start: (load.w_start * f) / l, w_end: (load.w_end * f) / l };
  }
}

/** Gjør om en modell til SI. Tverrsnittsdata står alltid i SI og endres ikke. */
export function toSI(model: Model): Model {
  const l = lengthFactor(model.units);
  const f = forceFactor(model.units);
  if (l === 1 && f === 1) return model;
  return {
    ...model,
    units: SI_UNITS,
    nodes: model.nodes.map((n) => ({ ...n, x: n.x * l, y: n.y * l })),
    loads: model.loads.map((load) => scaleLoad(load, f, l)),
  };
}

/** Komponentene til en punktlast gitt som størrelse og retning. */
export function pointLoadComponents(P: number, angleDeg: number): { Fx: number; Fy: number } {
  const a = (angleDeg * Math.PI) / 180;
  return { Fx: P * Math.cos(a), Fy: P * Math.sin(a) };
}
