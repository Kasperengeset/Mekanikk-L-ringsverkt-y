/**
 * Tegningen av konstruksjonen: elementer, ledd, opplagre, laster og nodenavn, slik kurset (Mekanikk 1,
 * NTNU) tegner dem. Ren presentasjon uten store og uten DOM-måling, så den kan rendres med
 * renderToStaticMarkup (pnpm snapshot og tester). StructureView kobler den til storen og håndterer dra.
 *
 * Hver entitet er en <g data-entity="load:P1"> med farge fra paletten (attributtet `color`) og en klasse
 * som structure.css bruker til å sette temaets farger i appen; alt inni tegnes med currentColor.
 * Med `interactive` legges et usynlig treff-lag øverst (data-entity + data-part) som StructureView
 * bruker for å finne ut hva som dras.
 */
import type { PointerEventHandler, ReactNode, Ref } from "react";
import type { DistributedLoad, Member, Model, MomentLoad, PointLoad, Support } from "../../core/schema.js";
import { forceFactor, lengthFactor } from "../../core/units.js";
import { formatQuantity, type QuantityKind } from "../format.js";
import type { Point, Viewport } from "../geometry.js";
import type { EntityRef } from "../state/store.js";
import type { CanvasProps } from "../types.js";
import { DEFAULT_PALETTE, entityKey, type Palette } from "./highlight.js";
import {
  add,
  dirOfAngle,
  distributedUnit,
  labelDirection,
  length,
  lerp,
  loadAnchor,
  loadScales,
  clampText,
  memberDirsAt,
  MIN_ARROW,
  mul,
  nodePoint,
  perpCCW,
  placeText,
  overlaps,
  placeTextOffLine,
  pointLoadVector,
  screenDir,
  segmentRect,
  sub,
  supportDirection,
  textRect,
  unit,
  type LoadScales,
  type Rect,
  type TextPlacement,
} from "./layout.js";

export interface StructureSvgProps extends CanvasProps {
  selection?: EntityRef | null;
  /** Uthevinger fra agenten eller bekreftelsessteget (store.highlights). */
  highlights?: EntityRef[];
  /** Usikre entiteter som nøkler ("load:P1"), se uncertainKeys. Tegnes som uthevinger. */
  uncertain?: Set<string>;
  palette?: Partial<Palette>;
  /** Lastskalaer; StructureView fryser dem under dra, så pilene ikke skifter lengde. */
  scales?: LoadScales;
  /** Tegn håndtak og et usynlig treff-lag for pekeren. */
  interactive?: boolean;
  className?: string;
  svgRef?: Ref<SVGSVGElement>;
  onPointerDown?: PointerEventHandler<SVGSVGElement>;
  onPointerMove?: PointerEventHandler<SVGSVGElement>;
  onPointerUp?: PointerEventHandler<SVGSVGElement>;
  onPointerCancel?: PointerEventHandler<SVGSVGElement>;
  onLostPointerCapture?: PointerEventHandler<SVGSVGElement>;
  /** Ekstra innhold øverst (f.eks. målingen med ?debug=1). */
  children?: ReactNode;
}

const FONT = 12;
const BEAM_WIDTH = 4;
const TRUSS_WIDTH = 2.2;
const HINGE_R = 4.5;
const MOMENT_R = 17;
const HEAD = { len: 10, half: 4.2 };
const SMALL_HEAD = { len: 6.5, half: 3 };
const ARROW_SPACING = 24;

type Mark = "selected" | "marked" | undefined;

const r2 = (v: number) => Math.round(v * 100) / 100;
const pt = (p: Point) => `${r2(p.x)},${r2(p.y)}`;
const near = (a: Point, b: Point, tol = 1) => length(sub(a, b)) < tol;

/** Klasse og farge for en entitet: valgt > uthevet > grunnfarge. */
function look(base: string, baseColor: string | undefined, mark: Mark, palette: Palette) {
  const className = [base, mark === "selected" && "is-selected", mark === "marked" && "is-uncertain"].filter(Boolean).join(" ");
  const color = mark === "selected" ? palette.accent : mark === "marked" ? palette.uncertain : baseColor;
  return color ? { className, color } : { className };
}

/** Tekst med enhet; i symbolske oppgaver skrives 1 F som F. */
function quantityLabel(kind: QuantityKind, valueSI: number, model: Model): string {
  const text = formatQuantity(kind, Math.abs(valueSI), model);
  return model.symbols.length && text.startsWith("1 ") ? text.slice(2) : text;
}

/** Fylt pilspiss med spissen i `tip`, i retningen `dir` (enhetsvektor på skjermen). */
function ArrowHead({ tip, dir, len = HEAD.len, half = HEAD.half }: { tip: Point; dir: Point; len?: number; half?: number }) {
  const n = perpCCW(dir);
  const base = sub(tip, mul(dir, len));
  return <polygon points={[tip, add(base, mul(n, half)), sub(base, mul(n, half))].map(pt).join(" ")} fill="currentColor" />;
}

function Arrow({ tail, tip, head = HEAD, width = 2 }: { tail: Point; tip: Point; head?: typeof HEAD; width?: number }) {
  const span = length(sub(tip, tail));
  if (span < 0.5) return null;
  const d = mul(sub(tip, tail), 1 / span);
  const len = Math.min(head.len, span);
  const base = sub(tip, mul(d, len));
  return (
    <>
      {span > len + 0.5 && <line x1={r2(tail.x)} y1={r2(tail.y)} x2={r2(base.x)} y2={r2(base.y)} stroke="currentColor" strokeWidth={width} />}
      <ArrowHead tip={tip} dir={d} len={len} half={(head.half * len) / head.len} />
    </>
  );
}

interface LabelProps {
  at: TextPlacement;
  lines: string[];
  palette: Palette;
  size?: number;
  up?: boolean;
  /** Tegneflaten; etiketten flyttes inn om den stikker ut. */
  bounds: { width: number; height: number };
}

/** Etikett med glorie i bakgrunnsfargen. Med `up` står siste linje på punktet og resten over (etikett over en last). */
function Label({ at: raw, lines, palette, size = FONT, up = false, bounds }: LabelProps) {
  const lineHeight = size + 2;
  const at = clampText(raw, lines, size, bounds.width, bounds.height, up);
  return (
    <text
      x={r2(at.x)}
      y={r2(at.y - (up ? (lines.length - 1) * lineHeight : 0))}
      textAnchor={at.anchor}
      fontSize={size}
      fill="currentColor"
      stroke={palette.bg}
      strokeWidth={3}
      strokeLinejoin="round"
      paintOrder="stroke"
      className="st-halo"
    >
      {lines.map((line, k) => (
        <tspan key={k} x={r2(at.x)} dy={k === 0 ? 0 : lineHeight} fontSize={k === 0 ? size : size - 1}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

// ---------------------------------------------------------------- geometri for lastene

interface PointGeom {
  load: PointLoad;
  tip: Point;
  tail: Point;
  dir: Point;
}

interface MomentGeom {
  load: MomentLoad;
  center: Point;
}

interface DistGeom {
  load: DistributedLoad;
  pA: Point;
  pB: Point;
  tailA: Point;
  tailB: Point;
  arrows: { tail: Point; tip: Point }[];
  /** Skjermretningen til positiv intensitet. */
  uS: Point;
  /** Fra elementet mot pilhalene (der etiketten står), for den største intensiteten. */
  outward: Point;
  /** Kraft per intensitet på skjermen (retning × størrelse), for å finne laster som fortsetter hverandre. */
  force: Point;
}

function pointGeom(model: Model, viewport: Viewport, scales: LoadScales, load: PointLoad): PointGeom | undefined {
  const anchor = loadAnchor(model, load);
  if (!anchor) return undefined;
  const tip = viewport.toScreen(anchor);
  const { angle, magnitude } = pointLoadVector(load);
  const dir = dirOfAngle(angle);
  const len = Math.max(MIN_ARROW, magnitude * scales.force);
  return { load, tip, tail: sub(tip, mul(dir, len)), dir };
}

/** Fra elementet mot pilhalen for intensiteten w. */
const outwardFor = (uS: Point, w: number) => mul(uS, w > 0 ? -1 : 1);

function distGeom(model: Model, viewport: Viewport, scales: LoadScales, load: DistributedLoad): DistGeom | undefined {
  const m = model.members.find((x) => x.id === load.member);
  const a = m && nodePoint(model, m.i);
  const b = m && nodePoint(model, m.j);
  if (!a || !b) return undefined;
  const uS = screenDir(distributedUnit(load, unit(sub(b, a))));
  const pA = viewport.toScreen(lerp(a, b, load.from));
  const pB = viewport.toScreen(lerp(a, b, load.to));
  // Pilen peker mot elementet i kraftens retning; halen står w · skala unna, på motsatt side.
  const tailOf = (p: Point, w: number) => sub(p, mul(uS, w * scales.line));
  const n = Math.max(2, Math.round(length(sub(pB, pA)) / ARROW_SPACING));
  const arrows: DistGeom["arrows"] = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const w = load.w_start + (load.w_end - load.w_start) * t;
    if (Math.abs(w) * scales.line < 3) continue;
    const tip = lerp(pA, pB, t);
    arrows.push({ tail: tailOf(tip, w), tip });
  }
  const dominant = Math.abs(load.w_start) >= Math.abs(load.w_end) ? load.w_start : load.w_end;
  return {
    load,
    pA,
    pB,
    tailA: tailOf(pA, load.w_start),
    tailB: tailOf(pB, load.w_end),
    arrows,
    uS,
    outward: outwardFor(uS, dominant),
    force: mul(uS, load.w_start),
  };
}

/** Jevne laster med samme kraft på kollineære elementer etter hverandre får én felles etikett (som i gerberbjelken). */
function labelGroups(geoms: DistGeom[]): DistGeom[][] {
  const parent = geoms.map((_, k) => k);
  const find = (k: number): number => (parent[k] === k ? k : (parent[k] = find(parent[k]!)));
  const uniform = (g: DistGeom) => g.load.w_start === g.load.w_end;
  for (let i = 0; i < geoms.length; i++) {
    for (let j = i + 1; j < geoms.length; j++) {
      const a = geoms[i]!;
      const b = geoms[j]!;
      if (!uniform(a) || !uniform(b) || a.load.basis !== b.load.basis) continue;
      if (length(sub(a.force, b.force)) > 1e-9 * Math.max(length(a.force), 1e-12)) continue;
      const da = unit(sub(a.pB, a.pA));
      const db = unit(sub(b.pB, b.pA));
      if (Math.abs(da.x * db.y - da.y * db.x) > 1e-3) continue;
      if (![a.pA, a.pB].some((p) => near(p, b.pA, 0.5) || near(p, b.pB, 0.5))) continue;
      parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, DistGeom[]>();
  geoms.forEach((g, k) => {
    const root = find(k);
    groups.set(root, [...(groups.get(root) ?? []), g]);
  });
  return [...groups.values()];
}

interface LabelSpec extends TextPlacement {
  lines: string[];
  up: boolean;
}

/** Plassene langs omhylningen en felles etikett prøves i, til den ikke kolliderer med andre laster. */
const LABEL_POSITIONS = [0.5, 0.35, 0.65, 0.2, 0.8, 0.1, 0.9];

function distLabels(group: DistGeom[], model: Model, obstacles: Rect[]): LabelSpec[] {
  const first = group[0]!;
  const { load } = first;
  const toSI = forceFactor(model.units) / lengthFactor(model.units);
  const extra =
    load.basis === "projection" && load.direction !== "local_y"
      ? [load.direction === "global_y" ? "per horisontal lengde" : "per vertikal lengde"]
      : [];
  if (group.length > 1 || load.w_start === load.w_end) {
    if (load.w_start === 0) return [];
    // Midt mellom de to haleendene som ligger lengst fra hverandre.
    const ends = group.flatMap((g) => [g.tailA, g.tailB]);
    let pair: [Point, Point] = [first.tailA, first.tailB];
    for (const p of ends) for (const q of ends) if (length(sub(p, q)) > length(sub(pair[0], pair[1]))) pair = [p, q];
    const lines = [quantityLabel("lineLoad", load.w_start * toSI, model), ...extra];
    const dir = unit(sub(pair[1], pair[0]));
    const at = (t: number) => ({ ...placeTextOffLine(lerp(pair[0], pair[1], t), dir, first.outward, lines, FONT), lines });
    const free = LABEL_POSITIONS.map(at).find((l) => !obstacles.some((o) => overlaps(textRect(l, lines, FONT, l.up), o)));
    return [free ?? at(0.5)];
  }
  const labels: LabelSpec[] = [];
  for (const [w, tail] of [
    [load.w_start, first.tailA],
    [load.w_end, first.tailB],
  ] as const) {
    if (w === 0) continue;
    const lines = [quantityLabel("lineLoad", w * toSI, model)];
    labels.push({ ...placeTextOffLine(tail, unit(sub(first.tailB, first.tailA)), outwardFor(first.uS, w), lines, FONT), lines });
  }
  if (labels[0] && extra.length) labels[0].lines.push(...extra);
  return labels;
}

// ---------------------------------------------------------------- symboler

function supportShape(type: Support["type"], at: Point, down: Point, bg: string) {
  const along = { x: down.y, y: -down.x };
  const P = (u: number, v: number) => add(at, add(mul(along, u), mul(down, v)));
  const line = (a: Point, b: Point, key: string | number, width = 1.2) => (
    <line key={key} x1={r2(a.x)} y1={r2(a.y)} x2={r2(b.x)} y2={r2(b.y)} stroke="currentColor" strokeWidth={width} />
  );
  const hatch = (v: number, from: number, to: number, depth: number) => {
    const out = [];
    for (let u = from; u <= to + 1e-9; u += 5) out.push(line(P(u, v), P(u - depth * 0.8, v + depth), `h${u}`, 1));
    return out;
  };
  const pin = <circle cx={r2(at.x)} cy={r2(at.y)} r={3} fill={bg} className="st-bg" stroke="currentColor" strokeWidth={1.5} />;
  if (type === "fixed") {
    return (
      <>
        {line(P(-18, 0), P(18, 0), "wall", 2.8)}
        {hatch(0, -15, 18, 8)}
      </>
    );
  }
  if (type === "pinned") {
    return (
      <>
        <polygon points={[P(0, 0), P(-12, 19), P(12, 19)].map(pt).join(" ")} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinejoin="round" />
        {line(P(-19, 19), P(19, 19), "ground", 1.7)}
        {hatch(19, -16, 19, 7)}
        {pin}
      </>
    );
  }
  const wheel = (u: number) => {
    const c = P(u, 17.4);
    return <circle key={u} cx={r2(c.x)} cy={r2(c.y)} r={3} fill="none" stroke="currentColor" strokeWidth={1.4} />;
  };
  return (
    <>
      <polygon points={[P(0, 0), P(-11, 14.4), P(11, 14.4)].map(pt).join(" ")} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinejoin="round" />
      {wheel(-5.5)}
      {wheel(5.5)}
      {line(P(-19, 20.4), P(19, 20.4), "ground", 1.7)}
      {hatch(20.4, -16, 19, 7)}
      {pin}
    </>
  );
}

/** Buet pil rundt punktet, mot klokka for M > 0 (slik det ser ut på skjermen). */
function momentPath(c: Point, ccw: boolean) {
  const at = (deg: number) => add(c, mul(dirOfAngle(deg), MOMENT_R));
  const [from, to] = ccw ? [-60, 240] : [240, -60];
  const p1 = at(from);
  const p2 = at(to);
  const a = (to * Math.PI) / 180;
  // Tangenten i enden, i bevegelsesretningen (skjermkoordinater).
  const tangent = ccw ? { x: -Math.sin(a), y: -Math.cos(a) } : { x: Math.sin(a), y: Math.cos(a) };
  return { d: `M${pt(p1)} A${MOMENT_R},${MOMENT_R} 0 1 ${ccw ? 0 : 1} ${pt(p2)}`, tip: add(p2, mul(tangent, 4)), tangent };
}

// ---------------------------------------------------------------- komponenten

export function StructureSvg(props: StructureSvgProps) {
  const { model, result, viewport, interactive = false } = props;
  const palette: Palette = props.palette ? { ...DEFAULT_PALETTE, ...props.palette } : DEFAULT_PALETTE;
  const scales = props.scales ?? loadScales(model);
  const selected = props.selection ? entityKey(props.selection) : undefined;
  const marked = new Set(props.uncertain ?? []);
  for (const h of props.highlights ?? []) marked.add(entityKey(h));
  const markOf = (...keys: string[]): Mark => (keys.includes(selected ?? "") ? "selected" : keys.some((k) => marked.has(k)) ? "marked" : undefined);

  const screen = new Map(model.nodes.map((n) => [n.id, viewport.toScreen(n)]));
  const ends = (m: Member) => {
    const a = screen.get(m.i);
    const b = screen.get(m.j);
    return a && b ? ([a, b] as const) : undefined;
  };

  const points: PointGeom[] = [];
  const moments: MomentGeom[] = [];
  const dists: DistGeom[] = [];
  for (const load of model.loads) {
    if (load.type === "point") {
      const g = pointGeom(model, viewport, scales, load);
      if (g) points.push(g);
    } else if (load.type === "moment") {
      const anchor = loadAnchor(model, load);
      if (anchor) moments.push({ load, center: viewport.toScreen(anchor) });
    } else {
      const g = distGeom(model, viewport, scales, load);
      if (g) dists.push(g);
    }
  }
  const supportDirs = new Map(model.supports.map((s) => [s.node, supportDirection(model, s)]));

  // Etikettene til punktlaster og momenter plasseres først; etikettene til fordelte laster går utenom dem.
  const f = forceFactor(model.units);
  const lf = lengthFactor(model.units);
  const pointLabels = new Map(
    points.map((g) => [g.load.id, { at: placeText(g.tail, mul(g.dir, -1), 5), lines: [quantityLabel("force", g.load.P * f, model)] }]),
  );
  const momentLabels = new Map(
    moments.map((g) => [
      g.load.id,
      { at: placeText({ x: g.center.x, y: g.center.y - MOMENT_R }, { x: 0, y: -1 }, 5), lines: [quantityLabel("moment", g.load.M * f * lf, model)] },
    ]),
  );
  const corner = { x: MOMENT_R, y: MOMENT_R };
  const obstacles: Rect[] = [
    ...points.flatMap((g) => [segmentRect(g.tail, g.tip, 4), textRect(pointLabels.get(g.load.id)!.at, pointLabels.get(g.load.id)!.lines, FONT)]),
    ...moments.flatMap((g) => [segmentRect(sub(g.center, corner), add(g.center, corner), 2), textRect(momentLabels.get(g.load.id)!.at, momentLabels.get(g.load.id)!.lines, FONT)]),
  ];

  // Fagverksknutepunkt: noder der bare staver møtes, tegnes som små ledd.
  const trussJoints = model.nodes.filter((n) => {
    const ms = model.members.filter((m) => m.i === n.id || m.j === n.id);
    return ms.length > 0 && ms.every((m) => m.kind === "truss") && !supportDirs.has(n.id);
  });

  const nodeLabels = model.nodes.map((n) => {
    const p = screen.get(n.id)!;
    const blocked = [...memberDirsAt(model, n.id)];
    const down = supportDirs.get(n.id);
    const support = model.supports.find((s) => s.node === n.id);
    if (down && support) {
      // Symbolet er bredt: trekanten sprer seg ut fra noden, og veggen ved fast innspenning ligger langs noden.
      const spread = (32 * Math.PI) / 180;
      const rot = (d: Point, a: number) => ({ x: d.x * Math.cos(a) - d.y * Math.sin(a), y: d.x * Math.sin(a) + d.y * Math.cos(a) });
      blocked.push(down, rot(down, spread), rot(down, -spread));
      if (support.type === "fixed") blocked.push({ x: down.y, y: -down.x }, { x: -down.y, y: down.x });
    }
    for (const g of points) if (near(g.tip, p)) blocked.push(mul(g.dir, -1));
    for (const g of dists) {
      // Den fordelte lasten dekker flaten mellom elementet og omhylningen.
      if (near(g.pA, p)) blocked.push(g.outward, unit(add(g.outward, unit(sub(g.pB, g.pA)))));
      if (near(g.pB, p)) blocked.push(g.outward, unit(add(g.outward, unit(sub(g.pA, g.pB)))));
    }
    const hasMoment = moments.some((g) => near(g.center, p));
    if (hasMoment) blocked.push({ x: 0, y: -1 }); // etiketten til momentet står over
    return { node: n, at: placeText(p, labelDirection(blocked), hasMoment ? MOMENT_R + 12 : 10, FONT), p };
  });

  const svgClass = ["structure", interactive && "is-interactive", props.className].filter(Boolean).join(" ");

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={viewport.width}
      height={viewport.height}
      className={svgClass}
      fontFamily="system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"
      role="img"
      aria-label="Konstruksjonen"
      ref={props.svgRef}
      onPointerDown={props.onPointerDown}
      onPointerMove={props.onPointerMove}
      onPointerUp={props.onPointerUp}
      onPointerCancel={props.onPointerCancel}
      onLostPointerCapture={props.onLostPointerCapture}
    >
      <g className="st-visual">
        {/* Fordelte laster bak elementene */}
        {dists.map((g) => {
          const mark = markOf(`load:${g.load.id}`);
          return (
            <g key={g.load.id} data-entity={`load:${g.load.id}`} {...look("st-load", palette.load, mark, palette)}>
              <line x1={r2(g.tailA.x)} y1={r2(g.tailA.y)} x2={r2(g.tailB.x)} y2={r2(g.tailB.y)} stroke="currentColor" strokeWidth={1.6} />
              {g.arrows.map((a, k) => (
                <Arrow key={k} tail={a.tail} tip={a.tip} head={SMALL_HEAD} width={1.3} />
              ))}
              {mark === "selected" &&
                [g.tailA, g.tailB].map((p, k) => (
                  <circle key={k} cx={r2(p.x)} cy={r2(p.y)} r={4} fill={palette.bg} className="st-bg" stroke="currentColor" strokeWidth={1.5} />
                ))}
            </g>
          );
        })}
        {labelGroups(dists).map((group) => {
          const first = group[0]!;
          const mark = group.length === 1 ? markOf(`load:${first.load.id}`) : undefined;
          return (
            <g key={first.load.id} {...look("st-load st-load-label", palette.load, mark, palette)}>
              {distLabels(group, model, obstacles).map((l, k) => (
                <Label key={k} at={l} lines={l.lines} palette={palette} up={l.up} bounds={viewport} />
              ))}
            </g>
          );
        })}

        {/* Elementer */}
        {model.members.map((m) => {
          const e = ends(m);
          if (!e) return null;
          const [a, b] = e;
          const mark = markOf(`member:${m.id}`, ...(m.section ? [`section:${m.section}`] : []));
          const width = m.kind === "beam" ? BEAM_WIDTH : TRUSS_WIDTH;
          return (
            <g key={m.id} data-entity={`member:${m.id}`} {...look(`st-member st-${m.kind}`, undefined, mark, palette)}>
              {mark && <line x1={r2(a.x)} y1={r2(a.y)} x2={r2(b.x)} y2={r2(b.y)} stroke="currentColor" strokeOpacity={0.25} strokeWidth={width + 8} strokeLinecap="round" />}
              <line x1={r2(a.x)} y1={r2(a.y)} x2={r2(b.x)} y2={r2(b.y)} stroke="currentColor" strokeWidth={width} strokeLinecap="round" />
            </g>
          );
        })}

        {/* Momentledd og fagverksknutepunkt */}
        {model.members.flatMap((m) => {
          const e = ends(m);
          if (!e || m.kind !== "beam" || !m.release) return [];
          const [a, b] = e;
          const d = unit(sub(b, a));
          const out = [];
          for (const [end, p, dir] of [
            ["i", a, d],
            ["j", b, mul(d, -1)],
          ] as const) {
            if (!m.release[end]) continue;
            const c = add(p, mul(dir, HINGE_R + 1.5));
            out.push(
              <circle
                key={`${m.id}-${end}`}
                data-entity={`member:${m.id}`}
                cx={r2(c.x)}
                cy={r2(c.y)}
                r={HINGE_R}
                fill={palette.bg}
                stroke="currentColor"
                strokeWidth={1.8}
                {...look("st-hinge st-bg", undefined, markOf(`member:${m.id}`), palette)}
              />,
            );
          }
          return out;
        })}
        {trussJoints.map((n) => {
          const p = screen.get(n.id)!;
          return <circle key={n.id} cx={r2(p.x)} cy={r2(p.y)} r={3.6} fill={palette.bg} className="st-bg" stroke="currentColor" strokeWidth={1.6} />;
        })}

        {/* Opplagre */}
        {model.supports.map((s) => {
          const p = screen.get(s.node);
          if (!p) return null;
          return (
            <g key={s.node} data-entity={`support:${s.node}`} {...look(`st-support st-${s.type}`, undefined, markOf(`support:${s.node}`), palette)}>
              {supportShape(s.type, p, supportDirs.get(s.node)!, palette.bg)}
            </g>
          );
        })}

        {/* Nodenavn */}
        {nodeLabels.map(({ node, at, p }) => {
          const mark = markOf(`node:${node.id}`);
          return (
            <g key={node.id} data-entity={`node:${node.id}`} {...look("st-node", palette.muted, mark, palette)}>
              {mark && <circle cx={r2(p.x)} cy={r2(p.y)} r={6.5} fill="none" stroke="currentColor" strokeWidth={2} />}
              <Label at={at} lines={[node.id]} palette={palette} size={FONT + 1} bounds={viewport} />
            </g>
          );
        })}

        {/* Momenter og punktlaster */}
        {moments.map((g) => {
          const path = momentPath(g.center, g.load.M >= 0);
          const label = momentLabels.get(g.load.id)!;
          return (
            <g key={g.load.id} data-entity={`load:${g.load.id}`} {...look("st-load", palette.load, markOf(`load:${g.load.id}`), palette)}>
              <path d={path.d} fill="none" stroke="currentColor" strokeWidth={2} />
              <ArrowHead tip={path.tip} dir={path.tangent} />
              <Label at={label.at} lines={label.lines} palette={palette} bounds={viewport} />
            </g>
          );
        })}
        {points.map((g) => {
          const mark = markOf(`load:${g.load.id}`);
          const label = pointLabels.get(g.load.id)!;
          return (
            <g key={g.load.id} data-entity={`load:${g.load.id}`} {...look("st-load", palette.load, mark, palette)}>
              <Arrow tail={g.tail} tip={g.tip} width={2.2} />
              <Label at={label.at} lines={label.lines} palette={palette} bounds={viewport} />
              {interactive && mark === "selected" && (
                <circle cx={r2(g.tail.x)} cy={r2(g.tail.y)} r={4.5} fill={palette.bg} className="st-bg" stroke="currentColor" strokeWidth={1.6} />
              )}
            </g>
          );
        })}

        {result.status === "mechanism" && screen.has(result.node) && (
          <g className="st-mechanism" color={palette.warning}>
            <circle cx={r2(screen.get(result.node)!.x)} cy={r2(screen.get(result.node)!.y)} r={13} fill="none" stroke="currentColor" strokeWidth={2} strokeDasharray="4 3" />
          </g>
        )}
      </g>

      {interactive && <HitLayer model={model} ends={ends} dists={dists} points={points} moments={moments} supportDirs={supportDirs} screen={screen} />}
      {props.children}
    </svg>
  );
}

// ---------------------------------------------------------------- treff-laget

interface HitLayerProps {
  model: Model;
  ends: (m: Member) => readonly [Point, Point] | undefined;
  dists: DistGeom[];
  points: PointGeom[];
  moments: MomentGeom[];
  supportDirs: Map<string, Point>;
  screen: Map<string, Point>;
}

/**
 * Usynlige, brede flater over det som kan klikkes eller dras. Rekkefølgen bestemmer hva som ligger øverst.
 * Attributtene fill/stroke="none" holder dem usynlige uten stilark; structure.css gjør dem treffbare
 * (pointer-events: all) og viser håndtakene ved hover.
 */
function HitLayer({ model, ends, dists, points, moments, supportDirs, screen }: HitLayerProps) {
  const seg = (a: Point, b: Point, width: number, entity: string, part: string, extra = "") => (
    <line
      key={`${entity}-${part}`}
      className={`st-hit ${extra}`.trim()}
      data-entity={entity}
      data-part={part}
      x1={r2(a.x)}
      y1={r2(a.y)}
      x2={r2(b.x)}
      y2={r2(b.y)}
      strokeWidth={width}
      strokeLinecap="round"
    />
  );
  /** Håndtaket i enden av en fordelt last må kunne gripes også når intensiteten er liten der. */
  const grip = (p: Point, tail: Point, outward: Point) => (length(sub(tail, p)) < 12 ? add(p, mul(outward, 12)) : tail);
  return (
    <g className="st-hits" fill="none" stroke="none">
      {dists.map((g) => (
        <polygon
          key={g.load.id}
          className="st-hit"
          data-entity={`load:${g.load.id}`}
          data-part="body"
          points={[g.pA, g.pB, g.tailB, g.tailA].map(pt).join(" ")}
          strokeWidth={6}
        />
      ))}
      {model.members.map((m) => {
        const e = ends(m);
        return e ? seg(e[0], e[1], 14, `member:${m.id}`, "body") : null;
      })}
      {model.supports.map((s) => {
        const p = screen.get(s.node);
        if (!p) return null;
        const c = add(p, mul(supportDirs.get(s.node)!, 13));
        return <circle key={s.node} className="st-hit" data-entity={`support:${s.node}`} data-part="body" cx={r2(c.x)} cy={r2(c.y)} r={18} />;
      })}
      {dists.flatMap((g) => [
        seg(g.pA, grip(g.pA, g.tailA, g.outward), 10, `load:${g.load.id}`, "from", "st-hit-handle"),
        seg(g.pB, grip(g.pB, g.tailB, g.outward), 10, `load:${g.load.id}`, "to", "st-hit-handle"),
      ])}
      {model.nodes.map((n) => {
        const p = screen.get(n.id)!;
        return <circle key={n.id} className="st-hit st-hit-handle" data-entity={`node:${n.id}`} data-part="body" cx={r2(p.x)} cy={r2(p.y)} r={8} />;
      })}
      {moments.map((g) => (
        <path key={g.load.id} className="st-hit" data-entity={`load:${g.load.id}`} data-part="body" d={momentPath(g.center, g.load.M >= 0).d} strokeWidth={10} />
      ))}
      {points.map((g) => seg(g.tail, g.tip, 12, `load:${g.load.id}`, "body"))}
      {points.map((g) => (
        <circle
          key={`${g.load.id}-tail`}
          className="st-hit st-hit-handle"
          data-entity={`load:${g.load.id}`}
          data-part="tail"
          cx={r2(g.tail.x)}
          cy={r2(g.tail.y)}
          r={9}
        />
      ))}
    </g>
  );
}
