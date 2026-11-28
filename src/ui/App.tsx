/**
 * Appens skall: topptekst, hovedkolonnen (konstruksjonen og diagrammene i hvert sitt kort) og sidepanelet.
 * Oppsettet følger designet i docs/design; på smale skjermer legger sidepanelet seg under.
 *
 * Konstruksjonen og diagrammene deler viewport, så x-aksene står rett under hverandre. Bredden måles
 * inne i konstruksjonskortet, og høyden følger formen på konstruksjonen.
 */
import { useEffect } from "react";
import { ForceSystemView } from "./forces/ForceSystemView.js";
import { LiveBar } from "./live/LiveBar.js";
import { useLiveFollow } from "./live/live.js";
import { CutCard } from "./cut3d/CutCard.js";
import { DiagramsView } from "./diagrams/DiagramsView.js";
import { fixtureFromUrl } from "./fixtures.js";
import { FIT_PADDING, fitViewport, structureHeight } from "./geometry.js";
import { SidePanel } from "./panel/SidePanel.js";
import { SiteHeader } from "./site/SiteHeader.js";
import { useStore } from "./state/store.js";
import { useSolveResult } from "./state/useSolveResult.js";
import { StructureView } from "./structure/StructureView.js";
import { modelFromHash } from "./share.js";
import { AccessGate } from "./access/AccessGate.js";
import { ConfirmPanel } from "./upload/ConfirmPanel.js";
import { UploadPanel } from "./upload/UploadPanel.js";
import { useElementSize } from "./useElementSize.js";

export function App() {
  const model = useStore((s) => s.model);
  const phase = useStore((s) => s.phase);
  const loadModel = useStore((s) => s.loadModel);
  const hasCut = useStore((s) => s.cut !== null);
  const result = useSolveResult();
  const forces = useStore((s) => s.forces);
  const [figureRef, size] = useElementSize<HTMLDivElement>();
  const [forcesRef, forcesSize] = useElementSize<HTMLElement>();
  useLiveFollow();

  useEffect(() => {
    // Fra Claude: modellen i lenken (#m=…). Ellers et eksempel (?eksempel=…).
    const shared = modelFromHash(window.location.hash);
    const fixture = shared ?? fixtureFromUrl(window.location.search);
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
      <SiteHeader>
        <AccessGate />
      </SiteHeader>
      <div className="workspace">
        <main className="canvas">
          <LiveBar />
          {!model && forces ? (
            <section className="card figure-card" aria-label="Kraftsystemet" ref={forcesRef}>
              <div className="card-head">
                <h2 className="card-title">Kraftsystem fra Claude</h2>
                <button type="button" className="primary" onClick={() => useStore.getState().showForces(null)}>
                  Ny oppgave
                </button>
              </div>
              <ForceSystemView result={forces.result} forceUnit={forces.units.force} lengthUnit={forces.units.length} width={forcesSize.width - 48} />
            </section>
          ) : model && result ? (
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
