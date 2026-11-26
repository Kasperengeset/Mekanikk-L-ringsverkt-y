import { describe, expect, it } from "vitest";
import {
  collinearChain,
  isLoadPointNode,
  loadPositionOnChain,
  mergeAtNode,
  nodeLoadToMember,
  placeLoadOnChain,
} from "../src/core/edit-ops";
import type { Model } from "../src/core/schema";
import { evalPoly, solve, type SolveResult } from "../src/core/solver";
import { FIXTURES } from "../src/ui/fixtures";
import { model } from "./helpers";

type Ok = Extract<SolveResult, { status: "ok" }>;

function solved(m: Model): Ok {
  const r = solve(m);
  if (r.status !== "ok") throw new Error(`Løsningen feilet: ${r.status}`);
  return r;
}

/** M i et globalt punkt (SI), med fortegn regnet om til retningen `ref`, så elementenes retning ikke spiller inn. */
function momentAt(r: Ok, p: { x: number; y: number }, ref: { x: number; y: number }): number {
  for (const m of r.members) {
    const dx = p.x - m.start.x;
    const dy = p.y - m.start.y;
    const along = dx * m.cos + dy * m.sin;
    const across = -dx * m.sin + dy * m.cos;
    if (Math.abs(across) > 1e-9 || along < -1e-9 || along > m.length + 1e-9) continue;
    const piece = m.pieces.find((pc) => along >= pc.x0 - 1e-12 && along <= pc.x1 + 1e-12)!;
    return evalPoly(piece.M, along) * Math.sign(m.cos * ref.x + m.sin * ref.y);
  }
  throw new Error(`Ingen bjelke gjennom (${p.x}, ${p.y})`);
}

/** Reaksjoner og M i punktene må være like i de to modellene. */
function expectSameSolution(before: Model, after: Model, points: { x: number; y: number }[], ref = { x: 1, y: 0 }) {
  const a = solved(before);
  const b = solved(after);
  expect(b.reactions.length).toBe(a.reactions.length);
  for (const ra of a.reactions) {
    const rb = b.reactions.find((r) => r.node === ra.node)!;
    expect(rb.Fx).toBeCloseTo(ra.Fx, 6);
    expect(rb.Fy).toBeCloseTo(ra.Fy, 6);
    expect(rb.M).toBeCloseTo(ra.M, 6);
  }
  for (const p of points) expect(momentAt(b, p, ref)).toBeCloseTo(momentAt(a, p, ref), 6);
}

const gerber = FIXTURES.gerber!.model;

/** To elementer som begge går ut fra lastpunktet X (det ene må snus ved sammenslåing), med alle lasttyper. */
function reversedPair(fixedA = false): Model {
  return model({
    nodes: [
      { id: "A", x: 0, y: 0 },
      { id: "X", x: 2, y: 0 },
      { id: "B", x: 5, y: 0 },
    ],
    sections: [{ id: "S", E: 210e9, I: 8e-6, A: 2.8e-3, assumed: false }],
    members: [
      { id: "m1", i: "X", j: "A", kind: "beam", section: "S" },
      { id: "m2", i: "X", j: "B", kind: "beam", section: "S" },
    ],
    supports: [
      { node: "A", type: fixedA ? "fixed" : "pinned" },
      { node: "B", type: "roller", angle_deg: 0 },
    ],
    loads: [
      { id: "q1", type: "distributed", member: "m1", w_start: -1, w_end: -3, from: 0.2, to: 0.9, direction: "local_y", basis: "length" },
      { id: "q2", type: "distributed", member: "m2", w_start: -2, w_end: 0, from: 0, to: 0.6, direction: "global_y", basis: "length" },
      { id: "q3", type: "distributed", member: "m2", w_start: 1, w_end: 1, from: 0.5, to: 1, direction: "global_x", basis: "length" },
      { id: "P1", type: "point", member: "m2", at: 0.3, P: 4, angle_deg: -60 },
      { id: "M1", type: "moment", member: "m1", at: 0.5, M: 3 },
      { id: "PX", type: "point", node: "X", P: 5, angle_deg: -90 },
      { id: "MX", type: "moment", node: "X", M: -2 },
    ],
    asked: [{ quantity: "displacement", node: "X" }, { quantity: "internal_forces", member: "m2", at: 0.5 }],
    provenance: [{ entity_kind: "member", entity: "m1", confidence: 0.5, note: "Usikker lengde." }],
  });
}

describe("lastpunkt", () => {
  it("kjenner igjen en node som bare er et lastpunkt", () => {
    expect(isLoadPointNode(gerber, "P")).toBe(true);
    expect(isLoadPointNode(gerber, "H")).toBe(false); // momentledd
    expect(isLoadPointNode(gerber, "A")).toBe(false); // opplager og bare ett element
    expect(isLoadPointNode(gerber, "C")).toBe(false);
    const treledd = FIXTURES.treledd!.model;
    expect(isLoadPointNode(treledd, "B")).toBe(false); // hjørne
    expect(isLoadPointNode(treledd, "C")).toBe(false); // ledd og knekk
    expect(isLoadPointNode(FIXTURES.symbolsk!.model, "B")).toBe(false); // opplager
    expect(isLoadPointNode(reversedPair(), "X")).toBe(true);
  });

  it("krever samme tverrsnitt og ingen andre elementer", () => {
    const base = reversedPair();
    const otherSection = { ...base, sections: [...base.sections, { id: "T", I: 1e-6, assumed: false }] };
    otherSection.members = otherSection.members.map((m) => (m.id === "m1" ? { ...m, section: "T" } : m));
    expect(isLoadPointNode(otherSection, "X")).toBe(false);
    const third = model({
      nodes: [...base.nodes, { id: "T", x: 2, y: 2 }],
      sections: base.sections,
      members: [...base.members, { id: "m3", i: "X", j: "T", kind: "truss" }],
      supports: base.supports,
      loads: [],
    });
    expect(isLoadPointNode(third, "X")).toBe(false);
  });
});

describe("mergeAtNode", () => {
  it("slår sammen elementene i gerberbjelken og gjør nodelasten om til en last på elementet", () => {
    const r = mergeAtNode(gerber, "P");
    if (!r.ok) throw new Error(r.error);
    expect(r.member).toBe("HC");
    expect(r.at).toBeCloseTo(0.5);
    expect(r.model.nodes.map((n) => n.id)).toEqual(["A", "H", "C"]);
    expect(r.model.members.map((m) => [m.id, m.i, m.j])).toEqual([
      ["AH", "A", "H"],
      ["HC", "H", "C"],
    ]);
    expect(r.model.loads.find((l) => l.id === "P1")).toEqual({ id: "P1", type: "point", member: "HC", at: 0.5, P: 6, angle_deg: -90 });
    expect(r.model.loads.find((l) => l.id === "q_HP")).toMatchObject({ member: "HC", from: 0, to: 0.5 });
    expect(r.model.loads.find((l) => l.id === "q_PC")).toMatchObject({ member: "HC", from: 0.5, to: 1 });
    expectSameSolution(gerber, r.model, [0.5, 1.5, 2.9, 3.5, 4.5, 5, 5.5, 6.5].map((x) => ({ x, y: 0 })));
  });

  it("regner om laster når elementene peker mot hverandre (snudd retning, lokal y, trapes)", () => {
    for (const fixedA of [false, true]) {
      const before = reversedPair(fixedA);
      const r = mergeAtNode(before, "X");
      if (!r.ok) throw new Error(r.error);
      const merged = r.model.members.find((m) => m.id === r.member)!;
      expect([merged.i, merged.j, merged.section]).toEqual(["A", "B", "S"]);
      expect(r.at).toBeCloseTo(2 / 5);
      // Elementet m1 (X → A) blir snudd: lokal y skifter fortegn, og start/slutt bytter plass.
      expect(r.model.loads.find((l) => l.id === "q1")).toMatchObject({ w_start: 3, w_end: 1 });
      expect(r.model.loads.find((l) => l.id === "PX")).toMatchObject({ member: r.member, at: r.at });
      expect(r.model.loads.find((l) => l.id === "MX")).toMatchObject({ member: r.member, at: r.at });
      expect(r.model.asked[0]).toEqual({ quantity: "displacement", member: r.member, at: r.at });
      expect(r.model.provenance[0]!.entity).toBe(r.member);
      expectSameSolution(before, r.model, [0.3, 0.7, 1.3, 1.7, 2.5, 3.3, 4.2, 4.8].map((x) => ({ x, y: 0 })));
    }
  });

  it("beholder ledd i de ytre endene og virker på skrå bjelker", () => {
    const before = model({
      nodes: [
        { id: "A", x: 0, y: 0 },
        { id: "K", x: 1.2, y: 0.9 },
        { id: "B", x: 4, y: 3 },
        { id: "C", x: 4, y: 0 },
      ],
      members: [
        { id: "AK", i: "A", j: "K", kind: "beam" },
        { id: "KB", i: "K", j: "B", kind: "beam", release: { i: false, j: true } },
        { id: "BC", i: "B", j: "C", kind: "beam" },
      ],
      supports: [
        { node: "A", type: "pinned" },
        { node: "C", type: "fixed" },
      ],
      loads: [
        { id: "P", type: "point", node: "K", P: 3, angle_deg: -90 },
        { id: "q", type: "distributed", member: "KB", w_start: -2, w_end: -2, from: 0, to: 1, direction: "global_y", basis: "projection" },
      ],
    });
    const r = mergeAtNode(before, "K");
    if (!r.ok) throw new Error(r.error);
    expect(r.model.members.find((m) => m.id === r.member)!.release).toEqual({ i: false, j: true });
    const dir = { x: 0.8, y: 0.6 };
    expectSameSolution(before, r.model, [0.5, 1, 1.5, 2.5, 3.5].map((s) => ({ x: s * dir.x, y: s * dir.y })), dir);
  });

  it("avviser noder som ikke er lastpunkter", () => {
    expect(mergeAtNode(gerber, "H").ok).toBe(false);
    expect(mergeAtNode(gerber, "finnes-ikke").ok).toBe(false);
  });
});

describe("nodeLoadToMember", () => {
  it("flytter en last i en fri ende inn på elementet uten å endre løsningen", () => {
    const before = FIXTURES.utkrager!.model;
    const r = nodeLoadToMember(before, "P1", "AB");
    if (!r.ok) throw new Error(r.error);
    expect(r.model.loads.find((l) => l.id === "P1")).toEqual({ id: "P1", type: "point", member: "AB", at: 1, P: 5, angle_deg: -90 });
    expectSameSolution(before, r.model, [0.5, 2, 3.5].map((x) => ({ x, y: 0 })));
  });

  it("et moment kan ikke flyttes inn på en ende med momentledd", () => {
    const m = model({
      nodes: [
        { id: "A", x: 0, y: 0 },
        { id: "B", x: 2, y: 0 },
        { id: "C", x: 4, y: 0 },
      ],
      members: [
        { id: "AB", i: "A", j: "B", kind: "beam", release: { i: false, j: true } },
        { id: "BC", i: "B", j: "C", kind: "beam" },
      ],
      supports: [
        { node: "A", type: "fixed" },
        { node: "C", type: "roller", angle_deg: 0 },
      ],
      loads: [{ id: "M", type: "moment", node: "B", M: 2 }],
    });
    expect(nodeLoadToMember(m, "M", "AB").ok).toBe(false);
    const ok = nodeLoadToMember(m, "M", "BC");
    if (!ok.ok) throw new Error(ok.error);
    expectSameSolution(m, ok.model, [1, 3].map((x) => ({ x, y: 0 })));
  });
});

describe("collinearChain og placeLoadOnChain", () => {
  it("følger en rett bjelke gjennom opplagre og ledd", () => {
    const m = FIXTURES.symbolsk!.model;
    const chain = collinearChain(m, "BC")!;
    expect(chain.segments.map((s) => s.member)).toEqual(["AB", "BC"]);
    expect(chain.stops).toEqual([
      { node: "A", s: 0 },
      { node: "B", s: 1 },
      { node: "C", s: 1.5 },
    ]);
    expect(loadPositionOnChain(chain, m.loads[0]!)).toBe(1.5);
    const r = placeLoadOnChain(m, "F", chain, 0.4);
    if (!r.ok) throw new Error(r.error);
    expect(r.model.loads[0]).toEqual({ id: "F", type: "point", member: "AB", at: 0.4, P: 1, angle_deg: -90 });

    const g = collinearChain(gerber, "HP")!;
    expect(g.segments.map((s) => s.member)).toEqual(["AH", "HP", "PC"]);
  });

  it("stopper i hjørner og tar hensyn til elementer som går motsatt vei", () => {
    expect(collinearChain(FIXTURES.treledd!.model, "AB")!.segments.map((s) => s.member)).toEqual(["AB"]);
    const before = reversedPair();
    const chain = collinearChain(before, "m1")!;
    // Kjeden følger retningen til m1 (X → A), så den starter i B, og m2 (X → B) går motsatt vei.
    expect(chain.segments.map((s) => [s.member, s.reversed])).toEqual([
      ["m2", true],
      ["m1", false],
    ]);
    expect([chain.origin.x, chain.dir.x, chain.length]).toEqual([5, -1, 5]);
    const r = placeLoadOnChain(before, "P1", chain, 1.5);
    if (!r.ok) throw new Error(r.error);
    // 1,5 fra B mot A er midt på m2.
    expect(r.model.loads.find((l) => l.id === "P1")).toMatchObject({ member: "m2", at: 0.5 });
    const onM1 = placeLoadOnChain(before, "P1", chain, 4);
    expect(onM1.ok && onM1.model.loads.find((l) => l.id === "P1")).toMatchObject({ member: "m1", at: 0.5 });
    expect(loadPositionOnChain(chain, r.model.loads.find((l) => l.id === "P1")!)).toBeCloseTo(1.5);
  });

  it("beholder elementet lasten står på når den havner i en node", () => {
    const m = FIXTURES.symbolsk!.model;
    const chain = collinearChain(m, "AB")!;
    const onBC = placeLoadOnChain(m, "F", chain, 1.2);
    if (!onBC.ok) throw new Error(onBC.error);
    const atB = placeLoadOnChain(onBC.model, "F", chain, 1);
    expect(atB.ok && atB.model.loads[0]).toMatchObject({ member: "BC", at: 0 });
  });

  it("dra en nodelast bort fra lastpunktet gir samme løsning som en last på det sammenslåtte elementet", () => {
    const merged = mergeAtNode(gerber, "P");
    if (!merged.ok) throw new Error(merged.error);
    const chain = collinearChain(merged.model, merged.member)!;
    const moved = placeLoadOnChain(merged.model, "P1", chain, 6.2);
    if (!moved.ok) throw new Error(moved.error);
    const p1 = moved.model.loads.find((l) => l.id === "P1")!;
    expect(p1).toMatchObject({ member: "HC" });
    expect(loadPositionOnChain(chain, p1)).toBeCloseTo(6.2);
    // Samme last på den opprinnelige modellen (på elementet PC) gir samme løsning.
    const reference = {
      ...gerber,
      loads: gerber.loads.map((l) => (l.id === "P1" ? { id: "P1", type: "point" as const, member: "PC", at: 0.6, P: 6, angle_deg: -90 } : l)),
    };
    expectSameSolution(reference, moved.model, [1, 2.5, 4, 5.5, 6.5].map((x) => ({ x, y: 0 })));
  });
});
