import { describe, expect, it } from "vitest";
import { centroidFromBottom, PROFILES, resolveSection, shapeProperties } from "../src/core/sections.js";
import { validateModel } from "../src/core/validate.js";
import { simpleBeam } from "./helpers.js";

describe("IPE-tabellen", () => {
  // Kontroll av tabellverdiene mot geometrien (flenser, steg og fire hulkiler med radius r).
  it.each(Object.entries(PROFILES))("%s: A og I stemmer med geometrien", (_name, p) => {
    const af = (1 - Math.PI / 4) * p.r ** 2; // én hulkil
    const e = ((10 - 3 * Math.PI) / (12 - 3 * Math.PI)) * p.r; // tyngdepunktets avstand fra hjørnet
    const A = 2 * p.b * p.tf + (p.h - 2 * p.tf) * p.tw + 4 * af;
    const zf = p.h / 2 - p.tf - e;
    const Iy = (p.b * p.h ** 3 - (p.b - p.tw) * (p.h - 2 * p.tf) ** 3) / 12 + 4 * af * zf ** 2;
    const yf = p.tw / 2 + e;
    const Iz = (2 * p.tf * p.b ** 3) / 12 + ((p.h - 2 * p.tf) * p.tw ** 3) / 12 + 4 * af * yf ** 2;
    expect(Math.abs(A / p.A - 1)).toBeLessThan(0.01);
    expect(Math.abs(Iy / p.Iy - 1)).toBeLessThan(0.01);
    expect(Math.abs(Iz / p.Iz - 1)).toBeLessThan(0.03);
  });
});

describe("tverrsnitt fra form", () => {
  // Øving 9 oppg. 2: fritt opplagt bjelke L = 6 m, q = 4 kN/m, M_max = 18 kNm. σ = M·c/I.
  const M = 18e6; // Nmm
  const sigma = (I_m4: number, c_mm: number) => (M * c_mm) / (I_m4 * 1e12);

  it("rektangel 100 × 50 mm lagt flatt: σ = 432 N/mm²", () => {
    const { I } = shapeProperties({ type: "rectangle", b: 100, h: 50, unit: "mm" });
    expect(sigma(I, 25)).toBeCloseTo(432, 0);
  });

  it("IPE300 om sterk akse: σ ≈ 32 N/mm²", () => {
    const { I, A } = shapeProperties({ type: "profile", name: "ipe 300", axis: "strong" });
    expect(sigma(I, 150)).toBeCloseTo(32.3, 1);
    expect(A * 1e6).toBeCloseTo(5381, 0); // øving 8 oppg. 1: A = 5,38·10³ mm²
  });

  it("rør 200 × 8,5 mm: σ ≈ 77 N/mm² og areal ca. 5000 mm²", () => {
    const { I, A } = shapeProperties({ type: "tube", D: 200, t: 8.5, unit: "mm" });
    expect(sigma(I, 100)).toBeCloseTo(76.6, 1);
    expect(A * 1e6).toBeGreaterThan(5000);
  });

  it("sammensatt T-tverrsnitt: arealsenter og I med Steiners teorem", () => {
    const shape = {
      type: "composite" as const,
      unit: "mm" as const,
      parts: [
        { b: 20, h: 80, z: 0, hole: false },
        { b: 100, h: 20, z: 80, hole: false },
      ],
    };
    const { A, I } = shapeProperties(shape);
    expect(A * 1e6).toBeCloseTo(3600, 6);
    expect(centroidFromBottom(shape)! * 1e3).toBeCloseTo(67.778, 3);
    expect(I * 1e12).toBeCloseTo(3_142_222.2, 0);
  });

  it("oppgitte tall går foran formen, og manglende E gjør tverrsnittet antatt", () => {
    const r = resolveSection({ id: "S", A: 2, shape: { type: "profile", name: "IPE220", axis: "strong" }, assumed: false });
    expect(r.A).toBe(2);
    expect(r.I).toBeCloseTo(2.772e-5, 12);
    expect(r.assumed).toBe(true);
    expect(resolveSection({ id: "S", E: 210e9, shape: { type: "profile", name: "IPE220", axis: "strong" }, assumed: false }).assumed).toBe(false);
  });

  it("ukjent profil gir valideringsfeil", () => {
    const m = simpleBeam();
    const r = validateModel({
      ...m,
      sections: [{ id: "S", E: 210e9, shape: { type: "profile", name: "HEB999", axis: "strong" }, assumed: false }],
      members: [{ ...m.members[0]!, section: "S" }],
    });
    expect(r.issues.map((i) => i.code)).toContain("bad_section");
  });
});
