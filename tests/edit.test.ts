import { describe, expect, it } from "vitest";
import { cycleSupportType, getParam, setParam, setParams, snap } from "../src/core/edit.js";
import { simpleBeam } from "./helpers.js";

describe("setParam", () => {
  it("endrer en last og lar resten av modellen være urørt", () => {
    const m = simpleBeam();
    const r = setParam(m, "loads.P.at", 0.5);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(getParam(r.model, "loads.P.at")).toBe(0.5);
    expect(getParam(m, "loads.P.at")).toBeCloseTo(1 / 3);
    expect(r.model.nodes).toBe(m.nodes);
  });

  it("adresserer opplager med node-id og kan opprette nestede felt", () => {
    const m = simpleBeam();
    const a = setParam(m, "supports.B.angle_deg", 30);
    expect(a.ok && getParam(a.model, "supports.B.angle_deg")).toBe(30);
    const b = setParam(m, "members.AB.release.j", true);
    expect(b.ok && getParam(b.model, "members.AB.release.j")).toBe(true);
  });

  it("avviser ugyldige verdier og ukjente stier", () => {
    const m = simpleBeam();
    expect(setParam(m, "loads.P.at", 1.5).ok).toBe(false);
    expect(setParam(m, "loads.X.P", 1).ok).toBe(false);
    expect(setParam(m, "loads.q.from", 0.9).ok).toBe(true);
    expect(setParam(m, "loads.q.to", 0).ok).toBe(false); // krever from < to
    expect(setParam(m, "bogus.P.at", 1).ok).toBe(false);
  });

  it("setParams er alt eller ingenting", () => {
    const m = simpleBeam();
    expect(setParams(m, [{ path: "loads.P.P", value: 20 }, { path: "loads.P.at", value: 2 }]).ok).toBe(false);
    const ok = setParams(m, [{ path: "nodes.B.x", value: 8 }, { path: "loads.P.P", value: 20 }]);
    expect(ok.ok && [getParam(ok.model, "nodes.B.x"), getParam(ok.model, "loads.P.P")]).toEqual([8, 20]);
  });

  it("en mekanisme er en gyldig modell", () => {
    const r = setParam(simpleBeam(), "supports.A.type", "roller");
    expect(r.ok).toBe(true);
  });

  it("klikk på opplager går fast innspent → fastlager → rullelager → fast innspent", () => {
    let m = simpleBeam();
    const seq: string[] = [];
    for (let k = 0; k < 3; k++) {
      const r = cycleSupportType(m, "A");
      if (!r.ok) throw new Error(r.error);
      m = r.model;
      seq.push(m.supports.find((s) => s.node === "A")!.type);
    }
    expect(seq).toEqual(["roller", "fixed", "pinned"]);
  });

  it("snap runder til nærmeste steg", () => {
    expect(snap(2.04, 0.1)).toBeCloseTo(2.0);
    expect(snap(2.06, 0.1)).toBeCloseTo(2.1);
  });
});
