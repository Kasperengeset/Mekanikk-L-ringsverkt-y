/**
 * Diagrammene som kort, slik designet viser dem: en verktøylinje med knapper, og ett kort per diagram
 * med overskrift og merknader i HTML og tegningen under. Ren komponent (ingen store), så den kan rendres
 * med renderToStaticMarkup; DiagramsView kobler den til storen.
 *
 * Geometrien er den samme som i DiagramsSvg (layoutDiagrams). Hvert kort viser sitt panel som et utsnitt
 * (viewBox) av den samme tegningen, uten panelets egen topptekst. Kortene har samme bredde og sidemarg
 * som konstruksjonskortet, så x-aksene står rett under konstruksjonen.
 */
import { useId } from "react";
import { WarningIcon } from "../icons.js";
import { DeformedPanelView, ForcePanelView, NoteGlyphSvg, type DiagramsSvgProps } from "./DiagramsSvg.js";
import { DEFAULT_SETTINGS, layoutDiagrams, type Panel } from "./layout.js";
import { DEFAULT_PALETTE, type Palette } from "./palette.js";
import { toolbarChips, type Chip } from "./toolbar.js";

export function DiagramCards({ model, result, viewport, settings = DEFAULT_SETTINGS, palette, onSettingsChange, hidden, highlight, cut }: DiagramsSvgProps) {
  const pal: Palette = { ...DEFAULT_PALETTE, ...palette };
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const layout = layoutDiagrams(model, result, viewport, settings, { top: 0, hidden, highlight, cut });
  return (
    <>
      {onSettingsChange && <DiagramsToolbar chips={toolbarChips(settings, layout.deformationScale ?? 0, onSettingsChange)} />}
      {layout.message && (
        <div className="alert" role="status">
          <WarningIcon />
          <span>{layout.message.join(" ")}</span>
        </div>
      )}
      {layout.panels.map((p) => (
        <PanelCard key={p.kind} panel={p} width={layout.width} pal={pal} clipId={`dg-clip-${id}-${p.kind}`} />
      ))}
    </>
  );
}

/** Knappene grupperes som i designet: hvilke diagram som vises, og forstørrelsen (etter ledeteksten). */
function DiagramsToolbar({ chips }: { chips: (Chip | string)[] }) {
  const split = chips.findIndex((c) => typeof c === "string");
  const groups = split < 0 ? [chips] : [chips.slice(0, split), chips.slice(split)];
  return (
    <div role="toolbar" aria-label="Visning" className="dg-toolbar">
      {groups.map((group, g) => (
        <div key={g} className="dg-toolbar-group">
          {group.map((c, k) =>
            typeof c === "string" ? (
              <span key={k} className="dg-toolbar-label">
                {c.replace(/:$/, "")}
              </span>
            ) : (
              <button
                key={k}
                type="button"
                className={g === 0 ? "pill" : "pill sm"}
                title={c.title}
                aria-pressed={c.action ? undefined : c.active}
                aria-label={c.action ? c.title : undefined}
                disabled={c.disabled}
                onClick={c.onPress}
              >
                {c.label}
              </button>
            ),
          )}
        </div>
      ))}
    </div>
  );
}

function PanelCard({ panel, width, pal, clipId }: { panel: Panel; width: number; pal: Palette; clipId: string }) {
  const y0 = panel.top + panel.headerHeight;
  const height = panel.height - panel.headerHeight;
  const drawn = (panel.kind === "deformed" || !panel.zero) && height > 0;
  return (
    <section className={`card figure-card diagrams dg-card dg-card-${panel.kind}`} aria-label={panel.title}>
      <div className="dg-card-head">
        <span className={`dg-swatch dg-swatch-${panel.kind}`} aria-hidden="true" />
        <h3>{panel.title}</h3>
      </div>
      {panel.notes.length > 0 && (
        <p className="dg-notes">
          {panel.notes.map((n, k) => (
            <span key={k} className={`dg-note${n.tone === "warning" ? " warning" : ""}`}>
              {n.glyph && <NoteGlyphSvg glyph={n.glyph} pal={pal} />}
              {n.text}
            </span>
          ))}
        </p>
      )}
      {drawn && (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width={width}
          height={height}
          viewBox={`0 ${y0} ${width} ${height}`}
          className="dg-figure"
          role="img"
          aria-label={panel.title}
          fontFamily="Inter, system-ui, sans-serif"
        >
          {panel.kind === "deformed" ? (
            <DeformedPanelView panel={panel} first width={width} pal={pal} clipId={clipId} header={false} />
          ) : (
            <ForcePanelView panel={panel} first width={width} pal={pal} header={false} />
          )}
        </svg>
      )}
    </section>
  );
}
