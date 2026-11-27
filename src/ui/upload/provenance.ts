/**
 * Bekreftelsessteget: usikre entiteter fra model.provenance, stien en endring skal gå til
 * (grammatikken i src/core/edit.ts), og alternativer som tekst → verdi. Ren logikk, testes uten nettleser.
 */
import { getParam } from "../../core/edit.js";
import type { Model, Provenance } from "../../core/schema.js";
import { formatNumber } from "../format.js";
import type { EntityRef } from "../state/store.js";

/** Under denne sikkerheten vises entiteten for studenten (samme terskel som i tolkningen). */
export const LOW_CONFIDENCE = 0.7;

const COLLECTION: Partial<Record<Provenance["entity_kind"], "nodes" | "members" | "sections" | "supports" | "loads">> = {
  node: "nodes",
  member: "members",
  section: "sections",
  support: "supports",
  load: "loads",
};

function exists(model: Model, kind: EntityRef["kind"], id: string): boolean {
  switch (kind) {
    case "node":
      return model.nodes.some((n) => n.id === id);
    case "member":
      return model.members.some((m) => m.id === id);
    case "support":
      return model.supports.some((s) => s.node === id);
    case "load":
      return model.loads.some((l) => l.id === id);
    case "section":
      return model.sections.some((s) => s.id === id);
  }
}

/**
 * Stien en provenance-oppføring peker på, f.eks. `supports.B.type` eller `loads.P1.angle_deg`,
 * eller null når den ikke kan endres med ett klikk (mål, spørsmål, manglende felt eller entitet).
 */
export function provenancePath(p: Provenance, model: Model): string | null {
  const field = p.field?.trim();
  if (!field || !/^[A-Za-z_]\w*(\.[A-Za-z_]\w*)*$/.test(field)) return null;
  // Et anslått mål knyttet til en node (x eller y) endres som nodens koordinat.
  if (p.entity_kind === "dimension")
    return (field === "x" || field === "y") && exists(model, "node", p.entity) ? `nodes.${p.entity}.${field}` : null;
  const collection = COLLECTION[p.entity_kind];
  if (!collection || !exists(model, p.entity_kind as EntityRef["kind"], p.entity)) return null;
  return `${collection}.${p.entity}.${field}`;
}

/** Entiteten som skal utheves. Et mål uthever noden eller elementet med samme id, hvis det finnes. */
export function provenanceRef(p: Provenance, model: Model): EntityRef | null {
  if (p.entity_kind === "asked") return null;
  if (p.entity_kind === "dimension") {
    if (exists(model, "node", p.entity)) return { kind: "node", id: p.entity };
    if (exists(model, "member", p.entity)) return { kind: "member", id: p.entity };
    return null;
  }
  return exists(model, p.entity_kind, p.entity) ? { kind: p.entity_kind, id: p.entity } : null;
}

export interface UncertainEntry {
  /** Indeks i model.provenance (stabil nøkkel så lenge modellen ikke byttes ut). */
  index: number;
  provenance: Provenance;
  path: string | null;
  ref: EntityRef | null;
}

/** Alle oppføringer med lav sikkerhet, sortert med de minst sikre først. */
export function uncertainEntries(model: Model, threshold = LOW_CONFIDENCE): UncertainEntry[] {
  return model.provenance
    .map((p, index) => ({ index, provenance: p, path: provenancePath(p, model), ref: provenanceRef(p, model) }))
    .filter((e) => e.provenance.confidence < threshold)
    .sort((a, b) => a.provenance.confidence - b.provenance.confidence || a.index - b.index);
}

/** Entitetene som skal utheves, uten duplikater. */
export function highlightRefs(entries: UncertainEntry[]): EntityRef[] {
  const seen = new Set<string>();
  const out: EntityRef[] = [];
  for (const e of entries) {
    if (!e.ref) continue;
    const key = `${e.ref.kind}:${e.ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e.ref);
  }
  return out;
}

const NUMERIC_FIELDS = new Set(["x", "y", "P", "M", "angle_deg", "at", "from", "to", "w_start", "w_end", "E", "A", "I", "b", "h", "D", "t", "z"]);
const BOOLEAN_FIELDS = new Set(["i", "j", "assumed", "hole"]);

/** Norske ord LLM-en kan bruke for opplagertyper i stedet for verdiene i skjemaet. */
const SUPPORT_SYNONYMS: Record<string, string> = {
  fixed: "fixed",
  "fast innspenning": "fixed",
  innspenning: "fixed",
  innspent: "fixed",
  pinned: "pinned",
  fastlager: "pinned",
  "fast lager": "pinned",
  leddlager: "pinned",
  boltlager: "pinned",
  roller: "roller",
  rullelager: "roller",
  glidelager: "roller",
  "bevegelig lager": "roller",
};

/** Tall fra tekst: desimalkomma, unicode-minus og en valgfri enhet eller gradtegn til slutt. */
export function parseNumber(raw: string): number | undefined {
  const s = raw.trim().replace(/−/g, "-").replace(/\s+/g, " ");
  const m = /^([+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?)\s*(?:°|grader|mm|cm|m|kN\/m|kNm|kN|N\/m|Nm|N|MN|Pa|MPa|GPa)?$/i.exec(s);
  if (!m) return undefined;
  const n = Number(m[1]!.replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
}

export type ParsedAlternative = { ok: true; value: unknown } | { ok: false; error: string };

/**
 * Verdien et alternativ (alltid en streng i provenance) står for, ut fra feltet og verdien som står
 * i modellen nå. Tallfelt parses som tall, ja/nei-felt som boolske verdier, resten beholdes som tekst.
 */
export function parseAlternative(raw: string, path: string, model: Model): ParsedAlternative {
  const field = path.split(".").at(-1) ?? "";
  const current = getParam(model, path);
  const text = raw.trim();
  if (typeof current === "number" || (current === undefined && NUMERIC_FIELDS.has(field))) {
    const n = parseNumber(text);
    return n === undefined ? { ok: false, error: `«${raw}» er ikke et tall.` } : { ok: true, value: n };
  }
  if (typeof current === "boolean" || (current === undefined && BOOLEAN_FIELDS.has(field))) {
    const t = text.toLowerCase();
    if (["true", "ja", "1"].includes(t)) return { ok: true, value: true };
    if (["false", "nei", "0"].includes(t)) return { ok: true, value: false };
    return { ok: false, error: `«${raw}» er ikke ja eller nei.` };
  }
  if (path.startsWith("supports.") && field === "type") {
    const type = SUPPORT_SYNONYMS[text.toLowerCase()];
    return type ? { ok: true, value: type } : { ok: false, error: `«${raw}» er ikke en opplagertype.` };
  }
  return { ok: true, value: text };
}

const VALUE_NAMES: Record<string, Record<string, string>> = {
  type: { fixed: "fast innspenning", pinned: "fastlager", roller: "rullelager" },
  kind: { beam: "bjelke", truss: "fagverksstav" },
  direction: { global_y: "vertikal", global_x: "horisontal", local_y: "vinkelrett på elementet" },
  basis: { length: "per lengde langs elementet", projection: "per projisert lengde" },
  axis: { strong: "sterk akse", weak: "svak akse" },
};

/** En verdi slik studenten skal se den, f.eks. «rullelager», «-90°» eller «4 m». */
export function formatValue(path: string, value: unknown, model: Model): string {
  const field = path.split(".").at(-1) ?? "";
  if (value === undefined || value === null) return "ikke satt";
  if (typeof value === "boolean") return value ? "ja" : "nei";
  if (typeof value === "number") {
    const { length, force } = model.units;
    const unit: Record<string, string> = {
      x: ` ${length}`,
      y: ` ${length}`,
      P: ` ${force}`,
      M: ` ${force}${length}`,
      w_start: ` ${force}/${length}`,
      w_end: ` ${force}/${length}`,
      angle_deg: "°",
    };
    // I symbolske oppgaver er enhetene symboler (L, F), så tallet står alene; vinkler har alltid grader.
    const suffix = field === "angle_deg" ? "°" : model.symbols.length ? "" : (unit[field] ?? "");
    return `${formatNumber(value, 4)}${suffix}`;
  }
  if (typeof value === "string") return VALUE_NAMES[field]?.[value] ?? value;
  return JSON.stringify(value);
}

const KIND_NAMES: Record<Provenance["entity_kind"], string> = {
  node: "Node",
  member: "Element",
  section: "Tverrsnitt",
  support: "Opplager",
  load: "Last",
  dimension: "Mål",
  asked: "Spørsmål",
};

const FIELD_NAMES: Record<string, string> = {
  type: "type",
  kind: "type",
  x: "x-koordinat",
  y: "y-koordinat",
  P: "størrelse",
  M: "moment",
  angle_deg: "vinkel",
  at: "posisjon",
  from: "start",
  to: "slutt",
  w_start: "intensitet ved start",
  w_end: "intensitet ved slutt",
  direction: "retning",
  basis: "grunnlag",
  node: "node",
  member: "element",
  section: "tverrsnitt",
  E: "E-modul",
  "release.i": "ledd i i-enden",
  "release.j": "ledd i j-enden",
};

/** Overskrift for en oppføring, f.eks. «Opplager B – type». */
export function entryTitle(p: Provenance): string {
  const field = p.field?.trim();
  const name = field ? (FIELD_NAMES[field] ?? field) : undefined;
  return `${KIND_NAMES[p.entity_kind]} ${p.entity}${name ? ` – ${name}` : ""}`;
}
