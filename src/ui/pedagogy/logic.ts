/**
 * Rene hjelpere for «Prøv selv»: tolking av tallfelt, enheter, tilbakemeldingstekster og
 * enhetene til glidebryterne. Ingen React, så de kan testes direkte.
 */
import type { AttemptCheck, ComponentVerdict, TargetComponent, Unit } from "../../core/pedagogy";
import type { Model } from "../../core/schema";
import { forceFactor, lengthFactor } from "../../core/units";
import { formatQuantity, symbolicUnits } from "../format";

const NUMBER = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[+-]?\\d+)?";
const NUMBER_RE = new RegExp(`^${NUMBER}$`, "i");
const FRACTION_RE = new RegExp(`^(${NUMBER})/(${NUMBER})$`, "i");

/**
 * Tall fra et tekstfelt: desimalkomma eller -punktum, mellomrom og enkle brøker (1/8 i en symbolsk
 * oppgave). Tomt felt gir null, tekst som ikke er et tall gir NaN.
 */
export function parseNumberInput(text: string): number | null {
  const s = text
    .replace(/[\s\u00a0\u202f]/g, "")
    .replace(/[\u2212\u2013]/g, "-")
    .replace(/,/g, ".");
  if (s === "") return null;
  if (NUMBER_RE.test(s)) return Number(s);
  const f = FRACTION_RE.exec(s);
  if (f) {
    const den = Number(f[2]);
    return den === 0 ? NaN : Number(f[1]) / den;
  }
  return NaN;
}

/** Enheten bak et tallfelt: «kN», «kNm», «mm» – eller «· F» og «· FL» i en symbolsk oppgave. */
export function unitLabel(unit: Unit, model: Model): string {
  const sym = symbolicUnits(model)?.[unit];
  if (sym) return `· ${sym}`;
  const { force, length } = model.units;
  return { force, moment: `${force}${length}`, length, displacement: "mm", rotation: "rad" }[unit];
}

/** Faktor fra oppgavens enheter til SI (samme som i src/core/pedagogy.ts). */
function siFactor(unit: Unit, model: Model): number {
  const f = forceFactor(model.units);
  const l = lengthFactor(model.units);
  return { force: f, moment: f * l, length: l, displacement: 1e-3, rotation: 1 }[unit];
}

/**
 * Riktig verdi som tekst (formatQuantity). `scale` er største |fasit| i målet: numerisk støy
 * under 1e-9 av den skrives som 0. Når bare størrelsen teller, vises størrelsen.
 */
export function expectedText(c: TargetComponent, model: Model, scale = Math.abs(c.expected)): string {
  let value = c.magnitudeOnly ? Math.abs(c.expected) : c.expected;
  if (Math.abs(value) <= 1e-9 * scale) value = 0;
  return formatQuantity(c.unit, value * siFactor(c.unit, model), model);
}

export const VERDICT_TEXT: Record<ComponentVerdict, string> = {
  correct: "Riktig",
  wrong_sign: "Riktig størrelse, men feil retning (fortegn)",
  wrong: "Feil",
  missing: "Ikke besvart",
};

/** Samlet tilbakemelding for et forsøk. */
export function summaryText(check: AttemptCheck): string {
  const n = check.verdicts.length;
  if (check.allCorrect) return n === 1 ? "Riktig!" : "Alt riktig!";
  const correct = check.verdicts.filter((v) => v === "correct").length;
  const sign = check.verdicts.includes("wrong_sign") ? " Sjekk retningene mot fortegnskonvensjonen." : "";
  return `${correct} av ${n} riktig.${sign} Prøv gjerne igjen.`;
}

export const CONVENTION_TEXT = "Fortegn: horisontal positiv mot høyre, vertikal positiv oppover, moment positivt mot klokka, N positiv i strekk.";

export const HIDDEN_EXPLANATION = "Tallene vises når du har prøvd selv. Formen på diagrammene ser du allerede.";

/** Enheten til en verdi en glidebryter styrer, ut fra feltet i stien (tom når den er en andel eller ukjent). */
export function paramUnit(path: string, model: Model): string {
  const field = path.split(".").pop();
  const sym = symbolicUnits(model);
  const { force, length } = model.units;
  switch (field) {
    case "x":
    case "y":
      return sym?.length ?? length;
    case "P":
      return sym?.force ?? force;
    case "M":
      return sym?.moment ?? `${force}${length}`;
    case "w_start":
    case "w_end":
      return sym?.lineLoad ?? `${force}/${length}`;
    case "angle_deg":
      return "°";
    default:
      return "";
  }
}
