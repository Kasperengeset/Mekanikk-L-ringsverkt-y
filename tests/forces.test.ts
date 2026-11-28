import { describe, expect, it } from "vitest";
import { forceComponents, solveForceSystem, type ForceSystemInput } from "../src/core/forces.js";
import { loadTestset } from "../eval/testset.js";

const { forceCases } = await loadTestset("testset", { inputs: false });

describe("kraftsystem", () => {
  it("dekomponerer kraft gitt med vinkel, retningsvektor og komponenter", () => {
    const a = forceComponents({ id: "A", magnitude: 100, angle_deg: 90 });
    expect(a).toMatchObject({ Fx: expect.closeTo(0, 12), Fz: 100, angle_deg: 90 });
    const b = forceComponents({ id: "B", magnitude: 50, direction: { dx: -4, dz: 3 } });
    expect(b).toMatchObject({ Fx: expect.closeTo(-40, 12), Fz: expect.closeTo(30, 12) });
    const c = forceComponents({ id: "C", components: { Fx: 3, Fz: -4 } });
    expect(c).toMatchObject({ magnitude: 5, angle_deg: expect.closeTo(-53.13, 2) });
  });

  it("sier hva som mangler i stedet for å anta", () => {
    const r = solveForceSystem({ units: { length: "m", force: "N" }, forces: [{ id: "F1", magnitude: 10 }, { id: "F2", angle_deg: 30 }] });
    expect(r.status).toBe("missing");
    if (r.status !== "missing") return;
    expect(r.missing.map((m) => m.field)).toEqual(["F1.direction", "F2.magnitude"]);
    const twoWays = solveForceSystem({ units: { length: "m", force: "N" }, forces: [{ id: "F", magnitude: 1, angle_deg: 0, components: { Fx: 1, Fz: 0 } }] });
    expect(twoWays.status).toBe("missing");
  });

  it("moment om et punkt, og likevekt for et kraftpar som ikke er i momentlikevekt", () => {
    const input: ForceSystemInput = {
      units: { length: "m", force: "kN" },
      forces: [
        { id: "P", components: { Fx: 0, Fz: 10 }, at: { x: 2, z: 0 } },
        { id: "Q", components: { Fx: 0, Fz: -10 }, at: { x: 0, z: 0 } },
      ],
      moment_about: { x: 0, z: 0 },
    };
    const r = solveForceSystem(input);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.resultant.R).toBe(0);
    expect(r.moment?.M).toBe(20); // mot klokka
    expect(r.equilibrium).toBe(false);
    expect(solveForceSystem({ ...input, forces: [input.forces[0]!] })).toMatchObject({ status: "ok", equilibrium: false });
    const missingPoint = solveForceSystem({ ...input, forces: [{ id: "P", components: { Fx: 1, Fz: 0 } }] });
    expect(missingPoint).toMatchObject({ status: "missing", missing: [{ field: "P.at" }] });
  });

  it("egen kontroll: tre krefter i likevekt", () => {
    const r = solveForceSystem({
      units: { length: "m", force: "N" },
      forces: [
        { id: "A", magnitude: 300, angle_deg: 0 },
        { id: "B", magnitude: 400, angle_deg: 90 },
        { id: "C", magnitude: 500, direction: { dx: -3, dz: -4 } },
      ],
    });
    expect(r).toMatchObject({ status: "ok", equilibrium: true });
  });
});

// Kursoppgavene ligger bare lokalt (opphavsrett); i CI hoppes testen over.
describe.skipIf(forceCases.length === 0)("testsettet: kraftsystemer", () => {
  it.each(forceCases.map((c) => [c.id, c] as const))("%s treffer svarantydningen og løsningsforslaget", (_id, c) => {
    const r = solveForceSystem(c.truth);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    const close = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(c.expected.tolerance * Math.max(Math.abs(expected), 1));
    for (const [id, e] of Object.entries(c.expected.forces ?? {})) {
      const f = r.forces.find((x) => x.id === id)!;
      if (e.Fx !== undefined) close(f.Fx, e.Fx);
      if (e.Fz !== undefined) close(f.Fz, e.Fz);
    }
    if (c.expected.Rx !== undefined) close(r.resultant.Rx, c.expected.Rx);
    if (c.expected.Rz !== undefined) close(r.resultant.Rz, c.expected.Rz);
    if (c.expected.R !== undefined) close(r.resultant.R, c.expected.R);
  });
});
