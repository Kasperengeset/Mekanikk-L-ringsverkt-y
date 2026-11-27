import { describe, expect, it } from "vitest";
import type { Model } from "../src/core/schema.js";
import { displacedPoint, evalPoly, solve, type SolveResult } from "../src/core/solver/index.js";
import { model } from "./helpers.js";

const E = 210e9;
const I = 1e-4;
const EI = E * I;
/** Tverrsnitt der aksialdeformasjonen er neglisjerbar, slik kurset forutsetter. */
const stiff = { id: "S", E, A: 1e3, I, assumed: false };

function ok(r: SolveResult) {
  if (r.status !== "ok") throw new Error(r.status);
  return r;
}
const rel = (actual: number, expected: number, tol = 1e-6) =>
  expect(Math.abs(actual - expected) / Math.abs(expected), `${actual} mot ${expected}`).toBeLessThan(tol);
const kN = 1e3;
const udl = (member: string, w: number) =>
  ({ id: `q${member}`, type: "distributed", member, w_start: w, w_end: w, from: 0, to: 1, direction: "global_y", basis: "length" }) as const;
const withSection = (m: Model, sections = [stiff]): Model => ({
  ...m,
  sections,
  members: m.members.map((x) => ({ ...x, section: x.section ?? sections[0]!.id })),
});

describe("nedbøyning, standardformler", () => {
  it("fritt opplagt med jevn last: 5qL⁴/384EI midt på og qL³/24EI i endene", () => {
    const L = 6;
    const q = 4 * kN;
    const r = ok(
      solve(
        withSection(
          model({
            nodes: [
              { id: "A", x: 0, y: 0 },
              { id: "B", x: L, y: 0 },
            ],
            members: [{ id: "AB", i: "A", j: "B", kind: "beam" }],
            supports: [
              { node: "A", type: "pinned" },
              { node: "B", type: "roller" },
            ],
            loads: [udl("AB", -4)],
          }),
        ),
      ),
    );
    const m = r.members[0]!;
    rel(evalPoly(m.deflection[0]!.w, L / 2), (-5 * q * L ** 4) / (384 * EI));
    rel(r.displacements.A!.rz, (-q * L ** 3) / (24 * EI));
    rel(displacedPoint(m, L / 2).y, (-5 * q * L ** 4) / (384 * EI));
    expect(r.deformationQualitative).toBe(false);
  });

  it("utkrager med punktlast: PL³/3EI og PL²/2EI i tuppen", () => {
    const L = 3;
    const P = 10 * kN;
    const r = ok(
      solve(
        withSection(
          model({
            nodes: [
              { id: "A", x: 0, y: 0 },
              { id: "B", x: L, y: 0 },
            ],
            members: [{ id: "AB", i: "A", j: "B", kind: "beam" }],
            supports: [{ node: "A", type: "fixed" }],
            loads: [{ id: "P", type: "point", node: "B", P: 10, angle_deg: -90 }],
          }),
        ),
      ),
    );
    rel(r.displacements.B!.uy, (-P * L ** 3) / (3 * EI));
    rel(r.displacements.B!.rz, (-P * L ** 2) / (2 * EI));
  });

  it("uten oppgitt tverrsnitt er formen bare kvalitativ", () => {
    const r = ok(
      solve(
        model({
          nodes: [
            { id: "A", x: 0, y: 0 },
            { id: "B", x: 4, y: 0 },
          ],
          members: [{ id: "AB", i: "A", j: "B", kind: "beam" }],
          supports: [{ node: "A", type: "fixed" }],
          loads: [{ id: "P", type: "point", node: "B", P: 1, angle_deg: -90 }],
        }),
      ),
    );
    expect(r.deformationQualitative).toBe(true);
  });

  it("momentledd gir knekk i formen, men ingen sprang i forskyvningen", () => {
    const r = ok(
      solve(
        withSection(
          model({
            nodes: [
              { id: "A", x: 0, y: 0 },
              { id: "C", x: 4, y: 0 },
              { id: "D", x: 8, y: 0 },
            ],
            members: [
              { id: "AC", i: "A", j: "C", kind: "beam", release: { i: false, j: true } },
              { id: "CD", i: "C", j: "D", kind: "beam" },
            ],
            supports: [
              { node: "A", type: "fixed" },
              { node: "D", type: "roller" },
            ],
            loads: [udl("CD", -1)],
          }),
        ),
      ),
    );
    const [ac, cd] = r.members;
    const lastAC = ac!.deflection[ac!.deflection.length - 1]!;
    const firstCD = cd!.deflection[0]!;
    expect(evalPoly(lastAC.w, 4)).toBeCloseTo(evalPoly(firstCD.w, 0), 12);
    expect(Math.abs(evalPoly(lastAC.rotation, 4) - evalPoly(firstCD.rotation, 0))).toBeGreaterThan(1e-6);
  });
});

describe("nedbøyning mot svarantydninger i Mekanikk 1", () => {
  it("øving 11 oppg. 1: flaggstang i aluminium, rør 160 × 5 mm: w_tupp ≈ 0,70 m", () => {
    const r = ok(
      solve(
        model({
          nodes: [
            { id: "A", x: 0, y: 0 },
            { id: "B", x: 0, y: 6 },
          ],
          members: [{ id: "AB", i: "A", j: "B", kind: "beam", section: "R" }],
          sections: [{ id: "R", E: 70e9, shape: { type: "tube", D: 160, t: 5, unit: "mm" }, assumed: false }],
          supports: [{ node: "A", type: "fixed" }],
          loads: [{ id: "F", type: "point", node: "B", P: 5, angle_deg: 0 }],
        }),
      ),
    );
    expect(r.displacements.B!.ux).toBeCloseTo(0.70, 2);
    // a) nødvendig flytespenning: σ = M·c/I ≈ 328 MPa
    const m = r.members[0]!;
    const sigma = (Math.abs(evalPoly(m.pieces[0]!.M, 0)) * 0.08) / m.section.I / 1e6;
    expect(sigma).toBeCloseTo(328, 0);
  });

  it("øving 12 oppg. 1: φB = FL²/EI og Δ_C,horisontal = 4FL³/3EI", () => {
    const L = 2;
    const F = 1 * kN;
    const r = ok(
      solve(
        withSection(
          model({
            nodes: [
              { id: "A", x: 0, y: 0 },
              { id: "B", x: L, y: 0 },
              { id: "C", x: L, y: L },
            ],
            members: [
              { id: "AB", i: "A", j: "B", kind: "beam" },
              { id: "BC", i: "B", j: "C", kind: "beam" },
            ],
            supports: [{ node: "A", type: "fixed" }],
            loads: [{ id: "F", type: "point", node: "C", P: 1, angle_deg: 0 }],
          }),
        ),
      ),
    );
    rel(Math.abs(r.displacements.B!.rz), (F * L * L) / EI, 1e-5);
    rel(r.displacements.C!.ux, (4 * F * L ** 3) / (3 * EI), 1e-5);
  });

  describe("øving 13 oppg. 2: bjelke med utstikk på begge sider", () => {
    const L = 2;
    const q = 1 * kN;
    const beam = (loaded: string[]) =>
      ok(
        solve(
          withSection(
            model({
              nodes: [
                { id: "C", x: 0, y: 0 },
                { id: "A", x: L / 2, y: 0 },
                { id: "D", x: L, y: 0 },
                { id: "B", x: (3 * L) / 2, y: 0 },
                { id: "H", x: 2 * L, y: 0 },
              ],
              members: [
                { id: "CA", i: "C", j: "A", kind: "beam" },
                { id: "AD", i: "A", j: "D", kind: "beam" },
                { id: "DB", i: "D", j: "B", kind: "beam" },
                { id: "BH", i: "B", j: "H", kind: "beam" },
              ],
              supports: [
                { node: "A", type: "pinned" },
                { node: "B", type: "roller" },
              ],
              loads: loaded.map((m) => udl(m, -1)),
            }),
          ),
        ),
      );
    const unit = (q * L ** 4) / EI;

    it("a) last mellom opplagrene: wC = qL⁴/48EI opp", () => {
      rel(beam(["AD", "DB"]).displacements.C!.uy, unit / 48);
    });
    it("b) last på venstre utstikk: wC = 11qL⁴/384EI ned", () => {
      rel(beam(["CA"]).displacements.C!.uy, (-11 * unit) / 384);
    });
    it("d) last over hele bjelken: wC = 7qL⁴/384EI ned og wD = qL⁴/384EI opp", () => {
      const r = beam(["CA", "AD", "DB", "BH"]);
      rel(r.displacements.C!.uy, (-7 * unit) / 384);
      rel(r.displacements.D!.uy, unit / 384);
    });
  });

  it("øving 12 oppg. 2j: ΔB = 28,8 mm fra aksialdeformasjon av stavene (IPE80)", () => {
    const beams = { id: "BJ", E: 210e9, A: 1e3, shape: { type: "profile" as const, name: "IPE220", axis: "strong" as const }, assumed: false };
    const bars = { id: "ST", E: 210e9, shape: { type: "profile" as const, name: "IPE80", axis: "strong" as const }, assumed: false };
    const r = ok(
      solve(
        model({
          nodes: [
            { id: "A", x: 0, y: 0 },
            { id: "B", x: 8, y: 0 },
            { id: "D", x: 16, y: 0 },
            { id: "C", x: 8, y: -2 },
          ],
          sections: [beams, bars],
          members: [
            { id: "AB", i: "A", j: "B", kind: "beam", section: "BJ", release: { i: false, j: true } },
            { id: "BD", i: "B", j: "D", kind: "beam", section: "BJ" },
            { id: "BC", i: "B", j: "C", kind: "truss", section: "ST" },
            { id: "AC", i: "A", j: "C", kind: "truss", section: "ST" },
            { id: "DC", i: "D", j: "C", kind: "truss", section: "ST" },
          ],
          supports: [
            { node: "A", type: "pinned" },
            { node: "D", type: "roller" },
          ],
          loads: [udl("AB", -8), udl("BD", -8)],
        }),
      ),
    );
    expect(r.displacements.B!.uy * 1e3).toBeCloseTo(-28.8, 1);
  });
});
