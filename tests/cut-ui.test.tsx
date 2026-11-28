// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { solve } from "../src/core/solver/index.js";
import { CutCard } from "../src/ui/cut3d/CutCard.js";
import { FIXTURES } from "../src/ui/fixtures.js";
import { fitViewport } from "../src/ui/geometry.js";
import { useStore } from "../src/ui/state/store.js";
import { StructureView } from "../src/ui/structure/StructureView.js";

const utkrager = FIXTURES.utkrager!.model;

beforeEach(() => {
  useStore.getState().loadModel(utkrager);
  useStore.getState().setCutMode("forces");
});
afterEach(cleanup);

describe("snitt i konstruksjonsvisningen", () => {
  it("klikk på et element legger et snitt, og dra flytter det langs bjelken", () => {
    const vp = fitViewport(utkrager, 900, 300);
    const { container } = render(<StructureView model={utkrager} result={solve(utkrager)} viewport={vp} />);
    const svg = container.querySelector("svg")!;
    const hit = container.querySelector('.st-hit[data-entity="member:AB"]')!;
    const p = vp.toScreen({ x: 1.03, y: 0 });
    fireEvent.pointerDown(hit, { button: 0, pointerId: 1, clientX: p.x, clientY: p.y });
    expect(useStore.getState().cut).toEqual({ member: "AB", at: 0.25, point: { x: 1, y: 0 } });
    expect(container.querySelector(".st-cut")).not.toBeNull();
    const q = vp.toScreen({ x: 3.04, y: 0 });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: q.x, clientY: q.y });
    fireEvent.pointerUp(svg, { pointerId: 1, clientX: q.x, clientY: q.y });
    expect(useStore.getState().cut?.point).toEqual({ x: 3, y: 0 });
    // Snittet er visning: modellen og angre-historikken er urørt.
    expect(useStore.getState().model).toBe(utkrager);
    expect(useStore.getState().past).toHaveLength(0);
  });

  it("i bekreftelsessteget velger et klikk bare elementet", () => {
    useStore.getState().loadModel(utkrager, "confirm");
    const vp = fitViewport(utkrager, 900, 300);
    const { container } = render(<StructureView model={utkrager} result={solve(utkrager)} viewport={vp} />);
    const p = vp.toScreen({ x: 1, y: 0 });
    fireEvent.pointerDown(container.querySelector('.st-hit[data-entity="member:AB"]')!, { button: 0, pointerId: 1, clientX: p.x, clientY: p.y });
    expect(useStore.getState().cut).toBeNull();
    expect(useStore.getState().selection).toEqual({ kind: "member", id: "AB" });
  });
});

describe("kortet «Snitt i 3D»", () => {
  it("vises ikke uten snitt", () => {
    const { container } = render(<CutCard model={utkrager} result={solve(utkrager)} />);
    expect(container.innerHTML).toBe("");
  });

  it("viser N, V og M, bytter til spenninger og fjerner snittet", async () => {
    useStore.getState().setCut({ member: "AB", at: 0.5, point: { x: 2, y: 0 } });
    render(<CutCard model={utkrager} result={solve(utkrager)} />);
    expect(screen.getByText("Element AB, 2 m fra A")).toBeTruthy();
    const rows = screen.getByRole("list", { name: "Snittkrefter" });
    expect(rows.textContent).toContain("11 kN");
    expect(rows.textContent).toContain("16 kNm (strekk i overkant)");
    // jsdom har ikke WebGL: 3D-flaten faller tilbake til en forklaring, tallene står fortsatt.
    expect(await screen.findByText(/trenger WebGL/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Spenninger" }));
    expect(screen.getByRole("button", { name: "Spenninger" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("82,3 MPa strekk")).toBeTruthy();
    expect(screen.getByText("11,2 MPa")).toBeTruthy();

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Fjern snittet" })));
    expect(useStore.getState().cut).toBeNull();
  });

  it("skjuler tallene til studenten har prøvd, også spenningene", () => {
    const gerber = FIXTURES.gerber!.model;
    useStore.getState().loadModel(gerber);
    useStore.getState().setCut({ member: "AH", at: 0.5, point: { x: 1.5, y: 0 } });
    useStore.getState().setCutMode("stress");
    render(<CutCard model={gerber} result={solve(gerber)} />);
    const rows = screen.getByRole("list", { name: "Snittkrefter" });
    expect(rows.textContent).not.toMatch(/\d/);
    expect(screen.getByText(/Tverrsnittet står ikke i oppgaven/)).toBeTruthy();
  });
});
