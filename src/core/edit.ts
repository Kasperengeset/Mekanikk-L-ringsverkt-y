/**
 * Endringer i modellen. Brukes av visningen (dra, klikk, glidebrytere) og av agenten
 * (verktøyet set_param), så begge går gjennom nøyaktig samme kode og samme validering.
 *
 * Sti-grammatikk: "<samling>.<id>.<felt>", der entiteter adresseres med id:
 *   nodes.B.x            members.AB.release.j     supports.B.type (opplager adresseres med node-id)
 *   loads.P1.at          loads.q1.w_start         sections.S1.E          units.force
 *
 * En endring godtas bare hvis resultatet følger skjemaet og ikke har valideringsfeil.
 * En mekanisme er en gyldig modell (løseren rapporterer den), så den stoppes ikke her.
 */
import { z } from "zod";
import { Model, type SupportType } from "./schema";
import { validateModel, type Issue } from "./validate";

export type EditResult = { ok: true; model: Model } | { ok: false; error: string; issues?: Issue[] };

const COLLECTIONS = ["nodes", "members", "supports", "loads", "sections"] as const;
type Collection = (typeof COLLECTIONS)[number];

function keyOf(collection: Collection, item: Record<string, unknown>): string {
  return String(collection === "supports" ? item.node : item.id);
}

/** Setter en verdi i en kopi av objektet langs stien. Mangler mellomledd, opprettes de. */
function setIn(obj: Record<string, unknown>, path: string[], value: unknown): Record<string, unknown> {
  const [head, ...rest] = path;
  if (head === undefined) return obj;
  if (rest.length === 0) {
    const copy = { ...obj };
    if (value === undefined) delete copy[head];
    else copy[head] = value;
    return copy;
  }
  const child = (obj[head] ?? {}) as Record<string, unknown>;
  return { ...obj, [head]: setIn(child, rest, value) };
}

/** Leser verdien langs stien, eller undefined. */
export function getParam(model: Model, path: string): unknown {
  const parts = path.split(".");
  const [collection, id, ...field] = parts;
  if (collection === "units") return field.length === 0 && id ? (model.units as Record<string, unknown>)[id] : undefined;
  if (!COLLECTIONS.includes(collection as Collection) || !id) return undefined;
  const item = (model[collection as Collection] as Record<string, unknown>[]).find((x) => keyOf(collection as Collection, x) === id);
  return field.reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined), item);
}

/** Setter én verdi. `value: undefined` fjerner et valgfritt felt. */
export function setParam(model: Model, path: string, value: unknown): EditResult {
  const parts = path.split(".");
  const [collection, id, ...field] = parts;
  let next: unknown;
  if (collection === "units") {
    if (!id || field.length) return { ok: false, error: `Ugyldig sti: ${path}` };
    next = { ...model, units: { ...model.units, [id]: value } };
  } else {
    if (!COLLECTIONS.includes(collection as Collection) || !id || field.length === 0) return { ok: false, error: `Ugyldig sti: ${path}` };
    const items = model[collection as Collection] as Record<string, unknown>[];
    const index = items.findIndex((x) => keyOf(collection as Collection, x) === id);
    if (index < 0) return { ok: false, error: `Fant ikke ${collection}.${id}` };
    let item = items[index]!;
    // Momentledd er et objekt med begge ender; opprett det når en ende settes første gang.
    if (field[0] === "release" && item.release === undefined) item = { ...item, release: { i: false, j: false } };
    const updated = items.map((x, k) => (k === index ? setIn(item, field, value) : x));
    next = { ...model, [collection as Collection]: updated };
  }
  return check(next);
}

/** Flere endringer som én operasjon (alt eller ingenting). */
export function setParams(model: Model, changes: { path: string; value: unknown }[]): EditResult {
  let current = model;
  for (const c of changes) {
    const r = setParam(current, c.path, c.value);
    if (!r.ok) return r;
    current = r.model;
  }
  return { ok: true, model: current };
}

/** Kontrollerer skjema og validering for en ny modell. */
export function check(candidate: unknown): EditResult {
  const parsed = Model.safeParse(candidate);
  if (!parsed.success) return { ok: false, error: z.prettifyError(parsed.error) };
  const v = validateModel(parsed.data);
  if (!v.ok) {
    const errors = v.issues.filter((i) => i.level === "error");
    return { ok: false, error: errors.map((i) => i.message).join(" "), issues: errors };
  }
  // Behold kandidaten (ikke Zods kopi), så urørte deler beholder identitet og React slipper å tegne dem på nytt.
  // Kandidaten bygger på en allerede gyldig modell, så standardverdiene er fylt inn.
  return { ok: true, model: candidate as Model };
}

const SUPPORT_CYCLE: SupportType[] = ["fixed", "pinned", "roller"];

/** Klikk på et opplager: fast innspenning → fastlager → rullelager → fast innspenning. */
export function cycleSupportType(model: Model, node: string): EditResult {
  const s = model.supports.find((x) => x.node === node);
  if (!s) return { ok: false, error: `Ingen opplager i ${node}` };
  const nextType = SUPPORT_CYCLE[(SUPPORT_CYCLE.indexOf(s.type) + 1) % SUPPORT_CYCLE.length]!;
  return setParam(model, `supports.${node}.type`, nextType);
}

/** Runder en lengde til nærmeste multiplum av `step` (i modellens enheter), f.eks. 0,1 m. */
export function snap(value: number, step: number): number {
  return Math.round(value / step) * step;
}
