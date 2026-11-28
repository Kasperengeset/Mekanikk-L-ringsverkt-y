/**
 * N-, V- og M-diagram og deformert form som ren SVG (ingen store), så komponenten kan rendres med
 * renderToStaticMarkup (tester og `pnpm snapshot`). DiagramsView kobler den til storen.
 * All geometri regnes ut i layout.ts; her tegnes den bare.
 *
 * `hidden` (maske fra hiddenValues) bytter skjulte tall med «?»; formen tegnes uendret.
 * `highlight` tegner en markør (prikk og ring) på kurven i riktig panel.
 */
import { useId, type KeyboardEvent, type ReactNode } from "react";
import type { Cut } from "../../core/cut.js";
import type { HiddenValues } from "../../core/pedagogy.js";
import type { Point } from "../geometry.js";
import type { DiagramPoint, DiagramSettings } from "../state/store.js";
import type { CanvasProps } from "../types.js";
import type { Box, PlacedLabel } from "./labels.js";
import {
  DEFAULT_SETTINGS,
  LAYOUT,
  layoutDiagrams,
  type ActionSymbol,
  type CutMarker,
  type DeformedPanel,
  type DiagramLayout,
  type DiagramMarker,
  type ForcePanel,
  type Note,
  type Sketch,
  type SupportGlyph,
} from "./layout.js";
import { DEFAULT_PALETTE, type Palette } from "./palette.js";
import { toolbarChips } from "./toolbar.js";

export interface DiagramsSvgProps extends CanvasProps {
  settings?: DiagramSettings;
  palette?: Partial<Palette>;
  /** Gis den, vises en verktøylinje for å slå diagrammene av og på og endre forstørrelsen. */
  onSettingsChange?: (change: Partial<DiagramSettings>) => void;
  /** Tall som er skjult til studenten har prøvd selv (hiddenValues). Uten den vises alle tall. */
  hidden?: HiddenValues;
  /** Punkt i et diagram som skal utheves. */
  highlight?: DiagramPoint | null;
  /** Snittet som vises i 3D. */
  cut?: Cut | null;
}

const FONT = "system-ui, -apple-system, Helvetica, Arial, sans-serif";

const r1 = (v: number) => Math.round(v * 10) / 10;
const pathOf = (pts: Point[], close = false) => pts.map((p, k) => `${k ? "L" : "M"}${r1(p.x)} ${r1(p.y)}`).join("") + (close ? "Z" : "");

export function DiagramsSvg({ model, result, viewport, settings = DEFAULT_SETTINGS, palette, onSettingsChange, hidden, highlight, cut }: DiagramsSvgProps) {
  const pal: Palette = { ...DEFAULT_PALETTE, ...palette };
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const layout = layoutDiagrams(model, result, viewport, settings, { top: onSettingsChange ? LAYOUT.toolbar : 0, hidden, highlight, cut });
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={layout.width}
      height={layout.height}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      className="diagrams"
      fontFamily={FONT}
      role="img"
      aria-label="N-, V- og M-diagram og deformert form"
    >
      {onSettingsChange && <Toolbar settings={settings} layout={layout} pal={pal} onChange={onSettingsChange} />}
      {layout.message && <Message lines={layout.message} top={layout.top} pal={pal} />}
      {layout.panels.map((p, k) =>
        p.kind === "deformed" ? (
          <DeformedPanelView key={p.kind} panel={p} first={k === 0} width={layout.width} pal={pal} clipId={`dg-clip-${id}`} />
        ) : (
          <ForcePanelView key={p.kind} panel={p} first={k === 0} width={layout.width} pal={pal} />
        ),
      )}
    </svg>
  );
}

function Message({ lines, top, pal }: { lines: string[]; top: number; pal: Palette }) {
  return (
    <g className="dg-message">
      {lines.map((line, k) => (
        <text key={k} x={16} y={top + 22 + k * 18} fontSize={13} fill={pal.warning} className="dg-warning">
          {line}
        </text>
      ))}
    </g>
  );
}

function Header({ panel, first, width, pal }: { panel: ForcePanel | DeformedPanel; first: boolean; width: number; pal: Palette }) {
  return (
    <>
      {!first && <line x1={0} x2={width} y1={panel.top + 0.5} y2={panel.top + 0.5} stroke={pal.line} className="dg-separator" />}
      <text x={12} y={panel.top + 17} fontSize={13} fontWeight={600} fill={pal.fg}>
        {panel.title}
      </text>
      {panel.notes.map((n, k) => (
        <NoteView key={k} note={n} pal={pal} />
      ))}
    </>
  );
}

function NoteView({ note, pal }: { note: Note; pal: Palette }) {
  const textX = note.glyph ? note.x + 34 : note.x;
  return (
    <g>
      {note.glyph === "tension" && <NSymbol x={note.x + 15} y={note.y - 4} angle={0} sign={1} color={pal.N} pal={pal} className="dg-symbol-N" />}
      {note.glyph === "compression" && <NSymbol x={note.x + 15} y={note.y - 4} angle={0} sign={-1} color={pal.N} pal={pal} className="dg-symbol-N" />}
      {note.glyph === "inflection" && <InflectionDot p={{ x: note.x + 15, y: note.y - 4 }} pal={pal} />}
      <text x={textX} y={note.y} fontSize={11} fill={note.tone === "warning" ? pal.warning : pal.muted} fontWeight={note.tone === "warning" ? 600 : 400} className={note.tone === "warning" ? "dg-warning" : "dg-muted"}>
        {note.text}
      </text>
    </g>
  );
}

/** Symbolet foran en merknad (strekk, trykk, vendepunkt) som et lite frittstående SVG-bilde. */
export function NoteGlyphSvg({ glyph, pal }: { glyph: NonNullable<Note["glyph"]>; pal: Palette }) {
  return (
    <svg width={30} height={14} viewBox="0 -7 30 14" aria-hidden="true" className="dg-note-glyph">
      {glyph === "tension" && <NSymbol x={15} y={0} angle={0} sign={1} color={pal.N} pal={pal} className="dg-symbol-N" />}
      {glyph === "compression" && <NSymbol x={15} y={0} angle={0} sign={-1} color={pal.N} pal={pal} className="dg-symbol-N" />}
      {glyph === "inflection" && <InflectionDot p={{ x: 15, y: 0 }} pal={pal} />}
    </svg>
  );
}

function SketchView({ sketch, pal, dashed }: { sketch: Sketch; pal: Palette; dashed?: boolean }) {
  return (
    <g className="dg-sketch" opacity={dashed ? 0.6 : 0.4}>
      {sketch.members.map(([a, b], k) => (
        <line key={k} x1={r1(a.x)} y1={r1(a.y)} x2={r1(b.x)} y2={r1(b.y)} stroke={pal.fg} strokeWidth={dashed ? 1.5 : 2} strokeDasharray={dashed ? "6 4" : undefined} />
      ))}
      {sketch.supports.map((s, k) => (
        <SupportView key={k} glyph={s} pal={pal} />
      ))}
      {sketch.hinges.map((h, k) => (
        <circle key={k} cx={r1(h.x)} cy={r1(h.y)} r={3.5} fill={pal.background} stroke={pal.fg} strokeWidth={1.5} className="dg-bg-fill" />
      ))}
    </g>
  );
}

function SupportView({ glyph, pal }: { glyph: SupportGlyph; pal: Palette }) {
  const hatch = (y: number, from: number, to: number) =>
    Array.from({ length: Math.floor((to - from) / 5) + 1 }, (_, k) => `M${from + 5 * k} ${y}L${from + 5 * k - 4} ${y + 5}`).join("");
  let d: string;
  if (glyph.type === "fixed") d = `M-12 0L12 0${hatch(0, -10, 14)}`;
  else if (glyph.type === "pinned") d = `M0 0L-7 12L7 12Z M-11 12L11 12${hatch(12, -8, 12)}`;
  else d = `M0 0L-7 10L7 10Z M-11 14L11 14${hatch(14, -8, 12)}`;
  return (
    <g transform={`translate(${r1(glyph.x)} ${r1(glyph.y)}) rotate(${r1(glyph.angle)})`}>
      <path d={d} fill="none" stroke={pal.fg} strokeWidth={glyph.type === "fixed" ? 2 : 1.2} strokeLinejoin="round" />
    </g>
  );
}

/** Tallene i et panel. Et skjult tall er et rundt merke med «?» på samme sted, så studenten ser hvor tallet står. */
function Labels({ labels, pal }: { labels: PlacedLabel[]; pal: Palette }) {
  return (
    <g className="dg-labels">
      {labels.map((l, k) =>
        l.masked ? (
          <g key={k} className="dg-hidden-value">
            <title>Tallet vises når du har prøvd selv</title>
            <circle cx={r1(l.x)} cy={r1(l.y)} r={10} fill={pal.background} stroke={pal.line} strokeWidth={1.2} className="dg-hidden-chip" />
            <text x={r1(l.x)} y={r1(l.y + 4.2)} textAnchor="middle" fontSize={12} fontWeight={600} fill={pal.muted} className="dg-hidden-text">
              {l.text}
            </text>
          </g>
        ) : (
        <text
          key={k}
          x={r1(l.x)}
          y={r1(l.y + 4.2)}
          textAnchor="middle"
          fontSize={12}
          fontWeight={l.emphasis ? 700 : 500}
          fill={pal.fg}
          stroke={pal.background}
          strokeWidth={3}
          strokeLinejoin="round"
          paintOrder="stroke"
          className="dg-label"
        >
          {l.text}
        </text>
        ),
      )}
    </g>
  );
}

/** Snittet: stiplet strek gjennom aksen og kurven, og en prikk på kurven. */
function CutMarkerView({ marker, pal }: { marker: CutMarker; pal: Palette }) {
  const { from, to, point: p } = marker;
  return (
    <g className="dg-cut">
      <line x1={r1(from.x)} y1={r1(from.y)} x2={r1(to.x)} y2={r1(to.y)} stroke={pal.accent} strokeWidth={1.6} strokeDasharray="4 3" className="dg-cut-stroke" />
      <circle cx={r1(p.x)} cy={r1(p.y)} r={3.5} fill={pal.accent} stroke={pal.background} strokeWidth={1.5} className="dg-cut-dot" />
    </g>
  );
}

/** Uthevet punkt: strek fra aksen, ring og prikk på kurven. */
function MarkerView({ marker, pal }: { marker: DiagramMarker; pal: Palette }) {
  const { point: p, base: b } = marker;
  const showStem = Math.hypot(p.x - b.x, p.y - b.y) > 3;
  return (
    <g className="dg-highlight">
      {showStem && <line x1={r1(b.x)} y1={r1(b.y)} x2={r1(p.x)} y2={r1(p.y)} stroke={pal.highlight} strokeWidth={2} strokeDasharray="3 2" className="dg-highlight-stroke" />}
      <circle cx={r1(p.x)} cy={r1(p.y)} r={11} fill={pal.highlight} fillOpacity={0.15} stroke={pal.highlight} strokeWidth={2.5} className="dg-highlight-ring" />
      <circle cx={r1(p.x)} cy={r1(p.y)} r={4} fill={pal.highlight} stroke={pal.background} strokeWidth={1.5} className="dg-highlight-dot" />
    </g>
  );
}

function InflectionDot({ p, pal }: { p: Point; pal: Palette }) {
  return <circle cx={r1(p.x)} cy={r1(p.y)} r={3.5} fill={pal.deformed} stroke={pal.background} strokeWidth={1.2} className="dg-inflection" />;
}

function Arrow({ from, to, color }: { from: Point; to: Point; color: string }) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const head = 4;
  const base = { x: to.x - ux * head, y: to.y - uy * head };
  const tip = `M${to.x} ${to.y}L${base.x - uy * 2.6} ${base.y + ux * 2.6}L${base.x + uy * 2.6} ${base.y - ux * 2.6}Z`;
  return (
    <>
      <path d={`M${from.x} ${from.y}L${base.x} ${base.y}`} stroke={color} strokeWidth={1.3} fill="none" className="dg-shaft" />
      <path d={tip} fill={color} stroke="none" className="dg-head" />
    </>
  );
}

/** Lite element med piler ut (strekk) eller inn (trykk), langs elementaksen. */
function NSymbol({ x, y, angle, sign, color, pal, className }: { x: number; y: number; angle: number; sign: 1 | -1; color: string; pal: Palette; className?: string }) {
  const out = sign > 0;
  return (
    <g transform={`translate(${r1(x)} ${r1(y)}) rotate(${r1(angle)})`} className={className}>
      <rect x={-4} y={-4} width={8} height={8} fill={pal.background} stroke={color} strokeWidth={1.2} className="dg-bg-fill" />
      <Arrow from={{ x: out ? 5 : 15, y: 0 }} to={{ x: out ? 15 : 5.5, y: 0 }} color={color} />
      <Arrow from={{ x: out ? -5 : -15, y: 0 }} to={{ x: out ? -15 : -5.5, y: 0 }} color={color} />
    </g>
  );
}

/**
 * Skjærpar: positiv V virker i +y' på snittflaten mot i-enden og i −y' på flaten mot j-enden
 * (dM/dx = V). Lokal −y i symbolet er +y'.
 */
function VSymbol({ x, y, angle, sign, color, pal, className }: { x: number; y: number; angle: number; sign: 1 | -1; color: string; pal: Palette; className?: string }) {
  const s = sign;
  return (
    <g transform={`translate(${r1(x)} ${r1(y)}) rotate(${r1(angle)})`} className={className}>
      <rect x={-4} y={-4} width={8} height={8} fill={pal.background} stroke={color} strokeWidth={1.2} className="dg-bg-fill" />
      <Arrow from={{ x: -7, y: 7 * s }} to={{ x: -7, y: -8 * s }} color={color} />
      <Arrow from={{ x: 7, y: -7 * s }} to={{ x: 7, y: 8 * s }} color={color} />
    </g>
  );
}

function SymbolView({ symbol, pal }: { symbol: ActionSymbol; pal: Palette }) {
  const props = { x: symbol.x, y: symbol.y, angle: symbol.angle, sign: symbol.sign, color: pal[symbol.kind], pal, className: `dg-symbol dg-symbol-${symbol.kind}` };
  return symbol.kind === "N" ? <NSymbol {...props} /> : <VSymbol {...props} />;
}

export function ForcePanelView({ panel, first, width, pal, header = true }: { panel: ForcePanel; first: boolean; width: number; pal: Palette; header?: boolean }) {
  const q = panel.kind;
  const color = pal[q];
  return (
    <g className={`dg-panel dg-panel-${q}`}>
      {header && <Header panel={panel} first={first} width={width} pal={pal} />}
      {!panel.zero && (
        <>
          <SketchView sketch={panel.sketch} pal={pal} />
          {panel.diagrams.map((d) => (
            <g key={d.member}>
              <path d={pathOf(d.outline, true)} fill={color} fillOpacity={0.12} stroke="none" className={`dg-fill-${q} dg-area`} />
              {d.hatch.length > 0 && (
                <path d={d.hatch.map(([a, b]) => `M${r1(a.x)} ${r1(a.y)}L${r1(b.x)} ${r1(b.y)}`).join("")} stroke={color} strokeOpacity={0.45} strokeWidth={0.8} fill="none" className={`dg-stroke-${q} dg-hatch`} />
              )}
              <path d={pathOf(d.outline)} fill="none" stroke={color} strokeWidth={1.7} strokeLinejoin="round" className={`dg-stroke-${q} dg-outline`} />
            </g>
          ))}
          {panel.symbols.map((s, k) => (
            <SymbolView key={k} symbol={s} pal={pal} />
          ))}
          {panel.inflections.map((p, k) => (
            <InflectionDot key={k} p={p} pal={pal} />
          ))}
          {panel.cut && <CutMarkerView marker={panel.cut} pal={pal} />}
          {panel.highlight && <MarkerView marker={panel.highlight} pal={pal} />}
          <Labels labels={panel.labels} pal={pal} />
        </>
      )}
    </g>
  );
}

export function DeformedPanelView({
  panel,
  first,
  width,
  pal,
  clipId,
  header = true,
}: {
  panel: DeformedPanel;
  first: boolean;
  width: number;
  pal: Palette;
  clipId: string;
  header?: boolean;
}) {
  const c: Box = panel.clip;
  return (
    <g className="dg-panel dg-panel-deformed">
      {header && <Header panel={panel} first={first} width={width} pal={pal} />}
      <defs>
        <clipPath id={clipId}>
          <rect x={c.x0} y={c.y0} width={c.x1 - c.x0} height={c.y1 - c.y0} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <SketchView sketch={panel.sketch} pal={pal} dashed />
        {panel.shapes.map((s, k) => (
          <path key={k} d={pathOf(s)} fill="none" stroke={pal.deformed} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" className="dg-stroke-deformed" />
        ))}
        {panel.inflections.map((p, k) => (
          <InflectionDot key={k} p={p} pal={pal} />
        ))}
        {panel.maxPoint && <circle cx={r1(panel.maxPoint.x)} cy={r1(panel.maxPoint.y)} r={4.5} fill="none" stroke={pal.fg} strokeWidth={1.3} />}
        <Labels labels={panel.labels} pal={pal} />
      </g>
    </g>
  );
}

function Toolbar({ settings, layout, pal, onChange }: { settings: DiagramSettings; layout: DiagramLayout; pal: Palette; onChange: (c: Partial<DiagramSettings>) => void }) {
  const chips = toolbarChips(settings, layout.deformationScale ?? 0, onChange);
  let x = 12;
  const items: ReactNode[] = chips.map((chip, k) => {
    if (typeof chip === "string") {
      const node = (
        <text key={k} x={x + 4} y={24} fontSize={12} fill={pal.muted} className="dg-muted">
          {chip}
        </text>
      );
      x += chip.length * 7 + 10;
      return node;
    }
    const w = Math.max(28, chip.label.length * 7 + 18);
    const press = () => !chip.disabled && chip.onPress();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        press();
      }
    };
    const node = (
      <g
        key={k}
        transform={`translate(${x} 8)`}
        role="button"
        tabIndex={chip.disabled ? -1 : 0}
        aria-pressed={chip.active}
        aria-disabled={chip.disabled || undefined}
        className={`dg-chip${chip.active ? " active" : ""}${chip.disabled ? " disabled" : ""}`}
        onClick={press}
        onKeyDown={onKeyDown}
      >
        <title>{chip.title}</title>
        <rect width={w} height={22} rx={11} fill={chip.active ? pal.accent : pal.background} stroke={chip.active ? pal.accent : pal.line} />
        <text x={w / 2} y={15} textAnchor="middle" fontSize={12} fill={chip.active ? "#ffffff" : pal.fg}>
          {chip.label}
        </text>
      </g>
    );
    x += w + 6;
    return node;
  });
  return <g className="dg-toolbar">{items}</g>;
}
