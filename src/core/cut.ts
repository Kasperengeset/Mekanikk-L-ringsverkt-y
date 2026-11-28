/**
 * Snitt: et tenkt kutt på tvers av et element. Snittkreftene N, V og M i snittet kommer fra løseren
 * (de samme polynomene som diagrammene), og konstruksjonen deles i to frie legemer, ett på hver side.
 *
 * Fortegn (som i solver/internal.ts): på delen på i-siden virker N langs +x' (strekk trekker ut av
 * snittflaten), −V langs +y' og M mot klokka. På delen på j-siden virker de motsatt (Newtons 3. lov).
 *
 * Et snitt som står nøyaktig der en punktlast eller et moment angriper, gir verdiene like før lasten
 * (på i-siden), og lasten regnes til delen på j-siden. Slik stemmer likevekten for begge delene.
 */
import type { Model } from "./schema.js";
import { evalPoly, type MemberResult, type SolveResult } from "./solver/index.js";
import type { LocalLoad } from "./solver/loads.js";
import { pointLoadComponents, toSI } from "./units.js";

export interface Cut {
  member: string;
  /** Andel av elementlengden fra i-enden. */
  at: number;
}

export interface Vec2 {
  x: number;
  y: number;
}

type OkResult = Extract<SolveResult, { status: "ok" }>;

export interface CutForces {
  member: string;
  /** Meter fra i-enden. */
  x: number;
  N: number;
  V: number;
  M: number;
  /** Snittpunktet i SI. */
  point: Vec2;
  /** Retningen i → j (x'). */
  tangent: Vec2;
  /** 90° mot klokka fra x' (y'). */
  normal: Vec2;
}

/** Snittkreftene i snittet, i SI. undefined når elementet ikke finnes i løsningen. */
export function cutForces(result: OkResult, cut: Cut): CutForces | undefined {
  const m = result.members.find((x) => x.id === cut.member);
  if (!m) return undefined;
  const x = Math.min(1, Math.max(0, cut.at)) * m.length;
  const tol = 1e-12 * m.length;
  const piece = m.pieces.find((p) => x <= p.x1 + tol) ?? m.pieces[m.pieces.length - 1];
  const at = (k: "N" | "V" | "M") => (piece ? evalPoly(piece[k], x) : 0);
  const tangent = { x: m.cos, y: m.sin };
  return {
    member: m.id,
    x,
    N: at("N"),
    V: at("V"),
    M: at("M"),
    point: { x: m.start.x + tangent.x * x, y: m.start.y + tangent.y * x },
    tangent,
    normal: { x: -m.sin, y: m.cos },
  };
}

/** Kraft og moment fra snittet på hver av de to delene (globale akser, SI). */
export function cutActions(f: CutForces): [{ F: Vec2; M: number }, { F: Vec2; M: number }] {
  const F = { x: f.N * f.tangent.x - f.V * f.normal.x, y: f.N * f.tangent.y - f.V * f.normal.y };
  return [
    { F, M: f.M },
    { F: { x: -F.x, y: -F.y }, M: -f.M },
  ];
}

export interface CutParts {
  /** Nodene på i-siden (0) og j-siden (1) av snittet. Er konstruksjonen lukket, inneholder begge alle nodene. */
  nodes: [Set<string>, Set<string>];
  /** true når snittet deler konstruksjonen i to frie legemer. */
  separated: boolean;
  /** Delen hvert element (unntatt det snittede) hører til. Tom når snittet ikke deler konstruksjonen. */
  memberPart: Map<string, 0 | 1>;
}

/** Deler konstruksjonen i delen på i-siden og delen på j-siden av snittet. */
export function cutParts(model: Model, cut: Cut): CutParts {
  const cutMember = model.members.find((m) => m.id === cut.member);
  const reach = (from: string | undefined) => {
    const seen = new Set<string>();
    if (from === undefined) return seen;
    const stack = [from];
    while (stack.length) {
      const n = stack.pop()!;
      if (seen.has(n)) continue;
      seen.add(n);
      for (const m of model.members) {
        if (m.id === cut.member) continue;
        if (m.i === n) stack.push(m.j);
        else if (m.j === n) stack.push(m.i);
      }
    }
    return seen;
  };
  const a = reach(cutMember?.i);
  const separated = cutMember !== undefined && !a.has(cutMember.j);
  const b = separated ? reach(cutMember.j) : a;
  const memberPart = new Map<string, 0 | 1>();
  if (separated) for (const m of model.members) if (m.id !== cut.member) memberPart.set(m.id, a.has(m.i) ? 0 : 1);
  return { nodes: [a, b], separated, memberPart };
}

/** Den delen av en last på det snittede elementet som hører til en side av snittet (lokale akser). */
export function splitLocalLoad(load: LocalLoad, x: number, part: 0 | 1): LocalLoad | undefined {
  if (load.kind !== "dist") {
    const onPart1 = load.x >= x; // en last i snittet regnes til j-siden
    return onPart1 === (part === 1) ? load : undefined;
  }
  const [x1, x2] = part === 0 ? [load.x1, Math.min(load.x2, x)] : [Math.max(load.x1, x), load.x2];
  if (x2 - x1 <= 1e-12 * Math.max(Math.abs(load.x2), 1)) return undefined;
  const lerp = (q: [number, number], s: number) => q[0] + ((q[1] - q[0]) * (s - load.x1)) / (load.x2 - load.x1);
  return { kind: "dist", x1, x2, qa: [lerp(load.qa, x1), lerp(load.qa, x2)], qp: [lerp(load.qp, x1), lerp(load.qp, x2)] };
}

/** Resultant og moment om `about` for en last på et element (globale akser, SI). */
function memberLoadAction(m: MemberResult, load: LocalLoad, about: Vec2): { F: Vec2; M: number } {
  const t = { x: m.cos, y: m.sin };
  const n = { x: -m.sin, y: m.cos };
  const pos = (s: number) => ({ x: m.start.x + t.x * s - about.x, y: m.start.y + t.y * s - about.y });
  const force = (a: number, p: number) => ({ x: a * t.x + p * n.x, y: a * t.y + p * n.y });
  if (load.kind === "moment") return { F: { x: 0, y: 0 }, M: load.M };
  if (load.kind === "point") {
    const F = force(load.Pa, load.Pp);
    const r = pos(load.x);
    return { F, M: r.x * F.y - r.y * F.x };
  }
  // Lineær intensitet: to-punkts Gauss er eksakt for resultanten og momentet.
  const half = (load.x2 - load.x1) / 2;
  const mid = (load.x1 + load.x2) / 2;
  const q = (v: [number, number], s: number) => v[0] + ((v[1] - v[0]) * (s - load.x1)) / (load.x2 - load.x1);
  let F = { x: 0, y: 0 };
  let M = 0;
  for (const g of [-1 / Math.sqrt(3), 1 / Math.sqrt(3)]) {
    const s = mid + g * half;
    const f = force(q(load.qa, s) * half, q(load.qp, s) * half);
    const r = pos(s);
    F = { x: F.x + f.x, y: F.y + f.y };
    M += r.x * f.y - r.y * f.x;
  }
  return { F, M };
}

/**
 * Summen av alle krefter og momenter (om snittpunktet) på den ene delen: laster, opplagerkrefter og
 * snittkreftene. Er null for et riktig fritt legeme. undefined når snittet ikke deler konstruksjonen.
 */
export function freeBodyResidual(model: Model, result: OkResult, cut: Cut, part: 0 | 1): { Fx: number; Fy: number; M: number } | undefined {
  const forces = cutForces(result, cut);
  const parts = cutParts(model, cut);
  if (!forces || !parts.separated) return undefined;
  const si = toSI(model);
  const nodes = parts.nodes[part];
  const O = forces.point;
  let Fx = 0;
  let Fy = 0;
  let M = 0;
  const addForce = (F: Vec2, at: Vec2) => {
    Fx += F.x;
    Fy += F.y;
    M += (at.x - O.x) * F.y - (at.y - O.y) * F.x;
  };
  const nodeAt = (id: string) => si.nodes.find((n) => n.id === id)!;
  for (const load of si.loads) {
    if (load.type === "distributed" || load.node === undefined || !nodes.has(load.node)) continue;
    if (load.type === "point") {
      const { Fx: x, Fy: y } = pointLoadComponents(load.P, load.angle_deg);
      addForce({ x, y }, nodeAt(load.node));
    } else M += load.M;
  }
  for (const m of result.members) {
    const isCut = m.id === cut.member;
    if (!isCut && parts.memberPart.get(m.id) !== part) continue;
    for (const load of m.loads) {
      const piece = isCut ? splitLocalLoad(load, forces.x, part) : load;
      if (!piece) continue;
      const a = memberLoadAction(m, piece, O);
      Fx += a.F.x;
      Fy += a.F.y;
      M += a.M;
    }
  }
  for (const r of result.reactions) {
    if (!nodes.has(r.node)) continue;
    addForce({ x: r.Fx, y: r.Fy }, nodeAt(r.node));
    M += r.M;
  }
  const action = cutActions(forces)[part];
  Fx += action.F.x;
  Fy += action.F.y;
  M += action.M;
  return { Fx, Fy, M };
}

/** Elementet og posisjonen langs det for et punkt (modellkoordinater), eller undefined hvis punktet ikke ligger på et element. */
export function cutAtPoint(model: Model, p: Vec2, preferred?: string): Cut | undefined {
  const span = Math.max(...model.nodes.map((n) => Math.abs(n.x)), ...model.nodes.map((n) => Math.abs(n.y)), 1);
  const tol = 1e-6 * span;
  const node = (id: string) => model.nodes.find((n) => n.id === id);
  const candidates: Cut[] = [];
  for (const m of model.members) {
    const a = node(m.i);
    const b = node(m.j);
    if (!a || !b) continue;
    const d = { x: b.x - a.x, y: b.y - a.y };
    const L2 = d.x * d.x + d.y * d.y;
    if (L2 === 0) continue;
    const t = ((p.x - a.x) * d.x + (p.y - a.y) * d.y) / L2;
    if (t <= 0 || t >= 1) continue;
    const dist = Math.abs((p.x - a.x) * d.y - (p.y - a.y) * d.x) / Math.sqrt(L2);
    if (dist <= tol) candidates.push({ member: m.id, at: t });
  }
  return candidates.find((c) => c.member === preferred) ?? candidates[0];
}

/**
 * Snittet i gjeldende modell. Elementet kan ha fått ny id (f.eks. når to elementer slås sammen mens
 * en last dras); da finnes snittet igjen fra punktet det sto i.
 */
export function resolveCut(model: Model, cut: Cut & { point?: Vec2 }): Cut | undefined {
  if (model.members.some((m) => m.id === cut.member)) return { member: cut.member, at: Math.min(1, Math.max(0, cut.at)) };
  return cut.point ? cutAtPoint(model, cut.point) : undefined;
}
