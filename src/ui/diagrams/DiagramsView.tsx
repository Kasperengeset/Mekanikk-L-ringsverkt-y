/**
 * N-, V- og M-diagram og deformert form under konstruksjonen. Leser innstillingene i
 * `store.diagrams` (hvilke diagram som vises, forstørrelse) og tegner med DiagramsSvg.
 * `viewport` er konstruksjonens viewport; diagrammene får samme skala og x-akse, og panelet
 * bestemmer selv sin høyde.
 */
import { useStore } from "../state/store";
import type { CanvasProps } from "../types";
import { DiagramsSvg } from "./DiagramsSvg";
import "./diagrams.css";

export function DiagramsView({ model, result, viewport }: CanvasProps) {
  const settings = useStore((s) => s.diagrams);
  const setDiagrams = useStore((s) => s.setDiagrams);
  return <DiagramsSvg model={model} result={result} viewport={viewport} settings={settings} onSettingsChange={setDiagrams} />;
}
