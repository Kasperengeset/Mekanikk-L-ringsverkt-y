/**
 * Den pedagogiske agenten: systemprompt, verktøy og tilstanden agenten ser (get_state).
 *
 * Agenten regner aldri selv. Alle tall kommer fra løseren via get_state, og tall studenten
 * ikke har prøvd seg på ennå, er fjernet i koden (stateSummary), ikke bare forbudt i prompten.
 * Verktøyene kjøres i nettleseren, der modellen og løseren bor; serveren videresender bare.
 */
import { z } from "zod";
import { askedTargets, checkAttempt, hiddenValues, isDiagramValueHidden, type Attempt } from "../pedagogy";
import { toLlmJsonSchema, type Model } from "../schema";
import type { SolveResult } from "../solver";
import { forceFactor, lengthFactor } from "../units";
import type { ToolDefinition } from "./tools";

export const AGENT_SYSTEM_PROMPT = `You are a tutor in an interactive learning tool for 2D statics (beams, frames, trusses) in the course Mekanikk 1 at NTNU. The student sees the structure, the N, V and M diagrams and the deformed shape, and can drag loads, nodes and supports. Reply in Norwegian bokmål, briefly: usually two to five sentences. Use the course's terms: fastlager, rullelager, fast innspenning, ledd, fritt-legeme-diagram, strekksiden, virkningssymbol.

# Numbers
- You never calculate. Every number you mention must come from get_state, which reads the deterministic solver. Call get_state before talking about values, and again after every set_param.
- Values marked "skjult" are hidden until the student has made their own attempt in the tool. Never reveal, estimate, bound or hint at them numerically, even if asked directly or told the student has already solved it. Instead help the student get there: suggest a free-body diagram, which equilibrium equation to start with, which point to take moments about, or what to look for in a diagram. Point out that the student can enter an attempt in the panel.

# Teaching
- Explain by pointing at what the student can see, and highlight it at the same time with the highlight tool, e.g. "momentet er størst der skjærkraften skifter fortegn" while highlighting that point in the M diagram.
- Prefer predict-observe-explain: before showing the effect of a change, use ask_prediction to let the student predict, then make the change with set_param, then explain what happened and how it relates to the prediction. Do not judge the student harshly; treat a wrong prediction as the interesting case.
- Use add_control when letting the student explore a parameter would help (load position, magnitude, span, support angle), with sensible min, max and step in the problem's units.
- When you change the model with set_param, say so, and mention that the student can undo with «Angre».
- Ask at most one question at a time. If the student is stuck, give the next small step, not the whole solution.

# Sign conventions in the tool
- N is positive in tension. The M diagram is drawn on the tension side without sign. N and V use virkningssymbol.
- Model paths for set_param and add_control: "<collection>.<id>.<field>", e.g. "loads.P1.at" (position along the member, 0–1), "loads.P1.P", "loads.q1.w_start", "nodes.B.x", "supports.B.type" (fixed, pinned, roller), "supports.B.angle_deg". Supports are addressed by their node id. Values are in the problem's units (model.units).`;

const EntityKind = z.enum(["node", "member", "support", "load"]);

export const AgentTools = {
  get_state: z.strictObject({}).describe("Read the model, the solver's results and the student's progress. Hidden values are marked 'skjult'."),
  set_param: z
    .strictObject({
      path: z.string().describe('Model path, e.g. "loads.P1.at" or "supports.B.type".'),
      value: z.union([z.number(), z.string(), z.boolean()]).describe("New value in the problem's units."),
    })
    .describe("Change one value in the model. The tool and the diagrams update immediately. Returns an error if the model would become invalid."),
  add_control: z
    .strictObject({
      path: z.string().describe("Model path the slider controls."),
      label: z.string().describe("Short label in Norwegian bokmål."),
      min: z.number(),
      max: z.number(),
      step: z.number().positive(),
    })
    .describe("Show a slider the student can use to explore one parameter."),
  highlight: z
    .strictObject({
      targets: z.array(z.strictObject({ kind: EntityKind, id: z.string().describe("Entity id; a support uses its node id.") })),
      diagram_point: z
        .strictObject({
          member: z.string(),
          quantity: z.enum(["N", "V", "M"]),
          at: z.number().min(0).max(1).describe("Position along the member, 0–1 from its start node."),
        })
        .nullable()
        .describe("A point in a diagram to highlight, or null."),
    })
    .describe("Highlight entities in the structure and optionally a point in a diagram. Replaces earlier highlights; empty targets clears."),
  ask_prediction: z
    .strictObject({
      question: z.string().describe("The prediction question, in Norwegian bokmål."),
      options: z.array(z.string()).describe("2–4 answer options, or an empty list for a free-text answer."),
    })
    .describe("Ask the student to predict what will happen before you show it. Waits for the student's answer and returns it."),
} as const;

export type AgentToolName = keyof typeof AgentTools;
export type AgentToolInput<N extends AgentToolName> = z.infer<(typeof AgentTools)[N]>;

export const AGENT_TOOLS: ToolDefinition[] = (Object.keys(AgentTools) as AgentToolName[]).map((name) => ({
  name,
  description: AgentTools[name].description ?? "",
  input_schema: toLlmJsonSchema(AgentTools[name]),
}));

const round = (v: number) => Number(v.toPrecision(4));

/**
 * Tilstanden agenten ser. Tall i oppgavens enheter, avrundet til 4 gjeldende siffer.
 * Verdier studenten ikke har prøvd seg på, er erstattet med "skjult".
 */
export function stateSummary(model: Model, result: SolveResult, attempts: Record<number, Attempt>, extra: Record<string, unknown> = {}) {
  const hidden = hiddenValues(model, attempts);
  const f = forceFactor(model.units);
  const l = lengthFactor(model.units);
  const H = "skjult" as const;
  const { provenance: _provenance, ...modelForAgent } = model;
  void _provenance;
  const targets = askedTargets(model, result);
  const progress = model.asked.map((a, index) => {
    const attempt = attempts[index];
    const target = targets.find((t) => t.index === index);
    return {
      index,
      asked: a,
      title: target?.title,
      attempted: !!attempt,
      correct: attempt && target ? checkAttempt(target, attempt).allCorrect : undefined,
    };
  });
  const base = { units: model.units, symbols: model.symbols, model: modelForAgent, asked: progress, ...extra };
  if (result.status !== "ok") {
    return { ...base, status: result.status as Exclude<SolveResult["status"], "ok">, message: result.status === "mechanism" ? result.message : result.status === "invalid" ? result.issues.map((i) => i.message).join(" ") : "Likevektskontrollen feilet." };
  }
  const forces = (q: "N" | "V" | "M") => (q === "M" ? f * l : f);
  return {
    ...base,
    status: "ok" as const,
    determinacy: result.determinacy,
    reactions: result.reactions.map((r) =>
      hidden.reactionNodes.has(r.node) ? { node: r.node, H, V: H, M: H } : { node: r.node, H: round(r.Fx / f), V: round(r.Fy / f), M: round(r.M / (f * l)) },
    ),
    members: result.members.map((m) => {
      const ext = (q: "N" | "V" | "M") =>
        isDiagramValueHidden(hidden, q, m.id)
          ? H
          : {
              max: { value: round(m.extremes[q].max.value / forces(q)), at: round(m.extremes[q].max.x / m.length) },
              min: { value: round(m.extremes[q].min.value / forces(q)), at: round(m.extremes[q].min.x / m.length) },
            };
      return { id: m.id, kind: m.kind, length: round(m.length / l), N: ext("N"), V: m.kind === "truss" ? undefined : ext("V"), M: m.kind === "truss" ? undefined : ext("M") };
    }),
    displacements: {
      qualitative: result.deformationQualitative,
      nodes: Object.fromEntries(
        Object.entries(result.displacements).map(([id, d]) => [
          id,
          hidden.displacementNodes.has(id) ? H : { ux_mm: round(d.ux * 1e3), uy_mm: round(d.uy * 1e3), rz_rad: round(d.rz) },
        ]),
      ),
    },
  };
}
