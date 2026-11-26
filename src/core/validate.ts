/**
 * Deterministisk validering av en modell: referanser, geometri og statisk ubestemthetsgrad.
 * Kjøres etter tolkningen (feilene sendes tilbake til LLM-en) og før hver løsning.
 *
 * Rangsjekken av stivhetsmatrisen (geometrisk ustabile systemer med n_s ≥ 0) hører til løseren.
 */
import type { Model } from "./schema";

export type IssueLevel = "error" | "warning";

export interface Issue {
  level: IssueLevel;
  code: string;
  message: string;
  entity?: string;
}

export interface Determinacy {
  /** Statisk ubestemthetsgrad. < 0: mekanisme, 0: statisk bestemt, > 0: statisk ubestemt. */
  n_s: number;
  classification: "mechanism" | "determinate" | "indeterminate";
  unknowns: number;
  equations: number;
}

export interface ValidationResult {
  ok: boolean;
  issues: Issue[];
  /** Regnes bare når det ikke finnes feil. */
  determinacy?: Determinacy;
}

const REACTIONS = { fixed: 3, pinned: 2, roller: 1 } as const;

function duplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of ids) (seen.has(id) ? dup : seen).add(id);
  return [...dup];
}

export function validateModel(model: Model): ValidationResult {
  const issues: Issue[] = [];
  const error = (code: string, message: string, entity?: string) => issues.push({ level: "error", code, message, entity });
  const warn = (code: string, message: string, entity?: string) => issues.push({ level: "warning", code, message, entity });

  for (const [what, ids] of [
    ["node", model.nodes.map((n) => n.id)],
    ["member", model.members.map((m) => m.id)],
    ["section", model.sections.map((s) => s.id)],
    ["load", model.loads.map((l) => l.id)],
  ] as const) {
    for (const id of duplicates(ids)) error("duplicate_id", `Id '${id}' er brukt av flere ${what}-entiteter.`, id);
  }

  const nodes = new Map(model.nodes.map((n) => [n.id, n]));
  const members = new Map(model.members.map((m) => [m.id, m]));
  const sections = new Set(model.sections.map((s) => s.id));

  const xs = model.nodes.map((n) => n.x);
  const ys = model.nodes.map((n) => n.y);
  const extent = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 0);
  const lengthTol = Math.max(extent * 1e-9, Number.MIN_VALUE);

  const memberPairs = new Map<string, string>();
  for (const m of model.members) {
    const a = nodes.get(m.i);
    const b = nodes.get(m.j);
    if (!a) error("unknown_node", `Element '${m.id}' peker på noden '${m.i}', som ikke finnes.`, m.id);
    if (!b) error("unknown_node", `Element '${m.id}' peker på noden '${m.j}', som ikke finnes.`, m.id);
    if (m.i === m.j) error("zero_length", `Element '${m.id}' starter og slutter i samme node.`, m.id);
    else if (a && b && Math.hypot(b.x - a.x, b.y - a.y) <= lengthTol)
      error("zero_length", `Element '${m.id}' har lengde null.`, m.id);
    if (m.section !== undefined && !sections.has(m.section))
      error("unknown_section", `Element '${m.id}' peker på tverrsnittet '${m.section}', som ikke finnes.`, m.id);
    if (m.kind === "truss" && (m.release?.i || m.release?.j))
      warn("truss_release", `Stav '${m.id}' har momentledd, men en fagverksstav tar ikke moment uansett.`, m.id);
    const key = [m.i, m.j].sort().join("|");
    const other = memberPairs.get(key);
    if (other) warn("duplicate_member", `Elementene '${other}' og '${m.id}' forbinder de samme nodene.`, m.id);
    else memberPairs.set(key, m.id);
  }

  const supported = new Set<string>();
  for (const s of model.supports) {
    if (!nodes.has(s.node)) error("unknown_node", `Opplageret peker på noden '${s.node}', som ikke finnes.`, s.node);
    if (supported.has(s.node)) error("duplicate_support", `Noden '${s.node}' har mer enn ett opplager.`, s.node);
    supported.add(s.node);
  }

  for (const load of model.loads) {
    if (load.type === "distributed") {
      const m = members.get(load.member);
      if (!m) error("unknown_member", `Last '${load.id}' peker på elementet '${load.member}', som ikke finnes.`, load.id);
      else if (m.kind === "truss")
        error("load_on_truss", `Last '${load.id}' står på staven '${m.id}'. Laster i et fagverk må stå i nodene.`, load.id);
      if (!(load.from < load.to))
        error("bad_range", `Last '${load.id}' må ha from < to (har from = ${load.from}, to = ${load.to}).`, load.id);
      continue;
    }
    const onNode = load.node !== undefined;
    const onMember = load.member !== undefined || load.at !== undefined;
    if (onNode === onMember) {
      error("bad_location", `Last '${load.id}' må stå enten i en node (node) eller på et element (member og at).`, load.id);
      continue;
    }
    if (onNode) {
      if (!nodes.has(load.node!)) error("unknown_node", `Last '${load.id}' peker på noden '${load.node}', som ikke finnes.`, load.id);
      continue;
    }
    if (load.member === undefined || load.at === undefined) {
      error("bad_location", `Last '${load.id}' på et element trenger både member og at.`, load.id);
      continue;
    }
    const m = members.get(load.member);
    if (!m) error("unknown_member", `Last '${load.id}' peker på elementet '${load.member}', som ikke finnes.`, load.id);
    else if (m.kind === "truss" && load.at > 0 && load.at < 1)
      error("load_on_truss", `Last '${load.id}' står midt på staven '${m.id}'. Laster i et fagverk må stå i nodene.`, load.id);
  }

  for (const a of model.asked) {
    if (a.node !== undefined && !nodes.has(a.node))
      warn("unknown_ref", `Det som spørres etter, peker på noden '${a.node}', som ikke finnes.`, a.node);
    if (a.member !== undefined && !members.has(a.member))
      warn("unknown_ref", `Det som spørres etter, peker på elementet '${a.member}', som ikke finnes.`, a.member);
  }

  const known = new Set([...nodes.keys(), ...members.keys(), ...sections, ...model.loads.map((l) => l.id)]);
  for (const p of model.provenance) {
    if (!known.has(p.entity) && p.entity_kind !== "dimension" && p.entity_kind !== "asked")
      warn("unknown_ref", `Usikkerheten gjelder '${p.entity}', som ikke finnes i modellen.`, p.entity);
  }

  // Sammenheng: alle noder bør henge sammen gjennom elementer.
  const adjacency = new Map<string, string[]>(model.nodes.map((n) => [n.id, []]));
  for (const m of model.members) {
    adjacency.get(m.i)?.push(m.j);
    adjacency.get(m.j)?.push(m.i);
  }
  for (const n of model.nodes) {
    if (adjacency.get(n.id)!.length === 0 && model.members.length > 0)
      warn("isolated_node", `Noden '${n.id}' er ikke koblet til noe element.`, n.id);
  }
  const first = model.nodes[0];
  if (first && model.members.length > 0) {
    const seen = new Set([first.id]);
    const stack = [first.id];
    while (stack.length) {
      for (const next of adjacency.get(stack.pop()!) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        stack.push(next);
      }
    }
    const connected = model.nodes.filter((n) => adjacency.get(n.id)!.length > 0);
    if (connected.some((n) => !seen.has(n.id)))
      warn("disconnected", "Konstruksjonen består av flere deler som ikke henger sammen.");
  }

  if (model.supports.length === 0) error("no_supports", "Modellen har ingen opplagre.");
  if (model.members.length === 0) error("no_members", "Modellen har ingen elementer.");

  const ok = !issues.some((i) => i.level === "error");
  return { ok, issues, determinacy: ok ? determinacy(model) : undefined };
}

/**
 * Statisk ubestemthetsgrad for en blandet modell av bjelke- og stavelementer:
 *   n_s = (ukjente snittkrefter + reaksjoner) − (likevektslikninger + ledd).
 * Bjelke: 3 ukjente, stav: 1. Hver node gir 2 likninger, pluss 1 for rotasjon hvis minst én
 * bjelkeende er stivt koblet til noden eller noden er fast innspent. Hvert momentledd i en
 * elementende gir 1 likning (M = 0). For rene rammer og rene fagverk gir dette formlene
 * 3m + r − 3j − c og m + r − 2j fra spesifikasjonen.
 */
export function determinacy(model: Model): Determinacy {
  let unknowns = 0;
  let equations = 0;
  const rigidEnds = new Map<string, number>(model.nodes.map((n) => [n.id, 0]));
  for (const m of model.members) {
    if (m.kind === "truss") {
      unknowns += 1;
      continue;
    }
    unknowns += 3;
    for (const end of ["i", "j"] as const) {
      if (m.release?.[end]) equations += 1;
      else rigidEnds.set(m[end], (rigidEnds.get(m[end]) ?? 0) + 1);
    }
  }
  const supportAt = new Map(model.supports.map((s) => [s.node, s.type]));
  for (const s of model.supports) unknowns += REACTIONS[s.type];
  for (const n of model.nodes) {
    equations += 2;
    if ((rigidEnds.get(n.id) ?? 0) > 0 || supportAt.get(n.id) === "fixed") equations += 1;
  }
  const n_s = unknowns - equations;
  return {
    n_s,
    classification: n_s < 0 ? "mechanism" : n_s === 0 ? "determinate" : "indeterminate",
    unknowns,
    equations,
  };
}

export function formatIssues(issues: Issue[]): string {
  return issues.map((i) => `- [${i.level === "error" ? "feil" : "advarsel"}] ${i.message}`).join("\n");
}
