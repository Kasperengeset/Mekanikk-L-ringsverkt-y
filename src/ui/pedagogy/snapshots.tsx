/**
 * Varianter av diagrammene for visuell kontroll med `pnpm snapshot` (brukes ikke i appen):
 *
 *   pnpm snapshot --component src/ui/pedagogy/snapshots.tsx#DiagramsHidden --fixture gerber
 *   pnpm snapshot --component src/ui/pedagogy/snapshots.tsx#DiagramsHighlightMmax --fixture gerber
 *
 * DiagramsHidden: tallene skjult slik de er før studenten har prøvd (ingen forsøk).
 * DiagramsHighlightMmax: som DiagramsHidden, med en utheving av største |M|.
 */
import { hiddenValues } from "../../core/pedagogy.js";
import type { DiagramPoint } from "../state/store.js";
import type { CanvasProps } from "../types.js";
import { DiagramsSvg } from "../diagrams/DiagramsSvg.js";

export function DiagramsHidden({ model, result, viewport }: CanvasProps) {
  return <DiagramsSvg model={model} result={result} viewport={viewport} hidden={hiddenValues(model, {})} />;
}

/** Punktet med størst |M| i konstruksjonen, som andel av elementlengden. */
export function maxMomentPoint(result: CanvasProps["result"]): DiagramPoint | null {
  if (result.status !== "ok") return null;
  let best: { value: number; point: DiagramPoint } | null = null;
  for (const m of result.members) {
    for (const e of [m.extremes.M.max, m.extremes.M.min]) {
      if (!best || Math.abs(e.value) > best.value) best = { value: Math.abs(e.value), point: { member: m.id, quantity: "M", at: e.x / m.length } };
    }
  }
  return best?.point ?? null;
}

export function DiagramsHighlightMmax({ model, result, viewport }: CanvasProps) {
  return <DiagramsSvg model={model} result={result} viewport={viewport} hidden={hiddenValues(model, {})} highlight={maxMomentPoint(result)} />;
}
