import { describe, expect, it } from "vitest";
import { AGENT_TOOLS, stateSummary } from "../src/core/llm/agent";
import { askedTargets, checkAttempt, hiddenValues, isDiagramValueHidden } from "../src/core/pedagogy";
import { solve } from "../src/core/solver";
import { FIXTURES } from "../src/ui/fixtures";
import { requestPrediction } from "../src/ui/state/prediction";
import { useStore } from "../src/ui/state/store";
import { model } from "./helpers";

type OkSummary = Extract<ReturnType<typeof stateSummary>, { status: "ok" }>;
const okSummary = (...args: Parameters<typeof stateSummary>) => stateSummary(...args) as OkSummary;

/** Fritt opplagt bjelke 6 m, q = 4 kN/m: reaksjoner 12 kN, M_max = 18 kNm. */
const beam = model({
  nodes: [
    { id: "A", x: 0, y: 0 },
    { id: "B", x: 6, y: 0 },
  ],
  members: [{ id: "AB", i: "A", j: "B", kind: "beam" }],
  supports: [
    { node: "A", type: "pinned" },
    { node: "B", type: "roller" },
  ],
  loads: [{ id: "q", type: "distributed", member: "AB", w_start: -4, w_end: -4, from: 0, to: 1, direction: "global_y", basis: "length" }],
  asked: [{ quantity: "reaction", node: "A" }, { quantity: "M_max" }, { quantity: "diagrams" }],
});
const result = solve(beam);

describe("mål og kontroll av forsøk", () => {
  const targets = askedTargets(beam, result);

  it("gir fasit i oppgavens enheter", () => {
    expect(targets[0]!.components.map((c) => c.label)).toEqual(["A, horisontal", "A, vertikal"]);
    expect(targets[0]!.components[0]!.expected).toBeCloseTo(0, 9);
    expect(targets[0]!.components[1]!.expected).toBeCloseTo(12, 9);
    expect(targets[1]!.components[0]!.expected).toBeCloseTo(18);
    expect(targets[2]!.components).toEqual([]);
  });

  it("godtar svar innenfor 2 % og skiller feil retning fra feil størrelse", () => {
    const t = targets[0]!;
    expect(checkAttempt(t, { values: [0, 12.1], at: 0 }).allCorrect).toBe(true);
    expect(checkAttempt(t, { values: [0, -12], at: 0 }).verdicts).toEqual(["correct", "wrong_sign"]);
    expect(checkAttempt(t, { values: [0, 9], at: 0 }).verdicts).toEqual(["correct", "wrong"]);
    expect(checkAttempt(t, { values: [null, 12], at: 0 }).verdicts).toEqual(["missing", "correct"]);
    expect(checkAttempt(targets[1]!, { values: [-18], at: 0 }).allCorrect).toBe(true);
  });
});

describe("skjulte verdier", () => {
  it("skjuler det som spørres etter til det finnes et forsøk", () => {
    const before = hiddenValues(beam, {});
    // Reaksjonen i B ville gitt A via likevekt, så begge skjules.
    expect([...before.reactionNodes].sort()).toEqual(["A", "B"]);
    expect(before.diagram.M).toBe("all");
    const after = hiddenValues(beam, { 0: { values: [0, 12], at: 1 }, 1: { values: [18], at: 1 }, 2: { values: null, at: 1 } });
    expect(after.reactionNodes.size).toBe(0);
    expect(isDiagramValueHidden(after, "M", "AB")).toBe(false);
  });

  it("get_state viser ikke skjulte tall, verken i reaksjoner eller diagrammer", () => {
    const s = okSummary(beam, result, {});
    const json = JSON.stringify(s);
    expect(json).not.toContain('"V":12');
    expect(json).not.toMatch(/"value":18\b/);
    expect(s.reactions?.find((r) => r.node === "A")).toEqual({ node: "A", H: "skjult", V: "skjult", M: "skjult" });
    expect(s.reactions?.find((r) => r.node === "B")).toMatchObject({ V: "skjult" });
    const opened = okSummary(beam, result, { 0: { values: [0, 12], at: 1 }, 1: { values: [18], at: 1 }, 2: { values: null, at: 1 } });
    expect(JSON.stringify(opened)).toMatch(/"value":18\b/);
  });

  it("stavkrefter skjules per stav", () => {
    const truss = FIXTURES.fagverk!.model;
    const h = hiddenValues(truss, {});
    expect(isDiagramValueHidden(h, "N", "AB")).toBe(true);
    const s = okSummary(truss, solve(truss), {});
    expect(s.members?.every((m) => m.N === "skjult")).toBe(true);
  });
});

describe("agentens verktøy", () => {
  it("har de fem verktøyene fra spesifikasjonen med JSON Schema", () => {
    expect(AGENT_TOOLS.map((t) => t.name)).toEqual(["get_state", "set_param", "add_control", "highlight", "ask_prediction"]);
    for (const t of AGENT_TOOLS) expect(t.input_schema).toMatchObject({ type: "object" });
  });
});

describe("spådom via storen", () => {
  it("venter på svaret fra studenten", async () => {
    useStore.getState().loadModel(beam);
    const pending = requestPrediction("Hva skjer med M_max hvis lasten dobles?", ["Dobles", "Uendret"]);
    const open = useStore.getState().prediction!;
    expect(open.options).toHaveLength(2);
    useStore.getState().answerPrediction(open.id, { text: "Dobles", optionIndex: 0 });
    await expect(pending).resolves.toEqual({ text: "Dobles", optionIndex: 0 });
    expect(useStore.getState().prediction).toBeNull();
  });
});
