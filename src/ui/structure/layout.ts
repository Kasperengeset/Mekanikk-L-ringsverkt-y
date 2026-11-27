/**
 * Geometri for tegningen av konstruksjonen. Modellpunkter er i modellens enheter med y opp;
 * skjermpunkter og -retninger er i piksler med y ned (som i SVG).
 */
import type { DistributedLoad, Load, Member, Model, MomentLoad, PointLoad, Support } from "../../core/schema.js";
import type { Point } from "../geometry.js";

export const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Point, k: number): Point => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y;
export const length = (a: Point): number => Math.hypot(a.x, a.y);
export const unit = (a: Point): Point => {
  const l = length(a);
  return l > 0 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
};
export const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
/** Retning i modellen (y opp) som skjermretning (y ned). */
export const screenDir = (d: Point): Point => ({ x: d.x, y: -d.y });
/** Skjermretningen dreid 90° mot klokka slik det ser ut på skjermen. */
export const perpCCW = (d: Point): Point => ({ x: d.y, y: -d.x });
/** Skjermretning for en vinkel i grader mot klokka fra +x (slik det ser ut på skjermen). */
export const dirOfAngle = (deg: number): Point => {
  const a = (deg * Math.PI) / 180;
  return { x: Math.cos(a), y: -Math.sin(a) };
};

/** Pilene skal ikke bli kortere enn dette, uansett størrelse på lasten. */
export const MIN_ARROW = 22;
/** Lengden på den største punktlasten og høyden på den største fordelte lasten, i piksler. */
export const POINT_LOAD_LENGTH = 46;
export const DISTRIBUTED_HEIGHT = 30;

/** Piksler per kraftenhet (punktlast) og per kraft/lengde-enhet (fordelt last), i modellens enheter. */
export interface LoadScales {
  force: number;
  line: number;
}

/** Skalaer der den største punktlasten og den største fordelte lasten får fast lengde. */
export function loadScales(model: Model): LoadScales {
  let maxP = 0;
  let maxW = 0;
  for (const l of model.loads) {
    if (l.type === "point") maxP = Math.max(maxP, Math.abs(l.P));
    else if (l.type === "distributed") maxW = Math.max(maxW, Math.abs(l.w_start), Math.abs(l.w_end));
  }
  return { force: maxP > 0 ? POINT_LOAD_LENGTH / maxP : 1, line: maxW > 0 ? DISTRIBUTED_HEIGHT / maxW : 1 };
}

export function nodePoint(model: Model, id: string): Point | undefined {
  const n = model.nodes.find((x) => x.id === id);
  return n ? { x: n.x, y: n.y } : undefined;
}

/** Punktet en andel `t` langs elementet fra i-enden (modellkoordinater). */
export function memberPoint(model: Model, m: Member, t: number): Point | undefined {
  const a = nodePoint(model, m.i);
  const b = nodePoint(model, m.j);
  return a && b ? lerp(a, b, t) : undefined;
}

/** Angrepspunktet til en punktlast eller et moment (modellkoordinater). */
export function loadAnchor(model: Model, load: PointLoad | MomentLoad): Point | undefined {
  if (load.node !== undefined) return nodePoint(model, load.node);
  const m = model.members.find((x) => x.id === load.member);
  return m && load.at !== undefined ? memberPoint(model, m, load.at) : undefined;
}

/** Skjermretningene fra noden langs hvert element som ender der. */
export function memberDirsAt(model: Model, node: string): Point[] {
  const p = nodePoint(model, node);
  if (!p) return [];
  const dirs: Point[] = [];
  for (const m of model.members) {
    if (m.i !== node && m.j !== node) continue;
    const q = nodePoint(model, m.i === node ? m.j : m.i);
    if (q) dirs.push(unit(screenDir(sub(q, p))));
  }
  return dirs;
}

const DOWN: Point = { x: 0, y: 1 };
const AXES: Point[] = [DOWN, { x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }];

/** Den første retningen (i rekkefølge) som ikke kolliderer med noe element, ellers den som kolliderer minst. */
function freest(candidates: Point[], blocked: Point[]): Point {
  let best = candidates[0]!;
  let bestOverlap = Infinity;
  for (const c of candidates) {
    const overlap = Math.max(-1, ...blocked.map((b) => dot(c, b)));
    if (overlap < 0.5) return c;
    if (overlap < bestOverlap) {
      best = c;
      bestOverlap = overlap;
    }
  }
  return best;
}

/**
 * Skjermretningen fra noden inn i opplagersymbolet (mot underlaget).
 *  - Rullelager: normalen til underlaget (`angle_deg`, 0 = horisontalt), snudd om et element ligger der.
 *  - Fastlager: nedover, eller til siden om et element går nedover.
 *  - Fast innspenning: bort fra elementene, så veggen står vinkelrett på elementet (rettet inn mot
 *    nærmeste akse når det er nesten vannrett eller loddrett).
 */
export function supportDirection(model: Model, support: Support): Point {
  const dirs = memberDirsAt(model, support.node);
  if (support.type === "roller") {
    const a = ((support.angle_deg ?? 0) * Math.PI) / 180;
    const d = { x: Math.sin(a), y: Math.cos(a) }; // −normalen (sin α, −cos α) i modellen, på skjermen
    return dirs.some((m) => dot(m, d) > 0.7) ? mul(d, -1) : d;
  }
  if (support.type === "pinned") return freest(AXES, dirs);
  const sum = dirs.reduce((s, d) => add(s, d), { x: 0, y: 0 });
  if (length(sum) < 0.3) return freest(AXES, dirs);
  const away = unit(mul(sum, -1));
  const axis = AXES.find((ax) => dot(ax, away) > Math.cos((15 * Math.PI) / 180));
  return axis ?? away;
}

const LABEL_DIRS: Point[] = [
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: 1, y: 1 },
  { x: 0, y: -1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
].map(unit);

/** Retningen for en etikett ved et punkt: den av åtte retninger som har størst vinkel til det som er i veien. */
export function labelDirection(blocked: Point[]): Point {
  if (blocked.length === 0) return LABEL_DIRS[0]!;
  let best = LABEL_DIRS[0]!;
  let bestScore = -Infinity;
  for (const c of LABEL_DIRS) {
    const score = Math.min(...blocked.map((b) => Math.acos(Math.max(-1, Math.min(1, dot(c, b))))));
    if (score > bestScore + 1e-6) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

export interface TextPlacement {
  x: number;
  y: number;
  anchor: "start" | "middle" | "end";
}

/**
 * Plassering av tekst ved punktet `p`, forskjøvet `gap` piksler i retningen `dir`, slik at teksten
 * ligger på den siden og ikke over punktet. `fontSize` brukes for å sentrere loddrett.
 */
export function placeText(p: Point, dir: Point, gap: number, fontSize = 12): TextPlacement {
  const q = add(p, mul(dir, gap));
  const anchor = dir.x > 0.35 ? "start" : dir.x < -0.35 ? "end" : "middle";
  const capital = fontSize * 0.72;
  const y = dir.y < -0.35 ? q.y : dir.y > 0.35 ? q.y + capital : q.y + capital / 2;
  return { x: q.x, y, anchor };
}

/** Omtrentlig bredde på en tekstlinje (resvg og nettleseren måler ikke likt, så dette er et overslag). */
export function textWidth(line: string, fontSize: number): number {
  return line.length * fontSize * 0.56;
}

/**
 * Plassering av en etikett ved en linje (f.eks. omhylningen til en fordelt last): forskjøvet i
 * retningen `out` akkurat langt nok til at tekstboksen ikke krysser linja gjennom `mid` med retning
 * `lineDir`. `up` betyr at flere linjer bygges oppover fra punktet (se Label i StructureSvg).
 */
export function placeTextOffLine(
  mid: Point,
  lineDir: Point,
  out: Point,
  lines: string[],
  fontSize: number,
  margin = 5,
): TextPlacement & { up: boolean } {
  const w = Math.max(...lines.map((l) => textWidth(l, fontSize)));
  const cap = fontSize * 0.72;
  const extra = (lines.length - 1) * (fontSize + 2);
  const [x0, x1] = out.x > 0.35 ? [0, w] : out.x < -0.35 ? [-w, 0] : [-w / 2, w / 2];
  const [y0, y1] = out.y < -0.35 ? [-extra - cap, 3] : out.y > 0.35 ? [0, cap + extra + 3] : [-cap / 2, cap / 2 + extra + 3];
  let nrm = { x: -lineDir.y, y: lineDir.x };
  if (dot(nrm, out) < 0) nrm = mul(nrm, -1);
  const lowest = Math.min(...[x0, x1].flatMap((x) => [y0, y1].map((y) => dot(nrm, { x, y }))));
  const gap = Math.min(80, Math.max(margin, (margin - lowest) / Math.max(dot(nrm, out), 0.2)));
  return { ...placeText(mid, out, gap, fontSize), up: out.y < -0.35 };
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Omtrentlig boks rundt en etikett (samme konvensjon som placeText og Label i StructureSvg). */
export function textRect(at: TextPlacement, lines: string[], fontSize: number, up = false): Rect {
  const w = Math.max(...lines.map((l) => textWidth(l, fontSize)));
  const x0 = at.anchor === "start" ? at.x : at.anchor === "end" ? at.x - w : at.x - w / 2;
  const extra = (lines.length - 1) * (fontSize + 2);
  return { x0, x1: x0 + w, y0: at.y - fontSize * 0.72 - (up ? extra : 0), y1: at.y + 3 + (up ? 0 : extra) };
}

/** Boksen rundt et linjestykke, med `pad` piksler luft. */
export function segmentRect(a: Point, b: Point, pad: number): Rect {
  return { x0: Math.min(a.x, b.x) - pad, x1: Math.max(a.x, b.x) + pad, y0: Math.min(a.y, b.y) - pad, y1: Math.max(a.y, b.y) + pad };
}

export const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** Flytter en etikett inn i tegneflaten om den stikker ut. */
export function clampText(at: TextPlacement, lines: string[], fontSize: number, width: number, height: number, up = false): TextPlacement {
  const w = Math.max(...lines.map((l) => textWidth(l, fontSize)));
  const left = at.anchor === "start" ? at.x : at.anchor === "end" ? at.x - w : at.x - w / 2;
  const dx = Math.max(0, 2 - left) - Math.max(0, left + w - (width - 2));
  const extra = (lines.length - 1) * (fontSize + 2);
  const top = at.y - fontSize * 0.72 - (up ? extra : 0);
  const bottom = at.y + 3 + (up ? 0 : extra);
  const dy = Math.max(0, 2 - top) - Math.max(0, bottom - (height - 2));
  return { ...at, x: at.x + dx, y: at.y + dy };
}

/** Enhetsvektoren (modell) som en positiv intensitet virker i, for en fordelt last på elementet. */
export function distributedUnit(load: Pick<DistributedLoad, "direction">, memberDir: Point): Point {
  if (load.direction === "global_y") return { x: 0, y: 1 };
  if (load.direction === "global_x") return { x: 1, y: 0 };
  return { x: -memberDir.y, y: memberDir.x };
}

/** Effektiv retning (grader) og størrelse for en punktlast; negativ P snur pilen. */
export function pointLoadVector(load: Pick<PointLoad, "P" | "angle_deg">): { angle: number; magnitude: number } {
  return load.P < 0 ? { angle: load.angle_deg + 180, magnitude: -load.P } : { angle: load.angle_deg, magnitude: load.P };
}

export function isPointOrMoment(load: Load): load is PointLoad | MomentLoad {
  return load.type === "point" || load.type === "moment";
}
