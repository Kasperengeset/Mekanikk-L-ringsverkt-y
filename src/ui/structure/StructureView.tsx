/**
 * PLASSHOLDER – eies av spor A (konstruksjon og interaksjon).
 * Tegner bare elementene som streker, så appen kan kjøres før sporet er ferdig.
 */
import type { CanvasProps } from "../types";

export function StructureView({ model, viewport }: CanvasProps) {
  const pos = new Map(model.nodes.map((n) => [n.id, viewport.toScreen(n)]));
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={viewport.width} height={viewport.height} className="structure">
      {model.members.map((m) => {
        const a = pos.get(m.i)!;
        const b = pos.get(m.j)!;
        return <line key={m.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="currentColor" strokeWidth={3} />;
      })}
    </svg>
  );
}
