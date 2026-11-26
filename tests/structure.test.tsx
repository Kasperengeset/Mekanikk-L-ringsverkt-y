import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Model } from "../src/core/schema";
import { solve } from "../src/core/solver";
import { FIXTURES } from "../src/ui/fixtures";
import { fitViewport } from "../src/ui/geometry";
import type { EntityRef } from "../src/ui/state/store";
import { DEFAULT_PALETTE, uncertainKeys } from "../src/ui/structure/highlight";
import { supportDirection } from "../src/ui/structure/layout";
import { StructureSvg, type StructureSvgProps } from "../src/ui/structure/StructureSvg";
import { findAll, hasClass, parseMarkup, textContent, within, type El } from "./structure-markup";

function render(model: Model, extra: Partial<StructureSvgProps> = {}): El {
  const markup = renderToStaticMarkup(<StructureSvg model={model} result={solve(model)} viewport={fitViewport(model, 900, 450)} {...extra} />);
  expect(markup.startsWith("<svg")).toBe(true);
  return parseMarkup(markup);
}

/** Den synlige gruppen for en entitet. */
function group(doc: El, key: string): El {
  const g = findAll(doc, (e) => e.tag === "g" && e.attrs["data-entity"] === key && within(e, "st-visual"))[0];
  if (!g) throw new Error(`Fant ikke ${key}`);
  return g;
}
/** Treff-flaten for en del av en entitet (bare med interactive). */
const hit = (doc: El, key: string, part = "body") =>
  findAll(doc, (e) => e.attrs["data-entity"] === key && e.attrs["data-part"] === part && within(e, "st-hits"))[0];
const num = (el: El, attr: string) => Number(el.attrs[attr]);
const texts = (doc: El) => findAll(doc, (e) => e.tag === "text").map(textContent);

describe("StructureSvg", () => {
  it.each(Object.entries(FIXTURES))("%s tegnes med alle elementer, opplagre, laster og nodenavn", (_name, f) => {
    const doc = render(f.model);
    for (const m of f.model.members) group(doc, `member:${m.id}`);
    for (const s of f.model.supports) expect(hasClass(group(doc, `support:${s.node}`), `st-${s.type}`)).toBe(true);
    for (const l of f.model.loads) group(doc, `load:${l.id}`);
    for (const n of f.model.nodes) expect(texts(doc)).toContain(n.id);
    // Uten interaktivitet er det ikke noe treff-lag.
    expect(findAll(doc, (e) => hasClass(e, "st-hit"))).toHaveLength(0);
  });

  it("uthevinger får klassen is-uncertain og fargen for usikkerhet", () => {
    const highlights: EntityRef[] = [
      { kind: "load", id: "P1" },
      { kind: "support", id: "B" },
      { kind: "node", id: "A" },
    ];
    const doc = render(FIXTURES.skraa!.model, { highlights });
    for (const key of ["load:P1", "support:B", "node:A"]) {
      const g = group(doc, key);
      expect(hasClass(g, "is-uncertain")).toBe(true);
      expect(g.attrs.color).toBe(DEFAULT_PALETTE.uncertain);
    }
    const other = group(doc, "load:M1");
    expect(hasClass(other, "is-uncertain")).toBe(false);
    expect(other.attrs.color).toBe(DEFAULT_PALETTE.load);
    expect(group(doc, "support:A").attrs.color).toBeUndefined(); // arver forgrunnsfargen
  });

  it("usikre entiteter fra provenance (confidence < 0,7) utheves", () => {
    const model: Model = {
      ...FIXTURES.skraa!.model,
      provenance: [
        { entity_kind: "support", entity: "B", field: "type", confidence: 0.5, note: "Rullelager eller fastlager?" },
        { entity_kind: "load", entity: "P1", confidence: 0.9, note: "Sikker." },
        { entity_kind: "dimension", entity: "AB", confidence: 0.4, note: "Lengden er uleselig." },
      ],
    };
    const keys = uncertainKeys(model);
    expect([...keys].sort()).toEqual(["member:AB", "support:B"]);
    const doc = render(model, { uncertain: keys });
    expect(hasClass(group(doc, "support:B"), "is-uncertain")).toBe(true);
    expect(group(doc, "member:AB").attrs.color).toBe(DEFAULT_PALETTE.uncertain);
    expect(hasClass(group(doc, "load:P1"), "is-uncertain")).toBe(false);
  });

  it("valgt entitet markeres med aksentfargen, også når den er uthevet", () => {
    const doc = render(FIXTURES.gerber!.model, { selection: { kind: "member", id: "HP" }, highlights: [{ kind: "member", id: "HP" }] });
    const g = group(doc, "member:HP");
    expect(hasClass(g, "is-selected")).toBe(true);
    expect(hasClass(g, "is-uncertain")).toBe(false);
    expect(g.attrs.color).toBe(DEFAULT_PALETTE.accent);
    expect(g.children.filter((c) => c.tag === "line")).toHaveLength(2); // glorie + element
  });

  it("et uthevet tverrsnitt uthever elementene som bruker det", () => {
    const doc = render(FIXTURES.utkrager!.model, { highlights: [{ kind: "section", id: "S" }] });
    expect(hasClass(group(doc, "member:AB"), "is-uncertain")).toBe(true);
  });

  it("paletten kan byttes (f.eks. for mørk modus i snapshot)", () => {
    const doc = render(FIXTURES.gerber!.model, { palette: { load: "#47cd89" } });
    expect(group(doc, "load:P1").attrs.color).toBe("#47cd89");
  });

  it("pilene peker riktig vei og etikettene står i oppgavens enheter", () => {
    const gerber = render(FIXTURES.gerber!.model, { interactive: true });
    const p1 = hit(gerber, "load:P1")!;
    // Halen (x1, y1) rett over spissen (x2, y2): lasten virker nedover.
    expect(num(p1, "x1")).toBeCloseTo(num(p1, "x2"));
    expect(num(p1, "y1")).toBeLessThan(num(p1, "y2"));
    expect(texts(gerber)).toContain("6 kN");
    // Tre like fordelte laster etter hverandre får én felles etikett.
    expect(texts(gerber).filter((t) => t === "2 kN/m")).toHaveLength(1);
    const envelope = group(gerber, "load:q_AH").children.find((c) => c.tag === "line")!;
    const beam = group(gerber, "member:AH").children.find((c) => c.tag === "line")!;
    expect(num(envelope, "y1")).toBeLessThan(num(beam, "y1"));

    const skraa = render(FIXTURES.skraa!.model, { interactive: true });
    const p = hit(skraa, "load:P1")!;
    // −135°: pilen peker ned mot venstre, så halen står oppe til høyre for spissen.
    expect(num(p, "x1")).toBeGreaterThan(num(p, "x2"));
    expect(num(p, "y1")).toBeLessThan(num(p, "y2"));
    // M > 0: buen går mot klokka (sweep-flagg 0 i SVG, der y peker nedover).
    const arc = group(skraa, "load:M1").children.find((c) => c.tag === "path")!;
    expect(arc.attrs.d).toMatch(/A17,17 0 1 0 /);
    expect(texts(skraa)).toContain("4 kNm");

    expect(texts(render(FIXTURES.symbolsk!.model))).toContain("F");
    expect(texts(render(FIXTURES.treledd!.model)).join(" ")).toMatch(/10 kN\/m\s*per horisontal lengde/);
  });

  it("negativt moment og negativ P snur pilene", () => {
    const m = FIXTURES.skraa!.model;
    const flipped: Model = {
      ...m,
      loads: m.loads.map((l) => (l.type === "moment" ? { ...l, M: -4 } : l.type === "point" ? { ...l, P: -8 } : l)),
    };
    const doc = render(flipped, { interactive: true });
    expect(group(doc, "load:M1").children.find((c) => c.tag === "path")!.attrs.d).toMatch(/A17,17 0 1 1 /);
    const p = hit(doc, "load:P1")!;
    // −8 kN i −135° er 8 kN i 45°: halen nede til venstre for spissen.
    expect(num(p, "x1")).toBeLessThan(num(p, "x2"));
    expect(num(p, "y1")).toBeGreaterThan(num(p, "y2"));
    expect(texts(doc)).toContain("8 kN");
  });

  it("opplagrene roteres etter underlaget og står på motsatt side av elementet", () => {
    const skraa = FIXTURES.skraa!.model;
    const roller = supportDirection(skraa, skraa.supports.find((s) => s.node === "B")!);
    expect([roller.x, roller.y].map((v) => Number(v.toFixed(3)))).toEqual([0.5, 0.866]);
    const pinned = supportDirection(skraa, skraa.supports.find((s) => s.node === "A")!);
    expect([pinned.x + 0, pinned.y]).toEqual([0, 1]);
    // Fast innspenning i venstre ende av en utkrager: veggen står til venstre.
    const utkrager = FIXTURES.utkrager!.model;
    const fixed = supportDirection(utkrager, utkrager.supports[0]!);
    expect([fixed.x, fixed.y + 0]).toEqual([-1, 0]);
    // Fast innspenning under en søyle: veggen ligger under.
    const ramme = FIXTURES.ramme!.model;
    const base = ramme.supports.find((s) => s.type === "fixed")!;
    expect(supportDirection(ramme, base).y).toBeCloseTo(1);
  });

  it("en mekanisme markeres i noden løseren peker på", () => {
    const m = FIXTURES.skraa!.model;
    const mechanism: Model = { ...m, supports: m.supports.map((s) => ({ ...s, type: "roller" as const, angle_deg: 0 })) };
    expect(findAll(render(mechanism), (e) => hasClass(e, "st-mechanism"))).toHaveLength(1);
    expect(findAll(render(m), (e) => hasClass(e, "st-mechanism"))).toHaveLength(0);
  });

  it("interaktiv tegning har treff-flater for håndtakene", () => {
    const doc = render(FIXTURES.skraa!.model, { interactive: true, selection: { kind: "load", id: "P1" } });
    expect(hit(doc, "load:P1", "tail")).toBeDefined();
    expect(hit(doc, "support:B")).toBeDefined();
    expect(hit(doc, "node:A")).toBeDefined();
    expect(hit(doc, "member:AB")).toBeDefined();
    // Valgt punktlast viser håndtaket på halen.
    expect(group(doc, "load:P1").children.some((c) => c.tag === "circle")).toBe(true);
    const dist = render(FIXTURES.utkrager!.model, { interactive: true });
    expect(hit(dist, "load:q_AB", "from")).toBeDefined();
    expect(hit(dist, "load:q_AB", "to")).toBeDefined();
  });

  it("etiketten til en fordelt last viker for en punktlast midt på", () => {
    const base = FIXTURES.utkrager!.model;
    const m: Model = {
      ...base,
      loads: base.loads.map((l) => (l.type === "point" ? { id: l.id, type: "point" as const, member: "AB", at: 0.5, P: l.P, angle_deg: l.angle_deg } : l)),
    };
    const doc = render(m, { interactive: true });
    const arrowX = num(hit(doc, "load:P1")!, "x1");
    const label = findAll(doc, (e) => e.tag === "text" && textContent(e) === "3 kN/m")[0]!;
    // Etiketten er sentrert; halv bredde ≈ 20 px, så midten må ligge godt unna pilen.
    expect(Math.abs(num(label, "x") - arrowX)).toBeGreaterThan(40);
  });

  it("etikettene holder seg innenfor tegneflaten", () => {
    for (const f of Object.values(FIXTURES)) {
      const doc = render(f.model);
      for (const t of findAll(doc, (e) => e.tag === "text")) {
        expect(num(t, "x")).toBeGreaterThanOrEqual(0);
        expect(num(t, "x")).toBeLessThanOrEqual(900);
        expect(num(t, "y")).toBeGreaterThan(8);
        expect(num(t, "y")).toBeLessThanOrEqual(450);
      }
    }
  });
});
