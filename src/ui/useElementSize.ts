import { useLayoutEffect, useState } from "react";

/**
 * Størrelsen til et element, oppdatert ved endring (ResizeObserver). Returnerer en callback-ref,
 * så målingen også virker for et element som vises senere (f.eks. først når en modell er lastet).
 */
export function useElementSize<T extends HTMLElement>() {
  const [element, setElement] = useState<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    if (!element) return;
    const update = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    update();
    // Uten ResizeObserver (eldre nettlesere, jsdom) måles elementet bare én gang.
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(element);
    return () => ro.disconnect();
  }, [element]);
  return [setElement, size] as const;
}
