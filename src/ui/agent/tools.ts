/**
 * Agentens verktøy, kjørt i nettleseren mot storen. Input valideres med AgentTools (Zod) først:
 * med eager_input_streaming validerer ikke API-et inputen, og et ugyldig kall skal gi en feil
 * tilbake til modellen (is_error), ikke kjøres.
 *
 * Hvert kall gir et tool_result til modellen og eventuelt en kort linje til samtalen («Endret …»).
 */
import { z } from "zod";
import { getParam } from "../../core/edit";
import { AgentTools, stateSummary, type AgentToolInput, type AgentToolName } from "../../core/llm/agent";
import type { Model } from "../../core/schema";
import { solve } from "../../core/solver";
import { formatNumber } from "../format";
import { requestPrediction } from "../state/prediction";
import { useStore, type EntityRef } from "../state/store";
import type { AgentToolResult, AgentToolUseEvent } from "./protocol";

/** Linje i samtalen for en handling veilederen gjorde. */
export interface AgentAction {
  text: string;
  error: boolean;
}

export interface ToolOutcome {
  result: AgentToolResult;
  /** null: ingen linje i samtalen (f.eks. get_state). */
  action: AgentAction | null;
}

interface HandlerResult {
  content: string;
  isError?: boolean;
  action: AgentAction | null;
}

const ok = (content: unknown, action: string | null): HandlerResult => ({
  content: typeof content === "string" ? content : JSON.stringify(content),
  action: action === null ? null : { text: action, error: false },
});
const fail = (content: string, action: string | null): HandlerResult => ({
  content,
  isError: true,
  action: action === null ? null : { text: action, error: true },
});

const SUPPORT_NAMES: Record<string, string> = { fixed: "fast innspenning", pinned: "fastlager", roller: "rullelager" };

/** En modellsti på norsk, f.eks. "loads.P1.at" → "posisjonen til lasten P1". */
export function describePath(path: string): string {
  const [collection, id, ...rest] = path.split(".");
  const field = rest.join(".");
  if (collection === "units") return id === "force" ? "kraftenheten" : id === "length" ? "lengdeenheten" : `enheten ${id ?? ""}`.trim();
  if (!id) return path;
  switch (collection) {
    case "loads": {
      const names: Record<string, string> = {
        at: "posisjonen til",
        P: "størrelsen på",
        M: "størrelsen på",
        angle_deg: "retningen til",
        w_start: "intensiteten ved starten av",
        w_end: "intensiteten ved slutten av",
        from: "starten av",
        to: "slutten av",
        node: "plasseringen av",
        member: "plasseringen av",
        direction: "retningen til",
      };
      return names[field] ? `${names[field]} lasten ${id}` : `${field} for lasten ${id}`;
    }
    case "nodes":
      return field === "x" || field === "y" ? `${field}-koordinaten til node ${id}` : `${field} for node ${id}`;
    case "supports":
      if (field === "type") return `opplageret i ${id}`;
      if (field === "angle_deg") return `vinkelen til opplageret i ${id}`;
      return `${field} for opplageret i ${id}`;
    case "members":
      if (field === "release.i" || field === "release.j") return `momentleddet i ${field.endsWith("i") ? "starten" : "enden"} av ${id}`;
      if (field === "section") return `tverrsnittet til ${id}`;
      return `${field} for element ${id}`;
    case "sections":
      return `${field} for tverrsnittet ${id}`;
    default:
      return path;
  }
}

/** En verdi på norsk med enhet der den er kjent. */
export function describeValue(path: string, value: number | string | boolean, model: Model | null): string {
  const field = path.split(".").at(-1) ?? "";
  if (typeof value === "boolean") return value ? "på" : "av";
  if (typeof value === "string") return SUPPORT_NAMES[value] ?? value;
  const n = formatNumber(value, 4);
  if (field === "at" || field === "from" || field === "to") return `${formatNumber(value * 100, 3)} % av lengden`;
  if (field === "angle_deg") return `${n}°`;
  if (!model || model.symbols.length) return n;
  const { force, length } = model.units;
  const unit = { P: force, M: `${force}${length}`, w_start: `${force}/${length}`, w_end: `${force}/${length}`, x: length, y: length }[field];
  return unit ? `${n} ${unit}` : n;
}

function joinNorwegian(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} og ${parts.at(-1)}`;
}

const ENTITY_NAMES: Record<EntityRef["kind"], (id: string) => string> = {
  node: (id) => `node ${id}`,
  member: (id) => `elementet ${id}`,
  support: (id) => `opplageret i ${id}`,
  load: (id) => `lasten ${id}`,
  section: (id) => `tverrsnittet ${id}`,
};

function entityExists(model: Model, ref: EntityRef): boolean {
  switch (ref.kind) {
    case "node":
      return model.nodes.some((n) => n.id === ref.id);
    case "member":
      return model.members.some((m) => m.id === ref.id);
    case "support":
      return model.supports.some((s) => s.node === ref.id);
    case "load":
      return model.loads.some((l) => l.id === ref.id);
    case "section":
      return model.sections.some((s) => s.id === ref.id);
  }
}

const NO_MODEL = "Ingen oppgave er lastet inn.";

type Handler<N extends AgentToolName> = (input: AgentToolInput<N>, signal: AbortSignal) => HandlerResult | Promise<HandlerResult>;

const HANDLERS: { [N in AgentToolName]: Handler<N> } = {
  get_state: () => {
    const { model, attempts, controls, selection } = useStore.getState();
    if (!model) return fail(NO_MODEL, null);
    // stateSummary fjerner tallene studenten ikke har prøvd seg på ennå.
    return ok(stateSummary(model, solve(model), attempts, { controls, selection }), null);
  },

  set_param: ({ path, value }) => {
    const store = useStore.getState();
    const what = describePath(path);
    const r = store.edit({ path, value });
    if (!r.ok) return fail(r.error, `Kunne ikke endre ${what}: ${r.error}`);
    return ok({ ok: true, path, value, undo: "Studenten kan angre med «Angre»." }, `Endret ${what} til ${describeValue(path, value, r.model)}`);
  },

  add_control: ({ path, label, min, max, step }) => {
    const store = useStore.getState();
    if (!store.model) return fail(NO_MODEL, null);
    const current = getParam(store.model, path);
    if (typeof current !== "number") return fail(`Fant ingen tallverdi på stien «${path}».`, `Kunne ikke lage glidebryteren «${label}»`);
    if (!(min < max)) return fail("min må være mindre enn max.", `Kunne ikke lage glidebryteren «${label}»`);
    if (step > max - min) return fail("step må være mindre enn max − min.", `Kunne ikke lage glidebryteren «${label}»`);
    store.addControl({ path, label, min, max, step });
    return ok({ ok: true, current }, `La til en glidebryter: ${label}`);
  },

  highlight: ({ targets, diagram_point }) => {
    const store = useStore.getState();
    if (!store.model) return fail(NO_MODEL, null);
    const model = store.model;
    const missing = targets.filter((t) => !entityExists(model, t)).map((t) => ENTITY_NAMES[t.kind](t.id));
    if (diagram_point && !model.members.some((m) => m.id === diagram_point.member)) missing.push(ENTITY_NAMES.member(diagram_point.member));
    if (missing.length) return fail(`Fant ikke ${joinNorwegian(missing)}. Ingenting ble uthevet.`, `Kunne ikke utheve: fant ikke ${joinNorwegian(missing)}`);
    store.setHighlights(targets);
    store.setDiagramHighlight(diagram_point);
    const parts = targets.map((t) => ENTITY_NAMES[t.kind](t.id));
    if (diagram_point)
      parts.push(`${diagram_point.quantity}-diagrammet i ${diagram_point.member} ved ${formatNumber(diagram_point.at * 100, 3)} %`);
    return ok({ ok: true }, parts.length ? `Uthevet ${joinNorwegian(parts)}` : "Fjernet uthevingen");
  },

  ask_prediction: async ({ question, options }, signal) => {
    if (options.length === 1 || options.length > 4)
      return fail("Gi 2–4 svaralternativer, eller en tom liste for fritt svar.", null);
    if (signal.aborted) throw new DOMException("Avbrutt", "AbortError");
    const answer = await requestPrediction(question, options, signal);
    return ok(
      { answer: answer.text, ...(answer.optionIndex !== undefined ? { option_index: answer.optionIndex } : {}) },
      `Spådommen din: «${answer.text}»`,
    );
  },
};

const isToolName = (name: string): name is AgentToolName => Object.hasOwn(AgentTools, name);

/**
 * Kjører ett verktøykall. Ugyldig input og ukjente verktøy gir is_error. Kaster bare ved avbrudd
 * (AbortError fra ask_prediction), så løkken kan svare på resten av kallene selv.
 */
export async function runAgentTool(call: AgentToolUseEvent, signal: AbortSignal): Promise<ToolOutcome> {
  const respond = (r: HandlerResult): ToolOutcome => ({
    result: { type: "tool_result", tool_use_id: call.id, content: r.content, ...(r.isError ? { is_error: true } : {}) },
    action: r.action,
  });
  if (!isToolName(call.name)) return respond(fail(`Ukjent verktøy «${call.name}».`, null));
  const parsed = AgentTools[call.name].safeParse(call.input);
  if (!parsed.success) return respond(fail(`Ugyldig input til ${call.name}: ${z.prettifyError(parsed.error)}`, null));
  const handler = HANDLERS[call.name] as Handler<AgentToolName>;
  return respond(await handler(parsed.data as AgentToolInput<AgentToolName>, signal));
}
