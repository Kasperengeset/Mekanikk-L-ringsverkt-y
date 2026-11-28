/**
 * N-, V- og M-diagram og deformert form under konstruksjonen, ett kort per diagram. Leser innstillingene i
 * `store.diagrams` (hvilke diagram som vises, forstørrelse) og tegner med DiagramCards.
 * `viewport` er konstruksjonens viewport; diagrammene får samme skala og x-akse, og panelet
 * bestemmer selv sin høyde.
 *
 * Tall studenten ikke har prøvd seg på ennå, skjules (hiddenValues med store.attempts), og
 * store.diagramHighlight tegnes som en markør, og snittet (store.cut) som en stiplet strek. Uthever agenten et panel som er slått av, slås det på.
 */
import { useEffect, useMemo } from "react";
import { resolveCut } from "../../core/cut.js";
import { hiddenValues } from "../../core/pedagogy.js";
import { useStore } from "../state/store.js";
import type { CanvasProps } from "../types.js";
import { DiagramCards } from "./DiagramCards.js";
import "./diagrams.css";

export function DiagramsView({ model, result, viewport }: CanvasProps) {
  const settings = useStore((s) => s.diagrams);
  const setDiagrams = useStore((s) => s.setDiagrams);
  const attempts = useStore((s) => s.attempts);
  const highlight = useStore((s) => s.diagramHighlight);
  const storedCut = useStore((s) => s.cut);
  const hidden = useMemo(() => hiddenValues(model, attempts), [model, attempts]);
  const cut = useMemo(() => (storedCut ? resolveCut(model, storedCut) : undefined), [model, storedCut]);

  const panelShown = highlight ? settings[highlight.quantity] : false;
  useEffect(() => {
    if (highlight && !useStore.getState().diagrams[highlight.quantity]) setDiagrams({ [highlight.quantity]: true });
  }, [highlight, setDiagrams]);
  useEffect(() => {
    if (!highlight || !panelShown) return;
    // Diagrammene kan ligge under kanten av lerretet: rull markøren fram.
    const marker = document.querySelector(".diagrams .dg-highlight");
    if (marker && typeof marker.scrollIntoView === "function") marker.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [highlight, panelShown]);

  return <DiagramCards model={model} result={result} viewport={viewport} settings={settings} onSettingsChange={setDiagrams} hidden={hidden} highlight={highlight} cut={cut} />;
}
