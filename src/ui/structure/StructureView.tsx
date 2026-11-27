/**
 * Konstruksjonsvisningen i appen: StructureSvg koblet til storen, med klikk og dra.
 *
 *  - Klikk velger en entitet; klikk på et opplager bytter type (fast innspent → fastlager → rullelager).
 *  - Dra en punktlast eller et moment langs bjelken, halen på en punktlast for størrelse og retning,
 *    en node for geometrien, en fordelt last (hele, eller endene) langs elementet.
 *  - Pointer events med setPointerCapture: beginGesture ved pointerdown, updateGesture per pointermove,
 *    endGesture ved pointerup (ett steg i angre-historikken), cancelGesture ved Escape.
 *
 * Med ?debug=1 vises tiden per oppdatering (endring + løsning + tegning, til React har skrevet DOM-en).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { cycleSupportType } from "../../core/edit.js";
import type { Point, Viewport } from "../geometry.js";
import { useStore } from "../state/store.js";
import type { CanvasProps } from "../types.js";
import { dragTo, startDrag, type DragPart, type DragSession } from "./drag.js";
import { highlightProps, parseEntityKey } from "./highlight.js";
import { length, loadScales, sub, type LoadScales } from "./layout.js";
import { StructureSvg } from "./StructureSvg.js";
import "./structure.css";

/** Så langt (piksler) pekeren kan flytte seg før et klikk blir et drag. */
const CLICK_TOLERANCE = 4;

const DEBUG = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("debug") === "1";

interface ActiveDrag {
  session: DragSession;
  pointerId: number;
  start: Point;
  moved: boolean;
  /** Viewport og skalaer da draget startet (fryses, så det man drar ikke flytter seg under pekeren). */
  viewport: Viewport;
  lastKey?: string;
}

function formatMs(v: number): string {
  return v.toFixed(1).replace(".", ",");
}

function timingText(samples: number[]): string {
  const last = samples[samples.length - 1] ?? 0;
  const mean = samples.reduce((s, v) => s + v, 0) / Math.max(samples.length, 1);
  const max = Math.max(...samples);
  return `Oppdatering: ${formatMs(last)} ms (snitt ${formatMs(mean)}, maks ${formatMs(max)} over ${samples.length})`;
}

export function StructureView({ model, result, viewport }: CanvasProps) {
  const phase = useStore((s) => s.phase);
  const selection = useStore((s) => s.selection);
  const highlights = useStore((s) => s.highlights);
  const marks = useMemo(() => highlightProps({ phase, selection, highlights }, model), [phase, selection, highlights, model]);

  const svgRef = useRef<SVGSVGElement>(null);
  const active = useRef<ActiveDrag | null>(null);
  const [frozen, setFrozen] = useState<{ viewport?: Viewport; scales: LoadScales } | null>(null);
  const liveScales = useMemo(() => loadScales(model), [model]);
  const vp = frozen?.viewport ?? viewport;
  const scales = frozen?.scales ?? liveScales;

  // Måling: fra pointermove til React har skrevet den nye tegningen.
  const timing = useRef<{ start: number; samples: number[] }>({ start: 0, samples: [] });
  const debugRef = useRef<SVGTextElement>(null);
  useLayoutEffect(() => {
    const t = timing.current;
    if (!t.start) return;
    t.samples = [...t.samples.slice(-59), performance.now() - t.start];
    t.start = 0;
    if (debugRef.current) debugRef.current.textContent = timingText(t.samples);
  }, [model]);

  const stop = (pointerId: number | undefined, commit: boolean) => {
    const a = active.current;
    if (!a) return;
    active.current = null;
    const svg = svgRef.current;
    if (pointerId !== undefined && svg?.hasPointerCapture?.(pointerId)) svg.releasePointerCapture(pointerId);
    const store = useStore.getState();
    if (a.session.kind === "support") {
      if (commit && !a.moved && store.model) {
        const r = cycleSupportType(store.model, a.session.node);
        if (r.ok) store.replaceModel(r.model);
      }
    } else if (commit) store.endGesture();
    else store.cancelGesture();
    setFrozen(null);
  };
  // Escape-lytteren registreres én gang; den må alltid se den nyeste stop-funksjonen.
  const stopRef = useRef(stop);
  useLayoutEffect(() => {
    stopRef.current = stop;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (active.current) {
        e.preventDefault();
        stopRef.current(active.current.pointerId, false);
      } else useStore.getState().select(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const local = (e: PointerEvent<SVGSVGElement>): Point => {
    const rect = svgRef.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  };

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 || active.current) return;
    const target = (e.target as Element | null)?.closest?.("[data-entity]");
    const ref = parseEntityKey(target?.getAttribute("data-entity"));
    const store = useStore.getState();
    store.select(ref);
    if (!ref || !store.model) return;
    const part = (target?.getAttribute("data-part") ?? "body") as DragPart;
    const p = local(e);
    const session = startDrag(store.model, ref, part, vp.toWorld(p), vp, scales);
    if (!session) return;
    e.preventDefault();
    svgRef.current?.setPointerCapture?.(e.pointerId);
    active.current = { session, pointerId: e.pointerId, start: p, moved: false, viewport: vp };
    if (session.kind !== "support") store.beginGesture();
    // Under dra av en node endres modellens utstrekning; da holdes skalaen fast til draget er ferdig.
    setFrozen({ viewport: session.kind === "node" ? vp : undefined, scales });
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const a = active.current;
    if (!a || e.pointerId !== a.pointerId) return;
    const p = local(e);
    if (!a.moved && length(sub(p, a.start)) < CLICK_TOLERANCE) return;
    a.moved = true;
    const next = dragTo(a.session, a.viewport.toWorld(p), p);
    if (!next || next.key === a.lastKey) return;
    timing.current.start = performance.now();
    const r = useStore.getState().updateGesture(next.update);
    // En ugyldig mellomtilstand avvises av storen; da prøves samme tilstand igjen ved neste bevegelse.
    if (r.ok) a.lastKey = next.key;
    else timing.current.start = 0;
  };

  const onPointerUp = (e: PointerEvent<SVGSVGElement>) => {
    if (active.current?.pointerId === e.pointerId) stop(e.pointerId, true);
  };
  const onPointerCancel = (e: PointerEvent<SVGSVGElement>) => {
    if (active.current?.pointerId === e.pointerId) stop(e.pointerId, false);
  };

  return (
    <StructureSvg
      model={model}
      result={result}
      viewport={vp}
      scales={scales}
      {...marks}
      interactive
      className={frozen ? "is-dragging" : undefined}
      svgRef={svgRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
    >
      {DEBUG && (
        <text ref={debugRef} x={8} y={vp.height - 8} className="st-debug" fill="#667085" fontSize={11}>
          Dra noe for å måle tiden per oppdatering
        </text>
      )}
    </StructureSvg>
  );
}
