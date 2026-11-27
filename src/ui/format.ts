/**
 * Tall til tekst på norsk (desimalkomma), i oppgavens enheter. Løserens resultater er i SI.
 * For symbolske oppgaver (model.symbols) skrives resultatet som koeffisient × symboler, f.eks. 0,1125 FL.
 */
import type { Model } from "../core/schema.js";
import { forceFactor, lengthFactor } from "../core/units.js";

export type QuantityKind = "force" | "moment" | "length" | "lineLoad" | "displacement" | "rotation";

/** Tall med inntil `digits` gjeldende siffer, desimalkomma og uten unødige nuller. */
export function formatNumber(value: number, digits = 3): string {
  if (!Number.isFinite(value)) return "–";
  if (Math.abs(value) < 1e-12) return "0";
  const rounded = Number(value.toPrecision(digits));
  return rounded.toLocaleString("nb-NO", { maximumFractionDigits: 10, useGrouping: false }).replace("−", "-");
}

/** Enhetene uttrykt med symbolene i en symbolsk oppgave, eller undefined for tallbaserte oppgaver. */
export function symbolicUnits(model: Model): Partial<Record<QuantityKind, string>> | undefined {
  if (!model.symbols.length) return undefined;
  const of = (kind: string) => model.symbols.find((s) => s.kind === kind)?.name;
  const L = of("length");
  const F = of("force") ?? (of("distributed") && L ? `${of("distributed")}${L}` : undefined) ?? (of("moment") && L ? `${of("moment")}/${L}` : undefined);
  const join = (...parts: (string | undefined)[]) => (parts.every(Boolean) ? parts.join("") : undefined);
  return {
    force: F,
    moment: of("moment") ?? join(F, L),
    length: L,
    lineLoad: of("distributed") ?? (F && L ? `${F}/${L}` : undefined),
  };
}

/** Verdi i SI til tekst med enhet, f.eks. "18 kNm", eller "0,113 FL" i en symbolsk oppgave. */
export function formatQuantity(kind: QuantityKind, valueSI: number, model: Model, digits = 3): string {
  const l = lengthFactor(model.units);
  const f = forceFactor(model.units);
  const factor = { force: f, moment: f * l, length: l, lineLoad: f / l, displacement: 1e-3, rotation: 1 }[kind];
  const value = valueSI / factor;
  const sym = symbolicUnits(model)?.[kind];
  if (sym) return `${formatNumber(value, digits)} ${sym}`;
  const unit = {
    force: model.units.force,
    moment: `${model.units.force}${model.units.length}`,
    length: model.units.length,
    lineLoad: `${model.units.force}/${model.units.length}`,
    displacement: "mm",
    rotation: "rad",
  }[kind];
  return `${formatNumber(value, digits)} ${unit}`;
}
