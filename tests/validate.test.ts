import { describe, expect, it } from "vitest";
import { validateModel } from "../src/core/validate";
import { model, simpleBeam } from "./helpers";

const ns = (m: Parameters<typeof validateModel>[0]) => validateModel(m).determinacy?.n_s;

const twoNodes = [
  { id: "A", x: 0, y: 0 },
  { id: "B", x: 5, y: 0 },
];
const beamAB = [{ id: "AB", i: "A", j: "B", kind: "beam" as const }];

describe("statisk ubestemthetsgrad", () => {
  it("fritt opplagt bjelke er statisk bestemt", () => {
    const r = validateModel(simpleBeam());
    expect(r.ok).toBe(true);
    expect(r.determinacy).toMatchObject({ n_s: 0, classification: "determinate" });
  });

  it("utkrager er statisk bestemt", () => {
    expect(ns(model({ nodes: twoNodes, members: beamAB, supports: [{ node: "A", type: "fixed" }], loads: [] }))).toBe(0);
  });

  it("innspent–rullelager er 1 gang ubestemt, innspent–innspent 3 ganger", () => {
    const supports = (b: "roller" | "fixed") => [
      { node: "A", type: "fixed" as const },
      { node: "B", type: b },
    ];
    expect(ns(model({ nodes: twoNodes, members: beamAB, supports: supports("roller"), loads: [] }))).toBe(1);
    expect(ns(model({ nodes: twoNodes, members: beamAB, supports: supports("fixed"), loads: [] }))).toBe(3);
  });

  it("to rullelagre gir mekanisme", () => {
    const r = validateModel(
      model({ nodes: twoNodes, members: beamAB, supports: [{ node: "A", type: "roller" }, { node: "B", type: "roller" }], loads: [] }),
    );
    expect(r.determinacy).toMatchObject({ n_s: -1, classification: "mechanism" });
  });

  it("Gerberbjelke (innspent, ledd, rullelager) er statisk bestemt uansett hvilken ende leddet står på", () => {
    const nodes = [
      { id: "A", x: 0, y: 0 },
      { id: "B", x: 4, y: 0 },
      { id: "C", x: 7, y: 0 },
    ];
    const supports = [
      { node: "A", type: "fixed" as const },
      { node: "C", type: "roller" as const },
    ];
    const onAB = [
      { id: "AB", i: "A", j: "B", kind: "beam" as const, release: { i: false, j: true } },
      { id: "BC", i: "B", j: "C", kind: "beam" as const },
    ];
    const onBoth = [
      { id: "AB", i: "A", j: "B", kind: "beam" as const, release: { i: false, j: true } },
      { id: "BC", i: "B", j: "C", kind: "beam" as const, release: { i: true, j: false } },
    ];
    expect(ns(model({ nodes, members: onAB, supports, loads: [] }))).toBe(0);
    expect(ns(model({ nodes, members: onBoth, supports, loads: [] }))).toBe(0);
  });

  it("trekantfagverk er statisk bestemt, med en ekstra stav 1 gang ubestemt", () => {
    const nodes = [
      { id: "A", x: 0, y: 0 },
      { id: "B", x: 4, y: 0 },
      { id: "C", x: 2, y: 3 },
      { id: "D", x: 6, y: 3 },
    ];
    const bars = (pairs: [string, string][]) => pairs.map(([i, j]) => ({ id: i + j, i, j, kind: "truss" as const }));
    const supports = [
      { node: "A", type: "pinned" as const },
      { node: "B", type: "roller" as const },
    ];
    expect(ns(model({ nodes: nodes.slice(0, 3), members: bars([["A", "B"], ["A", "C"], ["B", "C"]]), supports, loads: [] }))).toBe(0);
    expect(
      ns(model({ nodes, members: bars([["A", "B"], ["A", "C"], ["B", "C"], ["C", "D"], ["B", "D"], ["A", "D"]]), supports, loads: [] })),
    ).toBe(1);
  });

  it("treleddsramme er statisk bestemt", () => {
    const r = validateModel(
      model({
        nodes: [
          { id: "A", x: 0, y: 0 },
          { id: "B", x: 0, y: 4 },
          { id: "C", x: 3, y: 4 },
          { id: "D", x: 6, y: 4 },
          { id: "E", x: 6, y: 0 },
        ],
        members: [
          { id: "AB", i: "A", j: "B", kind: "beam" },
          { id: "BC", i: "B", j: "C", kind: "beam", release: { i: false, j: true } },
          { id: "CD", i: "C", j: "D", kind: "beam" },
          { id: "DE", i: "D", j: "E", kind: "beam" },
        ],
        supports: [
          { node: "A", type: "pinned" },
          { node: "E", type: "pinned" },
        ],
        loads: [],
      }),
    );
    expect(r.determinacy?.n_s).toBe(0);
  });
});

describe("feil i modellen", () => {
  it("finner ukjente referanser, nullengde og ugyldig lastplassering", () => {
    const r = validateModel(
      model({
        nodes: [
          { id: "A", x: 0, y: 0 },
          { id: "B", x: 0, y: 0 },
        ],
        members: [
          { id: "AB", i: "A", j: "B", kind: "beam" },
          { id: "AX", i: "A", j: "X", kind: "beam" },
        ],
        supports: [{ node: "A", type: "fixed" }],
        loads: [
          { id: "P", type: "point", node: "A", member: "AB", at: 0.5, P: 1, angle_deg: -90 },
          { id: "q", type: "distributed", member: "AB", w_start: 1, w_end: 1, from: 0.6, to: 0.2, direction: "global_y", basis: "length" },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.determinacy).toBeUndefined();
    expect(r.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["zero_length", "unknown_node", "bad_location", "bad_range"]));
  });

  it("avviser last midt på en fagverksstav", () => {
    const r = validateModel(
      model({
        nodes: twoNodes,
        members: [{ id: "AB", i: "A", j: "B", kind: "truss" }],
        supports: [{ node: "A", type: "pinned" }, { node: "B", type: "roller" }],
        loads: [{ id: "P", type: "point", member: "AB", at: 0.5, P: 1, angle_deg: -90 }],
      }),
    );
    expect(r.issues.map((i) => i.code)).toContain("load_on_truss");
  });
});
