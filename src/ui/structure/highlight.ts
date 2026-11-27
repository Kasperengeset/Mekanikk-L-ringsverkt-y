/**
 * Farger og uthevinger i konstruksjonsvisningen.
 *
 * Fargene settes to steder: som `color`-attributt fra paletten (det er det `pnpm snapshot` ser, siden
 * resvg ikke kjenner CSS-variabler) og som klasse som structure.css overstyrer med temaets variabler
 * i appen. Tegningen bruker currentColor, så begge veier gir samme farge.
 */
import type { Model } from "../../core/schema.js";
import type { EntityRef, Phase } from "../state/store.js";

export interface Palette {
  /** Bakgrunnen (fyll i ledd og glorie bak tekst). */
  bg: string;
  muted: string;
  load: string;
  uncertain: string;
  accent: string;
  warning: string;
}

/** Samme verdier som lys modus i styles.css. Konstruksjonen selv bruker currentColor (--fg). */
export const DEFAULT_PALETTE: Palette = {
  bg: "#ffffff",
  muted: "#667085",
  load: "#067647",
  uncertain: "#f79009",
  accent: "#2463eb",
  warning: "#b42318",
};

/** Grensen for usikre entiteter i bekreftelsessteget. */
export const UNCERTAIN_BELOW = 0.7;

/** Nøkkel for en entitet, f.eks. "load:P1" eller "support:A" (opplager adresseres med node-id). */
export function entityKey(ref: EntityRef): string {
  return `${ref.kind}:${ref.id}`;
}

export function parseEntityKey(key: string | null | undefined): EntityRef | null {
  if (!key) return null;
  const at = key.indexOf(":");
  const kind = key.slice(0, at);
  if (at < 0 || !["node", "member", "support", "load", "section"].includes(kind)) return null;
  return { kind: kind as EntityRef["kind"], id: key.slice(at + 1) };
}

/**
 * Entitetene tolkningen er usikker på (provenance med confidence < 0,7), som nøkler.
 * Et usikkert mål («dimension») utheves på noden eller elementet med samme id.
 */
export function uncertainKeys(model: Model, below = UNCERTAIN_BELOW): Set<string> {
  const keys = new Set<string>();
  const nodes = new Set(model.nodes.map((n) => n.id));
  const members = new Set(model.members.map((m) => m.id));
  for (const p of model.provenance) {
    if (p.confidence >= below) continue;
    switch (p.entity_kind) {
      case "node":
      case "member":
      case "support":
      case "load":
      case "section":
        keys.add(`${p.entity_kind}:${p.entity}`);
        break;
      case "dimension":
        if (nodes.has(p.entity)) keys.add(`node:${p.entity}`);
        if (members.has(p.entity)) keys.add(`member:${p.entity}`);
        break;
      case "asked":
        break;
    }
  }
  return keys;
}

/**
 * Det konstruksjonsvisningen viser fra storen: valgt entitet, uthevinger og (bare i bekreftelsessteget)
 * entitetene tolkningen er usikker på. Ren funksjon, så den kan testes uten nettleser.
 */
export function highlightProps(
  state: { phase: Phase; selection: EntityRef | null; highlights: EntityRef[] },
  model: Model,
): { selection: EntityRef | null; highlights: EntityRef[]; uncertain: Set<string> | undefined } {
  return {
    selection: state.selection,
    highlights: state.highlights,
    uncertain: state.phase === "confirm" ? uncertainKeys(model) : undefined,
  };
}
