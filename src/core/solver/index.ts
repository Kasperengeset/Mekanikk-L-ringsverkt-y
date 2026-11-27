/**
 * Løseren: direkte stivhetsmetode for plane rammer og fagverk.
 *
 * Fremgangsmåte:
 *  1. Validering (referanser, geometri, n_s). Ugyldige modeller løses ikke.
 *  2. Modellen gjøres om til SI. Hvert element gir stivhet og ekvivalente nodelaster i globale akser.
 *     Momentledd kondenseres bort på elementnivå.
 *  3. Noder med skrått rullelager får (u, v) rotert til underlagets akser (t, n), så n kan holdes fast.
 *  4. Rotasjoner uten stiv bjelkeende (rene fagverksnoder, ledd i alle ender) holdes fast, ellers blir
 *     K singulær uten at konstruksjonen er en mekanisme.
 *  5. K_ff u_f = f_f løses. Singulær K_ff betyr mekanisme, og frihetsgraden rapporteres.
 *  6. Reaksjoner, endekrefter og eksakte snittkrefter langs hvert element.
 *  7. Selvkontroll: ΣFx, ΣFy og ΣM om origo for påførte laster og reaksjoner må være null
 *     innenfor 1e-9 relativt. Ellers vises ingen resultater.
 *
 * Alle resultater er i SI (N, m, Nm).
 */
import type { Model } from "../schema.js";
import { pointLoadComponents, toSI } from "../units.js";
import { validateModel, type Determinacy, type Issue } from "../validate.js";
import { DEFAULT_SECTION, resolveSection, type ResolvedSection } from "../sections.js";
import { condense, localStiffness, mulMatVec, toGlobal, transformation, vecToGlobal } from "./element.js";
import { deflection, type DeflectionPiece } from "./deflection.js";
import { evalPoly, extremes, internalForces, type Extremes, type Piece } from "./internal.js";
import { solveDense, zeros } from "./linalg.js";
import { distributedDirection, equivalentNodalLoads, toLocal, type LocalLoad } from "./loads.js";

export type { Extremes, Piece } from "./internal.js";
export type { DeflectionPiece } from "./deflection.js";
export { evalPoly } from "./internal.js";

export interface Reaction {
  node: string;
  Fx: number;
  Fy: number;
  M: number;
}

export interface MemberResult {
  id: string;
  kind: "beam" | "truss";
  length: number;
  /** Retningen i → j. */
  cos: number;
  sin: number;
  /** Krefter som virker på elementendene, lokale akser: [N1, V1, M1, N2, V2, M2]. */
  endForces: number[];
  pieces: Piece[];
  extremes: Extremes;
  /** Lastene på elementet i lokale akser (for tegning og videre beregninger). */
  loads: LocalLoad[];
  /** Startnoden (i) i SI. */
  start: { x: number; y: number };
  /** Tverrsnittsdata som ble brukt. */
  section: ResolvedSection;
  /** Deformert form langs elementet i lokale akser. */
  deflection: DeflectionPiece[];
}

export interface Equilibrium {
  Fx: number;
  Fy: number;
  M: number;
  /** Største relative avvik (krefter mot summen av alle krefter, moment mot summen av alle momenter). */
  relative: number;
}

export type DofComponent = "ux" | "uy" | "rz" | "ut" | "un";

export type SolveResult =
  | {
      status: "ok";
      determinacy: Determinacy;
      displacements: Record<string, { ux: number; uy: number; rz: number }>;
      reactions: Reaction[];
      members: MemberResult[];
      equilibrium: Equilibrium;
      /** true når minst ett element mangler oppgitt tverrsnitt: formen er riktig, men ikke størrelsen. */
      deformationQualitative: boolean;
    }
  | { status: "invalid"; issues: Issue[] }
  | { status: "mechanism"; determinacy: Determinacy; node: string; component: DofComponent; message: string }
  | { status: "equilibrium_failed"; equilibrium: Equilibrium };

export const EQUILIBRIUM_TOL = 1e-9;

interface Element {
  id: string;
  i: number;
  j: number;
  kind: "beam" | "truss";
  L: number;
  c: number;
  s: number;
  k: Float64Array[];
  f: Float64Array;
  T: Float64Array[];
  loads: LocalLoad[];
  section: ResolvedSection;
}

export function solve(model: Model): SolveResult {
  const validation = validateModel(model);
  if (!validation.ok || !validation.determinacy) return { status: "invalid", issues: validation.issues };
  const determinacy = validation.determinacy;
  const si = toSI(model);

  const index = new Map(si.nodes.map((n, k) => [n.id, k]));
  const nodes = si.nodes;
  const ndof = 3 * nodes.length;
  const sections = new Map<string, ResolvedSection>(si.sections.map((s) => [s.id, resolveSection(s)]));

  // --- Elementer og laster på elementer
  const elements: Element[] = si.members.map((m) => {
    const a = nodes[index.get(m.i)!]!;
    const b = nodes[index.get(m.j)!]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const L = Math.hypot(dx, dy);
    const c = dx / L;
    const s = dy / L;
    const loads: LocalLoad[] = [];
    for (const load of si.loads) {
      if (load.type === "distributed") {
        if (load.member !== m.id) continue;
        const [gx, gy] = distributedDirection(load, c, s);
        const [ua, up] = toLocal(gx, gy, c, s);
        loads.push({
          kind: "dist",
          x1: load.from * L,
          x2: load.to * L,
          qa: [ua * load.w_start, ua * load.w_end],
          qp: [up * load.w_start, up * load.w_end],
        });
      } else if (load.member === m.id && load.at !== undefined) {
        if (load.type === "point") {
          const { Fx, Fy } = pointLoadComponents(load.P, load.angle_deg);
          const [Pa, Pp] = toLocal(Fx, Fy, c, s);
          loads.push({ kind: "point", x: load.at * L, Pa, Pp });
        } else loads.push({ kind: "moment", x: load.at * L, M: load.M });
      }
    }
    const section = (m.section !== undefined && sections.get(m.section)) || DEFAULT_SECTION;
    const truss = m.kind === "truss";
    let k = localStiffness(m.kind, section, L);
    let f = equivalentNodalLoads(loads, L, truss);
    const released = truss ? [] : [...(m.release?.i ? [2] : []), ...(m.release?.j ? [5] : [])];
    if (released.length) ({ k, f } = condense(k, f, released));
    return { id: m.id, i: index.get(m.i)!, j: index.get(m.j)!, kind: m.kind, L, c, s, k, f, T: transformation(c, s), loads, section };
  });

  // --- Global stivhet og last
  const K = zeros(ndof, ndof);
  const F = new Float64Array(ndof);
  for (const e of elements) {
    const kg = toGlobal(e.k, e.T);
    const fg = vecToGlobal(e.f, e.T);
    const dofs = [3 * e.i, 3 * e.i + 1, 3 * e.i + 2, 3 * e.j, 3 * e.j + 1, 3 * e.j + 2];
    for (let a = 0; a < 6; a++) {
      F[dofs[a]!]! += fg[a]!;
      for (let b = 0; b < 6; b++) K[dofs[a]!]![dofs[b]!]! += kg[a]![b]!;
    }
  }
  for (const load of si.loads) {
    if (load.type === "distributed" || load.node === undefined) continue;
    const n = index.get(load.node)!;
    if (load.type === "point") {
      const { Fx, Fy } = pointLoadComponents(load.P, load.angle_deg);
      F[3 * n]! += Fx;
      F[3 * n + 1]! += Fy;
    } else F[3 * n + 2]! += load.M;
  }

  // --- Skrå rullelagre: roter (u, v) til (t, n) i noden
  const rotated = new Map<number, { c: number; s: number }>();
  for (const sup of si.supports) {
    if (sup.type !== "roller") continue;
    const a = ((sup.angle_deg ?? 0) * Math.PI) / 180;
    if (Math.abs(Math.sin(a)) < 1e-15) continue;
    rotated.set(index.get(sup.node)!, { c: Math.cos(a), s: Math.sin(a) });
  }
  for (const [n, { c, s }] of rotated) {
    const u = 3 * n;
    const v = u + 1;
    for (const row of K) {
      const ru = row[u]!;
      const rv = row[v]!;
      row[u] = c * ru + s * rv;
      row[v] = -s * ru + c * rv;
    }
    const ru = K[u]!;
    const rv = K[v]!;
    for (let col = 0; col < ndof; col++) {
      const a = ru[col]!;
      const b = rv[col]!;
      ru[col] = c * a + s * b;
      rv[col] = -s * a + c * b;
    }
    const fu = F[u]!;
    const fv = F[v]!;
    F[u] = c * fu + s * fv;
    F[v] = -s * fu + c * fv;
  }

  // --- Fastholdte frihetsgrader
  const restrained = new Set<number>();
  for (const sup of si.supports) {
    const n = index.get(sup.node)!;
    if (sup.type === "fixed") [0, 1, 2].forEach((d) => restrained.add(3 * n + d));
    else if (sup.type === "pinned") [0, 1].forEach((d) => restrained.add(3 * n + d));
    else restrained.add(3 * n + 1); // n-retningen (lik y for horisontalt underlag)
  }
  const rigidEnds = new Array(nodes.length).fill(0);
  for (const m of si.members) {
    if (m.kind === "truss") continue;
    if (!m.release?.i) rigidEnds[index.get(m.i)!]++;
    if (!m.release?.j) rigidEnds[index.get(m.j)!]++;
  }
  const inactive = new Set<number>();
  for (let n = 0; n < nodes.length; n++) {
    const dof = 3 * n + 2;
    if (rigidEnds[n] > 0 || restrained.has(dof)) continue;
    if (Math.abs(F[dof]!) > 0) {
      return {
        status: "mechanism",
        determinacy,
        node: nodes[n]!.id,
        component: "rz",
        message: `Momentet i ${nodes[n]!.id} kan ikke tas opp: ingen bjelke er stivt koblet til noden.`,
      };
    }
    inactive.add(dof);
  }

  // --- Løs K_ff u_f = f_f
  const free: number[] = [];
  for (let d = 0; d < ndof; d++) if (!restrained.has(d) && !inactive.has(d)) free.push(d);
  const Kff = free.map((r) => Float64Array.from(free, (c) => K[r]![c]!));
  const ff = Float64Array.from(free, (r) => F[r]!);
  const solution = solveDense(Kff, ff);
  if ("singular" in solution) {
    const dof = free[solution.singular]!;
    const n = Math.floor(dof / 3);
    const comp = dof % 3;
    const component: DofComponent = comp === 2 ? "rz" : rotated.has(n) ? (comp === 0 ? "ut" : "un") : comp === 0 ? "ux" : "uy";
    const what = { ux: "horisontalt", uy: "vertikalt", rz: "som rotasjon", ut: "langs underlaget", un: "normalt på underlaget" }[component];
    return {
      status: "mechanism",
      determinacy,
      node: nodes[n]!.id,
      component,
      message: `Konstruksjonen er en mekanisme: den kan bevege seg ${what} i ${nodes[n]!.id} uten motstand.`,
    };
  }
  const uRot = new Float64Array(ndof);
  free.forEach((d, k) => (uRot[d] = solution.x[k]!));

  // --- Reaksjoner (i rotert system), og tilbake til globale akser
  const Ku = mulMatVec(K, uRot);
  const rRot = new Float64Array(ndof);
  for (const d of restrained) rRot[d] = Ku[d]! - F[d]!;
  const u = Float64Array.from(uRot);
  const r = Float64Array.from(rRot);
  for (const [n, { c, s }] of rotated) {
    for (const vec of [u, r]) {
      const t = vec[3 * n]!;
      const nn = vec[3 * n + 1]!;
      vec[3 * n] = c * t - s * nn;
      vec[3 * n + 1] = s * t + c * nn;
    }
  }

  const reactions: Reaction[] = si.supports.map((sup) => {
    const n = index.get(sup.node)!;
    return { node: sup.node, Fx: r[3 * n]!, Fy: r[3 * n + 1]!, M: sup.type === "fixed" ? r[3 * n + 2]! : 0 };
  });

  // --- Endekrefter og snittkrefter
  const members: MemberResult[] = elements.map((e) => {
    const dg = [3 * e.i, 3 * e.i + 1, 3 * e.i + 2, 3 * e.j, 3 * e.j + 1, 3 * e.j + 2].map((d) => u[d]!);
    const dl = mulMatVec(e.T, dg);
    const kd = mulMatVec(e.k, dl);
    const p = Array.from(kd, (v, a) => v - e.f[a]!);
    const pieces = internalForces(p, e.loads, e.L);
    const shape = deflection(pieces, dl, e.L, e.section.E * e.section.I, e.section.E * e.section.A, e.kind === "truss");
    const start = nodes[e.i]!;
    return {
      id: e.id,
      kind: e.kind,
      length: e.L,
      cos: e.c,
      sin: e.s,
      endForces: p,
      pieces,
      extremes: extremes(pieces),
      loads: e.loads,
      start: { x: start.x, y: start.y },
      section: e.section,
      deflection: shape,
    };
  });

  const equilibrium = checkEquilibrium(si, elements, reactions, index);
  if (equilibrium.relative > EQUILIBRIUM_TOL) return { status: "equilibrium_failed", equilibrium };

  const displacements: Record<string, { ux: number; uy: number; rz: number }> = {};
  nodes.forEach((n, k) => (displacements[n.id] = { ux: u[3 * k]!, uy: u[3 * k + 1]!, rz: inactive.has(3 * k + 2) ? 0 : u[3 * k + 2]! }));
  const deformationQualitative = elements.some((e) => e.section.assumed);
  return { status: "ok", determinacy, displacements, reactions, members, equilibrium, deformationQualitative };
}

/**
 * Punkt på den deformerte formen i globale koordinater (SI), x meter fra i-enden.
 * `scale` forstørrer forskyvningene for tegning.
 */
export function displacedPoint(m: MemberResult, x: number, scale = 1): { x: number; y: number } {
  const piece = m.deflection.find((p) => x <= p.x1 + 1e-12) ?? m.deflection[m.deflection.length - 1]!;
  const u = evalPoly(piece.u, x) * scale;
  const w = evalPoly(piece.w, x) * scale;
  return { x: m.start.x + (x + u) * m.cos - w * m.sin, y: m.start.y + (x + u) * m.sin + w * m.cos };
}

/** ΣFx, ΣFy og ΣM om origo for alle påførte laster og reaksjoner, regnet direkte fra modellen. */
function checkEquilibrium(si: Model, elements: Element[], reactions: Reaction[], index: Map<string, number>): Equilibrium {
  let Fx = 0;
  let Fy = 0;
  let M = 0;
  let scaleF = 0;
  let scaleM = 0;
  const force = (x: number, y: number, fx: number, fy: number) => {
    Fx += fx;
    Fy += fy;
    const m = x * fy - y * fx;
    M += m;
    scaleF += Math.hypot(fx, fy);
    scaleM += Math.abs(m);
  };
  const moment = (m: number) => {
    M += m;
    scaleM += Math.abs(m);
  };
  for (const load of si.loads) {
    if (load.type !== "distributed" && load.node !== undefined) {
      const n = si.nodes[index.get(load.node)!]!;
      if (load.type === "point") {
        const { Fx: fx, Fy: fy } = pointLoadComponents(load.P, load.angle_deg);
        force(n.x, n.y, fx, fy);
      } else moment(load.M);
    }
  }
  for (const e of elements) {
    const origin = si.nodes[e.i]!;
    const at = (x: number) => [origin.x + e.c * x, origin.y + e.s * x] as const;
    const globalVec = (a: number, p: number) => [a * e.c - p * e.s, a * e.s + p * e.c] as const;
    for (const l of e.loads) {
      if (l.kind === "point") force(...at(l.x), ...globalVec(l.Pa, l.Pp));
      else if (l.kind === "moment") moment(l.M);
      else {
        const half = (l.x2 - l.x1) / 2;
        const mid = (l.x1 + l.x2) / 2;
        for (const [g, w] of [
          [-Math.sqrt(3 / 5), 5 / 9],
          [0, 8 / 9],
          [Math.sqrt(3 / 5), 5 / 9],
        ] as const) {
          const x = mid + g * half;
          const t = (x - l.x1) / (l.x2 - l.x1);
          const qa = l.qa[0] + (l.qa[1] - l.qa[0]) * t;
          const qp = l.qp[0] + (l.qp[1] - l.qp[0]) * t;
          const [gx, gy] = globalVec(qa * w * half, qp * w * half);
          force(...at(x), gx, gy);
        }
      }
    }
  }
  for (const r of reactions) {
    const n = si.nodes[index.get(r.node)!]!;
    force(n.x, n.y, r.Fx, r.Fy);
    moment(r.M);
  }
  const relF = scaleF > 0 ? Math.max(Math.abs(Fx), Math.abs(Fy)) / scaleF : 0;
  const relM = scaleM > 0 ? Math.abs(M) / scaleM : 0;
  return { Fx, Fy, M, relative: Math.max(relF, relM) };
}
