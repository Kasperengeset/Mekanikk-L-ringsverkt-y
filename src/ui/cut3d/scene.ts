/**
 * 3D-scenen for et snitt, som rene data (ingen three.js), så den kan testes uten nettleser.
 * Cut3DCanvas gjør dataene om til three.js-objekter.
 *
 * Koordinater i meter (SI): x og y i rammens plan, z ut av planet (mot betrakteren). Elementene
 * tegnes som bjelker med tverrsnittets form, i en tegneskala der høyden er noen prosent av
 * konstruksjonen. Konstruksjonen deles i snittet, og delene flyttes litt fra hverandre langs
 * elementet, så snittflatene og kreftene på dem synes (fritt legeme). Deler snittet ikke
 * konstruksjonen (lukket ramme eller fagverk), står delene stille og elementet kortes inn ved snittet.
 *
 * To visninger:
 *  - "forces": laster, opplagerkrefter og snittkreftene N, V og M på begge snittflatene.
 *  - "stress": normalspenningene σ som piler ut av eller inn i snittflatene, og skjærspenningene τ
 *    som et diagram i snittflatens plan, ved siden av tverrsnittet.
 *
 * Pilene har samme kraftskala for laster, opplagerkrefter og snittkrefter, så de kan sammenlignes.
 * Skjulte tall (hiddenValues) gir pil i riktig retning, men med fast lengde og «?» i stedet for tallet.
 */
import { cutForces, cutParts, type Cut, type CutForces } from "../../core/cut.js";
import { isDiagramValueHidden, type HiddenValues } from "../../core/pedagogy.js";
import type { Model, Support } from "../../core/schema.js";
import { distributedDirection } from "../../core/solver/loads.js";
import type { MemberResult, SolveResult } from "../../core/solver/index.js";
import { intervalsAt, sectionGeometry, stressProfile, type SectionGeometry } from "../../core/stress.js";
import { pointLoadComponents, toSI } from "../../core/units.js";
import { formatQuantity } from "../format.js";
import type { CutMode } from "../state/store.js";

export type V3 = [number, number, number];

export type Tone = "load" | "loadPoint" | "reaction" | "N" | "V" | "M" | "tension" | "compression" | "tau" | "muted";

export type { CutMode };

export interface SceneArrow {
  tail: V3;
  tip: V3;
  tone: Tone;
  /** Radius på skaftet. */
  radius: number;
}

/** Buet pil (moment): sirkelbue om `axis` gjennom `center`, fra retningen `start`, `sweep` radianer (positivt mot klokka om aksen). */
export interface SceneArc {
  center: V3;
  axis: V3;
  start: V3;
  radius: number;
  sweep: number;
  tone: Tone;
  tube: number;
}

export interface SceneLabel {
  at: V3;
  tone: Tone;
  /** Symbol med senket indeks (f.eks. H med A), og verdien etter et likhetstegn. */
  symbol?: string;
  sub?: string;
  value?: string;
  masked?: boolean;
  kind?: "node" | "force" | "symbol";
}

/** Tverrsnittet i tegneskala, i (z, y) om arealsenteret. */
export type DisplaySection = { kind: "rects"; rects: { z0: number; z1: number; y0: number; y1: number }[] } | { kind: "circle"; R: number; r: number };

export interface SceneBody {
  part: 0 | 1;
  /** Startpunkt og enhetsvektor langs aksen (x'), y' i planet. */
  origin: V3;
  dir: V3;
  up: V3;
  length: number;
  section: DisplaySection;
  kind: "beam" | "truss";
}

export interface SceneFace {
  part: 0 | 1;
  center: V3;
  /** Utover fra delen (inn i spalten mellom delene). */
  normal: V3;
  up: V3;
  section: DisplaySection;
}

export interface SceneSupport {
  type: Support["type"];
  at: V3;
  /** Fra noden mot underlaget. */
  down: V3;
  size: number;
  depth: number;
}

export interface SceneLine {
  points: V3[];
  tone: Tone;
  dashed?: boolean;
}

export interface SceneHinge {
  at: V3;
  radius: number;
  depth: number;
}

export interface Scene3D {
  mode: CutMode;
  bodies: SceneBody[];
  faces: SceneFace[];
  arrows: SceneArrow[];
  arcs: SceneArc[];
  labels: SceneLabel[];
  supports: SceneSupport[];
  lines: SceneLine[];
  hinges: SceneHinge[];
  /** Hele scenen, og området rundt snittet (for kameraet). */
  bounds: { center: V3; radius: number };
  focus: { center: V3; radius: number };
  /** Punktene kameraet skal få med: hele scenen ("forces") eller området rundt snittet ("stress"). */
  framePoints: V3[];
  /** Retningen kameraet ser fra (enhetsvektor fra midten mot kameraet). */
  view: V3;
  separated: boolean;
  /** Konstruksjonens største mål i meter. */
  span: number;
  forces: CutForces;
}

export interface SceneInput {
  model: Model;
  result: Extract<SolveResult, { status: "ok" }>;
  cut: Cut;
  mode: CutMode;
  hidden?: HiddenValues;
}

// ---------------------------------------------------------------- vektorer

const v3 = (x: number, y: number, z = 0): V3 => [x, y, z];
const plus = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const minus = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const times = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm3 = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const unit3 = (a: V3): V3 => {
  const l = norm3(a);
  return l > 0 ? times(a, 1 / l) : [0, 0, 0];
};
const Z: V3 = [0, 0, 1];

/** Tegneskalaene (andeler av konstruksjonens største mål). */
export const SCALE = {
  /** Høyden på det høyeste tverrsnittet: innenfor disse grensene, ellers i riktig størrelse. */
  sectionMin: 0.03,
  sectionMax: 0.075,
  /** Tverrsnitt som ikke står i oppgaven. */
  assumedBeam: 0.055,
  assumedTruss: 0.03,
  minSection: 0.012,
  /** Lengden på pilen for den største kraften, og den korteste pilen. */
  forceMax: 0.15,
  forceMin: 0.045,
  /** Pil for et skjult tall. */
  forceHidden: 0.09,
  /** Største pil for en fordelt last. */
  lineLoad: 0.07,
  /** Lengden på pilen for største |σ| og bredden på τ-diagrammet. */
  sigma: 0.1,
  tau: 0.08,
  shaft: 0.0055,
  thinShaft: 0.0032,
  margin: 0.008,
} as const;

// ---------------------------------------------------------------- tverrsnitt

function scaleSection(g: SectionGeometry, k: number): DisplaySection {
  if (g.kind === "circle") return { kind: "circle", R: g.R * k, r: g.r * k };
  return { kind: "rects", rects: g.rects.map((r) => ({ z0: r.z0 * k, z1: r.z1 * k, y0: r.y0 * k, y1: r.y1 * k })) };
}

interface MemberDisplay {
  geometry: SectionGeometry;
  /** Skala fra virkelige mål til tegningen. */
  k: number;
  section: DisplaySection;
  /** Halv høyde og halv bredde i tegningen. */
  half: number;
  halfWidth: number;
}

function memberDisplays(model: Model, span: number): Map<string, MemberDisplay> {
  const geoms = new Map(model.members.map((m) => [m.id, sectionGeometry(model.sections.find((s) => s.id === m.section))]));
  const known = [...geoms.values()].filter((g) => !g.assumed);
  const hMax = Math.max(0, ...known.map((g) => g.top - g.bottom));
  const kKnown = hMax > 0 ? Math.min(Math.max(hMax, SCALE.sectionMin * span), SCALE.sectionMax * span) / hMax : 0;
  const out = new Map<string, MemberDisplay>();
  for (const m of model.members) {
    const g = geoms.get(m.id)!;
    const h = g.top - g.bottom;
    let k = g.assumed ? ((m.kind === "truss" ? SCALE.assumedTruss : SCALE.assumedBeam) * span) / h : kKnown;
    if (h * k < SCALE.minSection * span) k = (SCALE.minSection * span) / h;
    out.set(m.id, { geometry: g, k, section: scaleSection(g, k), half: (h * k) / 2, halfWidth: (g.width * k) / 2 });
  }
  return out;
}

// ---------------------------------------------------------------- hjelpere for piler

/**
 * Pil for en kraft i retning `dir` (enhetsvektor) som angriper i `at`, med kroppen på siden `side`:
 * peker kraften mot `at` fra den siden, står spissen ved angrepspunktet (trykker), ellers halen (trekker).
 */
function sidedArrow(at: V3, dir: V3, side: V3, len: number, offset: number, tone: Tone, radius: number): SceneArrow {
  const start = plus(at, times(side, offset));
  const far = plus(start, times(side, len));
  return dot3(dir, side) < 0 ? { tail: far, tip: start, tone, radius } : { tail: start, tip: far, tone, radius };
}

/** Enden av pilen som ligger lengst fra `from`. */
const farEnd = (a: SceneArrow, from: V3) => (norm3(minus(a.tail, from)) > norm3(minus(a.tip, from)) ? a.tail : a.tip);

function momentArc(center: V3, M: number, radius: number, tone: Tone, tube: number, openToward?: V3): SceneArc {
  // Buen dekker 270°, med åpningen mot `openToward` (f.eks. mot delen et snittmoment virker på).
  const open = openToward ? unit3(openToward) : v3(0, -1);
  const startAngle = Math.atan2(open[1], open[0]) + (M >= 0 ? Math.PI / 4 : -Math.PI / 4);
  const sweep = (M >= 0 ? 1 : -1) * 1.5 * Math.PI;
  return { center, axis: Z, start: v3(Math.cos(startAngle), Math.sin(startAngle)), radius, sweep, tone, tube };
}

/** Punktet på buen midt i sveipet. */
function arcMid(a: SceneArc): V3 {
  const base = Math.atan2(a.start[1], a.start[0]) + a.sweep / 2;
  return plus(a.center, v3(Math.cos(base) * a.radius, Math.sin(base) * a.radius));
}

// ---------------------------------------------------------------- scenen

export function buildCutScene({ model, result, cut, mode, hidden }: SceneInput): Scene3D | undefined {
  const forces = cutForces(result, cut);
  const cutMember = result.members.find((m) => m.id === cut.member);
  if (!forces || !cutMember) return undefined;
  const si = toSI(model);
  const nodes = new Map(si.nodes.map((n) => [n.id, v3(n.x, n.y)]));
  const xs = si.nodes.map((n) => n.x);
  const ys = si.nodes.map((n) => n.y);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1e-9);
  const center = v3((Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2);
  const S = span;
  const displays = memberDisplays(model, S);
  const parts = cutParts(model, cut);
  const isTruss = cutMember.kind === "truss";
  const isHidden = (q: "N" | "V" | "M") => hidden !== undefined && isDiagramValueHidden(hidden, q, cut.member);

  const t = v3(forces.tangent.x, forces.tangent.y);
  const n = v3(forces.normal.x, forces.normal.y);
  const P = v3(forces.point.x, forces.point.y);
  const cutDisplay = displays.get(cut.member)!;

  // --- Kraftskala: samme for laster, opplagerkrefter og snittkrefter.
  const magnitudes: number[] = [];
  for (const l of si.loads) if (l.type === "point") magnitudes.push(Math.abs(l.P));
  for (const r of result.reactions) if (!hidden?.reactionNodes.has(r.node)) magnitudes.push(Math.abs(r.Fx), Math.abs(r.Fy));
  if (!isHidden("N")) magnitudes.push(Math.abs(forces.N));
  if (!isHidden("V") && !isTruss) magnitudes.push(Math.abs(forces.V));
  const Fmax = Math.max(0, ...magnitudes);
  const lenOf = (F: number, masked: boolean) => (masked ? SCALE.forceHidden * S : Fmax > 0 ? Math.max(SCALE.forceMin, (SCALE.forceMax * Math.abs(F)) / Fmax) * S : SCALE.forceMin * S);
  // Støygrensen tar med alle krefter, også de skjulte, og fordelte laster over konstruksjonen.
  const allMax = Math.max(
    Fmax,
    ...result.reactions.flatMap((r) => [Math.abs(r.Fx), Math.abs(r.Fy)]),
    ...si.loads.flatMap((l) => (l.type === "distributed" ? [Math.abs(l.w_start) * S, Math.abs(l.w_end) * S] : l.type === "moment" ? [Math.abs(l.M) / S] : [])),
    1e-300,
  );
  const tiny = (F: number) => Math.abs(F) <= 1e-9 * allMax;

  // --- Spalten mellom delene.
  // Null vises ikke som pil, heller ikke når tallet er skjult: formen på diagrammene viser det allerede.
  const lenN = tiny(forces.N) ? 0 : lenOf(forces.N, isHidden("N"));
  const sigmaLen = SCALE.sigma * S;
  let gap = mode === "stress" ? 2 * sigmaLen + 0.07 * S : Math.max(0.16 * S, 2 * lenN + 0.07 * S);
  let lenNShown = lenN;
  let sigmaShown = sigmaLen;
  if (!parts.separated) {
    gap = Math.min(gap, 1.6 * Math.min(forces.x, cutMember.length - forces.x));
    lenNShown = Math.min(lenN, Math.max(0.02 * S, (gap - 0.04 * S) / 2));
    sigmaShown = Math.min(sigmaLen, Math.max(0.02 * S, (gap - 0.04 * S) / 2));
  }
  const offsets: [V3, V3] = parts.separated ? [times(t, -gap / 2), times(t, gap / 2)] : [v3(0, 0), v3(0, 0)];
  const nodePart = (id: string): 0 | 1 => (parts.separated && parts.nodes[1].has(id) ? 1 : 0);
  const at = (id: string) => plus(nodes.get(id)!, offsets[nodePart(id)]);
  const memberPart = (m: MemberResult): 0 | 1 => (parts.separated ? (parts.memberPart.get(m.id) ?? 0) : 0);

  const scene: Scene3D = {
    mode,
    bodies: [],
    faces: [],
    arrows: [],
    arcs: [],
    labels: [],
    supports: [],
    lines: [],
    hinges: [],
    bounds: { center, radius: S },
    focus: { center: P, radius: S },
    framePoints: [],
    view: unit3(v3(0.28, 0.3, 1)),
    separated: parts.separated,
    span: S,
    forces,
  };
  const shaft = SCALE.shaft * S;
  const thin = SCALE.thinShaft * S;
  const margin = SCALE.margin * S;

  // --- Elementene (det snittede i to biter).
  for (const m of result.members) {
    const d = displays.get(m.id)!;
    const dir = v3(m.cos, m.sin);
    const up = v3(-m.sin, m.cos);
    const start = v3(m.start.x, m.start.y);
    const body = (part: 0 | 1, from: number, to: number) => {
      if (to - from <= 1e-9 * S) return;
      scene.bodies.push({ part, origin: plus(plus(start, times(dir, from)), offsets[part]), dir, up, length: to - from, section: d.section, kind: m.kind });
    };
    if (m.id === cut.member) {
      const trim = parts.separated ? 0 : gap / 2;
      body(0, 0, forces.x - trim);
      body(1, forces.x + trim, m.length);
    } else body(memberPart(m), 0, m.length);
  }

  // Snittflatene.
  const trim = parts.separated ? 0 : gap / 2;
  const faceCenter = (part: 0 | 1) => plus(plus(P, times(t, part === 0 ? -trim : trim)), offsets[part]);
  for (const part of [0, 1] as const) scene.faces.push({ part, center: faceCenter(part), normal: part === 0 ? t : times(t, -1), up: n, section: cutDisplay.section });

  // Momentledd.
  for (const m of model.members) {
    if (m.kind !== "beam" || !m.release) continue;
    const d = displays.get(m.id)!;
    for (const end of ["i", "j"] as const) {
      if (!m.release[end]) continue;
      const node = end === "i" ? m.i : m.j;
      scene.hinges.push({ at: at(node), radius: Math.max(d.half * 0.55, 0.006 * S), depth: 2 * d.halfWidth + 0.02 * S });
    }
  }

  // --- Hjelpere for nodene: halv høyde (pilene starter utenfor bjelken) og frie retninger.
  const halfAt = (node: string) => Math.max(0, ...model.members.filter((m) => m.i === node || m.j === node).map((m) => displays.get(m.id)!.half));
  const memberDirs = (node: string): V3[] =>
    model.members
      .filter((m) => m.i === node || m.j === node)
      .map((m) => unit3(minus(nodes.get(m.i === node ? m.j : m.i)!, nodes.get(node)!)));

  // --- Laster.
  const loadLabel = (atPoint: V3, text: string, tone: Tone) => scene.labels.push({ at: atPoint, value: text, tone, kind: "force" });
  const forceText = (F: number) => formatQuantity("force", Math.abs(F), model);
  for (const load of si.loads) {
    if (load.type === "distributed") continue;
    let anchor: V3 | undefined;
    let half = 0;
    let frontZ = 0;
    if (load.node !== undefined) {
      anchor = at(load.node);
      half = halfAt(load.node);
      frontZ = Math.max(0, ...model.members.filter((m) => m.i === load.node || m.j === load.node).map((m) => displays.get(m.id)!.halfWidth));
    } else if (load.member !== undefined && load.at !== undefined) {
      const m = result.members.find((x) => x.id === load.member);
      if (!m) continue;
      const s = load.at * m.length;
      const part: 0 | 1 = m.id === cut.member ? (s >= forces.x ? 1 : 0) : memberPart(m);
      anchor = plus(v3(m.start.x + m.cos * s, m.start.y + m.sin * s), offsets[part]);
      if (m.id === cut.member && !parts.separated && Math.abs(s - forces.x) < gap / 2) anchor = plus(anchor, times(t, (s >= forces.x ? 1 : -1) * (gap / 2 - Math.abs(s - forces.x))));
      half = displays.get(m.id)!.half;
      frontZ = displays.get(m.id)!.halfWidth;
    }
    if (!anchor) continue;
    if (load.type === "point") {
      const { Fx, Fy } = pointLoadComponents(load.P, load.angle_deg);
      const dir = unit3(v3(Fx, Fy));
      if (norm3(dir) === 0) continue;
      const arrow = sidedArrow(anchor, dir, times(dir, -1), lenOf(load.P, false), half + margin, "loadPoint", shaft);
      scene.arrows.push(arrow);
      loadLabel(plus(farEnd(arrow, anchor), times(dir, -0.03 * S)), forceText(load.P), "loadPoint");
    } else {
      const arc = momentArc(plus(anchor, v3(0, 0, frontZ + 0.012 * S)), load.M, 0.055 * S, "load", shaft * 0.9);
      scene.arcs.push(arc);
      loadLabel(plus(anchor, v3(0, 0.055 * S + 0.035 * S, frontZ)), formatQuantity("moment", Math.abs(load.M), model), "load");
    }
  }

  // Fordelte laster: piler med spissen mot bjelken og en strek gjennom halene.
  const Wmax = Math.max(0, ...si.loads.flatMap((l) => (l.type === "distributed" ? [Math.abs(l.w_start), Math.abs(l.w_end)] : [])));
  for (const load of si.loads) {
    if (load.type !== "distributed" || Wmax === 0) continue;
    const m = result.members.find((x) => x.id === load.member);
    if (!m) continue;
    const d = displays.get(m.id)!;
    const [gx, gy] = distributedDirection(load, m.cos, m.sin);
    const dir = unit3(v3(gx, gy));
    const s0 = load.from * m.length;
    const s1 = load.to * m.length;
    // Biter: hele lasten, eller to biter når den går over snittet.
    const pieces: { from: number; to: number; part: 0 | 1 }[] = [];
    if (m.id === cut.member) {
      if (s0 < forces.x - trim) pieces.push({ from: s0, to: Math.min(s1, forces.x - trim), part: 0 });
      if (s1 > forces.x + trim) pieces.push({ from: Math.max(s0, forces.x + trim), to: s1, part: 1 });
    } else pieces.push({ from: s0, to: s1, part: memberPart(m) });
    const w = (s: number) => load.w_start + ((load.w_end - load.w_start) * (s - s0)) / Math.max(s1 - s0, 1e-12);
    for (const piece of pieces) {
      const count = Math.max(2, Math.round((piece.to - piece.from) / (0.055 * S)));
      const tails: V3[] = [];
      for (let k = 0; k <= count; k++) {
        const s = piece.from + ((piece.to - piece.from) * k) / count;
        const value = w(s);
        const base = plus(v3(m.start.x + m.cos * s, m.start.y + m.sin * s), offsets[piece.part]);
        const f = times(dir, Math.sign(value) || 1);
        const len = (SCALE.lineLoad * S * Math.abs(value)) / Wmax;
        const tip = plus(base, times(f, -(d.half + margin)));
        const tail = plus(tip, times(f, -len));
        tails.push(tail);
        if (len > 0.008 * S) scene.arrows.push({ tail, tip, tone: "load", radius: thin });
      }
      scene.lines.push({ points: tails, tone: "load" });
      const mid = tails[Math.floor(tails.length / 2)]!;
      const outward = unit3(minus(mid, plus(v3(m.start.x + m.cos * ((piece.from + piece.to) / 2), m.start.y + m.sin * ((piece.from + piece.to) / 2)), offsets[piece.part])));
      const text =
        load.w_start === load.w_end
          ? formatQuantity("lineLoad", Math.abs(load.w_start), model)
          : `${formatQuantity("lineLoad", Math.abs(w(piece.from)), model)} – ${formatQuantity("lineLoad", Math.abs(w(piece.to)), model)}`;
      loadLabel(plus(mid, times(outward, 0.028 * S)), text, "load");
    }
  }

  // --- Opplager og opplagerkrefter.
  for (const support of model.supports) {
    const node = support.node;
    const p = at(node);
    const r = result.reactions.find((x) => x.node === node);
    const dirs = memberDirs(node);
    const half = halfAt(node);
    const down = supportDown(support, dirs);
    scene.supports.push({ type: support.type, at: plus(p, times(down, half)), down, size: 0.05 * S, depth: 0.07 * S });
    if (!r) continue;
    const masked = hidden?.reactionNodes.has(node) ?? false;
    const side = (axis: V3): V3 => {
      const score = (s: V3) => Math.max(-1, ...dirs.map((d) => dot3(s, d))) - 0.5 * dot3(s, down) + 1e-3 * dot3(s, unit3(minus(nodes.get(node)!, center)));
      return score(axis) <= score(times(axis, -1)) ? axis : times(axis, -1);
    };
    const components: { F: number; axis: V3; symbol: string }[] = [];
    if (support.type === "roller") {
      const a = ((support.angle_deg ?? 0) * Math.PI) / 180;
      const normal = v3(-Math.sin(a), Math.cos(a));
      const R = r.Fx * normal[0] + r.Fy * normal[1];
      const symbol = Math.abs(normal[1]) > 0.999 ? "V" : Math.abs(normal[0]) > 0.999 ? "H" : "R";
      components.push({ F: R, axis: normal, symbol });
    } else components.push({ F: r.Fx, axis: v3(1, 0), symbol: "H" }, { F: r.Fy, axis: v3(0, 1), symbol: "V" });
    for (const c of components) {
      if (tiny(c.F)) continue;
      const dir = times(c.axis, Math.sign(c.F) || 1);
      const s = side(c.axis);
      const arrow = sidedArrow(p, dir, s, lenOf(c.F, masked), half + margin, "reaction", shaft);
      scene.arrows.push(arrow);
      scene.labels.push({ at: plus(farEnd(arrow, p), times(s, 0.03 * S)), tone: "reaction", symbol: c.symbol, sub: node, value: masked ? "?" : forceText(c.F), masked, kind: "force" });
    }
    if (support.type === "fixed" && !tiny(r.M / S)) {
      const front = Math.max(0, ...model.members.filter((m) => m.i === node || m.j === node).map((m) => displays.get(m.id)!.halfWidth));
      const arc = momentArc(plus(p, v3(0, 0, front + 0.012 * S)), r.M, 0.06 * S, "reaction", shaft * 0.9, down);
      scene.arcs.push(arc);
      scene.labels.push({
        at: plus(arcMid(arc), times(unit3(minus(arcMid(arc), arc.center)), 0.035 * S)),
        tone: "reaction",
        symbol: "M",
        sub: node,
        value: masked ? "?" : formatQuantity("moment", Math.abs(r.M), model),
        masked,
        kind: "force",
      });
    }
  }

  // --- Nodenavn.
  for (const node of si.nodes) {
    const blocked = [...memberDirs(node.id)];
    const sup = model.supports.find((s) => s.node === node.id);
    if (sup) blocked.push(supportDown(sup, memberDirs(node.id)));
    const candidates = [v3(-1, 1), v3(1, 1), v3(-1, -1), v3(1, -1)].map(unit3);
    let best = candidates[0]!;
    let bestScore = Infinity;
    for (const c of candidates) {
      const score = Math.max(-1, ...blocked.map((b) => dot3(c, b)));
      if (score < bestScore - 1e-9) [best, bestScore] = [c, score];
    }
    scene.labels.push({ at: plus(at(node.id), times(best, 0.045 * S)), tone: "muted", value: node.id, kind: "node" });
  }

  // --- Snittet.
  const before = { arrows: scene.arrows.length, lines: scene.lines.length, labels: scene.labels.length };
  if (mode === "forces") addCutForces(scene, { forces, faceCenter, t, n, isTruss, isHidden, lenOf, tiny, lenNShown, cutDisplay, S, shaft, margin });
  else addStresses(scene, { model, forces, faceCenter, t, n, isTruss, isHidden, cutMember: cut.member, cutDisplay, S, sigmaShown, thin, margin });

  // --- Kameraet: hele scenen, eller området rundt snittet i spenningsvisningen.
  const pts: V3[] = [];
  for (const b of scene.bodies) pts.push(b.origin, plus(b.origin, times(b.dir, b.length)));
  for (const a of scene.arrows) pts.push(a.tail, a.tip);
  for (const a of scene.arcs) pts.push(plus(a.center, v3(a.radius, a.radius)), minus(a.center, v3(a.radius, a.radius)));
  for (const s of scene.supports) pts.push(plus(s.at, times(s.down, s.size)));
  scene.bounds = sphere(pts);
  const near = pts.filter((p) => norm3(minus(p, P)) < 0.45 * S + gap);
  const focus = sphere([...near, plus(P, times(t, gap)), minus(P, times(t, gap))]);
  scene.focus = { center: P, radius: Math.max(focus.radius * 0.8, 3 * cutDisplay.half, 0.18 * S) };
  for (const l of scene.labels) pts.push(l.at);
  scene.framePoints = pts;
  if (mode === "stress") {
    scene.view = unit3(plus(plus(times(t, 0.75), v3(0, 0.35)), times(Z, 1)));
    // Bare spenningene og snittflatene, med litt av bjelken på hver side.
    scene.framePoints = [
      ...scene.arrows.slice(before.arrows).flatMap((a) => [a.tail, a.tip]),
      ...scene.lines.slice(before.lines).flatMap((l) => l.points),
      ...scene.labels.slice(before.labels).map((l) => l.at),
      ...scene.faces.flatMap((f) => [plus(f.center, times(f.normal, -0.08 * S)), plus(f.center, times(n, 2 * cutDisplay.half)), plus(f.center, times(n, -2 * cutDisplay.half))]),
    ];
  }
  return scene;
}

/** Fra noden mot underlaget for et opplager (modellkoordinater). */
function supportDown(support: Support, dirs: V3[]): V3 {
  if (support.type === "roller") {
    const a = ((support.angle_deg ?? 0) * Math.PI) / 180;
    const d = v3(Math.sin(a), -Math.cos(a));
    return dirs.some((m) => dot3(m, d) > 0.7) ? times(d, -1) : d;
  }
  const sum = dirs.reduce((s, d) => plus(s, d), v3(0, 0));
  if (norm3(sum) > 0.3) {
    const away = unit3(times(sum, -1));
    const axes = [v3(0, -1), v3(-1, 0), v3(1, 0), v3(0, 1)];
    return axes.find((ax) => dot3(ax, away) > Math.cos((15 * Math.PI) / 180)) ?? away;
  }
  return [v3(0, -1), v3(-1, 0), v3(1, 0), v3(0, 1)].find((ax) => !dirs.some((d) => dot3(ax, d) > 0.7)) ?? v3(0, -1);
}

function sphere(pts: V3[]): { center: V3; radius: number } {
  if (!pts.length) return { center: [0, 0, 0], radius: 1 };
  const lo = pts.reduce((a, p) => v3(Math.min(a[0], p[0]), Math.min(a[1], p[1]), Math.min(a[2], p[2])));
  const hi = pts.reduce((a, p) => v3(Math.max(a[0], p[0]), Math.max(a[1], p[1]), Math.max(a[2], p[2])));
  const center = times(plus(lo, hi), 0.5);
  return { center, radius: Math.max(1e-9, ...pts.map((p) => norm3(minus(p, center)))) };
}

interface CutContext {
  forces: CutForces;
  faceCenter(part: 0 | 1): V3;
  t: V3;
  n: V3;
  isTruss: boolean;
  isHidden(q: "N" | "V" | "M"): boolean;
  cutDisplay: MemberDisplay;
  S: number;
  margin: number;
}

/** N, V og M på begge snittflatene, med symbol som etikett (tallene står under figuren). */
function addCutForces(
  scene: Scene3D,
  c: CutContext & { lenOf(F: number, masked: boolean): number; tiny(F: number): boolean; lenNShown: number; shaft: number },
) {
  const { forces, t, n, S } = c;
  for (const part of [0, 1] as const) {
    const face = c.faceCenter(part);
    const out = part === 0 ? t : times(t, -1);
    // N: strekk trekker ut av flaten.
    if (!c.tiny(forces.N)) {
      const arrow = sidedArrow(face, times(out, forces.N >= 0 ? 1 : -1), out, c.lenNShown, c.margin, "N", c.shaft);
      scene.arrows.push(arrow);
      scene.labels.push({ at: plus(farEnd(arrow, face), times(n, -0.035 * S)), tone: "N", symbol: "N", kind: "symbol" });
    }
    if (c.isTruss) continue;
    // V: −V langs y' på i-siden, +V på j-siden.
    if (!c.tiny(forces.V)) {
      const sign = (part === 0 ? -1 : 1) * (Math.sign(forces.V) || 1);
      const dir = times(n, sign);
      const len = c.lenOf(forces.V, c.isHidden("V"));
      const mid = plus(face, times(out, 0.018 * S));
      const arrow = { tail: plus(mid, times(dir, -len / 2)), tip: plus(mid, times(dir, len / 2)), tone: "V" as const, radius: c.shaft };
      scene.arrows.push(arrow);
      scene.labels.push({ at: plus(arrow.tip, plus(times(dir, 0.03 * S), times(out, 0.02 * S))), tone: "V", symbol: "V", kind: "symbol" });
    }
    // M: mot klokka på i-siden for M > 0, motsatt på j-siden.
    if (!c.tiny(forces.M / S)) {
      const M = (part === 0 ? 1 : -1) * (forces.M === 0 ? 1 : forces.M);
      const radius = Math.max(c.cutDisplay.half * 1.6, 0.04 * S);
      const arc = momentArc(plus(face, v3(0, 0, c.cutDisplay.halfWidth + 0.01 * S)), M, radius, "M", c.shaft * 0.9, times(out, -1));
      scene.arcs.push(arc);
      // Over buen, litt inn mot delen, så de to M-ene ikke havner oppå hverandre i spalten.
      scene.labels.push({ at: plus(plus(arc.center, times(n, radius + 0.03 * S)), times(out, -0.55 * radius)), tone: "M", symbol: "M", kind: "symbol" });
    }
  }
}

/** σ som piler ut av og inn i snittflatene, og τ som diagram i flatens plan. */
function addStresses(scene: Scene3D, c: CutContext & { model: Model; cutMember: string; sigmaShown: number; thin: number }) {
  const { forces, t, n, S, model } = c;
  const member = model.members.find((m) => m.id === c.cutMember)!;
  const section = model.sections.find((s) => s.id === member.section);
  const profile = stressProfile(section, forces);
  const g = profile.geometry;
  const k = c.cutDisplay.k;
  const sigmaMax = Math.max(...profile.samples.map((s) => Math.abs(s.sigma)), 1e-300);
  const tauMax = Math.max(...profile.samples.map((s) => Math.abs(s.tau)), 1e-300);
  const rows = 9;
  const W = g.width;

  for (const part of [0, 1] as const) {
    const face = c.faceCenter(part);
    const out = part === 0 ? t : times(t, -1);
    const pointAt = (y: number, z: number, along = 0) => plus(plus(plus(face, times(n, y * k)), v3(0, 0, z * k)), times(out, along));
    // σ: rader over høyden, kolonner der det er materiale.
    for (let i = 0; i < rows; i++) {
      const y = g.bottom + ((g.top - g.bottom) * i) / (rows - 1);
      const probe = i === 0 ? y + 1e-9 * (g.top - g.bottom) : i === rows - 1 ? y - 1e-9 * (g.top - g.bottom) : y;
      const sigma = profile.samples.reduce((best, s) => (Math.abs(s.y - y) < Math.abs(best.y - y) ? s : best)).sigma;
      const len = (c.sigmaShown * Math.abs(sigma)) / sigmaMax;
      if (len < 0.004 * S) continue;
      for (const z of columns(intervalsAt(g, probe), W)) {
        const base = pointAt(y, z);
        const tone: Tone = sigma >= 0 ? "tension" : "compression";
        scene.arrows.push(sidedArrow(base, times(out, sigma >= 0 ? 1 : -1), out, len, 0.002 * S, tone, c.thin));
      }
    }
    // Omhylningen i midtplanet og linjen langs flaten.
    const envelope = profile.samples.map((s) => pointAt(s.y, 0, 0.002 * S + (c.sigmaShown * Math.abs(s.sigma)) / sigmaMax));
    scene.lines.push({ points: [pointAt(g.bottom, 0), ...envelope, pointAt(g.top, 0)], tone: "muted" });
    if (profile.neutralAxis !== undefined) {
      const y = profile.neutralAxis;
      scene.lines.push({ points: [pointAt(y, -W / 2 - 0.15 * W, 0.001 * S), pointAt(y, W / 2 + 0.15 * W, 0.001 * S)], tone: "muted", dashed: true });
    }
    const top = envelope[envelope.length - 1]!;
    scene.labels.push({ at: plus(top, times(n, 0.03 * S)), tone: Math.abs(profile.sigmaTop) >= Math.abs(profile.sigmaBottom) ? (profile.sigmaTop >= 0 ? "tension" : "compression") : profile.sigmaBottom >= 0 ? "tension" : "compression", symbol: "σ", kind: "symbol" });

    // τ: diagram i flatens plan, foran tverrsnittet, med en pil for retningen.
    if (c.isTruss || tauMax <= 1e-300 || Math.abs(forces.V) === 0) continue;
    const z0 = W / 2 + 0.25 * W;
    const tauLen = SCALE.tau * S;
    const axisZ = z0 * k + 0.012 * S;
    const inPlane = (y: number, dz: number) => plus(plus(face, times(n, y * k)), v3(0, 0, axisZ + dz));
    const curve = profile.samples.map((s) => inPlane(s.y, (tauLen * Math.abs(s.tau)) / tauMax));
    scene.lines.push({ points: [inPlane(g.bottom, 0), inPlane(g.top, 0)], tone: "tau" });
    scene.lines.push({ points: [inPlane(g.bottom, 0), ...curve, inPlane(g.top, 0)], tone: "tau" });
    for (let i = 1; i < 12; i++) {
      const y = g.bottom + ((g.top - g.bottom) * i) / 12;
      const s = profile.samples.reduce((best, x) => (Math.abs(x.y - y) < Math.abs(best.y - y) ? x : best));
      const dz = (tauLen * Math.abs(s.tau)) / tauMax;
      if (dz > 0.003 * S) scene.lines.push({ points: [inPlane(y, 0), inPlane(y, dz)], tone: "tau" });
    }
    const sign = (part === 0 ? -1 : 1) * (Math.sign(forces.V) || 1);
    const h = (g.top - g.bottom) * k;
    const mid = inPlane((g.top + g.bottom) / 2, -0.012 * S);
    scene.arrows.push({ tail: plus(mid, times(n, (-sign * h) / 2)), tip: plus(mid, times(n, (sign * h) / 2)), tone: "tau", radius: c.thin });
    scene.labels.push({ at: inPlane(g.top, tauLen * 0.5 + 0.02 * S), tone: "tau", symbol: "τ", kind: "symbol" });
  }
}

/** z-posisjonene til pilene i en rad: midt i smale biter, ellers tre per bit. */
function columns(intervals: [number, number][], width: number): number[] {
  const out: number[] = [];
  for (const [a, b] of intervals) {
    const w = b - a;
    if (w < 0.3 * width) out.push((a + b) / 2);
    else out.push(a + w / 6, (a + b) / 2, b - w / 6);
  }
  return out;
}
