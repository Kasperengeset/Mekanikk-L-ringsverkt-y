/**
 * Kraftsystem i planet: dekomponering, resultant, moment om et punkt og likevekt (Newtons 1. lov).
 * Deterministisk; ingen tall kommer fra en språkmodell.
 *
 * Akser som i TKT4116: x mot høyre og z oppover. Vinkler i grader mot klokka fra +x (mot +z).
 * Moment er positivt mot klokka, sett med x mot høyre og z opp: M = Σ (x − x₀)·Fz − (z − z₀)·Fx.
 *
 * En kraft kan gis på tre måter, slik oppgavene gir dem:
 *  - størrelse og vinkel (F₁ = 600 N, 35° over x-aksen),
 *  - størrelse og retningsvektor, f.eks. en helning 3:4 eller fra geometrien (F₃ mot punktet B),
 *  - komponenter direkte.
 * Mangler noe (f.eks. retningen), sier `missing` hva som må spørres om, i stedet for å anta.
 */
import { z } from "zod";
import { ForceUnit, LengthUnit } from "./schema.js";

const Num = z.number().refine(Number.isFinite, { error: "Må være et endelig tall." });
const Point = z.strictObject({ x: Num, z: Num });

export const ForceSpec = z.strictObject({
  id: z.string().min(1).describe("Navn på kraften slik oppgaven kaller den, f.eks. 'F1'."),
  magnitude: Num.min(0).optional().describe("Størrelse i units.force. Brukes med angle_deg eller direction."),
  angle_deg: Num.optional().describe("Retning i grader mot klokka fra +x (mot +z). Rett opp = 90, rett ned = -90, mot venstre = 180."),
  direction: z
    .strictObject({ dx: Num, dz: Num })
    .optional()
    .describe("Retningsvektor (trenger ikke være enhetsvektor), f.eks. helning 3:4 opp mot venstre = {dx: -4, dz: 3}, eller fra A til B = {dx: xB-xA, dz: zB-zA}."),
  components: z.strictObject({ Fx: Num, Fz: Num }).optional().describe("Komponentene direkte, i units.force. Bruk bare når oppgaven gir dem."),
  at: Point.optional().describe("Angrepspunkt (x, z) i units.length. Trengs bare for moment."),
});

export const ForceSystemInput = z.strictObject({
  units: z.strictObject({ length: LengthUnit, force: ForceUnit }).describe("Enhetene tallene i oppgaven står i."),
  forces: z.array(ForceSpec).min(1).describe("Kreftene som virker, hver gitt slik oppgaven gir den."),
  moment_about: Point.optional().describe("Punktet momentet regnes om (x, z). Utelates hvis oppgaven ikke spør om moment."),
});

export type ForceSpec = z.infer<typeof ForceSpec>;
export type ForceSystemInput = z.infer<typeof ForceSystemInput>;

export interface ForceComponents {
  id: string;
  Fx: number;
  Fz: number;
  magnitude: number;
  /** Retning i grader mot klokka fra +x, i (−180, 180]. */
  angle_deg: number;
}

export interface ForceSystemResult {
  status: "ok";
  forces: ForceComponents[];
  resultant: { Rx: number; Rz: number; R: number; angle_deg: number };
  /** Moment om moment_about (mot klokka positivt), når alle kreftene har angrepspunkt. */
  moment?: { about: { x: number; z: number }; M: number };
  /** true når R (og M, hvis regnet) er null innenfor toleransen: systemet er i likevekt. */
  equilibrium: boolean;
  /** Kontroll: summen av komponentene minus resultanten, relativt. Skal være ~0. */
  residual: number;
}

export interface MissingField {
  field: string;
  reason: string;
}

export type ForceSystemOutcome = ForceSystemResult | { status: "missing"; missing: MissingField[] };

const RAD = Math.PI / 180;
const normAngle = (deg: number) => {
  const a = ((((deg + 180) % 360) + 360) % 360) - 180;
  return a === -180 ? 180 : a + 0;
};

/** Komponentene til én kraft, eller hva som mangler. */
export function forceComponents(f: ForceSpec): ForceComponents | MissingField[] {
  const ways = [f.components !== undefined, f.angle_deg !== undefined, f.direction !== undefined].filter(Boolean).length;
  if (ways > 1) return [{ field: `${f.id}`, reason: "Oppgi kraften på én måte: components, magnitude + angle_deg, eller magnitude + direction." }];
  if (f.components) {
    const { Fx, Fz } = f.components;
    return { id: f.id, Fx, Fz, magnitude: Math.hypot(Fx, Fz), angle_deg: normAngle(Math.atan2(Fz, Fx) / RAD) };
  }
  if (f.magnitude === undefined) return [{ field: `${f.id}.magnitude`, reason: "Størrelsen på kraften står ikke i oppgaven." }];
  if (f.angle_deg !== undefined) {
    const a = f.angle_deg * RAD;
    return { id: f.id, Fx: f.magnitude * Math.cos(a), Fz: f.magnitude * Math.sin(a), magnitude: f.magnitude, angle_deg: normAngle(f.angle_deg) };
  }
  if (f.direction) {
    const L = Math.hypot(f.direction.dx, f.direction.dz);
    if (!(L > 0)) return [{ field: `${f.id}.direction`, reason: "Retningsvektoren kan ikke være null." }];
    const Fx = (f.magnitude * f.direction.dx) / L;
    const Fz = (f.magnitude * f.direction.dz) / L;
    return { id: f.id, Fx, Fz, magnitude: f.magnitude, angle_deg: normAngle(Math.atan2(Fz, Fx) / RAD) };
  }
  return [{ field: `${f.id}.direction`, reason: "Retningen på kraften mangler (vinkel, helning eller punkt den peker mot)." }];
}

/** Løser kraftsystemet. Tallene er i oppgavens enheter. */
export function solveForceSystem(input: ForceSystemInput): ForceSystemOutcome {
  const missing: MissingField[] = [];
  const forces: ForceComponents[] = [];
  const ids = new Set<string>();
  for (const f of input.forces) {
    if (ids.has(f.id)) missing.push({ field: f.id, reason: "To krefter har samme id." });
    ids.add(f.id);
    const c = forceComponents(f);
    if (Array.isArray(c)) missing.push(...c);
    else forces.push(c);
  }
  if (input.moment_about) {
    for (const f of input.forces) if (!f.at) missing.push({ field: `${f.id}.at`, reason: "Angrepspunktet trengs for å regne moment." });
  }
  if (missing.length) return { status: "missing", missing };

  const Rx = forces.reduce((s, f) => s + f.Fx, 0);
  const Rz = forces.reduce((s, f) => s + f.Fz, 0);
  const R = Math.hypot(Rx, Rz);
  const scale = Math.max(1e-300, ...forces.map((f) => f.magnitude));
  // Kontroll: komponentene rekonstruerer størrelsene (fanger feil i dekomponeringen).
  const residual = Math.max(0, ...forces.map((f) => Math.abs(Math.hypot(f.Fx, f.Fz) - f.magnitude) / scale));

  let moment: ForceSystemResult["moment"];
  if (input.moment_about) {
    const o = input.moment_about;
    let M = 0;
    input.forces.forEach((spec, k) => {
      const f = forces[k]!;
      M += (spec.at!.x - o.x) * f.Fz - (spec.at!.z - o.z) * f.Fx;
    });
    moment = { about: o, M };
  }
  const spans = input.forces.flatMap((f) => (f.at ? [Math.abs(f.at.x), Math.abs(f.at.z)] : []));
  const lengthScale = Math.max(1, ...spans);
  const equilibrium = R <= 1e-9 * scale && (!moment || Math.abs(moment.M) <= 1e-9 * scale * lengthScale);
  return {
    status: "ok",
    forces,
    resultant: { Rx, Rz, R, angle_deg: R > 0 ? normAngle(Math.atan2(Rz, Rx) / RAD) : 0 },
    ...(moment ? { moment } : {}),
    equilibrium,
    residual,
  };
}
