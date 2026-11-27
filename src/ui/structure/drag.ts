/**
 * Dra-logikken i konstruksjonsvisningen, som rene funksjoner (testes uten nettleser).
 *
 * StructureView kaller startDrag ved pointerdown og dragTo for hver pointermove. dragTo gir enten
 * endringer (stier, som store.updateGesture regner fra modellen da draget startet) eller en hel modell
 * når topologien endres (en nodelast som dras ut på et element, eller to elementer som slås sammen).
 * Alle posisjoner snappes: lengder til 0,1 lengdeenhet (ikke finere enn 1 cm), vinkler til 5°.
 */
import { snap } from "../../core/edit.js";
import {
  collinearChain,
  incidentMembers,
  isLoadPointNode,
  loadPositionOnChain,
  mergeAtNode,
  nodeLoadToMember,
  otherEnd,
  placeLoadOnChain,
  releasedAt,
  type Chain,
} from "../../core/edit-ops.js";
import type { Model } from "../../core/schema.js";
import { lengthFactor } from "../../core/units.js";
import type { Point, Viewport } from "../geometry.js";
import type { Change, EntityRef } from "../state/store.js";
import { dot, length, loadAnchor, nodePoint, sub, unit, type LoadScales } from "./layout.js";

/** Delen av en entitet som gripes: selve entiteten, halen på en punktlast eller en ende av en fordelt last. */
export type DragPart = "body" | "tail" | "from" | "to";

export type DragSession =
  | { kind: "node"; node: string; step: number }
  /** Klikk på et opplager bytter type; det dras ikke. */
  | { kind: "support"; node: string }
  | {
      kind: "load-move";
      load: string;
      /** Modellen da draget startet. */
      base: Model;
      step: number;
      /** Noden lasten sto i, for nodelaster. */
      node?: string;
      /** Modellen lasten flyttes i (etter omgjøring/sammenslåing), og bjelken den flyttes langs. */
      prepared?: Model;
      chain?: Chain;
      /** Startposisjonen langs kjeden for en nodelast: der gis den opprinnelige modellen tilbake. */
      origin?: number;
    }
  | { kind: "load-vector"; load: string; anchor: Point; forceScale: number; step: number }
  | { kind: "dist-end"; load: string; end: "from" | "to"; a: Point; b: Point; step: number }
  | { kind: "dist-shift"; load: string; a: Point; b: Point; step: number; t0: number; from0: number; to0: number };

export interface DragUpdate {
  update: Change[] | Model;
  /** Beskriver måltilstanden, så like oppdateringer etter hverandre kan hoppes over. */
  key: string;
}

/** Snappesteget for lengder i modellens enhet: 0,1 lengdeenhet, men ikke finere enn 1 cm. */
export function lengthStep(model: Model): number {
  return Math.max(0.1, 0.01 / lengthFactor(model.units));
}

/** Et «pent» steg (1, 2 eller 5 · 10^k) nær x. */
export function niceStep(x: number): number {
  if (!(x > 0) || !Number.isFinite(x)) return 1;
  const k = 10 ** Math.floor(Math.log10(x));
  const f = x / k;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * k;
}

/** snap uten flyttallsstøy (2,3000000000000003 → 2,3). */
export function snapTo(value: number, step: number): number {
  return Number(snap(value, step).toFixed(10));
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const cleanFraction = (t: number) => Number(clamp(t, 0, 1).toFixed(12));

/** Vinkel i grader i (−180, 180]. */
function normalizeAngle(deg: number): number {
  const a = ((((deg + 180) % 360) + 360) % 360) - 180;
  return a === -180 ? 180 : a + 0;
}

/** Andelen langs linjestykket a → b for projeksjonen av p. */
function projectFraction(p: Point, a: Point, b: Point): number {
  const d = sub(b, a);
  return dot(sub(p, a), d) / dot(d, d);
}

function memberEnds(model: Model, id: string): [Point, Point] | undefined {
  const m = model.members.find((x) => x.id === id);
  const a = m && nodePoint(model, m.i);
  const b = m && nodePoint(model, m.j);
  return a && b ? [a, b] : undefined;
}

/**
 * Starter et drag. `world` er pekeren i modellkoordinater. Gir null når entiteten bare kan velges
 * (elementer, staver, laster som ikke kan flyttes).
 */
export function startDrag(model: Model, ref: EntityRef, part: DragPart, world: Point, viewport: Viewport, scales: LoadScales): DragSession | null {
  const step = lengthStep(model);
  if (ref.kind === "node") return model.nodes.some((n) => n.id === ref.id) ? { kind: "node", node: ref.id, step } : null;
  if (ref.kind === "support") return model.supports.some((s) => s.node === ref.id) ? { kind: "support", node: ref.id } : null;
  if (ref.kind !== "load") return null;
  const load = model.loads.find((l) => l.id === ref.id);
  if (!load) return null;

  if (load.type === "distributed") {
    const ends = memberEnds(model, load.member);
    if (!ends) return null;
    const [a, b] = ends;
    if (part === "from" || part === "to") return { kind: "dist-end", load: load.id, end: part, a, b, step };
    return { kind: "dist-shift", load: load.id, a, b, step, t0: projectFraction(world, a, b), from0: load.from, to0: load.to };
  }

  if (part === "tail" && load.type === "point") {
    const anchor = loadAnchor(model, load);
    if (!anchor) return null;
    return { kind: "load-vector", load: load.id, anchor: viewport.toScreen(anchor), forceScale: scales.force, step: niceStep(Math.abs(load.P) / 10) };
  }

  if (load.node === undefined) {
    const chain = load.member !== undefined ? collinearChain(model, load.member) : undefined;
    return chain ? { kind: "load-move", load: load.id, base: model, step, prepared: model, chain } : null;
  }
  // En nodelast kan dras ut på bjelkeelementene som ender i noden; hvilket avgjøres av retningen på draget.
  const node = load.node;
  const usable = incidentMembers(model, node).filter((m) => m.kind === "beam" && !(load.type === "moment" && releasedAt(m, node)));
  return usable.length ? { kind: "load-move", load: load.id, base: model, step, node } : null;
}

/** Velger bjelken en nodelast dras ut på, og gjør om modellen (sammenslåing eller last på elementet). */
function prepareNodeLoad(s: Extract<DragSession, { kind: "load-move" }>, world: Point): boolean {
  const node = s.node!;
  const p = nodePoint(s.base, node)!;
  const drag = sub(world, p);
  if (length(drag) < s.step / 2) return false;
  const dir = unit(drag);
  const load = s.base.loads.find((l) => l.id === s.load)!;
  const candidates = incidentMembers(s.base, node).filter((m) => m.kind === "beam" && !(load.type === "moment" && releasedAt(m, node)));
  let best = candidates[0]!;
  let bestDot = -Infinity;
  for (const m of candidates) {
    const d = dot(unit(sub(nodePoint(s.base, otherEnd(m, node))!, p)), dir);
    if (d > bestDot) [best, bestDot] = [m, d];
  }
  let prepared: Model;
  let member: string;
  if (isLoadPointNode(s.base, node)) {
    const r = mergeAtNode(s.base, node);
    if (!r.ok) return false;
    [prepared, member] = [r.model, r.member];
  } else {
    const r = nodeLoadToMember(s.base, s.load, best.id);
    if (!r.ok) return false;
    [prepared, member] = [r.model, best.id];
  }
  const chain = collinearChain(prepared, member);
  const moved = prepared.loads.find((l) => l.id === s.load);
  if (!chain || !moved) return false;
  s.prepared = prepared;
  s.chain = chain;
  s.origin = loadPositionOnChain(chain, moved);
  return true;
}

/**
 * Ny tilstand for pekeren i `world` (modellkoordinater) og `screen` (piksler). Muterer økten når en
 * nodelast gjøres om første gang. null betyr ingen endring.
 */
export function dragTo(s: DragSession, world: Point, screen: Point): DragUpdate | null {
  switch (s.kind) {
    case "support":
      return null;

    case "node": {
      const x = snapTo(world.x, s.step);
      const y = snapTo(world.y, s.step);
      return {
        update: [
          { path: `nodes.${s.node}.x`, value: x },
          { path: `nodes.${s.node}.y`, value: y },
        ],
        key: `${x},${y}`,
      };
    }

    case "load-vector": {
      // Fra pekeren (halen) til angrepspunktet (spissen), på skjermen med y ned.
      const v = sub(s.anchor, screen);
      const px = length(v);
      if (px < 1) return null;
      const P = Math.max(s.step, snapTo(px / s.forceScale, s.step));
      const angle = normalizeAngle(snapTo((Math.atan2(-v.y, v.x) * 180) / Math.PI, 5));
      return {
        update: [
          { path: `loads.${s.load}.P`, value: P },
          { path: `loads.${s.load}.angle_deg`, value: angle },
        ],
        key: `${P},${angle}`,
      };
    }

    case "dist-end": {
      const L = length(sub(s.b, s.a));
      const raw = clamp(projectFraction(world, s.a, s.b), 0, 1) * L;
      const pos = Math.abs(raw - L) < s.step / 2 ? L : snapTo(raw, s.step);
      const t = cleanFraction(pos / L);
      return { update: [{ path: `loads.${s.load}.${s.end}`, value: t }], key: String(t) };
    }

    case "dist-shift": {
      const L = length(sub(s.b, s.a));
      const delta = snapTo((projectFraction(world, s.a, s.b) - s.t0) * L, s.step) / L;
      const shift = clamp(delta, -s.from0, 1 - s.to0);
      const from = cleanFraction(s.from0 + shift);
      const to = cleanFraction(s.to0 + shift);
      return {
        update: [
          { path: `loads.${s.load}.from`, value: from },
          { path: `loads.${s.load}.to`, value: to },
        ],
        key: `${from},${to}`,
      };
    }

    case "load-move": {
      if (!s.chain && !prepareNodeLoad(s, world)) return null;
      const chain = s.chain!;
      const raw = clamp(dot(sub(world, chain.origin), chain.dir), 0, chain.length);
      let pos = clamp(snapTo(raw, s.step), 0, chain.length);
      // Nodene langs bjelken (ender, opplagre, ledd) skal kunne nås selv om de ikke ligger på rutenettet.
      for (const stop of chain.stops) if (Math.abs(raw - stop.s) < s.step / 2 && Math.abs(raw - stop.s) <= Math.abs(raw - pos)) pos = stop.s;
      if (s.origin !== undefined && Math.abs(pos - s.origin) < 1e-9) return { update: s.base, key: "origin" };
      const r = placeLoadOnChain(s.prepared!, s.load, chain, pos);
      return r.ok ? { update: r.model, key: String(pos) } : null;
    }
  }
}
