/**
 * Plassering av tallene i diagrammene med en enkel kollisjonssjekk: viktigste tall først, og hvert
 * tall prøver noen posisjoner rundt kurvepunktet til det finner en ledig plass.
 */
import type { Point } from "../geometry";

/** Akseparallelt rektangel i skjermkoordinater. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type Segment = [Point, Point];

export const LABEL_FONT_SIZE = 12;

/** Omtrentlig tekstbredde (Helvetica/system-ui), nok til kollisjonssjekk. */
export function textWidth(text: string, fontSize = LABEL_FONT_SIZE): number {
  return text.length * fontSize * 0.58 + 2;
}

export function boxAround(center: Point, w: number, h: number): Box {
  return { x0: center.x - w / 2, y0: center.y - h / 2, x1: center.x + w / 2, y1: center.y + h / 2 };
}

export function boxesOverlap(a: Box, b: Box, margin = 0): boolean {
  return a.x0 < b.x1 + margin && b.x0 < a.x1 + margin && a.y0 < b.y1 + margin && b.y0 < a.y1 + margin;
}

/** Om et linjestykke skjærer (eller ligger inne i) et rektangel (Liang–Barsky). */
export function segmentHitsBox([p, q]: Segment, b: Box): boolean {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  let t0 = 0;
  let t1 = 1;
  const clip = (den: number, num: number) => {
    if (den === 0) return num >= 0;
    const t = num / den;
    if (den < 0) {
      // På vei inn i rektangelet
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      // På vei ut
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  return clip(-dx, p.x - b.x0) && clip(dx, b.x1 - p.x) && clip(-dy, p.y - b.y0) && clip(dy, b.y1 - p.y) && t0 <= t1;
}

export function unionBox(boxes: Box[]): Box | undefined {
  if (!boxes.length) return undefined;
  return boxes.reduce((a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }));
}

export function pointsBox(points: Point[], pad = 0): Box | undefined {
  if (!points.length) return undefined;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
}

export interface LabelRequest {
  text: string;
  /** Punktet på kurven tallet hører til. */
  anchor: Point;
  /** Enhetsvektor (skjerm) fra aksen mot kurven: tallet legges utenfor kurven i denne retningen. */
  normal: Point;
  /** Enhetsvektor (skjerm) langs elementet, i → j. */
  tangent: Point;
  /** Foretrukket forskyvning langs elementet: −1 mot i-enden, +1 mot j-enden (f.eks. ved sprang). */
  shift: -1 | 0 | 1;
  /** Lavere tall plasseres først. */
  priority: number;
  /** For rekkefølge innen samme prioritet: større verdier først. */
  magnitude: number;
  /** Avstanden fra aksen til kurven i piksler (for plassering inne i flaten). */
  depth: number;
  emphasis?: boolean;
  /** Kurven tallet hører til (f.eks. elementkjeden). */
  group?: string;
  /** true: tallet er skjult, og teksten er bare en plassholder («?»). */
  masked?: boolean;
}

export interface PlacedLabel {
  text: string;
  /** Punktet på kurven og punktet på aksen tallet hører til. */
  anchor: Point;
  base: Point;
  group?: string;
  /** Midten av teksten. */
  x: number;
  y: number;
  box: Box;
  emphasis: boolean;
  masked: boolean;
}

export interface Obstacles {
  boxes: Box[];
  segments: Segment[];
}

const GAP = 3;

/** Kandidatposisjoner (midtpunkt) for et tall, i prioritert rekkefølge. */
function candidates(r: LabelRequest, w: number, h: number): Point[] {
  const { anchor: a, normal: n, tangent: t } = r;
  const en = (Math.abs(n.x) * w) / 2 + (Math.abs(n.y) * h) / 2;
  const et = (Math.abs(t.x) * w) / 2 + (Math.abs(t.y) * h) / 2;
  const shifts = [...new Set([r.shift * (et + 2), 0, et + 2, -(et + 2), 2 * (et + 2), -2 * (et + 2)])];
  const at = (out: number, s: number): Point => ({ x: a.x + n.x * out + t.x * s, y: a.y + n.y * out + t.y * s });
  const out: Point[] = [];
  for (let layer = 0; layer < 3; layer++) for (const s of shifts) out.push(at(GAP + en + layer * (Math.abs(n.y) * h + Math.abs(n.x) * w * 0.5 + 2), s));
  // Inne i flaten, og til slutt på motsatt side av aksen.
  if (r.depth > 2 * en + 2 * GAP) for (const s of shifts) out.push(at(-(GAP + en), s));
  for (const s of shifts) out.push(at(-(r.depth + GAP + en), s));
  return out;
}

export interface PlaceOptions {
  fontSize?: number;
  /** Like tall i samme punkt på aksen fra ulike kurver skrives én gang (M rundt et hjørne). */
  dedupeAcrossGroups?: boolean;
}

/**
 * Plasserer tallene grådig etter prioritet. Et tall som ikke får plass uten å overlappe et annet
 * tall, utelates. Først prøves posisjoner som heller ikke krysser streker (`obstacles.segments`),
 * deretter posisjoner som bare unngår andre tall og symboler.
 */
export function placeLabels(requests: LabelRequest[], obstacles: Obstacles, bounds: { x0: number; x1: number }, options: PlaceOptions = {}): PlacedLabel[] {
  const fontSize = options.fontSize ?? LABEL_FONT_SIZE;
  const placed: PlacedLabel[] = [];
  const h = fontSize + 2;
  const order = [...requests].sort((a, b) => a.priority - b.priority || b.magnitude - a.magnitude);
  const inBounds = (b: Box) => b.x0 >= bounds.x0 && b.x1 <= bounds.x1;
  const freeOfLabels = (b: Box) => !placed.some((p) => boxesOverlap(p.box, b, 2)) && !obstacles.boxes.some((o) => boxesOverlap(o, b, 1));
  const freeOfLines = (b: Box) => !obstacles.segments.some((s) => segmentHitsBox(s, b));
  for (const r of order) {
    const base = { x: r.anchor.x - r.normal.x * r.depth, y: r.anchor.y - r.normal.y * r.depth };
    const duplicate = (p: PlacedLabel) => p.group !== r.group && p.text === r.text && Math.hypot(p.base.x - base.x, p.base.y - base.y) < 4;
    if (options.dedupeAcrossGroups && placed.some(duplicate)) continue;
    const w = textWidth(r.text, fontSize);
    const boxes = candidates(r, w, h).map((c) => ({ c, box: boxAround(c, w, h) }));
    const pick = boxes.find(({ box }) => inBounds(box) && freeOfLabels(box) && freeOfLines(box)) ?? boxes.find(({ box }) => inBounds(box) && freeOfLabels(box));
    if (pick) placed.push({ text: r.text, anchor: r.anchor, base, group: r.group, x: pick.c.x, y: pick.c.y, box: pick.box, emphasis: r.emphasis ?? false, masked: r.masked ?? false });
  }
  return placed;
}
