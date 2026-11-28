/**
 * Modellen i lenken: «Åpne i appen» fra Claude sender hele modellen komprimert i adressens hash
 * (#m=…), så ingenting lagres på serveren. Brukes av MCP-verktøyene og av webappen.
 */
import LZString from "lz-string";
import { Model } from "../core/schema.js";

const PREFIX = "#m=";
const FORCES_PREFIX = "#f=";

export function modelLink(origin: string, model: Model): string {
  return `${origin.replace(/\/+$/, "")}/app${PREFIX}${LZString.compressToEncodedURIComponent(JSON.stringify(model))}`;
}

/** Lenke til et kraftsystem (force_system-resultatet), vist i appen med ForceSystemView. */
export function forcesLink(origin: string, payload: Record<string, unknown>): string {
  return `${origin.replace(/\/+$/, "")}/app${FORCES_PREFIX}${LZString.compressToEncodedURIComponent(JSON.stringify(payload))}`;
}

/** Kraftsystemet fra en hash som «#f=…», eller undefined. */
export function forcesFromHash(hash: string): Record<string, unknown> | undefined {
  if (!hash.startsWith(FORCES_PREFIX)) return undefined;
  try {
    const json = LZString.decompressFromEncodedURIComponent(hash.slice(FORCES_PREFIX.length));
    const value = json ? (JSON.parse(json) as unknown) : undefined;
    return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** Modellen fra en hash som «#m=…», eller undefined når den mangler eller er ugyldig. */
export function modelFromHash(hash: string): Model | undefined {
  if (!hash.startsWith(PREFIX)) return undefined;
  try {
    const json = LZString.decompressFromEncodedURIComponent(hash.slice(PREFIX.length));
    if (!json) return undefined;
    const parsed = Model.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
