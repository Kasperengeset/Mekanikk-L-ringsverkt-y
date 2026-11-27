/**
 * Topologiske endringer visningen trenger når en last dras langs en bjelke. Rene funksjoner; alle
 * resultater går gjennom `check` i edit.ts, så de er gyldige modeller.
 *
 *  - Et lastpunkt er en node som bare finnes fordi en last står der: nøyaktig to kollineære
 *    bjelkeelementer, uten opplager, uten ledd og uten andre elementer. Når lasten dras bort, slås de
 *    to elementene sammen (mergeAtNode), og nodelasten blir en last på det nye elementet.
 *  - En nodelast i enden av et element kan gjøres om til en last på elementet (nodeLoadToMember).
 *  - En rett bjelke kan bestå av flere elementer etter hverandre. collinearChain og placeLoadOnChain
 *    lar en last flyttes langs hele bjelken, også forbi ledd og opplagre.
 *
 * Omgjøringene endrer ikke løsningen: reaksjoner og snittkrefter er de samme før og etter
 * (se tests/edit-ops.test.ts).
 */
import { check, type EditResult } from "./edit.js";
import type { Asked, Load, Member, Model, Node, Provenance } from "./schema.js";

/** Toleranse for kollinearitet (kryssprodukt av enhetsvektorer). */
const COLLINEAR_TOL = 1e-9;

interface Vec {
  x: number;
  y: number;
}

function findNode(model: Model, id: string): Node | undefined {
  return model.nodes.find((n) => n.id === id);
}

/** Enhetsvektor og lengde fra node `from` til node `to`. */
function direction(model: Model, from: string, to: string): Vec & { length: number } {
  const a = findNode(model, from)!;
  const b = findNode(model, to)!;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  return { x: (b.x - a.x) / length, y: (b.y - a.y) / length, length };
}

/** Noden i den andre enden av elementet. */
export function otherEnd(m: Member, node: string): string {
  return m.i === node ? m.j : m.i;
}

/** true hvis elementet har momentledd i enden som står i `node`. */
export function releasedAt(m: Member, node: string): boolean {
  if (m.kind !== "beam" || !m.release) return false;
  return (m.i === node && m.release.i) || (m.j === node && m.release.j);
}

/** Elementene som har en ende i noden. */
export function incidentMembers(model: Model, node: string): Member[] {
  return model.members.filter((m) => m.i === node || m.j === node);
}

/** true hvis retningene er motsatte (de to elementene fortsetter hverandre gjennom noden). */
function opposite(a: Vec, b: Vec): boolean {
  return Math.abs(a.x * b.y - a.y * b.x) < COLLINEAR_TOL && a.x * b.x + a.y * b.y < 0;
}

function parallel(a: Vec, b: Vec): boolean {
  return Math.abs(a.x * b.y - a.y * b.x) < COLLINEAR_TOL && a.x * b.x + a.y * b.y > 0;
}

/**
 * true hvis noden bare er et lastpunkt: nøyaktig to kollineære bjelkeelementer med samme tverrsnitt,
 * ingen opplager, ingen ledd og ingen andre elementer. Da kan de to elementene slås sammen uten at
 * konstruksjonen endres.
 */
export function isLoadPointNode(model: Model, node: string): boolean {
  if (!findNode(model, node) || model.supports.some((s) => s.node === node)) return false;
  const ms = incidentMembers(model, node);
  if (ms.length !== 2) return false;
  const [m1, m2] = ms as [Member, Member];
  if (m1.kind !== "beam" || m2.kind !== "beam") return false;
  if (releasedAt(m1, node) || releasedAt(m2, node)) return false;
  if (m1.section !== m2.section) return false;
  const a = otherEnd(m1, node);
  const b = otherEnd(m2, node);
  if (a === b) return false;
  return opposite(direction(model, node, a), direction(model, node, b));
}

function withoutNode<T extends Load>(load: T): T {
  const copy = { ...load } as T & { node?: string };
  delete copy.node;
  return copy;
}

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
/** Fjerner flyttallsstøy (0,30000000000000004 → 0,3) så modellen holder seg lesbar. */
const clean = (t: number) => Number(clamp01(t).toFixed(12));

export type MergeResult = { ok: true; model: Model; member: string; at: number } | { ok: false; error: string };

/**
 * Slår sammen de to elementene i et lastpunkt. Laster i noden blir laster på det nye elementet i
 * nodens posisjon (`at`), og lastene på de to elementene regnes om (fordelt last `from`/`to`,
 * punktlast og moment `at`). Det nye elementet går fra den ene ytre noden til den andre og beholder
 * leddene i de ytre endene.
 */
export function mergeAtNode(model: Model, node: string): MergeResult {
  if (!isLoadPointNode(model, node)) return { ok: false, error: `Noden ${node} er ikke bare et lastpunkt.` };
  const ms = incidentMembers(model, node) as [Member, Member];
  // Behold retningen til elementet som allerede går inn mot noden, hvis det finnes.
  const [first, second] = ms[0].j === node ? ms : ms[1].j === node ? [ms[1], ms[0]] : ms;
  const a = otherEnd(first, node);
  const b = otherEnd(second, node);
  const L1 = direction(model, a, node).length;
  const L2 = direction(model, node, b).length;
  const L = L1 + L2;
  const tNode = clean(L1 / L);

  const used = new Set(model.members.filter((m) => m !== first && m !== second).map((m) => m.id));
  let id = `${a}${b}`;
  for (let k = 2; used.has(id); k++) id = `${a}${b}_${k}`;

  const reversed = (m: Member) => (m === first ? first.i !== a : second.i !== node);
  /** Andel langs et av de gamle elementene → andel langs det nye. */
  const toMerged = (m: Member, t: number) => {
    const local = reversed(m) ? 1 - t : t;
    return clean(m === first ? (local * L1) / L : (L1 + local * L2) / L);
  };
  const byId = new Map([
    [first.id, first],
    [second.id, second],
  ]);

  const releaseI = first.release?.[first.i === a ? "i" : "j"] ?? false;
  const releaseJ = second.release?.[second.j === b ? "j" : "i"] ?? false;
  const merged: Member = {
    id,
    i: a,
    j: b,
    kind: "beam",
    ...(first.section !== undefined ? { section: first.section } : {}),
    ...(releaseI || releaseJ ? { release: { i: releaseI, j: releaseJ } } : {}),
  };

  const loads = model.loads.map((load): Load => {
    if (load.type === "distributed") {
      const m = byId.get(load.member);
      if (!m) return load;
      const from = toMerged(m, load.from);
      const to = toMerged(m, load.to);
      if (!reversed(m)) return { ...load, member: id, from, to };
      // Elementet snus: start og slutt bytter plass, og lokal y snur fortegn.
      const sign = load.direction === "local_y" ? -1 : 1;
      return { ...load, member: id, from: to, to: from, w_start: sign * load.w_end, w_end: sign * load.w_start };
    }
    if (load.node === node) return { ...withoutNode(load), member: id, at: tNode };
    const m = load.member !== undefined ? byId.get(load.member) : undefined;
    if (!m || load.at === undefined) return load;
    return { ...load, member: id, at: toMerged(m, load.at) };
  });

  const asked = model.asked.map((q): Asked => {
    if (q.node === node) {
      const copy = { ...q };
      delete copy.node;
      return { ...copy, member: id, at: tNode };
    }
    const m = q.member !== undefined ? byId.get(q.member) : undefined;
    if (!m) return q;
    return { ...q, member: id, ...(q.at !== undefined ? { at: toMerged(m, q.at) } : {}) };
  });

  const provenance = model.provenance
    .filter((p) => !(p.entity === node && (p.entity_kind === "node" || p.entity_kind === "dimension")))
    .map((p): Provenance => (p.entity_kind === "member" && byId.has(p.entity) ? { ...p, entity: id } : p));

  const r = check({
    ...model,
    nodes: model.nodes.filter((n) => n.id !== node),
    members: model.members.flatMap((m) => (m === first ? [merged] : m === second ? [] : [m])),
    loads,
    asked,
    provenance,
  });
  return r.ok ? { ok: true, model: r.model, member: id, at: tNode } : { ok: false, error: r.error };
}

/**
 * Gjør om en punktlast eller et moment i en node til en last på et element som ender i noden
 * (`at` = 0 eller 1). Et moment kan ikke flyttes inn på en ende med momentledd eller en stav.
 */
export function nodeLoadToMember(model: Model, loadId: string, memberId: string): EditResult {
  const load = model.loads.find((l) => l.id === loadId);
  if (!load || load.type === "distributed" || load.node === undefined) return { ok: false, error: `Last ${loadId} står ikke i en node.` };
  const node = load.node;
  const m = model.members.find((x) => x.id === memberId);
  if (!m || (m.i !== node && m.j !== node)) return { ok: false, error: `Element ${memberId} ender ikke i ${node}.` };
  if (load.type === "moment" && (m.kind === "truss" || releasedAt(m, node)))
    return { ok: false, error: `Momentet ${loadId} kan ikke stå på en ende uten momentstivhet.` };
  const at = m.i === node ? 0 : 1;
  return check({ ...model, loads: model.loads.map((l) => (l === load ? { ...withoutNode(l), member: m.id, at } : l)) });
}

export interface ChainSegment {
  member: string;
  /** Start og slutt langs kjeden, i modellens lengdeenhet. */
  s0: number;
  s1: number;
  /** true hvis elementet går mot kjedens retning (j-enden ligger nærmest kjedens start). */
  reversed: boolean;
}

/** En rett bjelke av ett eller flere bjelkeelementer etter hverandre. */
export interface Chain {
  origin: Vec;
  /** Enhetsvektor langs kjeden. */
  dir: Vec;
  length: number;
  segments: ChainSegment[];
  /** Nodene langs kjeden med posisjon. */
  stops: { node: string; s: number }[];
}

/**
 * Kjeden av kollineære bjelkeelementer gjennom et element. Kjeden fortsetter gjennom en node så
 * lenge nøyaktig ett bjelkeelement fortsetter i samme retning (andre elementer, opplagre og ledd i
 * noden stopper den ikke). undefined for staver.
 */
export function collinearChain(model: Model, memberId: string): Chain | undefined {
  const start = model.members.find((m) => m.id === memberId);
  if (!start || start.kind !== "beam") return undefined;
  const dir = direction(model, start.i, start.j);
  const path: { member: Member; from: string; to: string }[] = [{ member: start, from: start.i, to: start.j }];
  const seen = new Set([start.id]);

  const walk = (node: string, along: Vec, push: (step: { member: Member; from: string; to: string }) => void) => {
    let current = node;
    for (;;) {
      const next = incidentMembers(model, current).filter(
        (m) => !seen.has(m.id) && m.kind === "beam" && parallel(direction(model, current, otherEnd(m, current)), along),
      );
      if (next.length !== 1) return;
      const m = next[0]!;
      seen.add(m.id);
      const far = otherEnd(m, current);
      push({ member: m, from: current, to: far });
      current = far;
    }
  };
  walk(start.j, dir, (step) => path.push(step));
  walk(start.i, { x: -dir.x, y: -dir.y }, (step) => path.unshift({ member: step.member, from: step.to, to: step.from }));

  const origin = findNode(model, path[0]!.from)!;
  const at = (id: string) => {
    const n = findNode(model, id)!;
    return (n.x - origin.x) * dir.x + (n.y - origin.y) * dir.y;
  };
  const segments = path.map((p) => ({ member: p.member.id, s0: at(p.from), s1: at(p.to), reversed: p.member.i !== p.from }));
  const stops = [{ node: path[0]!.from, s: 0 }, ...path.map((p) => ({ node: p.to, s: at(p.to) }))];
  return { origin: { x: origin.x, y: origin.y }, dir: { x: dir.x, y: dir.y }, length: segments[segments.length - 1]!.s1, segments, stops };
}

/** Posisjonen til en punktlast eller et moment langs kjeden, eller undefined hvis lasten ikke står på den. */
export function loadPositionOnChain(chain: Chain, load: Load): number | undefined {
  if (load.type === "distributed") return undefined;
  if (load.node !== undefined) return chain.stops.find((s) => s.node === load.node)?.s;
  const seg = chain.segments.find((s) => s.member === load.member);
  if (!seg || load.at === undefined) return undefined;
  return seg.s0 + (seg.reversed ? 1 - load.at : load.at) * (seg.s1 - seg.s0);
}

/**
 * Flytter en punktlast eller et moment til posisjon `s` langs kjeden (som last på elementet der).
 * I en node mellom to elementer beholdes elementet lasten står på, hvis det er ett av dem.
 */
export function placeLoadOnChain(model: Model, loadId: string, chain: Chain, s: number): EditResult {
  const load = model.loads.find((l) => l.id === loadId);
  if (!load || load.type === "distributed") return { ok: false, error: `Fant ingen punktlast eller moment ${loadId}.` };
  const eps = 1e-9 * Math.max(chain.length, 1);
  const pos = Math.min(chain.length, Math.max(0, s));
  const candidates = chain.segments.filter((seg) => pos >= seg.s0 - eps && pos <= seg.s1 + eps);
  const seg = candidates.find((c) => c.member === load.member) ?? candidates[0];
  if (!seg) return { ok: false, error: `Posisjonen ${s} er utenfor bjelken.` };
  const local = (pos - seg.s0) / (seg.s1 - seg.s0);
  const at = clean(seg.reversed ? 1 - local : local);
  return check({
    ...model,
    loads: model.loads.map((l) => (l === load ? { ...withoutNode(l), member: seg.member, at } : l)),
  });
}
