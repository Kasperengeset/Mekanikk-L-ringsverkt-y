/**
 * Farger for diagrammene. Standardverdiene er faste farger, så SVG-en kan rendres uten nettleser
 * (resvg kjenner ikke CSS-variabler). I appen overstyrer diagrams.css dem med CSS-variablene
 * (--diagram-N, --diagram-V, --diagram-M, --deformed, --bg …) via klassenavnene, også i mørk modus.
 */
export interface Palette {
  N: string;
  V: string;
  M: string;
  deformed: string;
  /** Tekst og konstruksjon. */
  fg: string;
  muted: string;
  warning: string;
  /** Bakgrunn (glorie rundt tall, fyll i symboler). */
  background: string;
  line: string;
  accent: string;
  /** Utheving av et punkt (agenten), samme farge som uthevinger i konstruksjonen. */
  highlight: string;
}

/** Samme farger som variablene i styles.css (designet i docs/design). */
export const DEFAULT_PALETTE: Palette = {
  N: "#3d6b8c",
  V: "#5c7a3e",
  M: "#e2682b",
  deformed: "#e2682b",
  fg: "currentColor",
  muted: "#6b5b4e",
  warning: "#9a2a1f",
  background: "#ffffff",
  line: "#cfc3b1",
  accent: "#e2682b",
  highlight: "#b7791f",
};
