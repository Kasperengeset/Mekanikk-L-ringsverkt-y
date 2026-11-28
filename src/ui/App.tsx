/**
 * Appens skall: topptekst, hovedkolonnen (konstruksjonen og diagrammene i hvert sitt kort) og sidepanelet.
 * Oppsettet følger designet i docs/design; på smale skjermer legger sidepanelet seg under.
 *
 * Konstruksjonen og diagrammene deler viewport, så x-aksene står rett under hverandre. Bredden måles
 * inne i konstruksjonskortet, og høyden følger formen på konstruksjonen.
 */
import { useEffect } from "react";
import { AccessGate } from "./access/AccessGate.js";
import { CutCard } from "./cut3d/CutCard.js";
import { DiagramsView } from "./diagrams/DiagramsView.js";
import { fixtureFromUrl } from "./fixtures.js";
import { fitViewport, modelBounds } from "./geometry.js";
import { BrandMark } from "./icons.js";
import { SidePanel } from "./panel/SidePanel.js";
import { useStore } from "./state/store.js";
import { useSolveResult } from "./state/useSolveResult.js";
import { StructureView } from "./structure/StructureView.js";
import { ConfirmPanel } from "./upload/ConfirmPanel.js";
import { UploadPanel } from "./upload/UploadPanel.js";
import { useElementSize } from "./useElementSize.js";
import type { Model } from "../core/schema.js";

/**
 * Luften fitViewport legger rundt konstruksjonen. Lastpilene har fast lengde i piksler, så luften kan ikke
 * krympe på smale skjermer uten at teksten på en last havner oppå pilen.
 */
const FIT_PADDING = 70;

/** Høyden som gir konstruksjonen full bredde, innenfor rimelige grenser (bjelker blir lave, rammer høyere). */
export function structureHeight(model: Model, width: number): number {
  const b = modelBounds(model);
  const spanX = Math.max(b.maxX - b.minX, 1e-9);
  const spanY = b.maxY - b.minY;
  const height = (width - 2 * FIT_PADDING) * (spanY / spanX) + 2 * FIT_PADDING;
  return Math.round(Math.min(Math.max(height, 210), 560));
}

export function App() {
  const model = useStore((s) => s.model);
  const phase = useStore((s) => s.phase);
  const loadModel = useStore((s) => s.loadModel);
  const hasCut = useStore((s) => s.cut !== null);
  const result = useSolveResult();
  const [figureRef, size] = useElementSize<HTMLDivElement>();

  useEffect(() => {
    const fixture = fixtureFromUrl(window.location.search);
    if (fixture) loadModel(fixture);
  }, [loadModel]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      e.preventDefault();
      if (e.shiftKey) useStore.getState().redo();
      else useStore.getState().undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const viewport = model && size.width > 0 ? fitViewport(model, size.width, structureHeight(model, size.width), { padding: FIT_PADDING }) : null;

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-inner">
          <div className="brand">
            <BrandMark />
            <h1 className="brand-name">
              Mekanikk-<span>intuisjon</span>
            </h1>
          </div>
          <AccessGate />
        </div>
      </header>
      <div className="workspace">
        <main className="canvas">
          {model && result ? (
            <>
              <section className="card figure-card" aria-label="Konstruksjonen">
                <div ref={figureRef}>{viewport && <StructureView model={model} result={result} viewport={viewport} />}</div>
                {phase === "explore" && !hasCut && <p className="figure-hint muted">Klikk på et element for å snitte det og se kreftene inni i 3D.</p>}
              </section>
              {phase === "explore" && <CutCard model={model} result={result} />}
              {phase === "explore" && viewport && <DiagramsView model={model} result={result} viewport={viewport} />}
            </>
          ) : (
            <UploadPanel />
          )}
        </main>
        {model && result && <aside className="panel">{phase === "confirm" ? <ConfirmPanel /> : <SidePanel model={model} result={result} />}</aside>}
      </div>
    </div>
  );
}
