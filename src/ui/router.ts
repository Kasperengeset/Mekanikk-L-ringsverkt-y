/**
 * En liten ruter for de få sidene: forsiden (/), verktøyet (/app), innlogging (/logg-inn) og
 * personvern (/personvern). Bruker History API; Vercel sender alle stier til index.html (vercel.json).
 */
import { useSyncExternalStore, type MouseEvent } from "react";

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

if (typeof window !== "undefined") window.addEventListener("popstate", notify);

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const snapshot = () => (typeof window === "undefined" ? "/" : window.location.pathname + window.location.search);

/** Gjeldende sti med spørrestreng, f.eks. "/app?eksempel=gerber". */
export function useLocation(): { path: string; search: string } {
  const full = useSyncExternalStore(subscribe, snapshot, () => "/");
  const i = full.indexOf("?");
  return i < 0 ? { path: full, search: "" } : { path: full.slice(0, i), search: full.slice(i) };
}

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  if (to === snapshot()) return;
  if (options.replace) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
  window.scrollTo?.(0, 0);
  notify();
}

/** Klikk på en intern lenke uten å laste siden på nytt (Ctrl/⌘-klikk åpner som vanlig i ny fane). */
export function linkClick(to: string) {
  return (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
}

/**
 * Gamle lenker gikk til forsiden med ?eksempel= eller ?kode= (verktøyet lå der før). De sendes videre
 * til /app, så lenker som er delt ut, fortsatt virker.
 */
export function legacyRedirect(path: string, search: string): string | undefined {
  if (path !== "/" || !search) return undefined;
  const params = new URLSearchParams(search);
  return params.has("eksempel") || params.has("kode") ? `/app${search}` : undefined;
}
