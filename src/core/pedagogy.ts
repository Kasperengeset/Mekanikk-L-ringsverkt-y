/**
 * Pedagogiske regler, felles for visningen og agenten:
 *  - Hvert punkt i model.asked blir et mål med fasitverdier fra løseren.
 *  - Tallene for et mål er skjult (i diagrammer, sidepanel og get_state) til studenten har gjort et
 *    forsøk på det. Formen på diagrammene vises alltid. Tall som gir svaret direkte via likevekt,
 *    skjules også (se hiddenValues).
 *  - Studentens svar kontrolleres mot løseren med en toleranse.
 *
 * Verdier inn og ut av studenten er i oppgavens enheter (kN, kNm, m, mm); løseren er i SI.
 * I symbolske oppgaver er tallet koeffisienten foran symbolene (0,45 betyr 0,45F).
 */
import type { Asked, Model } from "./schema";
import { evalPoly, type SolveResult } from "./solver";
import { forceFactor, lengthFactor } from "./units";

export type Unit = "force" | "moment" | "length" | "displacement" | "rotation";

export interface TargetComponent {
  /** Kort navn på norsk, f.eks. "A, horisontal" eller "N i AB". */
  label: string;
  unit: Unit;
  /** Fasit i oppgavens enheter (mm for forskyvning, rad for rotasjon). */
  expected: number;
  /** true: bare størrelsen sammenlignes (f.eks. største moment). */
  magnitudeOnly: boolean;
}

export interface AskedTarget {
  index: number;
  asked: Asked;
  /** Hva som spørres etter, på norsk. */
  title: string;
  /** Tom for diagrammer: studenten krysser av for at de har tegnet selv. */
  components: TargetComponent[];
}

export interface Attempt {
  /** Studentens tall i samme rekkefølge som components, eller null når det er en egenvurdering (diagrammer). */
  values: (number | null)[] | null;
  at: number;
}

export type ComponentVerdict = "correct" | "wrong_sign" | "wrong" | "missing";

export interface AttemptCheck {
  verdicts: ComponentVerdict[];
  allCorrect: boolean;
}

export interface HiddenValues {
  /** Noder der opplagerkreftene er skjult. */
  reactionNodes: Set<string>;
  /** Elementer der tallene i hvert diagram er skjult ("all" = alle elementer). */
  diagram: Record<"N" | "V" | "M", Set<string> | "all">;
  /** Noder der forskyvningen er skjult. */
  displacementNodes: Set<string>;
}

const TOL_REL = 0.02;

function unitFactor(model: Model, unit: Unit): number {
  const f = forceFactor(model.units);
  const l = lengthFactor(model.units);
  return { force: f, moment: f * l, length: l, displacement: 1e-3, rotation: 1 }[unit];
}

/** Største absoluttverdi av et snittkraftdiagram over gitte elementer, i SI. */
function extremeAbs(result: Extract<SolveResult, { status: "ok" }>, q: "N" | "V" | "M", members?: string[]): number {
  let best = 0;
  for (const m of result.members) {
    if (members && !members.includes(m.id)) continue;
    const e = m.extremes[q];
    best = Math.max(best, Math.abs(e.max.value), Math.abs(e.min.value));
  }
  return best;
}

/** Målene for alle spørsmål i oppgaven. Tom liste når løsningen ikke finnes. */
export function askedTargets(model: Model, result: SolveResult): AskedTarget[] {
  if (result.status !== "ok") return [];
  const toUnit = (unit: Unit, si: number) => si / unitFactor(model, unit);
  return model.asked.map((asked, index) => {
    const c = (label: string, unit: Unit, si: number, magnitudeOnly = false): TargetComponent => ({
      label,
      unit,
      expected: toUnit(unit, si),
      magnitudeOnly,
    });
    switch (asked.quantity) {
      case "reaction": {
        const node = asked.node;
        const reactions = result.reactions.filter((r) => !node || r.node === node);
        const components = reactions.flatMap((r) => {
          const support = model.supports.find((s) => s.node === r.node)!;
          const parts = [c(`${r.node}, horisontal`, "force", r.Fx), c(`${r.node}, vertikal`, "force", r.Fy)];
          if (support.type === "fixed") parts.push(c(`${r.node}, moment`, "moment", r.M));
          return parts;
        });
        return { index, asked, title: node ? `Opplagerkrefter i ${node}` : "Opplagerkrefter", components };
      }
      case "member_force": {
        const m = result.members.find((x) => x.id === asked.member);
        const N = m ? evalPoly(m.pieces[0]!.N, m.length / 2) : NaN;
        return { index, asked, title: `Stavkraft i ${asked.member}`, components: [c(`N i ${asked.member} (strekk +)`, "force", N)] };
      }
      case "M_max":
      case "N_max":
      case "V_max": {
        const q = asked.quantity[0] as "N" | "V" | "M";
        const where = asked.member ? ` i ${asked.member}` : "";
        const value = extremeAbs(result, q, asked.member ? [asked.member] : undefined);
        return { index, asked, title: `Største ${q}${where}`, components: [c(`|${q}|max${where}`, q === "M" ? "moment" : "force", value, true)] };
      }
      case "internal_forces": {
        const m = result.members.find((x) => x.id === asked.member);
        const x = m ? (asked.at ?? 0.5) * m.length : 0;
        const piece = m?.pieces.find((p) => x >= p.x0 && x <= p.x1) ?? m?.pieces[0];
        const at = (k: "N" | "V" | "M") => (piece ? evalPoly(piece[k], x) : NaN);
        const where = `${asked.member ?? ""}${asked.at !== undefined ? ` ved ${Math.round(asked.at * 100)} %` : ""}`;
        return {
          index,
          asked,
          title: `Snittkrefter i ${where}`,
          components: [c(`N i ${where}`, "force", at("N")), c(`V i ${where}`, "force", at("V"), true), c(`M i ${where}`, "moment", at("M"), true)],
        };
      }
      case "displacement": {
        const d = asked.node ? result.displacements[asked.node] : undefined;
        const comps = d ? [c(`${asked.node}, horisontal`, "displacement", d.ux), c(`${asked.node}, vertikal`, "displacement", d.uy)] : [];
        return { index, asked, title: `Forskyvning i ${asked.node ?? "?"}`, components: comps };
      }
      case "rotation": {
        const d = asked.node ? result.displacements[asked.node] : undefined;
        return { index, asked, title: `Rotasjon i ${asked.node ?? "?"}`, components: d ? [c(`θ i ${asked.node}`, "rotation", d.rz)] : [] };
      }
      case "diagrams":
        return { index, asked, title: "N-, V- og M-diagram", components: [] };
    }
  });
}

/** Kontrollerer et forsøk. Toleransen er 2 % av fasit, men aldri strengere enn 0,5 % av største fasitverdi i målet. */
export function checkAttempt(target: AskedTarget, attempt: Attempt): AttemptCheck {
  if (target.components.length === 0) return { verdicts: [], allCorrect: true };
  const scale = Math.max(...target.components.map((c) => Math.abs(c.expected)), 1e-12);
  const verdicts = target.components.map((c, k): ComponentVerdict => {
    const v = attempt.values?.[k];
    if (v === null || v === undefined || !Number.isFinite(v)) return "missing";
    const tol = Math.max(TOL_REL * Math.abs(c.expected), 0.005 * scale);
    if (c.magnitudeOnly) return Math.abs(Math.abs(v) - Math.abs(c.expected)) <= tol ? "correct" : "wrong";
    if (Math.abs(v - c.expected) <= tol) return "correct";
    return Math.abs(Math.abs(v) - Math.abs(c.expected)) <= tol ? "wrong_sign" : "wrong";
  });
  return { verdicts, allCorrect: verdicts.every((v) => v === "correct") };
}

/** Hvilke tall som er skjult, gitt forsøkene så langt. */
export function hiddenValues(model: Model, attempts: Record<number, Attempt>): HiddenValues {
  const hidden: HiddenValues = { reactionNodes: new Set(), diagram: { N: new Set(), V: new Set(), M: new Set() }, displacementNodes: new Set() };
  const all = (q: "N" | "V" | "M") => (hidden.diagram[q] = "all");
  const add = (q: "N" | "V" | "M", member: string) => {
    const set = hidden.diagram[q];
    if (set !== "all") set.add(member);
  };
  model.asked.forEach((a, index) => {
    if (attempts[index]) return;
    switch (a.quantity) {
      case "reaction":
        // Én reaksjon gir de andre via likevekt, og endeverdiene i N-, V- og M-diagrammene er lik
        // reaksjonene. Derfor skjules alle reaksjoner og alle diagramtall til studenten har prøvd.
        model.supports.forEach((s) => hidden.reactionNodes.add(s.node));
        (["N", "V", "M"] as const).forEach(all);
        break;
      case "member_force":
        if (a.member) add("N", a.member);
        break;
      case "M_max":
      case "N_max":
      case "V_max": {
        const q = a.quantity[0] as "N" | "V" | "M";
        if (a.member) add(q, a.member);
        else all(q);
        break;
      }
      case "internal_forces":
        if (a.member) (["N", "V", "M"] as const).forEach((q) => add(q, a.member!));
        else (["N", "V", "M"] as const).forEach(all);
        break;
      case "diagrams":
        // Endeverdiene i diagrammene er lik reaksjonene, så de skjules også.
        (["N", "V", "M"] as const).forEach(all);
        model.supports.forEach((s) => hidden.reactionNodes.add(s.node));
        break;
      case "displacement":
      case "rotation":
        if (a.node) hidden.displacementNodes.add(a.node);
        break;
    }
  });
  return hidden;
}

export function isDiagramValueHidden(hidden: HiddenValues, q: "N" | "V" | "M", member: string): boolean {
  const set = hidden.diagram[q];
  return set === "all" || set.has(member);
}

export function anythingHidden(hidden: HiddenValues): boolean {
  return (
    hidden.reactionNodes.size > 0 ||
    hidden.displacementNodes.size > 0 ||
    (["N", "V", "M"] as const).some((q) => hidden.diagram[q] === "all" || (hidden.diagram[q] as Set<string>).size > 0)
  );
}
