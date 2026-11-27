import { describe, expect, it } from "vitest";
import { compareModels, type CompareResult } from "../src/core/compare.js";
import type { Model } from "../src/core/schema.js";
import { model, simpleBeam } from "./helpers.js";

const failures = (r: CompareResult) => r.entities.filter((e) => e.status !== "match");

function expectExact(truth: Model, cand: Model) {
  const r = compareModels(truth, cand);
  expect(failures(r)).toEqual([]);
  expect(r.exact).toBe(true);
  // Sammenligningen skal være symmetrisk for ekvivalente modeller.
  expect(compareModels(cand, truth).exact).toBe(true);
}

describe("compareModels – ekvivalente skrivemåter", () => {
  it("identiske modeller", () => {
    expectExact(simpleBeam(), simpleBeam());
  });

  it("andre enheter og annet origo", () => {
    const cand = model({
      units: { length: "mm", force: "N" },
      nodes: [
        { id: "1", x: 1000, y: 500 },
        { id: "2", x: 7000, y: 500 },
      ],
      members: [{ id: "e1", i: "1", j: "2", kind: "beam" }],
      supports: [
        { node: "1", type: "pinned" },
        { node: "2", type: "roller", angle_deg: 0 },
      ],
      loads: [
        { id: "a", type: "distributed", member: "e1", w_start: -4, w_end: -4, from: 0, to: 1, direction: "global_y", basis: "length" },
        { id: "b", type: "point", member: "e1", at: 1 / 3, P: 10000, angle_deg: -90 },
      ],
    });
    expectExact(simpleBeam(), cand);
  });

  it("element tegnet fra B til A, lokal retning og trapeslast", () => {
    const truth = model({
      nodes: [
        { id: "A", x: 0, y: 0 },
        { id: "B", x: 6, y: 0 },
      ],
      members: [{ id: "AB", i: "A", j: "B", kind: "beam" }],
      supports: [{ node: "A", type: "fixed" }],
      loads: [{ id: "q", type: "distributed", member: "AB", w_start: -2, w_end: -6, from: 0, to: 0.5, direction: "global_y", basis: "length" }],
    });
    const cand = model({
      nodes: truth.nodes,
      members: [{ id: "BA", i: "B", j: "A", kind: "beam" }],
      supports: [{ node: "A", type: "fixed" }],
      // Fra B mot A peker lokal y nedover, så nedoverrettet last er positiv.
      loads: [{ id: "q", type: "distributed", member: "BA", w_start: 6, w_end: 2, from: 0.5, to: 1, direction: "local_y", basis: "length" }],
    });
    expectExact(truth, cand);
  });

  it("node i lastpunktet i stedet for last på elementet", () => {
    const base = simpleBeam();
    const cand = model({
      nodes: [...base.nodes, { id: "C", x: 2, y: 0 }],
      members: [
        { id: "AC", i: "A", j: "C", kind: "beam" },
        { id: "CB", i: "C", j: "B", kind: "beam" },
      ],
      supports: base.supports,
      loads: [
        { id: "q1", type: "distributed", member: "AC", w_start: -4, w_end: -4, from: 0, to: 1, direction: "global_y", basis: "length" },
        { id: "q2", type: "distributed", member: "CB", w_start: -4, w_end: -4, from: 0, to: 1, direction: "global_y", basis: "length" },
        { id: "P", type: "point", node: "C", P: 10, angle_deg: -90 },
      ],
    });
    expectExact(base, cand);
  });

  it("samme kraft skrevet med negativ størrelse, eller som to komponenter", () => {
    const truth = model({
      nodes: [
        { id: "A", x: 0, y: 0 },
        { id: "B", x: 3, y: 4 },
      ],
      members: [{ id: "AB", i: "A", j: "B", kind: "beam" }],
      supports: [{ node: "A", type: "fixed" }],
      loads: [{ id: "P", type: "point", node: "B", P: 10, angle_deg: -45 }],
    });
    const negative = { ...truth, loads: [{ id: "P", type: "point" as const, node: "B", P: -10, angle_deg: 135 }] };
    const split = {
      ...truth,
      loads: [
        { id: "Px", type: "point" as const, node: "B", P: 10 * Math.SQRT1_2, angle_deg: 0 },
        { id: "Py", type: "point" as const, node: "B", P: 10 * Math.SQRT1_2, angle_deg: -90 },
      ],
    };
    expectExact(truth, negative);
    expectExact(truth, split);
  });

  it("snølast per horisontal lengde på skrått element tilsvarer redusert last per elementlengde", () => {
    const geometry = {
      nodes: [
        { id: "A", x: 0, y: 0 },
        { id: "B", x: 4, y: 3 },
      ],
      members: [{ id: "AB", i: "A", j: "B", kind: "beam" as const }],
      supports: [{ node: "A", type: "fixed" as const }],
    };
    const projected = model({
      ...geometry,
      loads: [{ id: "s", type: "distributed", member: "AB", w_start: -5, w_end: -5, from: 0, to: 1, direction: "global_y", basis: "projection" }],
    });
    const perLength = model({
      ...geometry,
      loads: [{ id: "s", type: "distributed", member: "AB", w_start: -4, w_end: -4, from: 0, to: 1, direction: "global_y", basis: "length" }],
    });
    expectExact(projected, perLength);
  });

  it("momentledd på BA eller BC gir samme ledd", () => {
    const nodes = [
      { id: "A", x: 0, y: 0 },
      { id: "B", x: 4, y: 0 },
      { id: "C", x: 7, y: 0 },
    ];
    const supports = [
      { node: "A", type: "fixed" as const },
      { node: "C", type: "roller" as const },
    ];
    const left = model({
      nodes,
      supports,
      loads: [],
      members: [
        { id: "AB", i: "A", j: "B", kind: "beam", release: { i: false, j: true } },
        { id: "BC", i: "B", j: "C", kind: "beam" },
      ],
    });
    const right = model({
      nodes,
      supports,
      loads: [],
      members: [
        { id: "AB", i: "A", j: "B", kind: "beam" },
        { id: "BC", i: "B", j: "C", kind: "beam", release: { i: true, j: false } },
      ],
    });
    expectExact(left, right);
    const rigid = { ...left, members: left.members.map((m) => ({ ...m, release: undefined })) };
    const r = compareModels(left, rigid);
    expect(failures(r)).toEqual([expect.objectContaining({ kind: "hinge", status: "missing" })]);
  });

  it("bjelke med ledd i begge ender og uten last regnes som fagverksstav", () => {
    const nodes = [
      { id: "A", x: 0, y: 0 },
      { id: "B", x: 4, y: 0 },
      { id: "C", x: 2, y: 3 },
    ];
    const supports = [
      { node: "A", type: "pinned" as const },
      { node: "B", type: "roller" as const },
    ];
    const loads = [{ id: "P", type: "point" as const, node: "C", P: 20, angle_deg: -90 }];
    const pairs = [
      ["A", "B"],
      ["A", "C"],
      ["B", "C"],
    ];
    const truss = model({ nodes, supports, loads, members: pairs.map(([i, j]) => ({ id: i! + j!, i: i!, j: j!, kind: "truss" as const })) });
    const beams = model({
      nodes,
      supports,
      loads,
      members: pairs.map(([i, j]) => ({ id: i! + j!, i: i!, j: j!, kind: "beam" as const, release: { i: true, j: true } })),
    });
    expectExact(truss, beams);
  });

  it("skrått rullelager: 30° og 210° beskriver samme underlag", () => {
    const truth = simpleBeam();
    const tilt = (deg: number) => ({ ...truth, supports: [truth.supports[0]!, { node: "B", type: "roller" as const, angle_deg: deg }] });
    expectExact(tilt(30), tilt(210));
  });
});

describe("compareModels – feil", () => {
  it("feil opplagertype gir mismatch på akkurat det opplageret", () => {
    const truth = simpleBeam();
    const cand = { ...truth, supports: [truth.supports[0]!, { node: "B", type: "pinned" as const }] };
    const r = compareModels(truth, cand);
    expect(r.exact).toBe(false);
    expect(failures(r)).toEqual([expect.objectContaining({ kind: "support", status: "mismatch", truthIds: ["B"], candidateIds: ["B"] })]);
    expect(r.counts.support).toEqual({ tp: 1, fp: 1, fn: 1 });
  });

  it("manglende last og feil verdi telles hver for seg", () => {
    const truth = simpleBeam();
    const cand = {
      ...truth,
      loads: [{ id: "q", type: "distributed" as const, member: "AB", w_start: -5, w_end: -5, from: 0, to: 1, direction: "global_y" as const, basis: "length" as const }],
    };
    const r = compareModels(truth, cand);
    const loads = failures(r).filter((e) => e.kind === "load");
    expect(loads.map((e) => e.status).sort()).toEqual(["mismatch", "missing"]);
    expect(r.counts.load).toEqual({ tp: 0, fp: 1, fn: 2 });
  });

  it("feil lengde på en del av konstruksjonen gir node-feil, men resten matcher", () => {
    const truth = model({
      nodes: [
        { id: "A", x: 0, y: 0 },
        { id: "B", x: 4, y: 0 },
        { id: "C", x: 6, y: 0 },
      ],
      members: [
        { id: "AB", i: "A", j: "B", kind: "beam" },
        { id: "BC", i: "B", j: "C", kind: "beam" },
      ],
      supports: [
        { node: "A", type: "pinned" },
        { node: "B", type: "roller" },
      ],
      loads: [{ id: "P", type: "point", node: "C", P: 5, angle_deg: -90 }],
    });
    const cand = { ...truth, nodes: [...truth.nodes.slice(0, 2), { id: "C", x: 7, y: 0 }] };
    const r = compareModels(truth, cand);
    expect(r.counts.node).toEqual({ tp: 2, fp: 1, fn: 1 });
    expect(r.counts.support.tp).toBe(2);
  });

  it("fasitens tverrsnitt sammenlignes bare når det er oppgitt", () => {
    const withSection = (E: number, assumed: boolean) => {
      const m = simpleBeam();
      return { ...m, sections: [{ id: "S", E, A: 1e-3, I: 1e-5, assumed }], members: [{ ...m.members[0]!, section: "S" }] };
    };
    expect(compareModels(withSection(210e9, true), simpleBeam()).exact).toBe(true);
    const computed = compareModels(simpleBeam(), withSection(210e9, false));
    expect(computed.exact).toBe(false);
    expect(computed.counts.section).toEqual({ tp: 0, fp: 1, fn: 0 });
    expect(compareModels(simpleBeam(), withSection(210e9, true)).exact).toBe(true);
    const r = compareModels(withSection(210e9, false), withSection(200e9, false));
    expect(r.exact).toBe(false);
    expect(r.counts.section).toEqual({ tp: 0, fp: 1, fn: 1 });
  });
});
