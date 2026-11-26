/**
 * PLASSHOLDER – eies av spor B (N-, V- og M-diagram og deformert form).
 * `viewport` er konstruksjonens viewport; diagrammene skal ha samme skala og x-akse.
 */
import type { CanvasProps } from "../types";

export function DiagramsView({ viewport }: CanvasProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={viewport.width} height={120} className="diagrams">
      <text x={16} y={30} fill="currentColor">
        N-, V- og M-diagram kommer her.
      </text>
    </svg>
  );
}
