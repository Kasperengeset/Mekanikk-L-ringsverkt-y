import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { hiddenValues, type Attempt } from "../src/core/pedagogy";
import type { Model } from "../src/core/schema";
import { solve, type SolveResult } from "../src/core/solver";
import { DiagramsSvg } from "../src/ui/diagrams/DiagramsSvg";
import { DEFAULT_SETTINGS, HIDDEN_TEXT, layoutDiagrams, type DeformedPanel, type ForcePanel, type Panel } from "../src/ui/diagrams/layout";
import { FIXTURES } from "../src/ui/fixtures";
import { formatQuantity } from "../src/ui/format";
import { fitViewport } from "../src/ui/geometry";
import { maxMomentPoint } from "../src/ui/pedagogy/snapshots";
import type { DiagramPoint } from "../src/ui/state/store";
import { model } from "./helpers";

type Ok = Extract<SolveResult, { status: "ok" }>;
const solveOk = (m: Model) => solve(m) as Ok;
const view = (m: Model) => fitViewport(m, 900, 300);

function markup(m: Model, extra: { hidden?: ReturnType<typeof hiddenValues>; highlight?: DiagramPoint | null } = {}) {
  return renderToStaticMarkup(<DiagramsSvg model={m} result={solve(m)} viewport={view(m)} {...extra} />);
}

function layout(m: Model, extra: { hidden?: ReturnType<typeof hiddenValues>; highlight?: DiagramPoint | null } = {}) {
  return layoutDiagrams(m, solve(m), view(m), DEFAULT_SETTINGS, extra);
}

const forcePanel = (panels: Panel[], kind: "N" | "V" | "M") => panels.find((p): p is ForcePanel => p.kind === kind)!;
const deformedPanel = (panels: Panel[]) => panels.find((p): p is DeformedPanel => p.kind === "deformed")!;
/** Stiene som tegner formen (fyll, skravur og kurve), i rekkefølge. */
const shapePaths = (svg: string) => [...svg.matchAll(/<path d="([^"]+)"[^>]*class="dg-(?:fill|stroke)-[NVM]"/g)].map((m) => m[1]);
/** Markupen til ett panel (fra panelets gruppe til neste panel). */
const panelMarkup = (svg: string, kind: string) => svg.split(/(?=<g class="dg-panel )/).find((s) => s.startsWith(`<g class="dg-panel dg-panel-${kind}"`)) ?? "";

const gerber = FIXTURES.gerber!.model;
const attempt: Attempt = { values: null, at: 1 };

describe("skjulte tall i diagrammene", () => {
  it("gerber (diagrammer spurt om): ingen av løserens tall i markupen, men formen er der", () => {
    const r = solveOk(gerber);
    const A = r.reactions.find((x) => x.node === "A")!;
    const C = r.reactions.find((x) => x.node === "C")!;
    // Konkrete tall fra løseren: V og M i innspenningen og V i rullelageret.
    const numbers = [formatQuantity("force", Math.abs(A.Fy), gerber), formatQuantity("moment", Math.abs(A.M), gerber), formatQuantity("force", Math.abs(C.Fy), gerber)];
    expect(numbers).toEqual(["13 kN", "30 kNm", "7 kN"]);

    const open = markup(gerber);
    const masked = markup(gerber, { hidden: hiddenValues(gerber, {}) });
    for (const n of numbers) {
      expect(open).toContain(`>${n}<`);
      expect(masked).not.toContain(n);
    }
    // Alle tall som ellers står i diagrammene, er borte.
    const texts = layout(gerber).panels.flatMap((p) => p.labels.map((l) => l.text));
    expect(texts.length).toBeGreaterThan(4);
    for (const t of texts) expect(masked).not.toContain(`>${t}<`);
    expect(masked).not.toMatch(/\d kNm?</);

    // Formen er den samme, og det står et «?» der tallene stod.
    expect(shapePaths(masked)).toEqual(shapePaths(open));
    expect(shapePaths(masked).length).toBeGreaterThan(0);
    const maskedLabels = layout(gerber, { hidden: hiddenValues(gerber, {}) }).panels.flatMap((p) => p.labels);
    expect(maskedLabels.length).toBeGreaterThan(0);
    expect(maskedLabels.every((l) => l.masked && l.text === HIDDEN_TEXT && !l.emphasis)).toBe(true);
    expect(masked.match(/dg-hidden-value/g)!.length).toBe(maskedLabels.length);
  });

  it("etter forsøket er tallene tilbake", () => {
    const svg = markup(gerber, { hidden: hiddenValues(gerber, { 0: attempt }) });
    expect(svg).toContain(">30 kNm<");
    expect(svg).not.toContain("dg-hidden-value");
  });

  it("spørres det etter en opplagerkraft, skjules alle diagramtall", () => {
    const skraa = FIXTURES.skraa!.model;
    const svg = markup(skraa, { hidden: hiddenValues(skraa, {}) });
    expect(svg).not.toMatch(/\d kNm?</);
    expect(svg).toContain("dg-hidden-value");
  });

  it("stavkraft i ett element: bare det elementets tall skjules", () => {
    const fagverk = FIXTURES.fagverk!.model;
    const r = solveOk(fagverk);
    const N = (id: string) => formatQuantity("force", Math.abs(r.members.find((m) => m.id === id)!.pieces[0]!.N[0]!), fagverk);
    // Forsøk på AC og BC, ikke på AB.
    const hidden = hiddenValues(fagverk, { 1: attempt, 2: attempt });
    expect([...(hidden.diagram.N as Set<string>)]).toEqual(["AB"]);
    const labels = forcePanel(layout(fagverk, { hidden }).panels, "N").labels;
    const byGroup = Object.fromEntries(labels.map((l) => [l.group, l]));
    expect(byGroup.AB!.text).toBe(HIDDEN_TEXT);
    expect(byGroup.AC!.text).toBe(N("AC"));
    expect(byGroup.BC!.text).toBe(N("BC"));
    const svg = markup(fagverk, { hidden });
    expect(svg).toContain(`>${N("AC")}<`);
  });

  it("nullstav i et fagverk: «0» skjules også", () => {
    const truss = model({
      nodes: [
        { id: "A", x: 0, y: 0 },
        { id: "B", x: 4, y: 0 },
        { id: "C", x: 4, y: 3 },
      ],
      members: [
        { id: "AB", i: "A", j: "B", kind: "truss" },
        { id: "BC", i: "B", j: "C", kind: "truss" },
        { id: "AC", i: "A", j: "C", kind: "truss" },
      ],
      supports: [
        { node: "A", type: "pinned" },
        { node: "B", type: "roller" },
      ],
      loads: [{ id: "P", type: "point", node: "C", P: 10, angle_deg: 0 }],
      asked: [{ quantity: "member_force", member: "AB" }],
    });
    const open = forcePanel(layout(truss).panels, "N").labels.find((l) => l.group === "AB")!;
    expect(open.text).toBe("0");
    const masked = forcePanel(layout(truss, { hidden: hiddenValues(truss, {}) }).panels, "N").labels.find((l) => l.group === "AB")!;
    expect(masked.text).toBe(HIDDEN_TEXT);
  });

  it("en node mellom to elementer på rett linje: tallet skjules når ett av dem er skjult", () => {
    const m = { ...gerber, asked: [{ quantity: "M_max" as const, member: "HP" }] };
    const hidden = hiddenValues(m, {});
    const labels = forcePanel(layout(m, { hidden }).panels, "M").labels;
    // Innspenningsmomentet (i AH) vises, toppen i PC vises, men ingen tall i HP eller i nodene H og P.
    expect(labels.map((l) => l.text)).toContain("30 kNm");
    const r = solveOk(m);
    const vp = view(m);
    const xs = ["H", "P"].map((id) => vp.toScreen(m.nodes.find((n) => n.id === id)!).x);
    for (const l of labels) {
      const inHP = l.base.x > xs[0]! - 0.5 && l.base.x < xs[1]! + 0.5;
      expect(l.masked).toBe(inHP);
    }
    expect(r.members.length).toBe(3);
  });

  it("største forskyvning skjules når forskyvningen er spurt om", () => {
    const utkrager = FIXTURES.utkrager!.model;
    const open = markup(utkrager);
    expect(open).toMatch(/49,\d mm/);
    expect(open).toMatch(/forstørret ×/);
    const hidden = hiddenValues(utkrager, {});
    const svg = markup(utkrager, { hidden });
    expect(svg).not.toMatch(/\d mm/);
    expect(svg).not.toContain("forstørret");
    expect(svg).toContain("Største forskyvning: ? (vises når du har prøvd selv)");
    const panel = deformedPanel(layout(utkrager, { hidden }).panels);
    expect(panel.valueHidden).toBe(true);
    expect(panel.labels.map((l) => l.text)).toEqual([HIDDEN_TEXT]);
    // Formen er uendret.
    expect(panel.shapes).toEqual(deformedPanel(layout(utkrager).panels).shapes);
    // Diagramtallene er ikke spurt om, så de vises.
    expect(svg).toMatch(/\d kNm</);
  });

  it("uten maske (pnpm snapshot) vises alle tall som før", () => {
    expect(markup(gerber)).not.toContain("dg-hidden-value");
  });
});

describe("utheving av et punkt i et diagram", () => {
  const L = 6;
  const beam = model({
    nodes: [
      { id: "A", x: 0, y: 0 },
      { id: "B", x: L, y: 0 },
    ],
    members: [{ id: "AB", i: "A", j: "B", kind: "beam" }],
    supports: [
      { node: "A", type: "pinned" },
      { node: "B", type: "roller" },
    ],
    loads: [{ id: "q", type: "distributed", member: "AB", w_start: -4, w_end: -4, from: 0, to: 1, direction: "global_y", basis: "length" }],
  });

  it("M-toppen midt på bjelken: markøren står på kurven, der tallet for M_max hører til", () => {
    const panels = layout(beam, { highlight: { member: "AB", quantity: "M", at: 0.5 } }).panels;
    const M = forcePanel(panels, "M");
    const marker = M.highlight!;
    const top = M.labels.find((l) => l.text === "18 kNm")!;
    expect(marker.point.x).toBeCloseTo(top.anchor.x, 6);
    expect(marker.point.y).toBeCloseTo(top.anchor.y, 6);
    // Aksen er rett over (M på strekksiden: under aksen), og avstanden er hele utslaget.
    expect(marker.base.x).toBeCloseTo(marker.point.x, 6);
    expect(marker.point.y - marker.base.y).toBeCloseTo(M.amplitude, 6);
    // Bare M-panelet får markøren.
    expect(forcePanel(panels, "V").highlight).toBeUndefined();
  });

  it("markøren havner i riktig panel i markupen", () => {
    const svg = markup(beam, { highlight: { member: "AB", quantity: "V", at: 0 } });
    expect(svg.match(/class="dg-highlight"/g)).toHaveLength(1);
    expect(panelMarkup(svg, "V")).toContain("dg-highlight");
    expect(panelMarkup(svg, "M")).not.toContain("dg-highlight");
  });

  it("V i i-enden: punktet er på kurven med V = qL/2", () => {
    const V = forcePanel(layout(beam, { highlight: { member: "AB", quantity: "V", at: 0 } }).panels, "V");
    const vp = view(beam);
    const marker = V.highlight!;
    expect(marker.base.x).toBeCloseTo(vp.toScreen({ x: 0, y: 0 }).x, 6);
    // V(0) = 12 kN er største |V|: utslaget er hele amplituden, mot +y' (oppover på skjermen).
    expect(marker.base.y - marker.point.y).toBeCloseTo(V.amplitude, 6);
  });

  it("i en kjede av elementer (gerber): x regnes fra elementets egen i-ende", () => {
    const vp = view(gerber);
    const M = forcePanel(layout(gerber, { highlight: { member: "PC", quantity: "M", at: 0.5 } }).panels, "M");
    // PC går fra x = 5 til x = 7, så midten er x = 6.
    expect(M.highlight!.base.x).toBeCloseTo(vp.toScreen({ x: 6, y: 0 }).x, 6);
    // Ved leddet (M = 0) står markøren på aksen.
    const hinge = forcePanel(layout(gerber, { highlight: { member: "AH", quantity: "M", at: 1 } }).panels, "M").highlight!;
    expect(hinge.point.x).toBeCloseTo(hinge.base.x, 6);
    expect(hinge.point.y).toBeCloseTo(hinge.base.y, 6);
  });

  it("største |M| (snapshot-varianten) treffer tallet med fet skrift", () => {
    const point = maxMomentPoint(solve(gerber))!;
    expect(point).toMatchObject({ member: "AH", quantity: "M", at: 0 });
    const M = forcePanel(layout(gerber, { highlight: point }).panels, "M");
    const top = M.labels.find((l) => l.emphasis)!;
    expect(M.highlight!.point.x).toBeCloseTo(top.anchor.x, 6);
    expect(M.highlight!.point.y).toBeCloseTo(top.anchor.y, 6);
  });

  it("ukjent element, et fagverk uten V, eller et panel som er slått av: ingen markør", () => {
    expect(markup(beam, { highlight: { member: "XY", quantity: "M", at: 0.5 } })).not.toContain("dg-highlight");
    const fagverk = FIXTURES.fagverk!.model;
    expect(markup(fagverk, { highlight: { member: "AB", quantity: "V", at: 0.5 } })).not.toContain("dg-highlight");
    const svg = renderToStaticMarkup(
      <DiagramsSvg model={beam} result={solve(beam)} viewport={view(beam)} settings={{ ...DEFAULT_SETTINGS, M: false }} highlight={{ member: "AB", quantity: "M", at: 0.5 }} />,
    );
    expect(svg).not.toContain("dg-highlight");
  });
});
