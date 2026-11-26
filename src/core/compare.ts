/**
 * Sammenligner to modeller entitet for entitet. Brukes av eval-skriptet (tolkning mot fasit) og
 * av self-consistency (flere tolkninger mot hverandre).
 *
 * Sammenligningen er fysisk, ikke tekstlig. Før den matcher, gjøres begge modellene om til en
 * kanonisk form, slik at ekvivalente skrivemåter regnes som like:
 *  - enheter (mm/m, N/kN) og plassering av origo,
 *  - retningen i→j på elementer,
 *  - en ekstra node midt på en rett bjelke (f.eks. der en punktlast står) mot en last på elementet,
 *  - P/vinkel-varianter av samme kraft, og fordelt last i global eller lokal retning,
 *  - en fordelt last delt i flere biter mot én last,
 *  - momentledd på ulike elementender som gir samme ledd i noden,
 *  - en bjelke med ledd i begge ender og uten last mot en fagverksstav.
 */
import type { Model, SupportType } from "./schema";
import { pointLoadComponents, toSI } from "./units";

export type CompareKind = "node" | "member" | "section" | "support" | "hinge" | "load";
export type MatchStatus = "match" | "mismatch" | "missing" | "extra";

export interface EntityComparison {
  kind: CompareKind;
  status: MatchStatus;
  /** Ids i referansemodellen (fasiten). Flere når elementer er slått sammen. */
  truthIds: string[];
  /** Ids i modellen som sammenlignes. */
  candidateIds: string[];
  detail?: string;
}

export interface KindCounts {
  tp: number;
  fp: number;
  fn: number;
}

export interface CompareResult {
  /** Alle entiteter stemmer: modellen er topologisk og numerisk lik referansen. */
  exact: boolean;
  entities: EntityComparison[];
  counts: Record<CompareKind, KindCounts>;
}

export interface CompareOptions {
  /** Toleranse for posisjoner, relativt til konstruksjonens største mål. */
  geometryTol?: number;
  /** Relativ toleranse for lastverdier og tverrsnittsdata. */
  valueTol?: number;
  /** Toleranse for vinkelen på skrå rullelagre, i grader. */
  angleTolDeg?: number;
}

export const COMPARE_KINDS: CompareKind[] = ["node", "member", "section", "support", "hinge", "load"];

// ---------------------------------------------------------------------------------------------
// Kanonisk form

interface CNode {
  id: string;
  x: number;
  y: number;
}

interface CSection {
  E: number;
  A: number;
  I: number;
  assumed: boolean;
}

interface CMember {
  uid: number;
  ids: string[];
  a: string;
  b: string;
  truss: boolean;
  releaseA: boolean;
  releaseB: boolean;
  section?: CSection;
}

type Loc = { node: string } | { member: number; s: number };

interface CPoint {
  type: "point";
  ids: string[];
  loc: Loc;
  Fx: number;
  Fy: number;
}

interface CMoment {
  type: "moment";
  ids: string[];
  loc: Loc;
  M: number;
}

/** Fordelt last i elementets lokale akser (aksialt og vinkelrett), per lengde langs elementet. */
interface CDist {
  type: "distributed";
  ids: string[];
  member: number;
  from: number;
  to: number;
  qa: [number, number];
  qp: [number, number];
}

type CLoad = CPoint | CMoment | CDist;

interface CSupport {
  type: SupportType;
  angle: number;
}

interface Canonical {
  nodes: Map<string, CNode>;
  members: CMember[];
  supports: Map<string, CSupport>;
  loads: CLoad[];
  extent: number;
}

const isNodeLoc = (loc: Loc): loc is { node: string } => "node" in loc;

function geometry(c: Pick<Canonical, "nodes">, m: CMember) {
  const a = c.nodes.get(m.a)!;
  const b = c.nodes.get(m.b)!;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const L = Math.hypot(dx, dy);
  return { dx, dy, L, cos: dx / L, sin: dy / L };
}

/** Projiserer en global vektor inn i elementets lokale akser. */
function toLocal(gx: number, gy: number, cos: number, sin: number): [number, number] {
  return [gx * cos + gy * sin, -gx * sin + gy * cos];
}

function canonicalize(model: Model, geometryTol: number): Canonical {
  const si = toSI(model);
  const nodes = new Map(si.nodes.map((n) => [n.id, { id: n.id, x: n.x, y: n.y }]));
  const xs = si.nodes.map((n) => n.x);
  const ys = si.nodes.map((n) => n.y);
  const extent = Math.max(Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)), 1e-9);
  const tol = geometryTol * extent;

  // Kanonisk retning: a er noden med minst x (eller minst y når x er lik innenfor toleransen).
  const before = (p: CNode, q: CNode) => (Math.abs(p.x - q.x) > tol ? p.x < q.x : p.y < q.y);

  const sections = new Map(si.sections.map((s) => [s.id, { E: s.E, A: s.A, I: s.I, assumed: s.assumed }]));
  const members: CMember[] = [];
  const byId = new Map<string, { member: CMember; flip: boolean; cos: number; sin: number }>();
  let uid = 0;
  for (const m of si.members) {
    const ni = nodes.get(m.i);
    const nj = nodes.get(m.j);
    if (!ni || !nj || ni === nj) continue; // ugyldig element; fanges av validateModel
    const flip = before(nj, ni);
    const member: CMember = {
      uid: uid++,
      ids: [m.id],
      a: flip ? m.j : m.i,
      b: flip ? m.i : m.j,
      truss: m.kind === "truss",
      releaseA: m.kind === "beam" && !!(flip ? m.release?.j : m.release?.i),
      releaseB: m.kind === "beam" && !!(flip ? m.release?.i : m.release?.j),
      section: m.section !== undefined ? sections.get(m.section) : undefined,
    };
    const L = Math.hypot(nj.x - ni.x, nj.y - ni.y);
    members.push(member);
    byId.set(m.id, { member, flip, cos: (nj.x - ni.x) / L, sin: (nj.y - ni.y) / L });
  }

  const loads: CLoad[] = [];
  for (const load of si.loads) {
    if (load.type === "distributed") {
      const ref = byId.get(load.member);
      if (!ref) continue;
      const { cos, sin } = ref; // original retning i→j
      let gx: number;
      let gy: number;
      if (load.direction === "local_y") [gx, gy] = [-sin, cos];
      else if (load.direction === "global_y") [gx, gy] = [0, load.basis === "projection" ? Math.abs(cos) : 1];
      else [gx, gy] = [load.basis === "projection" ? Math.abs(sin) : 1, 0];
      const g = geometry({ nodes }, ref.member);
      const unit = toLocal(gx, gy, g.cos, g.sin);
      const [w0, w1] = ref.flip ? [load.w_end, load.w_start] : [load.w_start, load.w_end];
      loads.push({
        type: "distributed",
        ids: [load.id],
        member: ref.member.uid,
        from: ref.flip ? 1 - load.to : load.from,
        to: ref.flip ? 1 - load.from : load.to,
        qa: [unit[0] * w0, unit[0] * w1],
        qp: [unit[1] * w0, unit[1] * w1],
      });
      continue;
    }
    let loc: Loc;
    if (load.node !== undefined) {
      if (!nodes.has(load.node)) continue;
      loc = { node: load.node };
    } else {
      const ref = load.member !== undefined ? byId.get(load.member) : undefined;
      if (!ref || load.at === undefined) continue;
      loc = { member: ref.member.uid, s: ref.flip ? 1 - load.at : load.at };
    }
    if (load.type === "point") loads.push({ type: "point", ids: [load.id], loc, ...pointLoadComponents(load.P, load.angle_deg) });
    else loads.push({ type: "moment", ids: [load.id], loc, M: load.M });
  }

  const supports = new Map(si.supports.filter((s) => nodes.has(s.node)).map((s) => [s.node, { type: s.type, angle: s.angle_deg ?? 0 }]));
  const c: Canonical = { nodes, members, supports, loads, extent };

  trussify(c);
  snapEndLoads(c, tol);
  return c;
}

function memberLoads(c: Canonical, uid: number): CLoad[] {
  return c.loads.filter((l) => (l.type === "distributed" ? l.member === uid : !isNodeLoc(l.loc) && l.loc.member === uid));
}

/** En bjelke med ledd i begge ender og uten last på elementet er en fagverksstav. */
function trussify(c: Canonical) {
  for (const m of c.members) {
    if (m.truss) continue;
    if (m.releaseA && m.releaseB && memberLoads(c, m.uid).length === 0) {
      m.truss = true;
      m.releaseA = false;
      m.releaseB = false;
    }
  }
}

/** Punktlast og moment helt i enden av et element flyttes til noden. */
function snapEndLoads(c: Canonical, tol: number) {
  const byUid = new Map(c.members.map((m) => [m.uid, m]));
  for (const load of c.loads) {
    if (load.type === "distributed" || isNodeLoc(load.loc)) continue;
    const m = byUid.get(load.loc.member)!;
    const { L } = geometry(c, m);
    if (load.loc.s * L <= tol) load.loc = { node: m.a };
    else if ((1 - load.loc.s) * L <= tol) load.loc = { node: m.b };
  }
}

function sameSection(p?: CSection, q?: CSection): boolean {
  if (!p || !q) return p === q;
  return p.E === q.E && p.A === q.A && p.I === q.I && p.assumed === q.assumed;
}

/**
 * Slår sammen to rette bjelkeelementer som møtes i en node uten opplager, ledd eller andre
 * elementer. Noden er da bare et lastpunkt, og lastene flyttes inn på det sammenslåtte elementet.
 */
/** De to elementene som går rett gjennom noden, hvis noden bare er et lastpunkt på en rett bjelke. */
function passThrough(c: Canonical, nodeId: string, tol: number): [CMember, CMember] | undefined {
  if (c.supports.has(nodeId)) return undefined;
  const attached = c.members.filter((m) => m.a === nodeId || m.b === nodeId);
  if (attached.length !== 2) return undefined;
  const m1 = attached.find((m) => m.b === nodeId);
  const m2 = attached.find((m) => m.a === nodeId);
  if (!m1 || !m2 || m1 === m2 || m1.truss || m2.truss) return undefined;
  if (m1.releaseB || m2.releaseA || !sameSection(m1.section, m2.section)) return undefined;
  const g1 = geometry(c, m1);
  const g2 = geometry(c, m2);
  const cross = g1.cos * g2.sin - g1.sin * g2.cos;
  const dot = g1.cos * g2.cos + g1.sin * g2.sin;
  if (dot <= 0 || Math.abs(cross) * Math.min(g1.L, g2.L) > tol) return undefined;
  return [m1, m2];
}

/** Slår sammen elementer gjennom noder som bare er lastpunkter, unntatt nodene i `keep`. */
function mergePassThroughNodes(c: Canonical, tol: number, keep: Set<string>) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of c.nodes.values()) {
      if (keep.has(node.id)) continue;
      const pair = passThrough(c, node.id, tol);
      if (!pair) continue;
      const [m1, m2] = pair;
      const g1 = geometry(c, m1);
      const g2 = geometry(c, m2);
      const L = g1.L + g2.L;
      const r1 = g1.L / L;
      const merged: CMember = {
        uid: Math.max(...c.members.map((m) => m.uid)) + 1,
        ids: [...m1.ids, ...m2.ids],
        a: m1.a,
        b: m2.b,
        truss: false,
        releaseA: m1.releaseA,
        releaseB: m2.releaseB,
        section: m1.section,
      };
      const map1 = (s: number) => s * r1;
      const map2 = (s: number) => r1 + s * (1 - r1);
      for (const load of c.loads) {
        if (load.type === "distributed") {
          if (load.member === m1.uid) Object.assign(load, { member: merged.uid, from: map1(load.from), to: map1(load.to) });
          else if (load.member === m2.uid) Object.assign(load, { member: merged.uid, from: map2(load.from), to: map2(load.to) });
        } else if (isNodeLoc(load.loc)) {
          if (load.loc.node === node.id) load.loc = { member: merged.uid, s: r1 };
        } else if (load.loc.member === m1.uid) load.loc = { member: merged.uid, s: map1(load.loc.s) };
        else if (load.loc.member === m2.uid) load.loc = { member: merged.uid, s: map2(load.loc.s) };
      }
      c.members = c.members.filter((m) => m !== m1 && m !== m2).concat(merged);
      c.nodes.delete(node.id);
      changed = true;
      break;
    }
  }
}

const close = (p: number, q: number, tol: number) => Math.abs(p - q) <= tol;

function sameLoc(c: Canonical, p: Loc, q: Loc, tol: number): boolean {
  if (isNodeLoc(p) || isNodeLoc(q)) return isNodeLoc(p) && isNodeLoc(q) && p.node === q.node;
  if (p.member !== q.member) return false;
  const m = c.members.find((x) => x.uid === p.member)!;
  return Math.abs(p.s - q.s) * geometry(c, m).L <= tol;
}

/** Summerer laster i samme punkt og slår sammen fordelte laster som henger sammen lineært. */
function combineLoads(c: Canonical, tol: number) {
  const out: CLoad[] = [];
  for (const load of c.loads) {
    if (load.type === "distributed") {
      const L = geometry(c, c.members.find((m) => m.uid === load.member)!).L;
      const same = out.find(
        (o): o is CDist =>
          o.type === "distributed" &&
          o.member === load.member &&
          close(o.from * L, load.from * L, tol) &&
          close(o.to * L, load.to * L, tol),
      );
      if (same) {
        same.ids.push(...load.ids);
        same.qa = [same.qa[0] + load.qa[0], same.qa[1] + load.qa[1]];
        same.qp = [same.qp[0] + load.qp[0], same.qp[1] + load.qp[1]];
      } else out.push({ ...load, ids: [...load.ids], qa: [...load.qa], qp: [...load.qp] });
      continue;
    }
    const same = out.find((o) => o.type === load.type && sameLoc(c, (o as CPoint | CMoment).loc, load.loc, tol));
    if (same && same.type === "point" && load.type === "point") {
      same.ids.push(...load.ids);
      same.Fx += load.Fx;
      same.Fy += load.Fy;
    } else if (same && same.type === "moment" && load.type === "moment") {
      same.ids.push(...load.ids);
      same.M += load.M;
    } else out.push({ ...load, ids: [...load.ids] });
  }

  // Fordelte laster som ligger kant i kant med samme lineære intensitet blir én last.
  const dists = out.filter((l): l is CDist => l.type === "distributed").sort((p, q) => p.member - q.member || p.from - q.from);
  const merged: CDist[] = [];
  for (const d of dists) {
    const prev = merged[merged.length - 1];
    if (prev && prev.member === d.member) {
      const L = geometry(c, c.members.find((m) => m.uid === d.member)!).L;
      const scale = Math.max(...prev.qa.map(Math.abs), ...prev.qp.map(Math.abs), ...d.qa.map(Math.abs), ...d.qp.map(Math.abs), 1e-12);
      const slope = (q: [number, number], from: number, to: number) => (q[1] - q[0]) / ((to - from) * L);
      const continuous =
        close(prev.to * L, d.from * L, tol) &&
        close(prev.qa[1], d.qa[0], 1e-6 * scale) &&
        close(prev.qp[1], d.qp[0], 1e-6 * scale) &&
        close(slope(prev.qa, prev.from, prev.to) * L, slope(d.qa, d.from, d.to) * L, 1e-6 * scale) &&
        close(slope(prev.qp, prev.from, prev.to) * L, slope(d.qp, d.from, d.to) * L, 1e-6 * scale);
      if (continuous) {
        prev.ids.push(...d.ids);
        prev.to = d.to;
        prev.qa = [prev.qa[0], d.qa[1]];
        prev.qp = [prev.qp[0], d.qp[1]];
        continue;
      }
    }
    merged.push(d);
  }
  c.loads = [...out.filter((l) => l.type !== "distributed"), ...merged];
}

// ---------------------------------------------------------------------------------------------
// Matching

/** Finner forskyvningen som får flest noder til å falle sammen, og parer nodene. */
function alignNodes(truth: Canonical, cand: Canonical, tol: number): Map<string, string> {
  const tNodes = [...truth.nodes.values()];
  const cNodes = [...cand.nodes.values()];
  let best = new Map<string, string>();
  let bestDist = Infinity;
  const tried = new Set<string>();
  for (const t of tNodes) {
    for (const c of cNodes) {
      const sx = t.x - c.x;
      const sy = t.y - c.y;
      const key = `${Math.round(sx / tol)}|${Math.round(sy / tol)}`;
      if (tried.has(key)) continue;
      tried.add(key);
      const mapping = new Map<string, string>();
      const used = new Set<string>();
      let total = 0;
      for (const tn of tNodes) {
        let nearest: CNode | undefined;
        let d = Infinity;
        for (const cn of cNodes) {
          if (used.has(cn.id)) continue;
          const dist = Math.hypot(cn.x + sx - tn.x, cn.y + sy - tn.y);
          if (dist < d) [nearest, d] = [cn, dist];
        }
        if (nearest && d <= tol) {
          mapping.set(nearest.id, tn.id);
          used.add(nearest.id);
          total += d;
        }
      }
      if (mapping.size > best.size || (mapping.size === best.size && total < bestDist)) {
        best = mapping;
        bestDist = total;
      }
    }
  }
  return best;
}

/** Snur et element i kandidatmodellen (a ↔ b) og justerer ledd og laster. */
function flipMember(c: Canonical, m: CMember) {
  [m.a, m.b] = [m.b, m.a];
  [m.releaseA, m.releaseB] = [m.releaseB, m.releaseA];
  for (const load of c.loads) {
    if (load.type === "distributed") {
      if (load.member !== m.uid) continue;
      [load.from, load.to] = [1 - load.to, 1 - load.from];
      load.qa = [-load.qa[1], -load.qa[0]];
      load.qp = [-load.qp[1], -load.qp[0]];
    } else if (!isNodeLoc(load.loc) && load.loc.member === m.uid) load.loc = { member: m.uid, s: 1 - load.loc.s };
  }
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const relClose = (p: number, q: number, rel: number) => Math.abs(p - q) <= rel * Math.max(Math.abs(p), Math.abs(q)) + 1e-12;
const angleClose = (p: number, q: number, tolDeg: number) => {
  const d = (((p - q) % 180) + 180) % 180;
  return Math.min(d, 180 - d) <= tolDeg;
};

/** Hvilke bjelkeender som er stivt koblet sammen i en node. "free" betyr fullt ledd. */
function hingeDescriptor(c: Canonical, nodeId: string, memberKey: (m: CMember) => string) {
  const ends = c.members
    .filter((m) => !m.truss && (m.a === nodeId || m.b === nodeId))
    .map((m) => ({ m, released: m.a === nodeId ? m.releaseA : m.releaseB }));
  const released = ends.filter((e) => e.released);
  const rigid = ends.filter((e) => !e.released).map((e) => memberKey(e.m)).sort();
  const rotational =
    c.supports.get(nodeId)?.type === "fixed" || c.loads.some((l) => l.type === "moment" && isNodeLoc(l.loc) && l.loc.node === nodeId);
  const descriptor = rigid.length >= 2 || (rigid.length === 1 && rotational) ? rigid.join(",") : "free";
  return { descriptor, released: released.flatMap((e) => e.m.ids), hasRelease: released.length > 0 };
}

export function compareModels(truthModel: Model, candidateModel: Model, options: CompareOptions = {}): CompareResult {
  const geometryTol = options.geometryTol ?? 0.01;
  const valueTol = options.valueTol ?? 0.01;
  const angleTolDeg = options.angleTolDeg ?? 1;

  const truth = canonicalize(truthModel, geometryTol);
  const cand = canonicalize(candidateModel, geometryTol);
  const tol = geometryTol * Math.max(truth.extent, cand.extent);

  // En node slås bare sammen når motparten i den andre modellen også er et rent lastpunkt (eller
  // ikke finnes). Ellers ville et manglende ledd eller opplager gi følgefeil på noder og elementer.
  const keepTruth = new Set<string>();
  const keepCand = new Set<string>();
  for (const [cId, tId] of alignNodes(truth, cand, tol)) {
    if (!passThrough(truth, tId, tol) !== !passThrough(cand, cId, tol)) {
      keepTruth.add(tId);
      keepCand.add(cId);
    }
  }
  mergePassThroughNodes(truth, tol, keepTruth);
  mergePassThroughNodes(cand, tol, keepCand);
  combineLoads(truth, tol);
  combineLoads(cand, tol);

  const entities: EntityComparison[] = [];
  const push = (kind: CompareKind, status: MatchStatus, truthIds: string[], candidateIds: string[], detail?: string) =>
    entities.push({ kind, status, truthIds, candidateIds, ...(detail ? { detail } : {}) });

  // Noder
  const nodeMap = alignNodes(truth, cand, tol); // kandidat → fasit
  const matchedTruthNodes = new Set(nodeMap.values());
  for (const [cId, tId] of nodeMap) push("node", "match", [tId], [cId]);
  for (const t of truth.nodes.values()) if (!matchedTruthNodes.has(t.id)) push("node", "missing", [t.id], [], `(${fmt(t.x)}, ${fmt(t.y)}) m`);
  for (const c of cand.nodes.values()) if (!nodeMap.has(c.id)) push("node", "extra", [], [c.id], `(${fmt(c.x)}, ${fmt(c.y)}) m`);

  // Elementer
  const truthMembers = new Map(truth.members.map((m) => [pairKey(m.a, m.b), m]));
  const memberMap = new Map<number, CMember>(); // kandidat-uid → fasitelement
  for (const cm of cand.members) {
    const ta = nodeMap.get(cm.a);
    const tb = nodeMap.get(cm.b);
    const tm = ta && tb ? truthMembers.get(pairKey(ta, tb)) : undefined;
    if (!tm || memberMap.has(cm.uid) || [...memberMap.values()].includes(tm)) {
      push("member", "extra", [], cm.ids);
      continue;
    }
    if (ta !== tm.a) flipMember(cand, cm);
    memberMap.set(cm.uid, tm);
    const kindOk = cm.truss === tm.truss;
    push("member", kindOk ? "match" : "mismatch", tm.ids, cm.ids, kindOk ? undefined : `fasit: ${tm.truss ? "stav" : "bjelke"}`);
    if (tm.section && !tm.section.assumed) {
      const cs = cm.section;
      const ok = !!cs && relClose(cs.E, tm.section.E, valueTol) && relClose(cs.A, tm.section.A, valueTol) && relClose(cs.I, tm.section.I, valueTol);
      push("section", cs ? (ok ? "match" : "mismatch") : "missing", tm.ids, cs ? cm.ids : [], ok ? undefined : "E, A eller I avviker");
    } else if (cm.section && !cm.section.assumed) {
      // Oppgaven oppgir ikke tverrsnittet som tall, så LLM-en må ha regnet det ut eller slått det opp.
      push("section", "extra", [], cm.ids, "tverrsnitt som ikke står som tall i oppgaven");
    }
  }
  const matchedTruthMembers = new Set(memberMap.values());
  for (const tm of truth.members) {
    if (matchedTruthMembers.has(tm)) continue;
    push("member", "missing", tm.ids, []);
    if (tm.section && !tm.section.assumed) push("section", "missing", tm.ids, []);
  }

  // Opplagre
  const truthNodeOfCand = (id: string) => nodeMap.get(id);
  const candSupportByTruthNode = new Map<string, [string, CSupport]>();
  for (const [cNode, s] of cand.supports) {
    const tNode = truthNodeOfCand(cNode);
    if (tNode === undefined) push("support", "extra", [], [cNode]);
    else candSupportByTruthNode.set(tNode, [cNode, s]);
  }
  for (const [tNode, ts] of truth.supports) {
    const found = candSupportByTruthNode.get(tNode);
    if (!found) {
      push("support", "missing", [tNode], [], ts.type);
      continue;
    }
    candSupportByTruthNode.delete(tNode);
    const [cNode, cs] = found;
    const ok = cs.type === ts.type && (ts.type !== "roller" || angleClose(cs.angle, ts.angle, angleTolDeg));
    push("support", ok ? "match" : "mismatch", [tNode], [cNode], ok ? undefined : `fasit: ${ts.type}${ts.type === "roller" ? ` ${ts.angle}°` : ""}, tolket: ${cs.type}${cs.type === "roller" ? ` ${cs.angle}°` : ""}`);
  }
  for (const [, [cNode]] of candSupportByTruthNode) push("support", "extra", [], [cNode]);

  // Ledd
  const truthKey = (m: CMember) => pairKey(m.a, m.b);
  const candKey = (m: CMember) => {
    const tm = memberMap.get(m.uid);
    return tm ? truthKey(tm) : `?${m.ids.join("+")}`;
  };
  for (const [cNode, tNode] of nodeMap) {
    const t = hingeDescriptor(truth, tNode, truthKey);
    const c = hingeDescriptor(cand, cNode, candKey);
    if (!t.hasRelease && !c.hasRelease) continue;
    const ok = t.descriptor === c.descriptor;
    push("hinge", ok ? "match" : t.hasRelease && !c.hasRelease ? "missing" : !t.hasRelease ? "extra" : "mismatch", t.released, ok || c.hasRelease ? c.released : [], `node ${tNode}`);
  }

  // Laster: flytt kandidatens laster over i fasitens nummerering
  const translated: CLoad[] = [];
  for (const load of cand.loads) {
    if (load.type === "distributed") {
      const tm = memberMap.get(load.member);
      if (tm) translated.push({ ...load, member: tm.uid });
      else push("load", "extra", [], load.ids, "på element som ikke finnes i fasiten");
      continue;
    }
    let loc: Loc | undefined;
    if (isNodeLoc(load.loc)) {
      const tNode = nodeMap.get(load.loc.node);
      if (tNode) loc = { node: tNode };
    } else {
      const tm = memberMap.get(load.loc.member);
      if (tm) loc = { member: tm.uid, s: load.loc.s };
    }
    if (loc) translated.push({ ...load, loc } as CLoad);
    else push("load", "extra", [], load.ids, "står et sted som ikke finnes i fasiten");
  }

  const used = new Set<CLoad>();
  for (const tl of truth.loads) {
    const sameLocation = translated.filter((cl) => {
      if (used.has(cl) || cl.type !== tl.type) return false;
      if (tl.type === "distributed") {
        const d = cl as CDist;
        const L = geometry(truth, truth.members.find((m) => m.uid === tl.member)!).L;
        return d.member === tl.member && close(d.from * L, tl.from * L, tol) && close(d.to * L, tl.to * L, tol);
      }
      return sameLoc(truth, (cl as CPoint | CMoment).loc, tl.loc, tol);
    });
    const valueOk = (cl: CLoad) => {
      if (tl.type === "point" && cl.type === "point") {
        const mag = Math.hypot(tl.Fx, tl.Fy);
        return Math.hypot(cl.Fx - tl.Fx, cl.Fy - tl.Fy) <= valueTol * mag + 1e-9;
      }
      if (tl.type === "moment" && cl.type === "moment") return relClose(cl.M, tl.M, valueTol);
      if (tl.type === "distributed" && cl.type === "distributed") {
        const scale = Math.max(...tl.qa.map(Math.abs), ...tl.qp.map(Math.abs));
        return [0, 1].every((k) => Math.abs(cl.qa[k]! - tl.qa[k]!) <= valueTol * scale + 1e-9 && Math.abs(cl.qp[k]! - tl.qp[k]!) <= valueTol * scale + 1e-9);
      }
      return false;
    };
    const exact = sameLocation.find(valueOk);
    const chosen = exact ?? sameLocation[0];
    if (chosen) {
      used.add(chosen);
      push("load", exact ? "match" : "mismatch", tl.ids, chosen.ids, exact ? undefined : `fasit: ${describeLoad(tl)}, tolket: ${describeLoad(chosen)}`);
    } else push("load", "missing", tl.ids, [], describeLoad(tl));
  }
  for (const cl of translated) if (!used.has(cl)) push("load", "extra", [], cl.ids, describeLoad(cl));

  const counts = Object.fromEntries(COMPARE_KINDS.map((k) => [k, { tp: 0, fp: 0, fn: 0 }])) as Record<CompareKind, KindCounts>;
  for (const e of entities) {
    const c = counts[e.kind];
    if (e.status === "match") c.tp++;
    else if (e.status === "mismatch") {
      c.fp++;
      c.fn++;
    }
    else if (e.status === "missing") c.fn++;
    else c.fp++;
  }
  return { exact: entities.every((e) => e.status === "match"), entities, counts };
}

function fmt(v: number): string {
  return Number(v.toPrecision(4)).toString();
}

function describeLoad(load: CLoad): string {
  switch (load.type) {
    case "point":
      return `punktlast (${fmt(load.Fx / 1e3)}, ${fmt(load.Fy / 1e3)}) kN`;
    case "moment":
      return `moment ${fmt(load.M / 1e3)} kNm`;
    case "distributed":
      return `fordelt last ${fmt(load.from)}–${fmt(load.to)}, vinkelrett ${fmt(load.qp[0] / 1e3)}→${fmt(load.qp[1] / 1e3)} kN/m, aksielt ${fmt(load.qa[0] / 1e3)}→${fmt(load.qa[1] / 1e3)} kN/m`;
  }
}
