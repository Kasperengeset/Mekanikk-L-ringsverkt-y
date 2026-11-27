/**
 * Omregning mellom modellkoordinater og skjerm. Modellen tegnes i sine egne enheter
 * (model.units.length), med y oppover; SVG har y nedover. Løserens resultater er i SI og
 * regnes om med lengthFactor.
 */
import type { Model } from "../core/schema.js";
import { lengthFactor } from "../core/units.js";

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Viewport {
  width: number;
  height: number;
  /** Piksler per lengdeenhet i modellen. */
  scale: number;
  /** Meter per lengdeenhet i modellen (for resultater i SI). */
  lengthFactor: number;
  bounds: Bounds;
  toScreen(p: Point): Point;
  toWorld(p: Point): Point;
  /** Punkt i SI-koordinater (fra løseren) til skjerm. */
  siToScreen(p: Point): Point;
}

export function modelBounds(model: Model): Bounds {
  const xs = model.nodes.map((n) => n.x);
  const ys = model.nodes.map((n) => n.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

export interface FitOptions {
  /** Luft rundt konstruksjonen i piksler (plass til opplagre, laster og tekst). */
  padding?: number;
  /** Tving en bestemt skala, f.eks. for at diagrammene skal ha samme x-akse som konstruksjonen. */
  scale?: number;
  /** Horisontal plassering når scale er tvunget: samme venstre kant som et annet viewport. */
  originX?: number;
}

/** Plasserer modellen sentrert i et område på width × height piksler. */
export function fitViewport(model: Model, width: number, height: number, options: FitOptions = {}): Viewport {
  const padding = options.padding ?? 70;
  const bounds = modelBounds(model);
  const spanX = Math.max(bounds.maxX - bounds.minX, 1e-9);
  const spanY = Math.max(bounds.maxY - bounds.minY, 1e-9);
  const fit = Math.min((width - 2 * padding) / spanX, (height - 2 * padding) / spanY);
  const scale = options.scale ?? (Number.isFinite(fit) && fit > 0 ? fit : 1);
  const originX = options.originX ?? (width - spanX * scale) / 2;
  const originY = (height + spanY * scale) / 2; // skjerm-y for bounds.minY
  const lf = lengthFactor(model.units);
  const toScreen = (p: Point): Point => ({ x: originX + (p.x - bounds.minX) * scale, y: originY - (p.y - bounds.minY) * scale });
  const toWorld = (p: Point): Point => ({ x: bounds.minX + (p.x - originX) / scale, y: bounds.minY + (originY - p.y) / scale });
  return {
    width,
    height,
    scale,
    lengthFactor: lf,
    bounds,
    toScreen,
    toWorld,
    siToScreen: (p) => toScreen({ x: p.x / lf, y: p.y / lf }),
  };
}

/** Skjermens venstre kant for modellens minX, for å dele x-akse mellom paneler. */
export function originXOf(v: Viewport): number {
  return v.toScreen({ x: v.bounds.minX, y: v.bounds.minY }).x;
}
