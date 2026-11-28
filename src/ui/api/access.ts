/**
 * Tilgangskoden i nettleseren. Testbrukeren får en personlig lenke med ?kode=…, som leses ved oppstart
 * og fjernes fra adresselinjen. Svarer serveren 401 med koden access, ber AccessGate om koden og
 * kjører forespørselen på nytt når den er lagret.
 *
 * Koden lagres i localStorage, med minnet som reserve når lagringen ikke er tilgjengelig (privat vindu).
 */
import { create } from "zustand";
import { ACCESS_CODE_PATTERN, ACCESS_HEADER } from "./protocol.js";

const STORAGE_KEY = "mekanikk.tilgangskode";
export const URL_PARAM = "kode";

let memory: string | null = null;

export function isValidAccessCode(code: string): boolean {
  return ACCESS_CODE_PATTERN.test(code.trim());
}

export function getAccessCode(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? memory;
  } catch {
    return memory;
  }
}

export function setAccessCode(code: string): void {
  memory = code.trim();
  try {
    localStorage.setItem(STORAGE_KEY, memory);
  } catch {
    // Koden gjelder da til siden lukkes.
  }
}

export function clearAccessCode(): void {
  memory = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ingenting lagret.
  }
}

/** Headeren med koden, eller ingenting når ingen kode er lagret. */
export function accessHeaders(): Record<string, string> {
  const code = getAccessCode();
  return code ? { [ACCESS_HEADER]: code } : {};
}

/** Lagrer ?kode= fra adressen og fjerner den, så koden ikke følger med når adressen deles videre. */
export function captureAccessCodeFromUrl(location: Pick<Location, "href"> = window.location, history: Pick<History, "replaceState" | "state"> = window.history): void {
  const url = new URL(location.href);
  const code = url.searchParams.get(URL_PARAM);
  if (code === null) return;
  if (isValidAccessCode(code)) setAccessCode(code);
  url.searchParams.delete(URL_PARAM);
  history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

interface AccessState {
  /** Meldingen fra serveren når den krever en (gyldig) kode; null når alt er i orden. */
  message: string | null;
  /** Forespørselen som ble avvist, kjøres på nytt når koden er lagret. */
  retry: (() => void) | null;
}

export const useAccess = create<AccessState>()(() => ({ message: null, retry: null }));

export function requireAccess(message: string, retry: () => void): void {
  useAccess.setState({ message, retry });
}

/** Lagrer koden og kjører den avviste forespørselen på nytt. */
export function submitAccessCode(code: string): void {
  setAccessCode(code);
  const { retry } = useAccess.getState();
  useAccess.setState({ message: null, retry: null });
  retry?.();
}

export function dismissAccess(): void {
  useAccess.setState({ message: null, retry: null });
}
