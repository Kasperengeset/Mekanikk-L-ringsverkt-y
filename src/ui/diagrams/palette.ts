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

export const DEFAULT_PALETTE: Palette = {
  N: "#2463eb",
  V: "#067647",
  M: "#d92d20",
  deformed: "#7a5af8",
  fg: "currentColor",
  muted: "#667085",
  warning: "#b42318",
  background: "#ffffff",
  line: "#d0d5dd",
  accent: "#2463eb",
  highlight: "#f79009",
};
