/**
 * Modellskjemaet: den eneste kontrakten mellom LLM-en, løseren og visningen.
 *
 * Enheter: geometri og laster står i enhetene i `units` (oppgavens enheter), slik at
 * LLM-en kan skrive av tallene fra oppgaven uten å regne om. Tverrsnittsdata (E, A, I)
 * står alltid i SI (Pa, m², m⁴). `units.ts` gjør om til SI før løseren bruker modellen.
 *
 * Koordinater: x mot høyre, y oppover. Vinkler i grader, positivt mot klokka fra +x.
 *
 * Avvik fra skjemaet i spesifikasjonen (se docs/spesifikasjon.pdf, s. 2):
 *  - Punktlast er gitt som størrelse `P` og retning `angle_deg` i stedet for Fx/Fy, så
 *    LLM-en slipper å dekomponere skrå laster selv. Kan stå i en node eller på et element (`member` + `at`).
 *  - Fordelt last har `direction` (global_y | global_x | local_y) og `basis` (length | projection).
 *  - Moment kan stå på et element (`member` + `at`).
 *  - `provenance` har `entity_kind`, `field` og `alternatives`, så bekreftelsessteget kan bytte med ett klikk.
 *  - `asked` bruker `node` for nodereferanser og `at` for posisjon (andel av elementlengden).
 *  - `schemaVersion` for migrering av lagrede modeller og testsettet.
 */
import { z } from "zod";

export const SCHEMA_VERSION = 1 as const;

const Id = z.string().min(1);
const Fraction = z.number().min(0).max(1);

export const LengthUnit = z.enum(["mm", "cm", "m"]);
export const ForceUnit = z.enum(["N", "kN", "MN"]);

export const Units = z
  .strictObject({ length: LengthUnit, force: ForceUnit })
  .describe("Enhetene oppgaven bruker. Alle koordinater og laster i modellen står i disse enhetene.");

export const Node = z.strictObject({
  id: Id.describe("Kort unik id, f.eks. 'A'."),
  x: z.number().describe("x-koordinat (mot høyre) i units.length."),
  y: z.number().describe("y-koordinat (oppover) i units.length."),
});

export const Release = z
  .strictObject({
    i: z.boolean().describe("true = momentledd i i-enden."),
    j: z.boolean().describe("true = momentledd i j-enden."),
  })
  .describe("Momentledd (indre ledd) i elementendene. Brukes bare for kind = beam.");

export const MemberKind = z.enum(["beam", "truss"]);

export const Member = z.strictObject({
  id: Id,
  i: Id.describe("Id til startnoden."),
  j: Id.describe("Id til sluttnoden."),
  kind: MemberKind.describe("beam = bjelke/rammeelement (N, V, M). truss = fagverksstav (bare N)."),
  section: Id.optional().describe("Id til tverrsnitt i sections. Utelates hvis oppgaven ikke oppgir tverrsnitt."),
  release: Release.optional(),
});

export const Section = z.strictObject({
  id: Id,
  E: z.number().positive().describe("Elastisitetsmodul i Pa."),
  A: z.number().positive().describe("Areal i m²."),
  I: z.number().positive().describe("Annet arealmoment i m⁴."),
  assumed: z.boolean().describe("true hvis verdiene ikke er oppgitt i oppgaven."),
});

export const SupportType = z.enum(["fixed", "pinned", "roller"]);

export const Support = z.strictObject({
  node: Id,
  type: SupportType.describe("fixed = fast innspenning, pinned = fastlager, roller = rullelager/glidelager."),
  angle_deg: z
    .number()
    .optional()
    .describe("Bare for roller: helningen til underlaget i grader, mot klokka fra +x. 0 = horisontalt underlag (vertikal reaksjon)."),
});

export const PointLoad = z.strictObject({
  id: Id,
  type: z.literal("point"),
  node: Id.optional().describe("Noden lasten står i. Bruk enten node, eller member + at."),
  member: Id.optional(),
  at: Fraction.optional().describe("Posisjon langs elementet som andel av lengden fra i-enden (0–1)."),
  P: z.number().describe("Størrelse i units.force."),
  angle_deg: z.number().describe("Retningen pilen peker, i grader mot klokka fra +x. Nedover = -90, oppover = 90, mot høyre = 0, mot venstre = 180."),
});

export const DistributedDirection = z.enum(["global_y", "global_x", "local_y"]);
export const DistributedBasis = z.enum(["length", "projection"]);

export const DistributedLoad = z.strictObject({
  id: Id,
  type: z.literal("distributed"),
  member: Id,
  w_start: z.number().describe("Intensitet ved `from` i units.force per units.length, positiv i +direction."),
  w_end: z.number().describe("Intensitet ved `to`."),
  from: Fraction.describe("Start som andel av elementlengden fra i-enden."),
  to: Fraction.describe("Slutt som andel av elementlengden fra i-enden."),
  direction: DistributedDirection.describe(
    "global_y: vertikal (nedover = negativ w). global_x: horisontal. local_y: vinkelrett på elementet, +local_y er 90° mot klokka fra retningen i→j.",
  ),
  basis: DistributedBasis.describe(
    "length: per lengde langs elementet (f.eks. egenvekt). projection: per projisert lengde vinkelrett på lastretningen (f.eks. snø per horisontal lengde). Ingen forskjell for local_y.",
  ),
});

export const MomentLoad = z.strictObject({
  id: Id,
  type: z.literal("moment"),
  node: Id.optional().describe("Noden momentet står i. Bruk enten node, eller member + at."),
  member: Id.optional(),
  at: Fraction.optional(),
  M: z.number().describe("Moment i units.force·units.length, positivt mot klokka."),
});

export const Load = z.discriminatedUnion("type", [PointLoad, DistributedLoad, MomentLoad]);

export const AskedQuantity = z.enum([
  "reaction",
  "member_force",
  "internal_forces",
  "diagrams",
  "N_max",
  "V_max",
  "M_max",
  "displacement",
  "rotation",
]);

export const Asked = z.strictObject({
  quantity: AskedQuantity.describe(
    "reaction = opplagerkrefter, member_force = stavkraft, internal_forces = N/V/M i et snitt, diagrams = N-, V- og M-diagram.",
  ),
  node: Id.optional(),
  member: Id.optional(),
  at: Fraction.optional(),
});

export const EntityKind = z.enum(["node", "member", "section", "support", "load", "dimension", "asked"]);

export const Provenance = z.strictObject({
  entity_kind: EntityKind,
  entity: Id.describe("Id til entiteten. For opplager: nodens id."),
  field: z.string().optional().describe("Feltet usikkerheten gjelder, f.eks. 'type' eller 'x'."),
  confidence: Fraction.describe("Hvor sikker tolkningen er, 0–1. Under 0,7 utheves for studenten."),
  note: z.string().describe("Kort forklaring på norsk bokmål."),
  alternatives: z.array(z.string()).optional().describe("Andre mulige verdier for feltet, f.eks. ['pinned', 'roller']."),
});

export const Model = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  units: Units,
  nodes: z.array(Node).min(1),
  members: z.array(Member),
  sections: z.array(Section).default([]),
  supports: z.array(Support),
  loads: z.array(Load),
  asked: z.array(Asked).default([]),
  provenance: z.array(Provenance).default([]),
});

/** Det LLM-en sender inn med verktøyet submit_model. */
export const SubmitModelInput = z.strictObject({
  model: Model,
  questions: z
    .array(z.string())
    .describe("Spørsmål til studenten på norsk bokmål om ting som er tvetydige i oppgaven. Tom liste hvis ingen."),
});

export type Units = z.infer<typeof Units>;
export type Node = z.infer<typeof Node>;
export type Member = z.infer<typeof Member>;
export type Section = z.infer<typeof Section>;
export type SupportType = z.infer<typeof SupportType>;
export type Support = z.infer<typeof Support>;
export type PointLoad = z.infer<typeof PointLoad>;
export type DistributedLoad = z.infer<typeof DistributedLoad>;
export type MomentLoad = z.infer<typeof MomentLoad>;
export type Load = z.infer<typeof Load>;
export type Asked = z.infer<typeof Asked>;
export type Provenance = z.infer<typeof Provenance>;
export type Model = z.infer<typeof Model>;
/** Modell slik den skrives for hånd (felt med standardverdi kan utelates). */
export type ModelInput = z.input<typeof Model>;
export type SubmitModelInput = z.infer<typeof SubmitModelInput>;

/** Nøkkelord som strict tool use ikke støtter. Zod validerer dem i stedet, etter at svaret er mottatt. */
const UNSUPPORTED_KEYWORDS = new Set([
  "$schema",
  "default",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "minItems",
  "maxItems",
  "uniqueItems",
]);

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function sanitize(node: Json): Json {
  if (Array.isArray(node)) return node.map(sanitize);
  if (node === null || typeof node !== "object") return node;
  const out: { [key: string]: Json } = {};
  for (const [key, value] of Object.entries(node)) {
    if (UNSUPPORTED_KEYWORDS.has(key)) continue;
    // Strict tool use støtter anyOf, ikke oneOf.
    out[key === "oneOf" ? "anyOf" : key] = sanitize(value);
  }
  return out;
}

/**
 * JSON Schema for et Zod-skjema, tilpasset strict tool use: felt med standardverdi er påkrevd
 * (LLM-en skal ta stilling), og nøkkelord API-et ikke støtter, er fjernet.
 */
export function toLlmJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const raw = z.toJSONSchema(schema, { io: "output", target: "draft-2020-12" }) as Json;
  return sanitize(raw) as Record<string, unknown>;
}
