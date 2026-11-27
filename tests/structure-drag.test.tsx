import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { solve } from "../src/core/solver/index.js";
import type { Model } from "../src/core/schema.js";
import { FIXTURES } from "../src/ui/fixtures.js";
import { fitViewport, type Point } from "../src/ui/geometry.js";
import { useStore, type EntityRef } from "../src/ui/state/store.js";
import { dragTo, lengthStep, niceStep, startDrag, type DragPart, type DragSession } from "../src/ui/structure/drag.js";
import { highlightProps } from "../src/ui/structure/highlight.js";
import { loadScales } from "../src/ui/structure/layout.js";
import { StructureSvg } from "../src/ui/structure/StructureSvg.js";
import { StructureView } from "../src/ui/structure/StructureView.js";
import { findAll, hasClass, parseMarkup } from "./structure-markup.js";
import { model as build } from "./helpers.js";

const fixture = (name: string) => FIXTURES[name]!.model;
const view = (m: Model) => fitViewport(m, 900, 450);

function begin(m: Model, ref: EntityRef, part: DragPart = "body", world: Point = { x: 0, y: 0 }): DragSession {
  const s = startDrag(m, ref, part, world, view(m), loadScales(m));
  if (!s) throw new Error("Draget startet ikke");
  return s;
}

/** Drar til et punkt i modellkoordinater (skjermpunktet regnes ut av viewporten). */
function to(s: DragSession, m: Model, world: Point) {
  return dragTo(s, world, view(m).toScreen(world));
}

const loadOf = (m: Model, id: string) => m.loads.find((l) => l.id === id)!;
const asModel = (u: ReturnType<typeof to>) => {
  if (!u || Array.isArray(u.update)) throw new Error("Ventet en hel modell");
  return u.update;
};

describe("snapping", () => {
  it("0,1 lengdeenhet, men ikke finere enn 1 cm", () => {
    expect(lengthStep(fixture("gerber"))).toBe(0.1);
    expect(lengthStep({ ...fixture("gerber"), units: { length: "mm", force: "N" } })).toBe(10);
    expect(lengthStep({ ...fixture("gerber"), units: { length: "cm", force: "kN" } })).toBe(1);
  });

  it("pene steg for kraft", () => {
    expect([niceStep(0.8), niceStep(0.6), niceStep(0.1), niceStep(2.5), niceStep(0)]).toEqual([1, 0.5, 0.1, 2, 1]);
  });
});

describe("dra en node", () => {
  it("snapper til 0,1 og gir endringer for x og y", () => {
    const m = fixture("skraa");
    const s = begin(m, { kind: "node", id: "B" });
    expect(to(s, m, { x: 5.04, y: 0.27 })!.update).toEqual([
      { path: "nodes.B.x", value: 5 },
      { path: "nodes.B.y", value: 0.3 },
    ]);
    expect(to(s, m, { x: 2.3, y: 0 })!.update).toEqual([
      { path: "nodes.B.x", value: 2.3 },
      { path: "nodes.B.y", value: 0 },
    ]);
  });
});

describe("dra en punktlast langs bjelken", () => {
  it("en last på et element flyttes langs elementet med snapping", () => {
    const m = fixture("skraa");
    const s = begin(m, { kind: "load", id: "P1" });
    const moved = asModel(to(s, m, { x: 1.26, y: 0.4 }));
    expect(loadOf(moved, "P1")).toMatchObject({ member: "AB", at: 0.26 });
    // Utenfor bjelken: lasten stopper i enden.
    expect(loadOf(asModel(to(s, m, { x: 7, y: 0 })), "P1")).toMatchObject({ member: "AB", at: 1 });
  });

  it("en last i et lastpunkt gjør noden om: elementene slås sammen, og løsningen er den samme i startpunktet", () => {
    const m = fixture("gerber");
    const s = begin(m, { kind: "load", id: "P1" });
    // For lite drag til å velge retning: ingen endring ennå.
    expect(to(s, m, { x: 5.02, y: 0 })).toBeNull();
    const moved = asModel(to(s, m, { x: 5.37, y: 0.2 }));
    expect(moved.nodes.map((n) => n.id)).toEqual(["A", "H", "C"]);
    expect(moved.members.map((x) => x.id)).toEqual(["AH", "HC"]);
    expect(loadOf(moved, "P1")).toMatchObject({ member: "HC", at: 0.6 });
    // Tilbake i startpunktet: den opprinnelige modellen (med noden P) kommer tilbake.
    expect(asModel(to(s, m, { x: 4.98, y: 0 }))).toBe(m);
    // Videre forbi leddet i H og inn på AH.
    const onAH = loadOf(asModel(to(s, m, { x: 2.04, y: 0 })), "P1");
    expect(onAH).toMatchObject({ member: "AH" });
    expect(onAH.type === "point" && onAH.at).toBeCloseTo(2 / 3, 10);
  });

  it("nodene langs bjelken kan nås selv om de ikke ligger på rutenettet", () => {
    const m = build({
      nodes: [
        { id: "A", x: 0, y: 0 },
        { id: "B", x: 2.35, y: 0 },
        { id: "C", x: 4, y: 0 },
      ],
      members: [
        { id: "AB", i: "A", j: "B", kind: "beam" },
        { id: "BC", i: "B", j: "C", kind: "beam" },
      ],
      supports: [
        { node: "A", type: "pinned" },
        { node: "B", type: "roller", angle_deg: 0 },
      ],
      loads: [{ id: "P", type: "point", member: "BC", at: 0.5, P: 1, angle_deg: -90 }],
    });
    const s = begin(m, { kind: "load", id: "P" });
    // 2,33 ligger nærmere B (2,35) enn rutepunktet 2,3.
    expect(loadOf(asModel(to(s, m, { x: 2.33, y: 0 })), "P")).toMatchObject({ member: "BC", at: 0 });
    expect(loadOf(asModel(to(s, m, { x: 2.28, y: 0 })), "P")).toMatchObject({ member: "AB" });
  });

  it("en last i en fri ende flyttes inn på elementet", () => {
    const m = fixture("utkrager");
    const s = begin(m, { kind: "load", id: "P1" });
    const moved = asModel(to(s, m, { x: 2.96, y: -0.1 }));
    expect(loadOf(moved, "P1")).toMatchObject({ member: "AB", at: 0.75 });
    expect(moved.nodes).toHaveLength(2);
  });

  it("en last forbi et opplager følger bjelken videre", () => {
    const m = fixture("symbolsk");
    const s = begin(m, { kind: "load", id: "F" });
    expect(loadOf(asModel(to(s, m, { x: 0.42, y: 0 })), "F")).toMatchObject({ member: "AB", at: 0.4 });
  });

  it("en last i et fagverksknutepunkt kan ikke dras langs stavene, men retningen kan endres", () => {
    const m = fixture("fagverk");
    const load = m.loads.find((l) => l.type === "point")!;
    expect(startDrag(m, { kind: "load", id: load.id }, "body", { x: 0, y: 0 }, view(m), loadScales(m))).toBeNull();
    expect(begin(m, { kind: "load", id: load.id }, "tail").kind).toBe("load-vector");
  });
});

describe("dra halen på en punktlast", () => {
  it("endrer størrelse og retning, med vinkelen snappet til 5°", () => {
    const m = fixture("skraa");
    const s = begin(m, { kind: "load", id: "P1" }, "tail");
    if (s.kind !== "load-vector") throw new Error();
    const scale = loadScales(m).force; // piksler per kN
    // Halen 60 px til høyre og 80 px over spissen: lasten peker ned mot venstre, 100 px lang.
    const screen = { x: s.anchor.x + 60, y: s.anchor.y - 80 };
    const r = dragTo(s, view(m).toWorld(screen), screen)!;
    const expectedP = Math.round(100 / scale / s.step) * s.step;
    expect(r.update).toEqual([
      { path: "loads.P1.P", value: Number(expectedP.toFixed(10)) },
      { path: "loads.P1.angle_deg", value: -125 },
    ]);
    // Halen rett til venstre: lasten peker mot høyre (0°).
    const left = { x: s.anchor.x - 40, y: s.anchor.y };
    expect((dragTo(s, view(m).toWorld(left), left)!.update as { value: unknown }[])[1]!.value).toBe(0);
    // Halen rett til høyre: 180°, ikke −180°.
    const right = { x: s.anchor.x + 40, y: s.anchor.y };
    expect((dragTo(s, view(m).toWorld(right), right)!.update as { value: unknown }[])[1]!.value).toBe(180);
  });
});

describe("dra en fordelt last", () => {
  it("endene snapper til 0,1 langs elementet", () => {
    const m = fixture("utkrager");
    const from = begin(m, { kind: "load", id: "q_AB" }, "from");
    expect(to(from, m, { x: 1.04, y: 0.3 })!.update).toEqual([{ path: "loads.q_AB.from", value: 0.25 }]);
    const end = begin(m, { kind: "load", id: "q_AB" }, "to");
    expect(to(end, m, { x: 3.12, y: 0 })!.update).toEqual([{ path: "loads.q_AB.to", value: 0.775 }]);
  });

  it("hele lasten flyttes uten å endre lengden, og stopper i enden av elementet", () => {
    const m: Model = { ...fixture("utkrager"), loads: [{ ...loadOf(fixture("utkrager"), "q_AB"), from: 0.25, to: 0.5 } as Model["loads"][number]] };
    const s = begin(m, { kind: "load", id: "q_AB" }, "body", { x: 1.5, y: 0 });
    expect(to(s, m, { x: 2.02, y: 0 })!.update).toEqual([
      { path: "loads.q_AB.from", value: 0.375 },
      { path: "loads.q_AB.to", value: 0.625 },
    ]);
    expect(to(s, m, { x: 9, y: 0 })!.update).toEqual([
      { path: "loads.q_AB.from", value: 0.75 },
      { path: "loads.q_AB.to", value: 1 },
    ]);
  });
});

describe("hele dra-operasjonen gjennom storen", () => {
  beforeEach(() => useStore.getState().loadModel(fixture("gerber")));

  it("omgjøringen av lastpunktet blir ett steg i historikken, og angre gir noden tilbake", () => {
    const store = useStore.getState();
    const m = store.model!;
    const s = begin(m, { kind: "load", id: "P1" });
    store.beginGesture();
    for (const x of [5.3, 5.6, 6.2]) store.updateGesture(to(s, m, { x, y: 0 })!.update);
    store.endGesture();
    const after = useStore.getState();
    expect(after.past).toHaveLength(1);
    expect(loadOf(after.model!, "P1")).toMatchObject({ member: "HC", at: 0.8 });
    expect(solve(after.model!).status).toBe("ok");
    after.undo();
    expect(useStore.getState().model).toBe(m);
  });

  it("ugyldige mellomtilstander avvises og forrige gyldige modell beholdes; Escape (cancelGesture) gir starten", () => {
    const store = useStore.getState();
    const m = store.model!;
    const s = begin(m, { kind: "node", id: "P" });
    store.beginGesture();
    expect(store.updateGesture(to(s, m, { x: 6, y: 0.5 })!.update).ok).toBe(true);
    const valid = useStore.getState().model;
    // Noden P oppå C gir et element med lengde null.
    expect(store.updateGesture(to(s, m, { x: 7, y: 0 })!.update).ok).toBe(false);
    expect(useStore.getState().model).toBe(valid);
    store.cancelGesture();
    expect(useStore.getState().model).toBe(m);
    expect(useStore.getState().past).toHaveLength(0);
  });

  it("klikk på opplager følger kursets rekkefølge", () => {
    const m = fixture("gerber");
    expect(begin(m, { kind: "support", id: "C" }).kind).toBe("support");
    expect(dragTo(begin(m, { kind: "support", id: "C" }), { x: 0, y: 0 }, { x: 0, y: 0 })).toBeNull();
  });
});

describe("StructureView", () => {
  it("uthever usikre entiteter bare i bekreftelsessteget, i tillegg til storens valg og uthevinger", () => {
    const m: Model = {
      ...fixture("skraa"),
      provenance: [{ entity_kind: "load", entity: "M1", confidence: 0.3, note: "Usikker retning." }],
    };
    const state = { selection: { kind: "member", id: "AB" } as EntityRef, highlights: [{ kind: "support", id: "A" } as EntityRef] };
    const confirm = highlightProps({ ...state, phase: "confirm" }, m);
    expect([...confirm.uncertain!]).toEqual(["load:M1"]);
    expect(confirm.selection).toEqual(state.selection);
    expect(confirm.highlights).toEqual(state.highlights);
    expect(highlightProps({ ...state, phase: "explore" }, m).uncertain).toBeUndefined();

    const doc = parseMarkup(renderToStaticMarkup(<StructureSvg model={m} result={solve(m)} viewport={view(m)} {...confirm} />));
    const g = (key: string) => findAll(doc, (e) => e.tag === "g" && e.attrs["data-entity"] === key)[0]!;
    expect(hasClass(g("load:M1"), "is-uncertain")).toBe(true);
    expect(hasClass(g("support:A"), "is-uncertain")).toBe(true);
    expect(hasClass(g("member:AB"), "is-selected")).toBe(true);
  });

  it("rendres uten nettleser, med treff-lag (storen gir starttilstanden på serveren)", () => {
    const m = fixture("gerber");
    const doc = parseMarkup(renderToStaticMarkup(<StructureView model={m} result={solve(m)} viewport={view(m)} />));
    expect(doc.children[0]!.tag).toBe("svg");
    expect(findAll(doc, (e) => hasClass(e, "st-hit")).length).toBeGreaterThan(0);
  });

  it("modeller i mm og N tegnes og dras i sine egne enheter", () => {
    const m = build({
      units: { length: "mm", force: "N" },
      nodes: [
        { id: "A", x: 0, y: 0 },
        { id: "B", x: 3000, y: 0 },
      ],
      members: [{ id: "AB", i: "A", j: "B", kind: "beam" }],
      supports: [
        { node: "A", type: "pinned" },
        { node: "B", type: "roller", angle_deg: 0 },
      ],
      loads: [{ id: "P", type: "point", member: "AB", at: 0.5, P: 1200, angle_deg: -90 }],
    });
    const s = begin(m, { kind: "load", id: "P" });
    // Steget er 10 mm: 1004 mm snapper til 1000 mm.
    const moved = loadOf(asModel(to(s, m, { x: 1004, y: 0 })), "P");
    expect(moved.type === "point" && moved.at).toBeCloseTo(1000 / 3000, 10);
    const doc = parseMarkup(renderToStaticMarkup(<StructureSvg model={m} result={solve(m)} viewport={view(m)} />));
    expect(findAll(doc, (e) => e.tag === "tspan").map((t) => t.text)).toContain("1200 N");
  });
});
