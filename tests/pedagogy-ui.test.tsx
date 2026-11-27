// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getParam } from "../src/core/edit.js";
import type { Model } from "../src/core/schema.js";
import { solve } from "../src/core/solver/index.js";
import { DiagramsView } from "../src/ui/diagrams/DiagramsView.js";
import { FIXTURES } from "../src/ui/fixtures.js";
import { fitViewport } from "../src/ui/geometry.js";
import { expectedText, HIDDEN_EXPLANATION, paramUnit, parseNumberInput, summaryText, unitLabel, VERDICT_TEXT } from "../src/ui/pedagogy/logic.js";
import { PedagogyPanel } from "../src/ui/pedagogy/PedagogyPanel.js";
import { requestPrediction } from "../src/ui/state/prediction.js";
import { useStore } from "../src/ui/state/store.js";
import { model } from "./helpers.js";

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

/** Panelet og diagrammene koblet til storen, slik som i appen. */
function Harness() {
  const m = useStore((s) => s.model);
  if (!m) return null;
  const result = solve(m);
  return (
    <>
      <PedagogyPanel model={m} result={result} />
      <div data-testid="diagrams">
        <DiagramsView model={m} result={result} viewport={fitViewport(m, 900, 300)} />
      </div>
    </>
  );
}

function load(m: Model) {
  act(() => useStore.getState().loadModel(m));
}

const diagramsText = () => screen.getByTestId("diagrams").innerHTML;
const form = (title: string) => screen.getByRole("heading", { name: title }).closest("form")!;

beforeEach(() => load(beam));
afterEach(cleanup);

describe("tolking av tallfelt", () => {
  it("desimalkomma, desimalpunktum, minustegn, mellomrom og brøk", () => {
    expect(parseNumberInput("12,5")).toBe(12.5);
    expect(parseNumberInput("12.5")).toBe(12.5);
    expect(parseNumberInput("-3,25")).toBe(-3.25);
    expect(parseNumberInput("−4")).toBe(-4);
    expect(parseNumberInput(" 1 000,5 ")).toBe(1000.5);
    expect(parseNumberInput(",5")).toBe(0.5);
    expect(parseNumberInput("1/8")).toBe(0.125);
    expect(parseNumberInput("-3/4")).toBe(-0.75);
  });

  it("tomt felt er null, og tekst som ikke er et tall, er NaN", () => {
    expect(parseNumberInput("")).toBeNull();
    expect(parseNumberInput("   ")).toBeNull();
    expect(parseNumberInput("abc")).toBeNaN();
    expect(parseNumberInput("1,2,3")).toBeNaN();
    expect(parseNumberInput("12 kN")).toBeNaN();
    expect(parseNumberInput("1/0")).toBeNaN();
  });
});

describe("tekster", () => {
  it("tilbakemelding per komponent og samlet", () => {
    expect(VERDICT_TEXT).toEqual({ correct: "Riktig", wrong_sign: "Riktig størrelse, men feil retning (fortegn)", wrong: "Feil", missing: "Ikke besvart" });
    expect(summaryText({ verdicts: ["correct", "correct"], allCorrect: true })).toBe("Alt riktig!");
    expect(summaryText({ verdicts: ["correct"], allCorrect: true })).toBe("Riktig!");
    expect(summaryText({ verdicts: ["correct", "wrong_sign", "missing"], allCorrect: false })).toBe("1 av 3 riktig. Sjekk retningene mot fortegnskonvensjonen. Prøv gjerne igjen.");
    expect(summaryText({ verdicts: ["wrong"], allCorrect: false })).toBe("0 av 1 riktig. Prøv gjerne igjen.");
  });

  it("enheter i oppgavens enheter, og symboler i symbolske oppgaver", () => {
    expect(unitLabel("force", beam)).toBe("kN");
    expect(unitLabel("moment", beam)).toBe("kNm");
    expect(unitLabel("displacement", beam)).toBe("mm");
    const sym = FIXTURES.symbolsk!.model;
    expect(unitLabel("force", sym)).toBe("· F");
    expect(unitLabel("moment", sym)).toBe("· FL");
    expect(paramUnit("loads.P1.P", beam)).toBe("kN");
    expect(paramUnit("nodes.B.x", beam)).toBe("m");
    expect(paramUnit("loads.P1.at", beam)).toBe("");
  });

  it("riktig verdi med formatQuantity; støy blir 0, og størrelsen når bare den teller", () => {
    expect(expectedText({ label: "", unit: "force", expected: 12, magnitudeOnly: false }, beam)).toBe("12 kN");
    expect(expectedText({ label: "", unit: "force", expected: 1e-13, magnitudeOnly: false }, beam, 12)).toBe("0 kN");
    expect(expectedText({ label: "", unit: "moment", expected: -18, magnitudeOnly: true }, beam)).toBe("18 kNm");
    expect(expectedText({ label: "", unit: "moment", expected: 0.5, magnitudeOnly: true }, FIXTURES.symbolsk!.model)).toBe("0,5 FL");
  });
});

describe("Prøv selv", () => {
  it("én rad per mål, felt per komponent med enhet, forklaring og fortegnskonvensjon", () => {
    render(<Harness />);
    expect(screen.getByRole("heading", { name: "Opplagerkrefter i A" })).toBeTruthy();
    expect(screen.getByLabelText("A, horisontal")).toBeTruthy();
    expect(screen.getByLabelText("A, vertikal")).toBeTruthy();
    expect(screen.getByLabelText(/\|M\|max/)).toBeTruthy();
    expect(within(form("Opplagerkrefter i A")).getAllByText("kN")).toHaveLength(2);
    expect(within(form("Største M")).getByText("kNm")).toBeTruthy();
    expect(screen.getByText(HIDDEN_EXPLANATION)).toBeTruthy();
    expect(screen.getByText(/horisontal positiv mot høyre, vertikal positiv oppover, moment positivt mot klokka, N positiv i strekk/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Jeg har tegnet diagrammene selv – vis tallene" })).toBeTruthy();
  });

  it("et forsøk lagres, gir tilbakemelding per komponent og viser riktig verdi", () => {
    render(<Harness />);
    const f = form("Opplagerkrefter i A");
    fireEvent.change(screen.getByLabelText("A, horisontal"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("A, vertikal"), { target: { value: "-12,1" } });
    fireEvent.click(within(f).getByRole("button", { name: "Sjekk svaret" }));

    const attempt = useStore.getState().attempts[0]!;
    expect(attempt.values).toEqual([0, -12.1]);
    expect(attempt.at).toBeGreaterThan(0);
    expect(within(f).getByText(/^Riktig\./)).toBeTruthy();
    expect(within(f).getByText(/Riktig størrelse, men feil retning/)).toBeTruthy();
    expect(within(f).getByText(/Riktig verdi: 12 kN/)).toBeTruthy();
    expect(within(f).getByText(/1 av 2 riktig/)).toBeTruthy();

    // Prøv igjen: et nytt forsøk erstatter det gamle.
    fireEvent.change(screen.getByLabelText("A, vertikal"), { target: { value: "12" } });
    fireEvent.click(within(f).getByRole("button", { name: "Sjekk svaret" }));
    expect(useStore.getState().attempts[0]!.values).toEqual([0, 12]);
    expect(within(f).getByText("Alt riktig!")).toBeTruthy();
  });

  it("tomme felt og tekst som ikke er et tall, lagres ikke", () => {
    render(<Harness />);
    const f = form("Opplagerkrefter i A");
    fireEvent.click(within(f).getByRole("button", { name: "Sjekk svaret" }));
    expect(within(f).getByText("Skriv inn minst ett tall før du sjekker.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("A, vertikal"), { target: { value: "tolv" } });
    fireEvent.click(within(f).getByRole("button", { name: "Sjekk svaret" }));
    expect(within(f).getByText(/ikke et tall/)).toBeTruthy();
    expect(screen.getByLabelText("A, vertikal").getAttribute("aria-invalid")).toBe("true");
    expect(useStore.getState().attempts).toEqual({});

    // Ett tomt felt er lov: det teller som ikke besvart.
    fireEvent.change(screen.getByLabelText("A, vertikal"), { target: { value: "12" } });
    fireEvent.click(within(f).getByRole("button", { name: "Sjekk svaret" }));
    expect(useStore.getState().attempts[0]!.values).toEqual([null, 12]);
    expect(within(f).getByText(/Ikke besvart/)).toBeTruthy();
  });

  it("tallene i diagrammene blir synlige når alle mål er forsøkt", () => {
    render(<Harness />);
    expect(diagramsText()).not.toContain("18 kNm");
    expect(diagramsText()).not.toContain("12 kN");
    expect(diagramsText()).toContain("dg-hidden-value");

    fireEvent.change(screen.getByLabelText("A, vertikal"), { target: { value: "12" } });
    fireEvent.click(within(form("Opplagerkrefter i A")).getByRole("button", { name: "Sjekk svaret" }));
    fireEvent.change(screen.getByLabelText(/\|M\|max/), { target: { value: "-18" } });
    fireEvent.click(within(form("Største M")).getByRole("button", { name: "Sjekk svaret" }));
    expect(within(form("Største M")).getByText("Riktig!")).toBeTruthy();
    // Diagrammene er fortsatt skjult til studenten sier at de er tegnet.
    expect(diagramsText()).not.toContain("18 kNm");

    fireEvent.click(screen.getByRole("button", { name: "Jeg har tegnet diagrammene selv – vis tallene" }));
    expect(useStore.getState().attempts[2]).toMatchObject({ values: null });
    expect(screen.getByText(/Tallene vises nå i diagrammene/)).toBeTruthy();
    expect(diagramsText()).toContain("18 kNm");
    expect(diagramsText()).toContain("12 kN");
    expect(diagramsText()).not.toContain("dg-hidden-value");
    expect(screen.queryByText(HIDDEN_EXPLANATION)).toBeNull();
  });

  it("det studenten har skrevet, beholdes når modellen endres", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("A, vertikal"), { target: { value: "11" } });
    act(() => void useStore.getState().edit({ path: "nodes.B.x", value: 8 }));
    expect((screen.getByLabelText("A, vertikal") as HTMLInputElement).value).toBe("11");
  });

  it("symbolsk oppgave: enheten er symbolet, og brøk godtas", () => {
    load(FIXTURES.symbolsk!.model);
    render(<Harness />);
    expect(screen.getByText("· FL")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/\|M\|max/), { target: { value: "1/2" } });
    fireEvent.click(screen.getByRole("button", { name: "Sjekk svaret" }));
    expect(screen.getByText("Riktig!")).toBeTruthy();
    expect(screen.getByText(/Riktig verdi: 0,5 FL/)).toBeTruthy();
  });

  it("uten noe å spørre om, glidebrytere eller spådom vises ingenting", () => {
    load({ ...beam, asked: [] });
    render(<Harness />);
    expect(document.querySelector(".pedagogy-panel")).toBeNull();
  });
});

describe("glidebrytere", () => {
  const control = { path: "loads.P1.at", label: "Lastens plassering", min: 0.1, max: 0.9, step: 0.05 };

  beforeEach(() => {
    load(FIXTURES.skraa!.model);
    act(() => useStore.getState().addControl(control));
  });

  it("viser etikett og gjeldende verdi", () => {
    render(<Harness />);
    expect(screen.getByLabelText("Lastens plassering")).toBeTruthy();
    expect(document.querySelector(".pd-control-value")!.textContent).toBe("0,4");
  });

  it("et drag endrer modellen som ett steg i angre-historikken", () => {
    render(<Harness />);
    const slider = screen.getByRole("slider");
    fireEvent.pointerDown(slider);
    fireEvent.change(slider, { target: { value: "0.5" } });
    fireEvent.change(slider, { target: { value: "0.65" } });
    fireEvent.pointerUp(slider);
    const s = useStore.getState();
    expect(getParam(s.model!, control.path)).toBeCloseTo(0.65);
    expect(s.past).toHaveLength(1);
    expect(s.gestureStart).toBeNull();
    expect(document.querySelector(".pd-control-value")!.textContent).toBe("0,65");

    act(() => useStore.getState().undo());
    expect(getParam(useStore.getState().model!, control.path)).toBeCloseTo(0.4);
  });

  it("piltaster (endring uten drag) gir ett steg per endring", () => {
    render(<Harness />);
    const slider = screen.getByRole("slider");
    fireEvent.change(slider, { target: { value: "0.45" } });
    fireEvent.change(slider, { target: { value: "0.5" } });
    expect(useStore.getState().past).toHaveLength(2);
  });

  it("en verdi storen avviser, krasjer ikke og endrer ikke modellen", () => {
    act(() => useStore.getState().addControl({ path: "nodes.B.x", label: "Spennvidde", min: 0, max: 10, step: 1 }));
    render(<Harness />);
    const before = useStore.getState().model;
    const slider = screen.getByLabelText("Spennvidde");
    fireEvent.pointerDown(slider);
    fireEvent.change(slider, { target: { value: "0" } });
    fireEvent.pointerUp(slider);
    expect(useStore.getState().model).toBe(before);
    expect(useStore.getState().past).toHaveLength(0);
    expect(screen.getByText(/ugyldig modell/)).toBeTruthy();
    expect((slider as HTMLInputElement).value).toBe("5");
  });

  it("en sti uten tallverdi gir en deaktivert glidebryter", () => {
    act(() => useStore.getState().addControl({ path: "loads.finnes_ikke.P", label: "Ukjent", min: 0, max: 1, step: 0.1 }));
    render(<Harness />);
    expect((screen.getByLabelText("Ukjent") as HTMLInputElement).disabled).toBe(true);
  });

  it("kan fjernes", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Fjern glidebryteren «Lastens plassering»" }));
    expect(useStore.getState().controls).toEqual([]);
    expect(screen.queryByRole("slider")).toBeNull();
  });
});

describe("spådomskortet", () => {
  it("knapp for hvert alternativ kaller answerPrediction med indeks", () => {
    render(<Harness />);
    act(() => useStore.getState().askPrediction({ id: "p1", question: "Hva skjer med momentet i A?", options: ["Det øker", "Det minker"] }));
    expect(screen.getByText("Hva skjer med momentet i A?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Det minker" }));
    const s = useStore.getState();
    expect(s.predictionAnswers.p1).toEqual({ text: "Det minker", optionIndex: 1 });
    expect(s.prediction).toBeNull();
    expect(screen.queryByText("Hva skjer med momentet i A?")).toBeNull();
  });

  it("fritekst når options er tom, og agentens løfte får svaret", async () => {
    render(<Harness />);
    let answer!: Promise<unknown>;
    act(() => void (answer = requestPrediction("Hvor blir momentet størst?", [])));
    const submit = screen.getByRole("button", { name: "Svar" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Ditt svar"), { target: { value: "  Midt på bjelken " } });
    fireEvent.click(submit);
    await expect(answer).resolves.toEqual({ text: "Midt på bjelken" });
    expect(useStore.getState().prediction).toBeNull();
  });

  it("«Vet ikke» er et gyldig svar", () => {
    render(<Harness />);
    act(() => useStore.getState().askPrediction({ id: "p2", question: "Øker nedbøyningen?", options: ["Ja", "Nei"] }));
    fireEvent.click(screen.getByRole("button", { name: "Vet ikke" }));
    expect(useStore.getState().predictionAnswers.p2).toEqual({ text: "Vet ikke" });
  });
});

describe("DiagramsView og storen", () => {
  it("utheving av et panel som er slått av, slår det på og tegner markøren", () => {
    render(<Harness />);
    act(() => useStore.getState().setDiagrams({ M: false }));
    expect(diagramsText()).not.toContain("dg-panel-M");
    act(() => useStore.getState().setDiagramHighlight({ member: "AB", quantity: "M", at: 0.5 }));
    expect(useStore.getState().diagrams.M).toBe(true);
    expect(diagramsText()).toContain("dg-highlight");
    act(() => useStore.getState().setDiagramHighlight(null));
    expect(diagramsText()).not.toContain("dg-highlight");
  });
});
