import type { Model } from "../core/schema.js";
import type { SolveResult } from "../core/solver/index.js";
import type { Viewport } from "./geometry.js";

/** Props som alle tegnekomponenter (SVG) får. De skal kunne rendres uten nettleser (pnpm snapshot). */
export interface CanvasProps {
  model: Model;
  result: SolveResult;
  viewport: Viewport;
}
