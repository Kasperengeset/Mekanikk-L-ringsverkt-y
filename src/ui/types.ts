import type { Model } from "../core/schema";
import type { SolveResult } from "../core/solver";
import type { Viewport } from "./geometry";

/** Props som alle tegnekomponenter (SVG) får. De skal kunne rendres uten nettleser (pnpm snapshot). */
export interface CanvasProps {
  model: Model;
  result: SolveResult;
  viewport: Viewport;
}
