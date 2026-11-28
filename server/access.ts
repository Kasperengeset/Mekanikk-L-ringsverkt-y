/**
 * Tilgangskoder for API-et, så ikke alle som har adressen kan bruke API-nøkkelen.
 *
 * ACCESS_CODES er en liste med koder skilt med komma eller mellomrom, gjerne én per testbruker
 * (f.eks. "ola-7f3k, kari-9x2m"). Uten ACCESS_CODES er API-et åpent, som under lokal utvikling.
 * Klienten sender koden i ACCESS_HEADER. Store og små bokstaver regnes som like.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { ACCESS_HEADER } from "../src/ui/api/protocol.js";

export const ACCESS_MISSING = "Denne versjonen krever en tilgangskode. Bruk lenken du har fått, eller skriv inn koden.";
export const ACCESS_INVALID = "Tilgangskoden er ikke gyldig. Sjekk lenken eller koden du har fått.";

export function parseAccessCodes(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/[\s,]+/)
    .map((c) => c.trim().toLowerCase())
    .filter((c) => c.length > 0);
}

const digest = (s: string) => createHash("sha256").update(s).digest();

/** undefined når forespørselen slipper gjennom, ellers meldingen til brukeren (svaret blir 401). */
export function checkAccess(req: Request, raw: string | undefined): string | undefined {
  const codes = parseAccessCodes(raw);
  if (codes.length === 0) return undefined;
  const given = req.headers.get(ACCESS_HEADER)?.trim().toLowerCase();
  if (!given) return ACCESS_MISSING;
  // Sammenligner med alle kodene på fast tid, så svartiden ikke avslører hvor nær en gjetning er.
  const d = digest(given);
  let ok = false;
  for (const code of codes) ok = timingSafeEqual(d, digest(code)) || ok;
  return ok ? undefined : ACCESS_INVALID;
}
