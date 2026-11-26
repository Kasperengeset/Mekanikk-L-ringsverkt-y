/**
 * Self-consistency: flere uavhengige tolkninger av samme oppgave sammenlignes entitet for entitet.
 * Den tolkningen som er mest enig med de andre, velges, og entitetene de andre er uenige i,
 * markeres som usikre så studenten blir spurt om dem i bekreftelsessteget.
 */
import { compareModels, type CompareKind } from "./compare";
import type { Model, Provenance } from "./schema";

export interface Disagreement {
  kind: CompareKind;
  /** Ids i den valgte modellen. Tom når den valgte modellen mangler noe andre tolkninger har. */
  ids: string[];
  /** Hvor mange av de andre tolkningene som er uenige. */
  votes: number;
  detail?: string;
}

export interface Consensus {
  index: number;
  disagreements: Disagreement[];
}

export function selectConsensus(models: Model[]): Consensus {
  if (models.length === 0) throw new Error("Trenger minst én modell.");
  // Velg modellen med færrest avvik mot de andre (medoiden).
  let index = 0;
  let fewest = Infinity;
  models.forEach((candidate, i) => {
    let errors = 0;
    models.forEach((other, j) => {
      if (i !== j) errors += compareModels(other, candidate).entities.filter((e) => e.status !== "match").length;
    });
    if (errors < fewest) [index, fewest] = [i, errors];
  });

  const byKey = new Map<string, Disagreement>();
  models.forEach((other, j) => {
    if (j === index) return;
    const seen = new Set<string>();
    for (const e of compareModels(other, models[index]!).entities) {
      if (e.status === "match") continue;
      const ids = e.candidateIds;
      const key = `${e.kind}:${ids.length ? ids.join("+") : `mangler:${e.truthIds.join("+")}`}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const d = byKey.get(key);
      if (d) d.votes++;
      else byKey.set(key, { kind: e.kind, ids, votes: 1, ...(e.detail ? { detail: e.detail } : {}) });
    }
  });
  return { index, disagreements: [...byKey.values()] };
}

const KIND_NAMES: Record<CompareKind, string> = {
  node: "en node",
  member: "et element",
  section: "et tverrsnitt",
  support: "et opplager",
  hinge: "et ledd",
  load: "en last",
};

const ENTITY_KIND: Record<CompareKind, Provenance["entity_kind"]> = {
  node: "node",
  member: "member",
  section: "member",
  support: "support",
  hinge: "member",
  load: "load",
};

/**
 * Legger uenighetene inn i modellen som provenance med lav sikkerhet, og lager spørsmål til
 * studenten for det den valgte modellen kan mangle.
 */
export function applyDisagreements(model: Model, disagreements: Disagreement[], runs: number): { model: Model; questions: string[] } {
  const provenance = [...model.provenance];
  const questions: string[] = [];
  for (const d of disagreements) {
    const share = `${d.votes} av ${runs - 1} andre tolkninger`;
    if (d.ids.length === 0) {
      questions.push(`${share} fant ${KIND_NAMES[d.kind]} som ikke er med her${d.detail ? ` (${d.detail})` : ""}. Mangler det noe i figuren?`);
      continue;
    }
    for (const id of d.ids) {
      provenance.push({
        entity_kind: ENTITY_KIND[d.kind],
        entity: id,
        confidence: Math.min(0.5, 1 - d.votes / runs),
        note: `${share} tolket dette annerledes${d.detail ? ` (${d.detail})` : ""}.`,
      });
    }
  }
  return { model: { ...model, provenance }, questions };
}
