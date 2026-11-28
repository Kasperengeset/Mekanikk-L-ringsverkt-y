/**
 * Modellen i lenken: «Åpne i moment.no» fra Claude sender hele modellen komprimert i adressens hash
 * (#m=…), så ingenting lagres på serveren. Brukes av MCP-verktøyene og av webappen.
 */
import LZString from "lz-string";
import { Model } from "../core/schema.js";

const PREFIX = "#m=";

export function modelLink(origin: string, model: Model): string {
  return `${origin.replace(/\/+$/, "")}/app${PREFIX}${LZString.compressToEncodedURIComponent(JSON.stringify(model))}`;
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
