import { describe, expect, it } from "vitest";
import type { Model } from "../src/core/schema.js";
import { evalPoly, solve, type MemberResult, type Piece, type SolveResult } from "../src/core/solver/index.js";
import { boxesOverlap, placeLabels, segmentHitsBox, type Box, type LabelRequest } from "../src/ui/diagrams/labels.js";
import { DEFAULT_SETTINGS, LAYOUT, layoutDiagrams, memberChains, type DeformedPanel, type ForcePanel, type Panel } from "../src/ui/diagrams/layout.js";
import { characteristicPoints, degree, joinPieces, rootsIn, samplePieces, shiftPoly, signChanges, signRegions } from "../src/ui/diagrams/sampling.js";
import { FIXTURES } from "../src/ui/fixtures.js";
import { formatQuantity } from "../src/ui/format.js";
import { fitViewport, type Point } from "../src/ui/geometry.js";
import { model, simpleBeam } from "./helpers.js";

type Ok = Extract<SolveResult, { status: "ok" }>;

function solveOk(m: Model): Ok {
  const r = solve(m);
  if (r.status !== "ok") throw new Error(`Forventet løsning, fikk ${r.status}`);
  return r;
}

const member = (r: Ok, id: string): MemberResult => r.members.find((m) => m.id === id)!;

function beam(L: number, supports: Model["supports"], loads: Model["loads"]): Model {
  return model({
    nodes: [
      { id: "A", x: 0, y: 0 },
      { id: "B", x: L, y: 0 },
    ],
    members: [{ id: "AB", i: "A", j: "B", kind: "beam" }],
    supports,
    loads,
  });
}

const udl = (w: number) => ({ id: "q", type: "distributed", member: "AB", w_start: w, w_end: w, from: 0, to: 1, direction: "global_y", basis: "length" }) as const;
const simplySupported = (L: number, loads: Model["loads"]) =>
  beam(
    L,
    [
      { node: "A", type: "pinned" },
      { node: "B", type: "roller", angle_deg: 0 },
    ],
    loads,
  );
const fixedFixed = (L: number, loads: Model["loads"]) =>
  beam(
    L,
    [
      { node: "A", type: "fixed" },
      { node: "B", type: "fixed" },
    ],
    loads,
  );

/** Layout med et viewport for konstruksjonen slik appen lager det. */
function layoutFor(m: Model, width = 900, height = 360, settings = DEFAULT_SETTINGS) {
  const viewport = fitViewport(m, width, height);
  return { viewport, layout: layoutDiagrams(m, solve(m), viewport, settings) };
}

const forcePanel = (panels: Panel[], kind: "N" | "V" | "M") => panels.find((p): p is ForcePanel => p.kind === kind)!;
const deformedPanel = (panels: Panel[]) => panels.find((p): p is DeformedPanel => p.kind === "deformed")!;

/** Alle punkter som tegnes i et panel (bokser som hjørner). */
function panelPoints(p: Panel): Point[] {
  const corners = (b: Box) => [
    { x: b.x0, y: b.y0 },
    { x: b.x1, y: b.y1 },
  ];
  const sketch = [...p.sketch.members.flat(), ...p.sketch.hinges, ...p.sketch.supports];
  const labels = p.labels.flatMap((l) => corners(l.box));
  if (p.kind === "deformed") return [...sketch, ...p.shapes.flat(), ...p.inflections, ...labels];
  return [...sketch, ...p.diagrams.flatMap((d) => [...d.outline, ...d.hatch.flat()]), ...p.symbols.flatMap((s) => corners(s.box)), ...p.inflections, ...labels];
}

describe("polynomhjelpere", () => {
  it("effektiv grad ser bort fra numerisk null", () => {
    expect(degree([1, 2, 0, 1e-20], 5)).toBe(1);
    expect(degree([0, 0, 3], 2)).toBe(2);
    expect(degree([4], 1)).toBe(0);
  });

  it("nullpunkter i et åpent intervall", () => {
    expect(rootsIn([-1, 0, 1], -2, 2)).toEqual([-1, 1]);
    expect(rootsIn([-1, 0, 1], 1, 2)).toEqual([]); // endepunktet teller ikke
    const cubic = rootsIn([0, -1, 0, 1], -2, 2); // x³ − x
    expect(cubic).toHaveLength(3);
    expect(cubic[1]!).toBeCloseTo(0, 9);
  });

  it("forskjøvet polynom og sammenslåtte biter gir samme verdier", () => {
    const p = [1, -2, 3, 0.5];
    const q = shiftPoly(p, 2);
    for (const x of [0, 1.3, 4]) expect(evalPoly(q, x + 2)).toBeCloseTo(evalPoly(p, x), 9);
    const r = solveOk(FIXTURES.bjelke!.model);
    const joined = joinPieces([member(r, "AC"), member(r, "CB")]);
    expect(joined.map((pc) => [pc.x0, pc.x1])).toEqual([
      [0, 2],
      [2, 6],
    ]);
    expect(evalPoly(joined[1]!.M, 3)).toBeCloseTo(evalPoly(member(r, "CB").pieces[0]!.M, 1), 6);
  });
});

describe("sampling", () => {
  // Fritt opplagt, L = 6 m, q = 4 kN/m og P = 10 kN 2 m fra A (tests/helpers.ts).
  const r = solveOk(simpleBeam());
  const ab = member(r, "AB");

  it("sprang ved punktlast: to verdier i samme x, forskjell lik lasten", () => {
    const s = samplePieces(ab.pieces, "V", 0.05).filter((p) => Math.abs(p.x - 2) < 1e-9);
    expect(s).toHaveLength(2);
    // V(2−) = R_A − 2q = 18,67 − 8, V(2+) = V(2−) − P
    expect(s[0]!.value).toBeCloseTo((18 + 2 / 3 - 8) * 1e3, 6);
    expect(s[0]!.value - s[1]!.value).toBeCloseTo(10e3, 6);
  });

  it("eksakte endepunkter og toppunktet der V = 0", () => {
    const s = samplePieces(ab.pieces, "M", 0.05);
    expect(s[0]!.x).toBe(0);
    expect(s[s.length - 1]!.x).toBeCloseTo(6, 12);
    expect(s[0]!.value).toBeCloseTo(0, 6);
    // V = 0 der 0,667 − 4(x − 2) = 0 → x = 2,1667
    const xTop = 2 + 2 / 3 / 4;
    expect(s.some((p) => Math.abs(p.x - xTop) < 1e-9)).toBe(true);
    const mMax = Math.max(...s.map((p) => p.value));
    expect(mMax).toBeCloseTo(ab.extremes.M.max.value, 6);
  });

  it("lineære biter får bare endepunktene", () => {
    const pl = solveOk(simplySupported(4, [{ id: "P", type: "point", member: "AB", at: 0.5, P: 10, angle_deg: -90 }]));
    expect(samplePieces(member(pl, "AB").pieces, "M", 0.01)).toHaveLength(4);
  });

  it("karakteristiske verdier: sprang på begge sider, ekstremer, og null utelates", () => {
    const pts = characteristicPoints(ab.pieces, "V", 1);
    const jump = pts.filter((p) => p.kind === "jump");
    expect(jump.map((p) => p.side)).toEqual([-1, 1]);
    expect(pts.find((p) => p.kind === "end" && p.x === 0)!.value).toBeCloseTo((18 + 2 / 3) * 1e3, 6);
    const m = characteristicPoints(ab.pieces, "M", 1);
    expect(m.every((p) => Math.abs(p.value) > 1)).toBe(true); // M = 0 i opplagrene står ikke
    const top = m.find((p) => p.kind === "extreme")!;
    expect(top.x).toBeCloseTo(2 + 1 / 6, 9);
  });

  it("konstante biter med samme verdi får ett tall midt på", () => {
    const pieces: Piece[] = [
      { x0: 0, x1: 2, N: [5], V: [1], M: [0, 1] },
      { x0: 2, x1: 4, N: [5], V: [1], M: [-1, 1] },
      { x0: 4, x1: 5, N: [-3], V: [1], M: [-1, 1] },
    ];
    const n = characteristicPoints(pieces, "N", 1e-9);
    expect(n).toEqual([
      { x: 2, value: 5, kind: "constant", side: 0 },
      { x: 4.5, value: -3, kind: "constant", side: 0 },
    ]);
  });

  it("fortegnsområder og vendepunkter for innspent bjelke med jevn last", () => {
    // M = 0 i x = L/2 ± L/(2√3)
    const L = 6;
    const ff = solveOk(fixedFixed(L, [udl(-4)]));
    const pieces = member(ff, "AB").pieces;
    const xs = signChanges(pieces, "M", 1e-6);
    expect(xs).toHaveLength(2);
    expect(xs[0]!).toBeCloseTo(L / 2 - L / (2 * Math.sqrt(3)), 6);
    expect(xs[1]!).toBeCloseTo(L / 2 + L / (2 * Math.sqrt(3)), 6);
    expect(signRegions(pieces, "M", 1e-6).map((s) => s.sign)).toEqual([-1, 1, -1]);
    expect(signRegions(pieces, "V", 1e-6).map((s) => s.sign)).toEqual([1, -1]);
  });

  it("M = 0 i et momentledd i elementenden er ikke et vendepunkt", () => {
    const r2 = solveOk(FIXTURES.gerber!.model);
    expect(signChanges(member(r2, "AH").pieces, "M", 1e-6)).toEqual([]);
  });
});

describe("etikettplassering", () => {
  const req = (text: string, x: number, priority: number): LabelRequest => ({
    text,
    anchor: { x, y: 100 },
    normal: { x: 0, y: 1 },
    tangent: { x: 1, y: 0 },
    shift: 0,
    priority,
    magnitude: 1,
    depth: 20,
  });

  it("ingen tall overlapper, og de viktigste plasseres der de hører hjemme", () => {
    const labels = placeLabels([req("12,5 kNm", 100, 1), req("13 kNm", 104, 0), req("1 kNm", 108, 2)], { boxes: [], segments: [] }, { x0: 0, x1: 400 });
    expect(labels[0]!.text).toBe("13 kNm");
    expect(labels[0]!.x).toBeCloseTo(104);
    for (let a = 0; a < labels.length; a++) for (let b = a + 1; b < labels.length; b++) expect(boxesOverlap(labels[a]!.box, labels[b]!.box)).toBe(false);
  });

  it("holder seg innenfor bredden", () => {
    const [label] = placeLabels([req("123,456 kN", 2, 0)], { boxes: [], segments: [] }, { x0: 6, x1: 300 });
    expect(label!.box.x0).toBeGreaterThanOrEqual(6);
  });

  it("linjestykke mot rektangel", () => {
    const b = { x0: 0, y0: 0, x1: 10, y1: 10 };
    expect(segmentHitsBox([{ x: -5, y: 5 }, { x: 15, y: 5 }], b)).toBe(true);
    expect(segmentHitsBox([{ x: -5, y: 15 }, { x: 15, y: 15 }], b)).toBe(false);
    expect(segmentHitsBox([{ x: 2, y: 2 }, { x: 3, y: 3 }], b)).toBe(true);
  });
});

describe("diagramlayout", () => {
  it("M-flaten for en fritt opplagt bjelke med last nedover ligger under aksen", () => {
    const { layout, viewport } = layoutFor(simplySupported(6, [udl(-4)]));
    const m = forcePanel(layout.panels, "M");
    const outline = m.diagrams[0]!.outline;
    const axisY = outline[0]!.y;
    expect(outline[outline.length - 1]!.y).toBeCloseTo(axisY);
    expect(outline.every((p) => p.y >= axisY - 1e-9)).toBe(true);
    expect(Math.max(...outline.map((p) => p.y)) - axisY).toBeCloseTo(LAYOUT.amplitude, 6);
    // Samme x-akse som konstruksjonen
    expect(outline[0]!.x).toBeCloseTo(viewport.toScreen({ x: 0, y: 0 }).x, 9);
    expect(outline[outline.length - 1]!.x).toBeCloseTo(viewport.toScreen({ x: 6, y: 0 }).x, 9);
  });

  it("tallet for M_max = qL²/8 står midt på bjelken, under kurven", () => {
    const m = simplySupported(6, [udl(-4)]);
    const { layout, viewport } = layoutFor(m);
    const panel = forcePanel(layout.panels, "M");
    const text = formatQuantity("moment", (4e3 * 36) / 8, m);
    expect(text).toBe("18 kNm");
    const label = panel.labels.find((l) => l.text === text)!;
    expect(label).toBeDefined();
    expect(label.emphasis).toBe(true);
    expect(label.x).toBeCloseTo(viewport.toScreen({ x: 3, y: 0 }).x, 6);
    expect(label.box.y0).toBeGreaterThan(label.anchor.y);
  });

  it("negativt moment (utkrager) tegnes på strekksiden over aksen", () => {
    const { layout } = layoutFor(beam(4, [{ node: "A", type: "fixed" }], [udl(-3)]));
    const outline = forcePanel(layout.panels, "M").diagrams[0]!.outline;
    expect(outline[1]!.y).toBeLessThan(outline[0]!.y - 1);
  });

  it("V tegnes med positiv verdi mot +y' og får virkningssymbol med riktig fortegn", () => {
    const { layout } = layoutFor(simplySupported(6, [udl(-4)]));
    const v = forcePanel(layout.panels, "V");
    const outline = v.diagrams[0]!.outline;
    expect(outline[1]!.y).toBeLessThan(outline[0]!.y); // V(0) > 0 opp
    expect(v.symbols.map((s) => s.sign)).toEqual([1, -1]);
    expect(v.labels.map((l) => l.text).sort()).toEqual(["12 kN", "12 kN"]);
  });

  it("sammenhengende elementer på rett linje blir én kurve, og sprang i noden blir loddrett", () => {
    const f = FIXTURES.gerber!.model;
    const r = solveOk(f);
    expect(memberChains(f, r.members).map((c) => c.map((m) => m.id))).toEqual([["AH", "HP", "PC"]]);
    const { layout } = layoutFor(f);
    const v = forcePanel(layout.panels, "V");
    expect(v.diagrams).toHaveLength(1);
    const xP = fitViewport(f, 900, 360).toScreen({ x: 5, y: 0 }).x;
    const atP = v.diagrams[0]!.outline.filter((p) => Math.abs(p.x - xP) < 1e-6);
    expect(atP).toHaveLength(2); // +3 kN og −3 kN
    expect(v.labels.filter((l) => l.text === "3 kN")).toHaveLength(2);
    // Ingen vendepunkt i momentleddet
    expect(forcePanel(layout.panels, "M").inflections).toHaveLength(0);
  });

  it("vendepunkter i M-panelet og på den deformerte formen", () => {
    const { layout } = layoutFor(fixedFixed(6, [udl(-4)]));
    expect(forcePanel(layout.panels, "M").inflections).toHaveLength(2);
    expect(deformedPanel(layout.panels).inflections).toHaveLength(2);
  });

  it("N = 0 i en bjelke gir et lite panel uten diagram", () => {
    const { layout } = layoutFor(simplySupported(6, [udl(-4)]));
    const n = forcePanel(layout.panels, "N");
    expect(n.zero).toBe(true);
    expect(n.diagrams).toHaveLength(0);
    expect(n.notes.some((t) => t.text.includes("N = 0"))).toBe(true);
  });

  it("fagverk: bare N-panel, smale bånd og 0 på nullstaver", () => {
    const truss = model({
      nodes: [
        { id: "A", x: 0, y: 0 },
        { id: "B", x: 4, y: 0 },
        { id: "C", x: 4, y: 3 },
      ],
      members: [
        { id: "AB", i: "A", j: "B", kind: "truss" },
        { id: "AC", i: "A", j: "C", kind: "truss" },
        { id: "BC", i: "B", j: "C", kind: "truss" },
      ],
      supports: [
        { node: "A", type: "pinned" },
        { node: "B", type: "roller", angle_deg: 0 },
      ],
      // Loddrett last i C rett over rullelageret: BC tar alt, AC og AB er nullstaver.
      loads: [{ id: "P", type: "point", node: "C", P: 10, angle_deg: -90 }],
    });
    const r = solveOk(truss);
    const zero = r.members.filter((m) => Math.abs(m.extremes.N.max.value) < 1e-6 && Math.abs(m.extremes.N.min.value) < 1e-6).map((m) => m.id);
    expect(zero).toEqual(["AB", "AC"]);
    const { layout } = layoutFor(truss);
    expect(layout.panels.map((p) => p.kind)).toEqual(["N", "deformed"]);
    const n = forcePanel(layout.panels, "N");
    expect(n.amplitude).toBeLessThanOrEqual(LAYOUT.trussAmplitude);
    expect(n.labels.filter((l) => l.text === "0")).toHaveLength(2);
    expect(n.labels.some((l) => l.text === "10 kN")).toBe(true);
  });

  it("deformert form: auto gir største forskyvning ≈ 10 % av største mål", () => {
    const m = FIXTURES.utkrager!.model;
    const { layout } = layoutFor(m);
    const d = deformedPanel(layout.panels);
    expect(d.qualitative).toBe(false);
    // δ = qL⁴/8EI + PL³/3EI for IPE200 (I = 19,43e-6 m⁴)
    const EI = 210e9 * 19.43e-6;
    expect(d.maxDisplacement).toBeCloseTo((3e3 * 4 ** 4) / (8 * EI) + (5e3 * 4 ** 3) / (3 * EI), 3);
    expect(d.maxDisplacement * d.scale).toBeCloseTo(0.1 * 4, 9);
    expect(d.notes[0]!.text).toMatch(/^Største forskyvning 49,\d mm/);
    expect(d.labels[0]!.text).toMatch(/mm$/);
    // Innspenningen: tangenten er horisontal i A
    const [a, b] = d.shapes[0]!;
    expect(Math.abs(b!.y - a!.y) / Math.abs(b!.x - a!.x)).toBeLessThan(0.02);
  });

  it("kvalitativ form når tverrsnitt mangler, og fast forstørrelse brukes som gitt", () => {
    const m = simplySupported(6, [udl(-4)]);
    const { layout } = layoutFor(m, 900, 360, { ...DEFAULT_SETTINGS, deformationScale: 5 });
    const d = deformedPanel(layout.panels);
    expect(d.qualitative).toBe(true);
    expect(d.scale).toBe(5);
    expect(d.notes[0]!.text).toBe("Kvalitativ form – tverrsnitt er ikke oppgitt");
    expect(d.labels).toHaveLength(0);
  });

  it("innstillingene bestemmer hvilke paneler som vises", () => {
    const { layout } = layoutFor(simpleBeam(), 900, 360, { N: false, V: true, M: true, deformed: false, deformationScale: "auto" });
    expect(layout.panels.map((p) => p.kind)).toEqual(["V", "M"]);
  });

  it("mekanisme og ugyldig modell gir melding i stedet for diagrammer", () => {
    const mech = beam(
      6,
      [
        { node: "A", type: "roller" },
        { node: "B", type: "roller" },
      ],
      [udl(-4)],
    );
    const { layout } = layoutFor(mech);
    expect(layout.panels).toHaveLength(0);
    expect(layout.message!.join(" ")).toMatch(/mekanisme/);
    const invalid = layoutDiagrams(mech, { status: "invalid", issues: [{ level: "error", code: "x", message: "Elementet mangler en node." }] }, fitViewport(mech, 900, 300));
    expect(invalid.message!.join(" ")).toMatch(/ugyldig.*Elementet mangler en node/);
  });

  const cases: [string, Model][] = [
    ...Object.entries(FIXTURES).map(([name, f]) => [name, f.model] as [string, Model]),
    ["innspent i høyre kant", beam(4, [{ node: "B", type: "fixed" }], [udl(-3)])],
    ["høy søyle med horisontal last", model({
      nodes: [
        { id: "A", x: 0, y: 0 },
        { id: "B", x: 0, y: 5 },
      ],
      members: [{ id: "AB", i: "A", j: "B", kind: "beam" }],
      supports: [{ node: "A", type: "fixed" }],
      loads: [{ id: "P", type: "point", node: "B", P: 10, angle_deg: 0 }],
    })],
  ];

  it.each(cases)("%s: alt ligger innenfor panelet, og panelene ligger etter hverandre", (_name, m) => {
    for (const [w, h] of [
      [900, 360],
      [600, 700],
      [420, 260],
    ] as const) {
      const viewport = fitViewport(m, w, h);
      const layout = layoutDiagrams(m, solve(m), viewport);
      let y = layout.top;
      for (const panel of layout.panels) {
        expect(panel.top).toBeCloseTo(y, 9);
        y += panel.height;
        const pts = panelPoints(panel);
        for (const p of pts) {
          expect(p.x).toBeGreaterThanOrEqual(-1e-6);
          expect(p.x).toBeLessThanOrEqual(w + 1e-6);
          expect(p.y).toBeGreaterThanOrEqual(panel.top - 1e-6);
          expect(p.y).toBeLessThanOrEqual(panel.top + panel.height + 1e-6);
        }
        for (const l of panel.labels) {
          expect(l.box.x0).toBeGreaterThanOrEqual(LAYOUT.margin - 1e-6);
          expect(l.box.x1).toBeLessThanOrEqual(w - LAYOUT.margin + 1e-6);
        }
        for (let a = 0; a < panel.labels.length; a++)
          for (let b = a + 1; b < panel.labels.length; b++) expect(boxesOverlap(panel.labels[a]!.box, panel.labels[b]!.box)).toBe(false);
      }
      expect(layout.height).toBeCloseTo(y, 9);
    }
  });
});
