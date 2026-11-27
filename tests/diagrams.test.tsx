import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { solve } from "../src/core/solver/index.js";
import type { Model } from "../src/core/schema.js";
import { DiagramsSvg } from "../src/ui/diagrams/DiagramsSvg.js";
import { DiagramsView } from "../src/ui/diagrams/DiagramsView.js";
import { toolbarChips, type Chip } from "../src/ui/diagrams/toolbar.js";
import { FIXTURES } from "../src/ui/fixtures.js";
import { fitViewport } from "../src/ui/geometry.js";
import { useStore, type DiagramSettings } from "../src/ui/state/store.js";
import { model } from "./helpers.js";

function render(m: Model, extra: Partial<Parameters<typeof DiagramsSvg>[0]> = {}) {
  const viewport = fitViewport(m, 900, 400);
  return renderToStaticMarkup(<DiagramsSvg model={m} result={solve(m)} viewport={viewport} {...extra} />);
}

const mechanism = model({
  nodes: [
    { id: "A", x: 0, y: 0 },
    { id: "B", x: 6, y: 0 },
  ],
  members: [{ id: "AB", i: "A", j: "B", kind: "beam" }],
  supports: [
    { node: "A", type: "roller" },
    { node: "B", type: "roller" },
  ],
  loads: [{ id: "P", type: "point", member: "AB", at: 0.5, P: 10, angle_deg: -90 }],
});

describe("DiagramsSvg", () => {
  it.each(Object.entries(FIXTURES))("%s rendres uten feil", (_name, f) => {
    const svg = render(f.model);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("Deformert form");
    expect(svg).not.toContain("NaN");
    // Ingen verktøylinje uten onSettingsChange (snapshot og tester)
    expect(svg).not.toContain("dg-chip");
  });

  it("bjelke: alle tre størrelser, M-tall og kvalitativ deformasjon", () => {
    const svg = render(FIXTURES.bjelke!.model);
    expect(svg).toContain("M – bøyemoment, tegnet på strekksiden");
    expect(svg).toContain("V – skjærkraft");
    expect(svg).toContain("N = 0 i alle elementer.");
    expect(svg).toContain("29,4 kNm");
    expect(svg).toContain("Kvalitativ form – tverrsnitt er ikke oppgitt");
  });

  it("symbolsk oppgave skriver tallene med symboler", () => {
    expect(render(FIXTURES.symbolsk!.model)).toContain("0,5 FL");
  });

  it("utkrager med tverrsnitt viser største forskyvning i mm", () => {
    expect(render(FIXTURES.utkrager!.model)).toMatch(/Største forskyvning 49,\d mm/);
  });

  it("mekanisme: melding i stedet for diagrammer", () => {
    const svg = render(mechanism);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("mekanisme");
    expect(svg).not.toContain("N – normalkraft");
  });

  it("ugyldig modell: meldingene fra valideringen", () => {
    const m = FIXTURES.bjelke!.model;
    const svg = renderToStaticMarkup(
      <DiagramsSvg model={m} result={{ status: "invalid", issues: [{ level: "error", code: "test", message: "Noden Q finnes ikke." }] }} viewport={fitViewport(m, 600, 300)} />,
    );
    expect(svg).toContain("Modellen er ugyldig");
    expect(svg).toContain("Noden Q finnes ikke.");
  });

  it("tåler et viewport for hele bildet (som i pnpm snapshot)", () => {
    const m = FIXTURES.ramme!.model;
    const svg = renderToStaticMarkup(<DiagramsSvg model={m} result={solve(m)} viewport={fitViewport(m, 900, 700)} />);
    expect(svg).toMatch(/^<svg[^>]* width="900"/);
  });

  it("verktøylinjen vises med onSettingsChange, og palette-propen gir fargene", () => {
    const svg = render(FIXTURES.gerber!.model, { onSettingsChange: () => {}, palette: { M: "#123456" } });
    expect(svg).toContain("dg-chip");
    expect(svg).toContain("Forstørrelse:");
    expect(svg).toContain("#123456");
  });
});

describe("verktøylinjen", () => {
  const settings: DiagramSettings = { N: true, V: true, M: true, deformed: true, deformationScale: "auto" };
  const chip = (chips: (Chip | string)[], label: string) => chips.find((c): c is Chip => typeof c !== "string" && c.label === label)!;

  it("slår diagrammene av og på", () => {
    const onChange = vi.fn();
    const chips = toolbarChips(settings, 8, onChange);
    chip(chips, "M").onPress();
    chip(chips, "Deformert form").onPress();
    expect(onChange.mock.calls).toEqual([[{ M: false }], [{ deformed: false }]]);
    expect(chip(chips, "auto").active).toBe(true);
  });

  it("dobler og halverer forstørrelsen som brukes nå, og auto tilbakestiller", () => {
    const onChange = vi.fn();
    const chips = toolbarChips({ ...settings, deformationScale: 3 }, 3, onChange);
    chip(chips, "×2").onPress();
    chip(chips, "÷2").onPress();
    chip(chips, "auto").onPress();
    expect(onChange.mock.calls).toEqual([[{ deformationScale: 6 }], [{ deformationScale: 1.5 }], [{ deformationScale: "auto" }]]);
  });

  it("ingen forstørrelsesknapper uten deformert form, og deaktivert uten forskyvninger", () => {
    expect(toolbarChips({ ...settings, deformed: false }, 8, () => {}).some((c) => typeof c !== "string" && c.label === "×2")).toBe(false);
    expect(chip(toolbarChips(settings, 0, () => {}), "×2").disabled).toBe(true);
  });
});

describe("DiagramsView", () => {
  it("rendres som kort med innstillingene i storen og verktøylinjen", () => {
    const m = FIXTURES.gerber!.model;
    const html = renderToStaticMarkup(<DiagramsView model={m} result={solve(m)} viewport={fitViewport(m, 900, 300)} />);
    expect(useStore.getState().diagrams).toMatchObject({ N: true, V: true, M: true, deformed: true });
    expect(html).toContain('role="toolbar"');
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>N<\/button>/);
    expect(html).toContain('aria-label="Doble forstørrelsen"');
    // Ett kort per diagram, med overskriften i HTML.
    expect(html.match(/class="card figure-card diagrams dg-card /g)).toHaveLength(4);
    expect(html).toContain("<h3>M – bøyemoment, tegnet på strekksiden</h3>");
    expect(html).toContain("<h3>Deformert form</h3>");
  });
});
