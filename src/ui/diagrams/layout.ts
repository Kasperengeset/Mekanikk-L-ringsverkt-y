/**
 * Alt som tegnes i diagrampanelene (N, V, M og deformert form), regnet ut i skjermkoordinater.
 * Rent: ingen React og ingen store, så det kan testes og rendres uten nettleser.
 *
 * Panelene bruker konstruksjonens skala og venstrekant (samme x-akse som oppgaven). Hvert panel
 * er så høyt som innholdet krever, så ingenting havner utenfor.
 *
 * Skjulte tall (options.hidden, fra hiddenValues i src/core/pedagogy.ts): formen tegnes som før,
 * men tallene byttes med «?» på de samme karakteristiske punktene, så studenten ser hvor tallene står.
 */
import { isDiagramValueHidden, type HiddenValues } from "../../core/pedagogy.js";
import type { Model, SupportType } from "../../core/schema.js";
import { displacedPoint, evalPoly, type MemberResult, type SolveResult } from "../../core/solver/index.js";
import { positiveSide, type Quantity } from "../convention.js";
import { formatNumber, formatQuantity } from "../format.js";
import { fitViewport, originXOf, type Point, type Viewport } from "../geometry.js";
import type { DiagramPoint, DiagramSettings } from "../state/store.js";
import { placeLabels, pointsBox, textWidth, unionBox, type Box, type LabelRequest, type PlacedLabel, type Segment } from "./labels.js";
import { characteristicPoints, joinPieces, maxAbs, samplePieces, signChanges, signRegions, valueAt } from "./sampling.js";

export const LAYOUT = {
  /** Utslaget i piksler for største |verdi| av hver størrelse. */
  amplitude: 60,
  /** Nedre grense når utslaget må krympes for å holde seg innenfor bredden. */
  minAmplitude: 16,
  /** Utslaget i rene fagverk (smale bånd langs stavene). */
  trussAmplitude: 26,
  /** Høyden til tittellinjen og hver merknadslinje. */
  title: 24,
  noteLine: 17,
  /** Luft over og under innholdet i et panel. */
  pad: 12,
  /** Minste avstand fra venstre og høyre kant. */
  margin: 6,
  toolbar: 38,
  /** Avstand mellom skraveringsstrekene i piksler. */
  hatch: 7,
  /** Deformert form: største forskyvning som andel av konstruksjonens største mål ved "auto". */
  autoDeformation: 0.1,
} as const;

export const DEFAULT_SETTINGS: DiagramSettings = { N: true, V: true, M: true, deformed: true, deformationScale: "auto" };

export const TITLES: Record<Quantity | "deformed", string> = {
  N: "N – normalkraft",
  V: "V – skjærkraft",
  M: "M – bøyemoment, tegnet på strekksiden",
  deformed: "Deformert form",
};

export interface SupportGlyph {
  type: SupportType;
  x: number;
  y: number;
  /** Rotasjon i grader (SVG, med klokka). Symbolet tegnes med lokal +y bort fra konstruksjonen. */
  angle: number;
}

/** Konstruksjonen tegnet svakt (eller stiplet) i et panel. */
export interface Sketch {
  members: Segment[];
  hinges: Point[];
  supports: SupportGlyph[];
}

export interface MemberDiagram {
  member: string;
  /** Lukket kontur: aksen i i-enden, kurven, aksen i j-enden. */
  outline: Point[];
  /** Skravur vinkelrett på aksen, fra aksen til kurven. */
  hatch: Segment[];
}

/** Virkningssymbol: lite element med piler (strekk/trykk for N, skjærpar for V). */
export interface ActionSymbol {
  kind: "N" | "V";
  x: number;
  y: number;
  /** Elementets retning på skjermen i grader (SVG-rotasjon). */
  angle: number;
  sign: 1 | -1;
  box: Box;
}

export type NoteGlyph = "tension" | "compression" | "inflection";

/** Tekst i panelets overskrift (under tittelen), plassert ferdig. */
export interface Note {
  text: string;
  tone: "muted" | "warning";
  glyph?: NoteGlyph;
  x: number;
  y: number;
}

interface PanelBase {
  top: number;
  height: number;
  /** Høyden til tittelen og merknadene øverst i panelet (innholdet begynner under). */
  headerHeight: number;
  title: string;
  notes: Note[];
}

/** Uthevet punkt i et diagram: punktet på kurven og punktet på aksen under det. */
export interface DiagramMarker {
  point: Point;
  base: Point;
}

export interface ForcePanel extends PanelBase {
  kind: Quantity;
  /** true: størrelsen er null overalt, og panelet har bare overskrift. */
  zero: boolean;
  /** Piksler for største |verdi|. */
  amplitude: number;
  maxValue: number;
  sketch: Sketch;
  diagrams: MemberDiagram[];
  labels: PlacedLabel[];
  symbols: ActionSymbol[];
  /** M-panelet: nullpunkter med fortegnsskifte (vendepunktene i den deformerte formen), på aksen. */
  inflections: Point[];
  /** Punktet som er uthevet (options.highlight), når det hører til dette panelet. */
  highlight?: DiagramMarker;
}

export interface DeformedPanel extends PanelBase {
  kind: "deformed";
  sketch: Sketch;
  /** Én polylinje per element. */
  shapes: Point[][];
  inflections: Point[];
  labels: PlacedLabel[];
  /** Punktet med størst forskyvning (bare når formen er kvantitativ). */
  maxPoint?: Point;
  /** Forstørrelsen som er brukt. */
  scale: number;
  /** Største forskyvning i meter. */
  maxDisplacement: number;
  qualitative: boolean;
  /** true: tallet for største forskyvning er skjult (studenten har ikke prøvd ennå). */
  valueHidden: boolean;
  /** Klippeflate: forskyvninger med svært stor forstørrelse kuttes ved panelkanten. */
  clip: Box;
}

export type Panel = ForcePanel | DeformedPanel;

export interface DiagramLayout {
  width: number;
  height: number;
  /** Y der panelene begynner (under verktøylinjen, hvis den vises). */
  top: number;
  panels: Panel[];
  /** Melding i stedet for diagrammer når løsningen ikke er ok. */
  message?: string[];
  /** Forstørrelsen den deformerte formen fikk (for knappene i verktøylinjen). */
  deformationScale?: number;
}

export interface LayoutOptions {
  /** Plass over panelene (f.eks. til en verktøylinje). */
  top?: number;
  /** Tall som er skjult til studenten har prøvd selv. Uten den vises alle tall. */
  hidden?: HiddenValues;
  /** Punkt i et diagram som skal utheves (agentens highlight). */
  highlight?: DiagramPoint | null;
}

/** Tekst i stedet for et skjult tall. */
export const HIDDEN_TEXT = "?";

type OkResult = Extract<SolveResult, { status: "ok" }>;

interface Mapper {
  model(p: Point): Point;
  si(p: Point): Point;
}

interface Context {
  model: Model;
  result: OkResult;
  width: number;
  scale: number;
  originX: number;
  pxPerMeter: number;
  maxAbs: Record<Quantity, number>;
  maxDimSI: number;
  hidden?: HiddenValues;
  highlight?: DiagramPoint | null;
}

const DEG = 180 / Math.PI;
const allTruss = (r: OkResult) => r.members.length > 0 && r.members.every((m) => m.kind === "truss");

export function layoutDiagrams(model: Model, result: SolveResult, viewport: Viewport, settings: DiagramSettings = DEFAULT_SETTINGS, options: LayoutOptions = {}): DiagramLayout {
  const width = viewport.width;
  const top = options.top ?? 0;
  if (result.status !== "ok") {
    const message = wrap(statusMessage(result), width - 2 * LAYOUT.margin - 16, 13);
    return { width, top, height: top + 24 + message.length * 18, panels: [], message };
  }

  const vp = fitViewport(model, width, 0, { scale: viewport.scale, originX: originXOf(viewport) });
  const spanX = vp.bounds.maxX - vp.bounds.minX;
  const spanY = vp.bounds.maxY - vp.bounds.minY;
  const ctx: Context = {
    model,
    result,
    width,
    scale: vp.scale,
    originX: originXOf(vp),
    pxPerMeter: vp.scale / vp.lengthFactor,
    maxAbs: { N: maxAbs(result.members, "N"), V: maxAbs(result.members, "V"), M: maxAbs(result.members, "M") },
    maxDimSI: Math.max(spanX, spanY) * vp.lengthFactor,
    hidden: options.hidden,
    highlight: options.highlight,
  };

  const panels: Panel[] = [];
  let y = top;
  const truss = allTruss(result);
  for (const q of ["N", "V", "M"] as const) {
    if (!settings[q] || (truss && q !== "N")) continue;
    const panel = forcePanel(ctx, q, y, truss);
    panels.push(panel);
    y += panel.height;
  }
  let deformationScale: number | undefined;
  if (settings.deformed) {
    const panel = deformedPanel(ctx, settings.deformationScale, y);
    deformationScale = panel.scale;
    panels.push(panel);
    y += panel.height;
  }
  return { width, top, height: Math.max(y, top + 1), panels, deformationScale };
}

function statusMessage(result: Exclude<SolveResult, { status: "ok" }>): string[] {
  switch (result.status) {
    case "mechanism":
      return [result.message, "Diagrammene kan ikke tegnes for en mekanisme."];
    case "invalid":
      return ["Modellen er ugyldig, så diagrammene kan ikke tegnes:", ...result.issues.filter((i) => i.level === "error").map((i) => `• ${i.message}`)];
    case "equilibrium_failed":
      return ["Likevektskontrollen feilet, så diagrammene vises ikke."];
  }
}

/** Enkel linjebryting etter omtrentlig tekstbredde. */
function wrap(lines: string[], maxWidth: number, fontSize: number): string[] {
  const out: string[] = [];
  for (const line of lines) {
    let current = "";
    for (const word of line.split(" ")) {
      const next = current ? `${current} ${word}` : word;
      if (current && textWidth(next, fontSize) > maxWidth) {
        out.push(current);
        current = word;
      } else current = next;
    }
    if (current) out.push(current);
  }
  return out;
}

/** Plasserer merknadene etter hverandre på linjer under tittelen. */
function flowNotes(items: Omit<Note, "x" | "y">[], top: number, width: number): { notes: Note[]; height: number } {
  const notes: Note[] = [];
  let x = 12;
  let line = 0;
  for (const item of items) {
    const w = (item.glyph ? 34 : 0) + textWidth(item.text, 11);
    if (x > 12 && x + w > width - 12) {
      line++;
      x = 12;
    }
    notes.push({ ...item, x, y: top + LAYOUT.title + line * LAYOUT.noteLine + 9 });
    x += w + 18;
  }
  return { notes, height: LAYOUT.title + (items.length ? (line + 1) * LAYOUT.noteLine : 0) };
}

function mapper(ctx: Context, dy: number): Mapper {
  const vp = fitViewport(ctx.model, ctx.width, 0, { scale: ctx.scale, originX: ctx.originX });
  const shift = (p: Point) => ({ x: p.x, y: p.y + dy });
  return { model: (p) => shift(vp.toScreen(p)), si: (p) => shift(vp.siToScreen(p)) };
}

/** Rotert omsluttende boks for et lokalt rektangel [x0, x1] × [y0, y1] rundt (cx, cy). */
function rotatedBox(cx: number, cy: number, angleDeg: number, x0: number, x1: number, y0: number, y1: number): Box {
  const a = angleDeg / DEG;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const pts = [
    [x0, y0],
    [x1, y0],
    [x0, y1],
    [x1, y1],
  ].map(([x, y]) => ({ x: cx + x! * c - y! * s, y: cy + x! * s + y! * c }));
  return pointsBox(pts)!;
}

function sketch(ctx: Context, map: Mapper): { sketch: Sketch; boxes: Box[] } {
  const { model } = ctx;
  const pos = new Map(model.nodes.map((n) => [n.id, map.model(n)]));
  const members: Segment[] = model.members.map((m) => [pos.get(m.i)!, pos.get(m.j)!]);
  const hinges: Point[] = [];
  for (const m of model.members) {
    if (m.kind !== "beam") continue;
    if (m.release?.i) hinges.push(pos.get(m.i)!);
    if (m.release?.j) hinges.push(pos.get(m.j)!);
  }
  const supports: SupportGlyph[] = [];
  const boxes: Box[] = [];
  for (const s of model.supports) {
    const p = pos.get(s.node);
    if (!p) continue;
    let angle = 0;
    if (s.type === "roller") angle = -(s.angle_deg ?? 0);
    else if (s.type === "fixed") {
      const m = model.members.find((mm) => mm.i === s.node || mm.j === s.node);
      const other = m ? pos.get(m.i === s.node ? m.j : m.i) : undefined;
      if (other) {
        const len = Math.hypot(other.x - p.x, other.y - p.y) || 1;
        const away = { x: (p.x - other.x) / len, y: (p.y - other.y) / len };
        angle = Math.atan2(-away.x, away.y) * DEG;
      }
    }
    supports.push({ type: s.type, x: p.x, y: p.y, angle });
    boxes.push(rotatedBox(p.x, p.y, angle, -13, 13, -2, 20));
  }
  return { sketch: { members, hinges, supports }, boxes };
}

/**
 * Elementer som fortsetter hverandre på rett linje (samme retning og type, og bare de to i noden),
 * slått sammen i rekkefølge fra i mot j. Hvert element er med i nøyaktig én kjede.
 */
export function memberChains(model: Model, members: MemberResult[]): MemberResult[][] {
  const byId = new Map(model.members.map((m) => [m.id, m]));
  const count = new Map<string, number>();
  for (const m of model.members) for (const n of [m.i, m.j]) count.set(n, (count.get(n) ?? 0) + 1);
  const next = new Map<string, MemberResult>();
  const hasPrev = new Set<string>();
  for (const a of members) {
    const j = byId.get(a.id)?.j;
    if (j === undefined || count.get(j) !== 2) continue;
    const b = members.find(
      (m) => m !== a && byId.get(m.id)?.i === j && m.kind === a.kind && Math.abs(m.cos - a.cos) < 1e-9 && Math.abs(m.sin - a.sin) < 1e-9,
    );
    if (b) {
      next.set(a.id, b);
      hasPrev.add(b.id);
    }
  }
  const chains: MemberResult[][] = [];
  for (const m of members) {
    if (hasPrev.has(m.id)) continue;
    const chain = [m];
    for (let cur = next.get(m.id); cur; cur = next.get(cur.id)) chain.push(cur);
    chains.push(chain);
  }
  return chains;
}

/** Funksjoner for ett element i et panel: punkt på aksen og punkt på kurven. */
function memberFrame(m: MemberResult, map: Mapper, q: Quantity) {
  const axis = (x: number) => map.si({ x: m.start.x + x * m.cos, y: m.start.y + x * m.sin });
  const side = positiveSide(q, m.cos, m.sin);
  const normal = { x: side.x, y: -side.y };
  const tangent = { x: m.cos, y: -m.sin };
  return { axis, normal, tangent };
}

const SYMBOL_EXTENT = { N: { hx: 15, hy: 5 }, V: { hx: 9, hy: 8 } } as const;
const PRIORITY = { extreme: 0, jump: 1, end: 1, constant: 1, boundary: 2 } as const;

/** Største utslag som holder alle kurvepunkter innenfor bredden (elementer nær kanten). */
function fitAmplitude(ctx: Context, q: Quantity, truss: boolean): number {
  const max = ctx.maxAbs[q];
  let amp: number = LAYOUT.amplitude;
  if (truss) {
    // Fagverk: smale bånd, så stavkreftene ikke dekker hverandre i knutepunktene.
    const shortest = Math.min(...ctx.result.members.map((m) => m.length * ctx.pxPerMeter));
    amp = Math.max(LAYOUT.minAmplitude, Math.min(LAYOUT.trussAmplitude, 0.15 * shortest));
  }
  const map = mapper(ctx, 0);
  for (const m of ctx.result.members) {
    if (m.kind === "truss" && q !== "N") continue;
    const { axis, normal } = memberFrame(m, map, q);
    for (const s of samplePieces(m.pieces, q, 4 / ctx.pxPerMeter)) {
      const k = (normal.x * s.value) / max;
      if (Math.abs(k) < 1e-12) continue;
      const x = axis(s.x).x;
      const room = k > 0 ? ctx.width - LAYOUT.margin - x : x - LAYOUT.margin;
      amp = Math.min(amp, room / Math.abs(k));
    }
  }
  return Math.max(LAYOUT.minAmplitude, amp);
}

interface Content {
  sketch: Sketch;
  diagrams: MemberDiagram[];
  labels: PlacedLabel[];
  symbols: ActionSymbol[];
  inflections: Point[];
  highlight?: DiagramMarker;
  bbox: Box;
}

/** Startpunktet (lokal x fra kjedens i-ende) for hvert element i en kjede. */
function chainOffsets(chain: MemberResult[]): number[] {
  const out: number[] = [];
  let x = 0;
  for (const m of chain) {
    out.push(x);
    x += m.length;
  }
  return out;
}

function forceContent(ctx: Context, q: Quantity, map: Mapper, amp: number): Content {
  const { model } = ctx;
  const max = ctx.maxAbs[q];
  const px = amp / max;
  const tol = 1e-6 * max;
  const step = 3 / ctx.pxPerMeter;
  const { sketch: sk, boxes: supportBoxes } = sketch(ctx, map);
  const diagrams: MemberDiagram[] = [];
  const symbols: ActionSymbol[] = [];
  const inflections: Point[] = [];
  const requests: LabelRequest[] = [];
  const kind = q === "M" ? "moment" : "force";
  let highlight: DiagramMarker | undefined;

  for (const chain of memberChains(model, ctx.result.members)) {
    const first = chain[0]!;
    if (first.kind === "truss" && q !== "N") continue;
    // Elementer på rett linje tegnes som ett diagram: kontinuerlige verdier i en node gir ingen strek,
    // og et sprang i en node blir en loddrett strek som et sprang inne i et element.
    const pieces = chain.length === 1 ? first.pieces : joinPieces(chain);
    const length = chain.reduce((sum, m) => sum + m.length, 0);
    const group = chain.map((m) => m.id).join("+");
    const { axis, normal, tangent } = memberFrame(first, map, q);
    const at = (x: number, v: number) => {
      const a = axis(x);
      return { x: a.x + normal.x * v * px, y: a.y + normal.y * v * px };
    };
    const offsets = chainOffsets(chain);
    const eps = 1e-9 * length;
    // Et tall i en node mellom to elementer er skjult når det er skjult i ett av dem.
    const hiddenAt = (x: number) =>
      ctx.hidden !== undefined && chain.some((m, k) => x >= offsets[k]! - eps && x <= offsets[k]! + m.length + eps && isDiagramValueHidden(ctx.hidden!, q, m.id));

    // Uthevingen bruker elementets egne biter; i et sprang gjelder verdien like før (som valueAt).
    const hl = ctx.highlight;
    const hk = hl && hl.quantity === q ? chain.findIndex((m) => m.id === hl.member) : -1;
    if (hl && hk >= 0) {
      const m = chain[hk]!;
      const xLocal = Math.min(1, Math.max(0, hl.at)) * m.length;
      const piece = m.pieces.find((p) => xLocal <= p.x1) ?? m.pieces[m.pieces.length - 1];
      const v = piece ? evalPoly(piece[q], xLocal) : 0;
      const x = offsets[hk]! + xLocal;
      highlight = { point: at(x, v), base: axis(x) };
    }

    const samples = samplePieces(pieces, q, step);
    if (samples.every((s) => Math.abs(s.value) <= tol)) {
      // Nullstav i et fagverk: skriv 0, det er en del av svaret.
      if (first.kind === "truss") {
        for (const [k, m] of chain.entries()) {
          const masked = ctx.hidden !== undefined && isDiagramValueHidden(ctx.hidden, q, m.id);
          const text = masked ? HIDDEN_TEXT : "0";
          requests.push({ text, anchor: axis(offsets[k]! + m.length / 2), normal, tangent, shift: 0, priority: 3, magnitude: 0, depth: 0, group, masked });
        }
      }
      continue;
    }

    const outline = [axis(0), ...samples.map((s) => at(s.x, s.value)), axis(length)];
    const hatch: Segment[] = [];
    const count = Math.floor((length * ctx.pxPerMeter) / LAYOUT.hatch);
    for (let k = 1; k < count; k++) {
      const x = (length * k) / count;
      const v = valueAt(pieces, q, x);
      if (Math.abs(v) * px > 1.5) hatch.push([axis(x), at(x, v)]);
    }
    diagrams.push({ member: group, outline, hatch });

    for (const cp of characteristicPoints(pieces, q, tol)) {
      const sign = cp.value > 0 ? 1 : -1;
      const masked = hiddenAt(cp.x);
      requests.push({
        text: masked ? HIDDEN_TEXT : formatQuantity(kind, Math.abs(cp.value), model),
        anchor: at(cp.x, cp.value),
        normal: { x: normal.x * sign, y: normal.y * sign },
        tangent,
        shift: cp.kind === "jump" ? cp.side : cp.kind === "end" ? (cp.x < length / 2 ? 1 : -1) : 0,
        priority: PRIORITY[cp.kind],
        magnitude: Math.abs(cp.value),
        depth: Math.abs(cp.value) * px,
        emphasis: !masked && Math.abs(cp.value) >= max * (1 - 1e-9),
        group,
        masked,
      });
    }

    if (q !== "M") {
      const angle = Math.atan2(tangent.y, tangent.x) * DEG;
      const { hx, hy } = SYMBOL_EXTENT[q];
      for (const r of signRegions(pieces, q, tol)) {
        if ((r.x1 - r.x0) * ctx.pxPerMeter < 2 * hx + 6) continue;
        const xm = (r.x0 + r.x1) / 2;
        const depth = Math.abs(valueAt(pieces, q, xm)) * px;
        const out = depth >= 2 * hy + 8 ? depth / 2 : depth + 4 + hy;
        const a = axis(xm);
        const c = { x: a.x + normal.x * r.sign * out, y: a.y + normal.y * r.sign * out };
        symbols.push({ kind: q, x: c.x, y: c.y, angle, sign: r.sign, box: rotatedBox(c.x, c.y, angle, -hx, hx, -hy, hy) });
      }
    } else {
      // Vendepunkter per element: M = 0 i et momentledd er en knekk, ikke et vendepunkt.
      let offset = 0;
      for (const m of chain) {
        if (m.kind === "beam") for (const x of signChanges(m.pieces, "M", tol)) inflections.push(axis(offset + x));
        offset += m.length;
      }
    }
  }

  const segments: Segment[] = [...sk.members];
  for (const d of diagrams) for (let k = 0; k + 1 < d.outline.length; k++) segments.push([d.outline[k]!, d.outline[k + 1]!]);
  const labels = placeLabels(
    requests,
    { boxes: [...symbols.map((s) => s.box), ...supportBoxes], segments },
    { x0: LAYOUT.margin, x1: ctx.width - LAYOUT.margin },
    // M er kontinuerlig rundt et stivt hjørne: samme tall på begge sider skrives én gang.
    { dedupeAcrossGroups: q === "M" },
  );

  const bbox = unionBox(
    [
      pointsBox(sk.members.flat()),
      ...supportBoxes,
      ...diagrams.map((d) => pointsBox(d.outline)),
      ...symbols.map((s) => s.box),
      ...labels.map((l) => l.box),
      pointsBox(inflections, 4),
    ].filter((b): b is Box => b !== undefined),
  )!;
  return { sketch: sk, diagrams, labels, symbols, inflections, highlight, bbox };
}

function forcePanel(ctx: Context, q: Quantity, top: number, truss: boolean): ForcePanel {
  const max = ctx.maxAbs[q];
  const ref = Math.max(ctx.maxAbs.N, ctx.maxAbs.V, ctx.maxAbs.M / Math.max(ctx.maxDimSI, 1e-9), 1e-300);
  const items: Omit<Note, "x" | "y">[] = [];
  if (q === "N" && truss) items.push({ text: "Fagverk: stavene har bare normalkraft (V = M = 0).", tone: "muted" });
  const base = { kind: q, title: TITLES[q], top, maxValue: max, sketch: { members: [], hinges: [], supports: [] }, diagrams: [], labels: [], symbols: [], inflections: [] };

  if (max <= 1e-9 * ref) {
    items.push({ text: `${q} = 0 i alle elementer.`, tone: "muted" });
    const { notes, height } = flowNotes(items, top, ctx.width);
    return { ...base, notes, height: height + 6, headerHeight: height + 6, zero: true, amplitude: 0 };
  }

  const amp = fitAmplitude(ctx, q, truss);
  const first = forceContent(ctx, q, mapper(ctx, 0), amp);
  if (q === "N") items.push({ text: "strekk", tone: "muted", glyph: "tension" }, { text: "trykk", tone: "muted", glyph: "compression" });
  if (q === "V") items.push({ text: "Pilene viser skjærkraftens virkning på et lite utsnitt.", tone: "muted" });
  if (q === "M" && first.inflections.length) items.push({ text: "M = 0 med fortegnsskifte (vendepunkt i deformert form)", tone: "muted", glyph: "inflection" });
  const { notes, height: headerHeight } = flowNotes(items, top, ctx.width);
  const contentTop = top + headerHeight + LAYOUT.pad;
  const content = forceContent(ctx, q, mapper(ctx, contentTop - first.bbox.y0), amp);
  return {
    ...base,
    ...content,
    notes,
    headerHeight,
    zero: false,
    amplitude: amp,
    height: headerHeight + 2 * LAYOUT.pad + (content.bbox.y1 - content.bbox.y0),
  };
}

interface DeformedContent {
  sketch: Sketch;
  shapes: Point[][];
  inflections: Point[];
  labels: PlacedLabel[];
  maxPoint?: Point;
  bbox: Box;
  structureBox: Box;
}

/** Punktene langs elementene den deformerte formen tegnes gjennom (lokal x, meter). */
function deformationStations(m: MemberResult, pxPerMeter: number): number[] {
  const xs: number[] = [];
  for (const p of m.deflection) {
    const n = m.kind === "truss" ? 1 : Math.min(48, Math.max(6, Math.ceil(((p.x1 - p.x0) * pxPerMeter) / 6)));
    for (let k = 0; k < n; k++) xs.push(p.x0 + ((p.x1 - p.x0) * k) / n);
  }
  xs.push(m.length);
  return xs;
}

/** Største forskyvning (meter) og hvor den er. */
export function maxDisplacement(result: OkResult, pxPerMeter = 100): { value: number; member?: MemberResult; x: number } {
  let best: { value: number; member?: MemberResult; x: number } = { value: 0, x: 0 };
  for (const m of result.members) {
    for (const x of deformationStations(m, pxPerMeter)) {
      const d = displacedPoint(m, x, 1);
      const value = Math.hypot(d.x - (m.start.x + x * m.cos), d.y - (m.start.y + x * m.sin));
      if (value > best.value) best = { value, member: m, x };
    }
  }
  return best;
}

/** Forstørrelsen for den deformerte formen. "auto": største forskyvning blir 10 % av største mål. */
export function deformationScaleFor(maxDisplacementSI: number, maxDimSI: number, setting: number | "auto"): number {
  if (setting !== "auto") return setting;
  return maxDisplacementSI > 0 ? (LAYOUT.autoDeformation * maxDimSI) / maxDisplacementSI : 0;
}

function deformedContent(ctx: Context, map: Mapper, scale: number, max: ReturnType<typeof maxDisplacement>, quantitative: boolean, masked: boolean): DeformedContent {
  const { sketch: sk, boxes } = sketch(ctx, map);
  const shapes = ctx.result.members.map((m) => deformationStations(m, ctx.pxPerMeter).map((x) => map.si(displacedPoint(m, x, scale))));
  const inflections: Point[] = [];
  for (const m of ctx.result.members) {
    if (m.kind !== "beam") continue;
    for (const x of signChanges(m.pieces, "M", 1e-6 * ctx.maxAbs.M)) inflections.push(map.si(displacedPoint(m, x, scale)));
  }
  let maxPoint: Point | undefined;
  let labels: PlacedLabel[] = [];
  if (quantitative && max.member && max.value > 0) {
    maxPoint = map.si(displacedPoint(max.member, max.x, scale));
    const m = max.member;
    const base = { x: m.start.x + max.x * m.cos, y: m.start.y + max.x * m.sin };
    const moved = displacedPoint(m, max.x, 1);
    const dir = { x: moved.x - base.x, y: -(moved.y - base.y) };
    const len = Math.hypot(dir.x, dir.y) || 1;
    const segments: Segment[] = [...sk.members];
    for (const s of shapes) for (let k = 0; k + 1 < s.length; k++) segments.push([s[k]!, s[k + 1]!]);
    labels = placeLabels(
      [
        {
          text: masked ? HIDDEN_TEXT : formatQuantity("displacement", max.value, ctx.model),
          anchor: maxPoint,
          normal: { x: dir.x / len, y: dir.y / len },
          tangent: { x: m.cos, y: -m.sin },
          shift: 0,
          priority: 0,
          magnitude: max.value,
          depth: 0,
          emphasis: !masked,
          masked,
        },
      ],
      { boxes, segments },
      { x0: LAYOUT.margin, x1: ctx.width - LAYOUT.margin },
    );
  }
  const structureBox = unionBox([pointsBox(sk.members.flat())!, ...boxes])!;
  const bbox = unionBox([structureBox, ...shapes.map((s) => pointsBox(s)!), ...labels.map((l) => l.box), pointsBox(inflections, 4)].filter((b): b is Box => b !== undefined))!;
  return { sketch: sk, shapes, inflections, labels, maxPoint, bbox, structureBox };
}

function deformedPanel(ctx: Context, setting: number | "auto", top: number): DeformedPanel {
  const { result, model } = ctx;
  const max = maxDisplacement(result, ctx.pxPerMeter);
  const scale = deformationScaleFor(max.value, ctx.maxDimSI, setting);
  const qualitative = result.deformationQualitative;
  // Forstørrelsen ved «auto» gir største forskyvning via konstruksjonens mål, så den skjules også.
  const valueHidden = (ctx.hidden?.displacementNodes.size ?? 0) > 0;
  const items: Omit<Note, "x" | "y">[] = [];
  if (max.value <= 0) items.push({ text: "Ingen forskyvninger.", tone: "muted" });
  else if (qualitative) items.push({ text: "Kvalitativ form – tverrsnitt er ikke oppgitt", tone: "warning" });
  else if (valueHidden) items.push({ text: `Største forskyvning: ${HIDDEN_TEXT} (vises når du har prøvd selv)`, tone: "muted" });
  else items.push({ text: `Største forskyvning ${formatQuantity("displacement", max.value, model)} (forstørret ×${formatNumber(scale, 2)})`, tone: "muted" });

  const first = deformedContent(ctx, mapper(ctx, 0), scale, max, !qualitative, valueHidden);
  if (first.inflections.length) items.push({ text: "vendepunkt (M skifter fortegn)", tone: "muted", glyph: "inflection" });
  items.push({ text: "stiplet: udeformert", tone: "muted" });
  const { notes, height: headerHeight } = flowNotes(items, top, ctx.width);

  // Med svært stor forstørrelse kan formen gå langt utenfor; panelet begrenses og klippes.
  const limit = 0.6 * ctx.maxDimSI * ctx.pxPerMeter + 40;
  const clampBox = (b: Box, s: Box): Box => ({ x0: b.x0, x1: b.x1, y0: Math.max(b.y0, s.y0 - limit), y1: Math.min(b.y1, s.y1 + limit) });
  const firstBox = clampBox(first.bbox, first.structureBox);
  const contentTop = top + headerHeight + LAYOUT.pad;
  const content = deformedContent(ctx, mapper(ctx, contentTop - firstBox.y0), scale, max, !qualitative, valueHidden);
  const box = clampBox(content.bbox, content.structureBox);
  const height = headerHeight + 2 * LAYOUT.pad + (box.y1 - box.y0);
  return {
    kind: "deformed",
    title: TITLES.deformed,
    top,
    height,
    headerHeight,
    notes,
    sketch: content.sketch,
    shapes: content.shapes,
    inflections: content.inflections,
    labels: content.labels,
    maxPoint: content.maxPoint,
    scale,
    maxDisplacement: max.value,
    qualitative,
    valueHidden,
    clip: { x0: 0, y0: top + headerHeight, x1: ctx.width, y1: top + height },
  };
}
