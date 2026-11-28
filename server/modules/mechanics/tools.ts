/**
 * Mekanikk-verktøyene for MCP. All regning skjer i src/core (samme løser som webappen); verktøyene
 * oversetter mellom Claude og løseren og skriver resultatet slik at Claude forklarer ut fra det.
 *
 * Claude leser tekstinnholdet; structuredContent har de samme tallene maskinlesbart (og modellen),
 * til visningen i chatten (MCP Apps, milepæl 2) og andre klienter.
 */
import { createHash } from "node:crypto";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { solveForceSystem, ForceSystemInput } from "../../../src/core/forces.js";
import { Model } from "../../../src/core/schema.js";
import { solve } from "../../../src/core/solver/index.js";
import { forceFactor, lengthFactor } from "../../../src/core/units.js";
import { formatNumber } from "../../../src/ui/format.js";
import { modelLink } from "../../../src/ui/share.js";
import type { SubjectModule, ToolContext, ToolDefinition } from "../../platform/mcp.js";

/** Visningen i chatten for begge verktøyene (src/ui/embed, bygd til dist/mcp-ui/visning.html). */
export const VIEW_URI = "ui://mekanikk/visning.html";

/** Relativ likevektsresidual som godtas (kravet er 1e-6; løseren selv krever 1e-9). */
export const RESIDUAL_LIMIT = 1e-6;

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);
const fmt = (v: number) => formatNumber(v, 4);

function text(t: string, structured?: Record<string, unknown>, isError = false): CallToolResult {
  return { content: [{ type: "text", text: t }], ...(structured ? { structuredContent: structured } : {}), ...(isError ? { isError: true } : {}) };
}

const EXPLAIN = "Forklar for studenten ut fra disse tallene. Ikke regn dem på nytt selv, og ikke legg til tall som ikke står her.";

// ---------------------------------------------------------------- force_system

export const forceSystemTool: ToolDefinition<typeof ForceSystemInput> = {
  name: "force_system",
  title: "Kraftsystem: komponenter, resultant og moment",
  description: [
    "Bruk dette verktøyet hver gang en mekanikkoppgave handler om krefter som skal dekomponeres eller summeres: komponenter (Fx, Fz), resultant R, retning, moment om et punkt eller likevekt i et punkt, f.eks. «finn x- og z-komponentene og resultanten av F1, F2 og F3».",
    "Bruk det også når regningen virker enkel: tallene herfra er kontrollert, mens hoderegning ikke er det. Regn ikke komponenter eller resultanter selv; bygg forklaringen på svaret herfra. Ikke for bjelker, rammer og fagverk (bruk solve_structure).",
    "Akser som i kurset: x mot høyre, z oppover. Gi hver kraft slik oppgaven gir den: størrelse + vinkel fra +x, størrelse + retningsvektor (helning som 3:4, eller fra ett punkt til et annet), eller komponenter.",
    "Står ikke retningen eller størrelsen i oppgaven, still studenten et spørsmål i stedet for å anta; verktøyet svarer med missing_fields.",
  ].join(" "),
  inputSchema: ForceSystemInput,
  ui: VIEW_URI,
  async run(input, ctx) {
    const denied = await ctx.consumeTask(`forces:${hash({ u: input.units, ids: input.forces.map((f) => f.id).sort() })}`);
    if (denied) return text(denied, { status: "denied", message: denied }, true);
    const r = solveForceSystem(input);
    const u = input.units.force;
    if (r.status === "missing") {
      const lines = r.missing.map((m) => `- ${m.field}: ${m.reason}`);
      return text(`Mangler opplysninger, spør studenten før du regner videre:\n${lines.join("\n")}`, { status: "missing", missing_fields: r.missing });
    }
    if (r.residual > RESIDUAL_LIMIT) return text(`Kontrollen feilet (residual ${r.residual}). Resultatet vises ikke.`, { status: "check_failed", residual: r.residual }, true);
    const lines = [
      "Løst med Mekanikk-intuisjon (deterministisk, kontrollert). Akser: x mot høyre, z oppover; vinkler mot klokka fra +x.",
      "Komponenter:",
      ...r.forces.map((f) => `- ${f.id}: ${f.id}x = ${fmt(f.Fx)} ${u}, ${f.id}z = ${fmt(f.Fz)} ${u} (|${f.id}| = ${fmt(f.magnitude)} ${u}, ${fmt(f.angle_deg)}°)`),
      `Resultant: Rx = ΣFx = ${fmt(r.resultant.Rx)} ${u}, Rz = ΣFz = ${fmt(r.resultant.Rz)} ${u}, R = √(Rx² + Rz²) = ${fmt(r.resultant.R)} ${u}, retning ${fmt(r.resultant.angle_deg)}° fra +x.`,
      ...(r.moment
        ? [`Moment om (${fmt(r.moment.about.x)}, ${fmt(r.moment.about.z)}) ${input.units.length}: M = ${fmt(r.moment.M)} ${u}${input.units.length} (positivt mot klokka).`]
        : []),
      r.equilibrium ? "Systemet er i likevekt (R = 0)." : "Systemet er ikke i likevekt (R ≠ 0).",
      EXPLAIN,
    ];
    return text(lines.join("\n"), { view: "forces", units: input.units, ...r });
  },
};

// ---------------------------------------------------------------- solve_structure

/** Modellskjemaet uten feltene Claude ikke trenger å fylle ut. */
export const StructureInput = Model.omit({ schemaVersion: true, provenance: true });

export interface StructureSummary {
  status: "ok";
  units: Model["units"];
  determinacy: { classification: string; n_s: number };
  reactions: { node: string; H: number; V: number; M: number }[];
  members: {
    id: string;
    kind: "beam" | "truss";
    length: number;
    N: { max: number; at_max: number; min: number; at_min: number };
    V: { max: number; at_max: number; min: number; at_min: number };
    M: { max: number; at_max: number; min: number; at_min: number };
  }[];
  equilibrium_residual: number;
  open_url: string;
}

/** Løser modellen og gjør resultatene om til oppgavens enheter. */
export function solveStructureModel(model: Model, origin: string): StructureSummary | { status: "invalid" | "mechanism" | "check_failed"; message: string; issues?: { message: string }[] } {
  const r = solve(model);
  if (r.status === "invalid") return { status: "invalid", message: "Modellen er ikke gyldig.", issues: r.issues.map((i) => ({ message: i.message })) };
  if (r.status === "mechanism") return { status: "mechanism", message: r.message };
  if (r.status === "equilibrium_failed" || r.equilibrium.relative > RESIDUAL_LIMIT)
    return { status: "check_failed", message: "Likevektskontrollen feilet, så resultatene vises ikke." };
  const f = forceFactor(model.units);
  const l = lengthFactor(model.units);
  const ext = (e: { max: { value: number; x: number }; min: { value: number; x: number } }, k: number) => ({
    max: e.max.value / k,
    at_max: e.max.x / l,
    min: e.min.value / k,
    at_min: e.min.x / l,
  });
  return {
    status: "ok",
    units: model.units,
    determinacy: { classification: r.determinacy.classification, n_s: r.determinacy.n_s },
    reactions: r.reactions.map((x) => ({ node: x.node, H: x.Fx / f, V: x.Fy / f, M: x.M / (f * l) })),
    members: r.members.map((m) => ({
      id: m.id,
      kind: m.kind,
      length: m.length / l,
      N: ext(m.extremes.N, f),
      V: ext(m.extremes.V, f),
      M: ext(m.extremes.M, f * l),
    })),
    equilibrium_residual: r.equilibrium.relative,
    open_url: modelLink(origin, model),
  };
}

function structureText(s: StructureSummary, model: Model): string {
  const F = s.units.force;
  const L = s.units.length;
  const supports = new Map(model.supports.map((x) => [x.node, x.type]));
  const zero = (v: number, scale: number) => Math.abs(v) <= 1e-9 * Math.max(scale, 1e-300);
  const scale = Math.max(1, ...s.reactions.flatMap((r) => [Math.abs(r.H), Math.abs(r.V)]));
  const val = (v: number) => fmt(zero(v, scale) ? 0 : v);
  const det = s.determinacy.classification === "determinate" ? "statisk bestemt" : `statisk ubestemt (n = ${s.determinacy.n_s})`;
  const lines = [
    `Løst med Mekanikk-intuisjon (deterministisk; likevekt kontrollert, relativ residual ${s.equilibrium_residual.toExponential(1)}). Konstruksjonen er ${det}.`,
    `Opplagerkrefter (H positiv mot høyre, V positiv oppover, M positivt mot klokka):`,
    ...s.reactions.map((r) => `- ${r.node}: H = ${val(r.H)} ${F}, V = ${val(r.V)} ${F}${supports.get(r.node) === "fixed" ? `, M = ${val(r.M)} ${F}${L}` : ""}`),
    "Største og minste snittkrefter per element (x målt fra elementets i-ende):",
    ...s.members.map((m) => {
      const part = (q: "N" | "V" | "M", unit: string) => {
        const e = m[q];
        if (val(e.min) === val(e.max)) return `${q} = ${val(e.max)} ${unit} (konstant)`;
        return `${q} fra ${val(e.min)} (x = ${fmt(e.at_min)} ${L}) til ${val(e.max)} ${unit} (x = ${fmt(e.at_max)} ${L})`;
      };
      return m.kind === "truss" ? `- ${m.id} (stav, ${fmt(m.length)} ${L}): N = ${val(m.N.max)} ${F}` : `- ${m.id} (${fmt(m.length)} ${L}): ${part("N", F)}; ${part("V", F)}; ${part("M", `${F}${L}`)}`;
    }),
    "Fortegn: N > 0 er strekk. dM/dx = V. M > 0 gir strekk på høyre side sett fra i mot j (underkant for en bjelke tegnet fra venstre mot høyre).",
    `Interaktiv visning med diagrammer og snitt: ${s.open_url}`,
    EXPLAIN,
  ];
  return lines.join("\n");
}

export const solveStructureTool: ToolDefinition<typeof StructureInput> = {
  name: "solve_structure",
  title: "Løs bjelke, ramme eller fagverk",
  description: [
    "Bruk dette verktøyet hver gang en mekanikkoppgave har en bjelke, ramme eller et fagverk med opplagre og laster: opplagerkrefter, stavkrefter, snittkrefter N, V og M, diagrammer eller statisk bestemthet.",
    "Det løser konstruksjonen med en verifisert løser (direkte stivhetsmetode, eksakte snittkrefter, likevektskontroll). Regn ikke reaksjoner eller snittkrefter selv, heller ikke enkle; bygg forklaringen på svaret herfra.",
    "Fyll ut modellen ut fra oppgaven: koordinater og laster i oppgavens egne enheter (units), y oppover (kursets z), vinkler mot klokka fra +x.",
    "Spør studenten hvis noe er uklart i figuren (opplagertype, mål, retning på last) i stedet for å anta.",
    "Svaret vises som en interaktiv figur i chatten (konstruksjon, N/V/M-diagrammer, snitt i 3D) og har en lenke til fullskjermvisning.",
  ].join(" "),
  inputSchema: StructureInput,
  ui: VIEW_URI,
  async run(input, ctx: ToolContext) {
    const parsed = Model.safeParse({ ...input, schemaVersion: 1, provenance: [] });
    if (!parsed.success) {
      const missing = parsed.error.issues.map((i) => ({ field: i.path.join("."), reason: i.message }));
      return text(`Modellen er ufullstendig:\n${missing.map((m) => `- ${m.field}: ${m.reason}`).join("\n")}`, { status: "missing", missing_fields: missing });
    }
    const model = parsed.data;
    const geometry = { u: model.units, n: model.nodes, m: model.members.map((m) => [m.i, m.j, m.kind]), s: model.supports };
    const denied = await ctx.consumeTask(`structure:${hash(geometry)}`);
    if (denied) return text(denied, { status: "denied", message: denied }, true);
    const s = solveStructureModel(model, ctx.origin);
    if (s.status !== "ok") {
      const detail = "issues" in s && s.issues ? `\n${s.issues.map((i) => `- ${i.message}`).join("\n")}` : "";
      const hint =
        s.status === "mechanism"
          ? " Konstruksjonen kan bevege seg fritt (mekanisme): sjekk opplagrene og leddene med studenten."
          : s.status === "invalid"
            ? " Rett modellen og prøv igjen; spør studenten om det som mangler."
            : "";
      return text(`${s.message}${detail}${hint}`, { status: s.status, message: s.message, ...("issues" in s ? { issues: s.issues } : {}) });
    }
    return text(structureText(s, model), { view: "structure", ...s, model } as unknown as Record<string, unknown>);
  },
};

export const mechanics: SubjectModule = {
  id: "mechanics",
  title: "Mekanikk (statikk)",
  instructions: [
    "Mekanikk-intuisjon gir verifiserte beregninger for statikk på nivå med TKT4116 Mekanikk 1 ved NTNU.",
    "Når studenten spør om en statikkoppgave, skal tallene alltid komme fra verktøyene, også når regningen er enkel: force_system for kraftsystemer (dekomponering, resultant, moment), solve_structure for bjelker, rammer og fagverk. Kall verktøyet før du regner noe selv.",
    "Tolk oppgaven (figur eller tekst) til verktøyets skjema; spør studenten når figuren er uklar.",
    "Forklar ut fra verktøyets resultater og bruk kursets begreper (fritt legeme, likevektslikninger, snittmetoden). Gi lenken til den interaktive visningen når den finnes.",
  ].join(" "),
  tools: [forceSystemTool as unknown as ToolDefinition, solveStructureTool as unknown as ToolDefinition],
  resources: [
    {
      uri: VIEW_URI,
      name: "Mekanikk-intuisjon: visning",
      description: "Interaktiv figur av kraftsystemet eller konstruksjonen, med diagrammer og snitt i 3D.",
      path: "/mcp-ui/visning.html",
    },
  ],
};
