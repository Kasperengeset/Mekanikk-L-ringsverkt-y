import { beforeEach, describe, expect, it } from "vitest";
import { positiveSide } from "../src/ui/convention";
import { FIXTURES } from "../src/ui/fixtures";
import { formatNumber, formatQuantity } from "../src/ui/format";
import { fitViewport } from "../src/ui/geometry";
import { useStore } from "../src/ui/state/store";
import { solve } from "../src/core/solver";
import { simpleBeam } from "./helpers";

describe("eksempelmodellene", () => {
  it.each(Object.entries(FIXTURES))("%s løses", (_name, f) => {
    expect(solve(f.model).status).toBe("ok");
  });
});

describe("viewport", () => {
  it("snur y-aksen og sentrerer modellen", () => {
    const v = fitViewport(simpleBeam(), 800, 400, { padding: 50 });
    const a = v.toScreen({ x: 0, y: 0 });
    const b = v.toScreen({ x: 6, y: 0 });
    expect(a.x).toBeCloseTo(50);
    expect(b.x).toBeCloseTo(750);
    expect(v.toScreen({ x: 0, y: 1 }).y).toBeLessThan(a.y);
    expect(v.toWorld(b).x).toBeCloseTo(6);
  });

  it("tvunget skala og venstrekant gir samme x-akse i to paneler", () => {
    const m = simpleBeam();
    const top = fitViewport(m, 800, 400);
    const bottom = fitViewport(m, 800, 150, { scale: top.scale, originX: top.toScreen({ x: 0, y: 0 }).x });
    expect(bottom.toScreen({ x: 4, y: 0 }).x).toBeCloseTo(top.toScreen({ x: 4, y: 0 }).x);
  });
});

describe("fortegn og formatering", () => {
  it("M tegnes på strekksiden: under en bjelke fra venstre mot høyre", () => {
    const m = positiveSide("M", 1, 0);
    const n = positiveSide("N", 1, 0);
    expect([m.x + 0, m.y]).toEqual([0, -1]);
    expect([n.x + 0, n.y]).toEqual([0, 1]);
    // Bjelke tegnet fra høyre mot venstre: strekksiden for positivt M er fortsatt −y', nå oppover.
    expect(positiveSide("M", -1, 0).y).toBe(1);
  });

  it("tall på norsk og i oppgavens enheter", () => {
    expect(formatNumber(18000.4, 3)).toBe("18000");
    expect(formatNumber(0.11249999)).toBe("0,112");
    expect(formatQuantity("moment", 18e3, simpleBeam())).toBe("18 kNm");
    expect(formatQuantity("moment", 0.5e3, FIXTURES.symbolsk!.model)).toBe("0,5 FL");
    expect(formatQuantity("force", 1.5e3, FIXTURES.symbolsk!.model)).toBe("1,5 F");
  });
});

describe("store", () => {
  beforeEach(() => useStore.getState().loadModel(simpleBeam()));

  it("edit gir ett steg i historikken, og angre/gjør om virker", () => {
    const s = useStore.getState();
    expect(s.edit({ path: "loads.P.P", value: 20 }).ok).toBe(true);
    expect(useStore.getState().model!.loads.find((l) => l.id === "P")).toMatchObject({ P: 20 });
    useStore.getState().undo();
    expect(useStore.getState().model!.loads.find((l) => l.id === "P")).toMatchObject({ P: 10 });
    useStore.getState().redo();
    expect(useStore.getState().model!.loads.find((l) => l.id === "P")).toMatchObject({ P: 20 });
  });

  it("en dra-operasjon blir ett steg, og ugyldige mellomtilstander avvises", () => {
    const s = useStore.getState();
    s.beginGesture();
    for (const at of [0.4, 0.5, 0.6]) s.updateGesture({ path: "loads.P.at", value: at });
    expect(s.updateGesture({ path: "loads.P.at", value: 1.4 }).ok).toBe(false);
    s.endGesture();
    const st = useStore.getState();
    expect(st.model!.loads.find((l) => l.id === "P")).toMatchObject({ at: 0.6 });
    expect(st.past).toHaveLength(1);
    st.undo();
    expect(useStore.getState().model!.loads.find((l) => l.id === "P")!).toMatchObject({ at: 1 / 3 });
  });
});
