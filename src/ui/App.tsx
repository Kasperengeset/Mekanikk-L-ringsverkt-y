/**
 * Appens skall. Eies av fundamentet; sporene fyller inn komponentene:
 *   A: structure/StructureView   B: diagrams/DiagramsView   C: upload/UploadPanel og upload/ConfirmPanel
 */
import { useEffect } from "react";
import { DiagramsView } from "./diagrams/DiagramsView.js";
import { fixtureFromUrl } from "./fixtures.js";
import { fitViewport } from "./geometry.js";
import { SidePanel } from "./panel/SidePanel.js";
import { useStore } from "./state/store.js";
import { useSolveResult } from "./state/useSolveResult.js";
import { StructureView } from "./structure/StructureView.js";
import { ConfirmPanel } from "./upload/ConfirmPanel.js";
import { UploadPanel } from "./upload/UploadPanel.js";
import { useElementSize } from "./useElementSize.js";

/** Høyden til konstruksjonspanelet som andel av lerretet; resten går til diagrammene. */
const STRUCTURE_SHARE = 0.5;

export function App() {
  const model = useStore((s) => s.model);
  const phase = useStore((s) => s.phase);
  const loadModel = useStore((s) => s.loadModel);
  const result = useSolveResult();
  const [canvasRef, size] = useElementSize<HTMLDivElement>();

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

  const structureHeight = Math.max(240, Math.round(size.height * STRUCTURE_SHARE));
  const viewport = model && size.width > 0 ? fitViewport(model, size.width, structureHeight) : null;

  return (
    <div className="app">
      <header className="app-header">
        <h1>Mekanikk-intuisjon</h1>
      </header>
      <main className="workspace">
        <section className="canvas" ref={canvasRef}>
          {model && result && viewport ? (
            <>
              <StructureView model={model} result={result} viewport={viewport} />
              {phase === "explore" && <DiagramsView model={model} result={result} viewport={viewport} />}
            </>
          ) : (
            <UploadPanel />
          )}
        </section>
        <aside className="panel">{model && result ? phase === "confirm" ? <ConfirmPanel /> : <SidePanel model={model} result={result} /> : null}</aside>
      </main>
    </div>
  );
}
