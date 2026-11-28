import { describe, expect, it } from "vitest";
import { cutActions, cutAtPoint, cutForces, cutParts, freeBodyResidual, resolveCut, splitLocalLoad } from "../src/core/cut.js";
import { hiddenValues } from "../src/core/pedagogy.js";
import type { Model, Section } from "../src/core/schema.js";
import { solve } from "../src/core/solver/index.js";
import { firstMoment, intervalsAt, shapeGeometry, stressProfile, widthAt } from "../src/core/stress.js";
import { cutReadout, tensionSideText } from "../src/ui/cut3d/readout.js";
import { buildCutScene } from "../src/ui/cut3d/scene.js";
import { layoutDiagrams, type ForcePanel } from "../src/ui/diagrams/layout.js";
import { FIXTURES } from "../src/ui/fixtures.js";
import { fitViewport } from "../src/ui/geometry.js";
import { cutChain, cutOnChain } from "../src/ui/structure/cutDrag.js";
import { lengthStep } from "../src/ui/structure/drag.js";
import { loadTestset } from "../eval/testset.js";
import { simpleBeam } from "./helpers.js";

const fixture = (name: string) => FIXTURES[name]!.model;
const { cases } = await loadTestset("testset", { inputs: false });
const ok = (m: Model) => {
  const r = solve(m);
  if (r.status !== "ok") throw new Error(`Ingen løsning: ${r.status}`);
  return r;
};

describe("snittkrefter", () => {
  it("utkrager i IPE200: V og M midt på stemmer med håndregning", () => {
    const m = fixture("utkrager");
    const f = cutForces(ok(m), { member: "AB", at: 0.5 })!;
    // Til høyre for snittet: 5 kN i enden og 3 kN/m over 2 m.
    expect(Math.abs(f.V)).toBeCloseTo(11e3, 6);
    expect(f.M).toBeCloseTo(-16e3, 6);
    expect(f.N).toBeCloseTo(0, 6);
    expect(f.point).toEqual({ x: 2, y: 0 });
  });

  it("et snitt nøyaktig i en punktlast gir verdien før lasten, og lasten hører til j-siden", () => {
    const m = simpleBeam();
    const r = ok(m);
    const before = cutForces(r, { member: "AB", at: 1 / 3 - 1e-9 })!;
    const at = cutForces(r, { member: "AB", at: 1 / 3 })!;
    expect(at.V).toBeCloseTo(before.V, 3);
    expect(splitLocalLoad({ kind: "point", x: 2, Pa: 0, Pp: -10 }, 2, 1)).toBeDefined();
    expect(splitLocalLoad({ kind: "point", x: 2, Pa: 0, Pp: -10 }, 2, 0)).toBeUndefined();
  });

  it("delene får like store og motsatte krefter (Newtons 3. lov)", () => {
    const f = cutForces(ok(simpleBeam()), { member: "AB", at: 0.6 })!;
    const [a, b] = cutActions(f);
    expect(a.F.x + b.F.x).toBe(0);
    expect(a.F.y + b.F.y).toBe(0);
    expect(a.M + b.M).toBe(0);
  });
});

describe("frie legemer", () => {
  it("gerberbjelken deles i to, fagverket ikke", () => {
    expect(cutParts(fixture("gerber"), { member: "HP", at: 0.5 }).separated).toBe(true);
    const truss = fixture("fagverk");
    expect(cutParts(truss, { member: truss.members[0]!.id, at: 0.5 }).separated).toBe(false);
    const frame = cutParts(fixture("ramme"), { member: "AB", at: 0.5 });
    expect(frame.separated).toBe(true);
    expect([...frame.nodes[0]]).toEqual(["A"]);
  });

  const models: [string, Model][] = [...Object.entries(FIXTURES).map(([k, v]) => [k, v.model] as [string, Model]), ...cases.map((c) => [c.id, c.truth] as [string, Model])];

  it.each(models)("%s: hver del er i likevekt med laster, opplagerkrefter og snittkrefter", (_id, m) => {
    const r = solve(m);
    if (r.status !== "ok") return;
    const scale = Math.max(1, ...r.reactions.flatMap((x) => [Math.abs(x.Fx), Math.abs(x.Fy)]));
    const span = Math.max(...r.members.map((x) => x.length));
    let checked = 0;
    for (const member of m.members) {
      for (const at of [0.13, 0.5, 0.77]) {
        for (const part of [0, 1] as const) {
          const res = freeBodyResidual(m, r, { member: member.id, at }, part);
          if (!res) continue;
          checked++;
          expect(Math.abs(res.Fx)).toBeLessThan(1e-7 * scale);
          expect(Math.abs(res.Fy)).toBeLessThan(1e-7 * scale);
          expect(Math.abs(res.M)).toBeLessThan(1e-7 * scale * span);
        }
      }
    }
    if (m.members.length === 1) expect(checked).toBeGreaterThan(0);
  });

  it("snittet finnes igjen fra punktet når elementet har fått ny id", () => {
    const m = fixture("gerber");
    expect(resolveCut(m, { member: "HP", at: 0.25, point: { x: 3.5, y: 0 } })).toEqual({ member: "HP", at: 0.25 });
    expect(resolveCut(m, { member: "borte", at: 0.25, point: { x: 3.5, y: 0 } })).toEqual({ member: "HP", at: 0.25 });
    expect(resolveCut(m, { member: "borte", at: 0.25, point: { x: 3.5, y: 2 } })).toBeUndefined();
    expect(cutAtPoint(m, { x: 3, y: 0 })).toBeUndefined(); // i en node
  });
});

describe("spenninger i tverrsnittet", () => {
  const rect = (b: number, h: number): Section => ({ id: "S", shape: { type: "rectangle", b, h, unit: "mm" }, assumed: false });

  it("rektangel: σ = M/W og τ_max = 1,5 V/A", () => {
    const p = stressProfile(rect(100, 200), { N: 0, V: 10e3, M: 20e3 });
    const W = (0.1 * 0.2 ** 2) / 6;
    expect(p.sigmaBottom).toBeCloseTo(20e3 / W, 0); // M > 0: strekk i −y' (underkant)
    expect(p.sigmaTop).toBeCloseTo(-20e3 / W, 0);
    expect(p.tauMax.value).toBeCloseTo((1.5 * 10e3) / 0.02, 0);
    expect(p.tauMax.y).toBeCloseTo(0, 9);
    expect(p.neutralAxis).toBe(0); // uten normalkraft går nøytralaksen gjennom arealsenteret
  });

  it("nøytralaksen flyttes av normalkraften", () => {
    const p = stressProfile(rect(100, 200), { N: 50e3, V: 0, M: 5e3 });
    // σ = N/A − M·y/I = 0 ⇒ y = N·I/(A·M)
    const I = (0.1 * 0.2 ** 3) / 12;
    expect(p.neutralAxis).toBeCloseTo((50e3 * I) / (0.02 * 5e3), 9);
    expect(p.sigmaTop).toBeCloseTo(50e3 / 0.02 - (5e3 * 0.1) / I, 3);
  });

  const shapes: [string, Section][] = [
    ["rektangel", rect(80, 240)],
    ["sirkel", { id: "S", shape: { type: "circle", D: 60, unit: "mm" }, assumed: false }],
    ["rør", { id: "S", shape: { type: "tube", D: 100, t: 8, unit: "mm" }, assumed: false }],
    ["IPE300", { id: "S", shape: { type: "profile", name: "IPE300", axis: "strong" }, assumed: false }],
    ["IPE300 svak akse", { id: "S", shape: { type: "profile", name: "IPE 300", axis: "weak" }, assumed: false }],
    [
      "T-tverrsnitt",
      {
        id: "S",
        shape: {
          type: "composite",
          unit: "mm",
          parts: [
            { b: 20, h: 180, z: 0, hole: false },
            { b: 160, h: 20, z: 180, hole: false },
          ],
        },
        assumed: false,
      },
    ],
    [
      "kassetverrsnitt",
      {
        id: "S",
        shape: {
          type: "composite",
          unit: "mm",
          parts: [
            { b: 200, h: 300, z: 0, hole: false },
            { b: 180, h: 280, z: 10, hole: true },
          ],
        },
        assumed: false,
      },
    ],
  ];

  it.each(shapes)("%s: ∫ τ·b dy = V og ∫ σ dA = N", (_name, section) => {
    const forces = { N: 7e3, V: 12e3, M: 3e3 };
    const p = stressProfile(section, forces, 400);
    const g = p.geometry;
    // Trapesregel over prøvepunktene (bredden like over hvert punkt).
    let shear = 0;
    let normal = 0;
    for (let k = 0; k + 1 < p.samples.length; k++) {
      const a = p.samples[k]!;
      const b = p.samples[k + 1]!;
      const dy = b.y - a.y;
      if (dy <= 0) continue;
      const mid = (a.y + b.y) / 2;
      const w = widthAt(g, mid);
      shear += ((a.tau + b.tau) / 2) * w * dy;
      normal += ((a.sigma + b.sigma) / 2) * w * dy;
    }
    expect(shear / forces.V).toBeCloseTo(1, 2);
    // σ bruker tabellverdier for profiler; ellers er A den samme.
    expect(normal / forces.N).toBeCloseTo(section.shape!.type === "profile" ? g.A / p.A : 1, 2);
    expect(firstMoment(g, g.bottom)).toBeCloseTo(0, 12);
  });

  it("I-profilet har smalt steg og brede flenser; svak akse gir to flenser ved siden av hverandre", () => {
    const strong = shapeGeometry({ type: "profile", name: "IPE300", axis: "strong" });
    expect(widthAt(strong, 0)).toBeCloseTo(7.1e-3, 9);
    expect(widthAt(strong, strong.top - 1e-4)).toBeCloseTo(0.15, 9);
    const weak = shapeGeometry({ type: "profile", name: "IPE300", axis: "weak" });
    expect(intervalsAt(weak, weak.top - 1e-4)).toHaveLength(2);
    expect(weak.top - weak.bottom).toBeCloseTo(0.15, 9);
  });

  it("uten form i oppgaven brukes et rektangel som bare er en illustrasjon", () => {
    expect(stressProfile(undefined, { N: 0, V: 1, M: 1 }).geometry.assumed).toBe(true);
  });
});

describe("snittet i konstruksjonsvisningen", () => {
  it("snapper til steget og står aldri i en node", () => {
    const m = fixture("gerber");
    const chain = cutChain(m, "AH")!;
    const step = lengthStep(m);
    expect(chain.length).toBe(7); // hele den rette bjelken
    expect(cutOnChain(chain, { x: 1.62, y: 0.3 }, step)).toEqual({ member: "AH", at: Number((1.6 / 3).toFixed(12)), point: { x: 1.6, y: 0 } });
    // I H (x = 3): et halvt steg inn på siden pekeren er.
    expect(cutOnChain(chain, { x: 3.01, y: 0 }, step)!.point.x).toBeCloseTo(3.05, 9);
    expect(cutOnChain(chain, { x: 2.99, y: 0 }, step)!.point.x).toBeCloseTo(2.95, 9);
    expect(cutOnChain(chain, { x: 3.01, y: 0 }, step)!.member).toBe("HP");
    expect(cutOnChain(chain, { x: -1, y: 0 }, step)!.point.x).toBeCloseTo(0.05, 9);
  });

  it("en stav er sin egen kjede", () => {
    const m = fixture("fagverk");
    const bar = m.members[0]!;
    const chain = cutChain(m, bar.id)!;
    expect(chain.segments).toHaveLength(1);
    expect(cutOnChain(chain, chain.origin, 0.1)!.member).toBe(bar.id);
  });
});

describe("tallene for snittet", () => {
  it("strekk og strekkside i ord, og «?» for skjulte tall", () => {
    const m = fixture("utkrager");
    const r = ok(m);
    const open = cutReadout(m, r, { member: "AB", at: 0.5 })!;
    expect(open.position).toBe("2 m fra A");
    expect(open.rows.map((x) => [x.q, x.value, x.note])).toEqual([
      ["N", "0 kN", undefined],
      ["V", "11 kN", undefined],
      ["M", "16 kNm", "strekk i overkant"],
    ]);
    const gerber = fixture("gerber");
    const hidden = cutReadout(gerber, ok(gerber), { member: "AH", at: 0.5 }, hiddenValues(gerber, {}))!;
    expect(hidden.rows.every((x) => x.value === "?" && x.masked)).toBe(true);
    const f = cutForces(r, { member: "AB", at: 0.5 })!;
    expect(tensionSideText({ ...f, M: 1 })).toBe("strekk i underkant");
  });

  it("en stav har bare N", () => {
    const m = fixture("fagverk");
    expect(cutReadout(m, ok(m), { member: m.members[0]!.id, at: 0.5 })!.rows.map((x) => x.q)).toEqual(["N"]);
  });
});

describe("3D-scenen", () => {
  const all = Object.entries(FIXTURES);

  it.each(all)("%s: bygges i begge visninger med endelige koordinater", (_name, { model: m }) => {
    const r = solve(m);
    if (r.status !== "ok") return;
    for (const member of m.members) {
      for (const mode of ["forces", "stress"] as const) {
        const scene = buildCutScene({ model: m, result: r, cut: { member: member.id, at: 0.4 }, mode, hidden: hiddenValues(m, {}) })!;
        expect(scene.bodies.length).toBeGreaterThanOrEqual(m.members.length + 1);
        expect(scene.faces).toHaveLength(2);
        const nums = [...scene.arrows.flatMap((a) => [...a.tail, ...a.tip]), ...scene.labels.flatMap((l) => l.at), ...scene.framePoints.flat()];
        expect(nums.every(Number.isFinite)).toBe(true);
      }
    }
  });

  it("delene flyttes fra hverandre langs elementet når snittet deler konstruksjonen", () => {
    const m = fixture("utkrager");
    const scene = buildCutScene({ model: m, result: ok(m), cut: { member: "AB", at: 0.5 }, mode: "forces" })!;
    expect(scene.separated).toBe(true);
    const [a, b] = scene.faces;
    expect(b!.center[0] - a!.center[0]).toBeGreaterThan(0.1 * scene.span);
    expect(a!.normal[0]).toBe(1);
    expect(b!.normal[0]).toBe(-1);
  });

  it("snittkreftene peker riktig: V ned på i-siden og opp på j-siden for utkrageren, ingen N-pil når N = 0", () => {
    const m = fixture("utkrager");
    const scene = buildCutScene({ model: m, result: ok(m), cut: { member: "AB", at: 0.5 }, mode: "forces" })!;
    const V = scene.arrows.filter((x) => x.tone === "V");
    expect(V).toHaveLength(2);
    const dy = (x: (typeof V)[number]) => x.tip[1] - x.tail[1];
    const [left, right] = V[0]!.tail[0] < V[1]!.tail[0] ? [V[0]!, V[1]!] : [V[1]!, V[0]!];
    expect(dy(left)).toBeLessThan(0);
    expect(dy(right)).toBeGreaterThan(0);
    expect(scene.arrows.filter((x) => x.tone === "N")).toHaveLength(0);
    // M < 0 (strekk i overkant): med klokka på i-siden.
    const arcs = scene.arcs.filter((x) => x.tone === "M");
    expect(arcs).toHaveLength(2);
    const leftArc = arcs.find((x) => x.center[0] < 2)!;
    expect(leftArc.sweep).toBeLessThan(0);
  });

  it("skjulte opplagerkrefter vises som «?», og tallet står ingen steder", () => {
    const m = fixture("gerber");
    const scene = buildCutScene({ model: m, result: ok(m), cut: { member: "HP", at: 0.5 }, mode: "forces", hidden: hiddenValues(m, {}) })!;
    const reactions = scene.labels.filter((l) => l.tone === "reaction");
    expect(reactions.length).toBeGreaterThan(0);
    expect(reactions.every((l) => l.value === "?" && l.masked)).toBe(true);
    const open = buildCutScene({ model: m, result: ok(m), cut: { member: "HP", at: 0.5 }, mode: "forces" })!;
    expect(open.labels.filter((l) => l.tone === "reaction").some((l) => /\d/.test(l.value ?? ""))).toBe(true);
  });

  it("spenningsvisningen tegner σ som strekk og trykk og τ som diagram", () => {
    const m = fixture("utkrager");
    const scene = buildCutScene({ model: m, result: ok(m), cut: { member: "AB", at: 0.5 }, mode: "stress" })!;
    expect(scene.arrows.some((a) => a.tone === "tension")).toBe(true);
    expect(scene.arrows.some((a) => a.tone === "compression")).toBe(true);
    expect(scene.lines.some((l) => l.tone === "tau")).toBe(true);
    expect(scene.arrows.some((a) => a.tone === "N" || a.tone === "V")).toBe(false);
  });

  it("et lukket fagverk deles ikke; staven kortes inn ved snittet", () => {
    const m = fixture("fagverk");
    const bar = m.members[0]!;
    const scene = buildCutScene({ model: m, result: ok(m), cut: { member: bar.id, at: 0.5 }, mode: "forces" })!;
    expect(scene.separated).toBe(false);
    const pieces = scene.bodies.filter((b) => b.kind === "truss");
    expect(pieces).toHaveLength(m.members.length + 1);
  });
});

describe("snittet i diagrammene", () => {
  it("V- og M-panelet får en stiplet strek gjennom snittet, med punktet på kurven", () => {
    const m = fixture("utkrager");
    const r = ok(m);
    const layout = layoutDiagrams(m, r, fitViewport(m, 900, 300), undefined, { cut: { member: "AB", at: 0.5 } });
    const panels = layout.panels.filter((p): p is ForcePanel => p.kind === "V" || p.kind === "M");
    expect(panels).toHaveLength(2);
    for (const p of panels) {
      expect(p.cut).toBeDefined();
      expect(p.cut!.base.x).toBeCloseTo(p.cut!.point.x, 6);
      expect(Math.abs(p.cut!.point.y - p.cut!.base.y)).toBeGreaterThan(5);
    }
    expect(layoutDiagrams(m, r, fitViewport(m, 900, 300)).panels.some((p) => "cut" in p && p.cut)).toBe(false);
  });
});
